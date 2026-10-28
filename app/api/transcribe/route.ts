/**
 * POST /api/transcribe — Speak (audit F2): the composer's recorded clip to text
 * (`lib/agents/transcribe.ts`). Body: the raw audio bytes, its mime in `content-type`. Answers
 * `{text, tokens, balanceAfter}`; the text goes into the composer, where the user reads it
 * before sending.
 *
 * ⚠️ GATED AND CHARGED LIKE EVERY AGENT STEP: the session's user, a rate limit before any money
 * is spent, the wallet `balance` returned, then one line charged to that same source with the
 * model's usage (`chargeOrKeep`, so a failed charge is kept for a retry, never lost). A failed
 * transcription is not charged.
 */
import { randomUUID } from "node:crypto";
import { after, type NextRequest, NextResponse } from "next/server";
import { readUserContext } from "@/lib/agents/profile";
import {
  AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  TRANSCRIBE_MODEL,
  transcribe,
} from "@/lib/agents/transcribe";
import { getSessionUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getBalance, SebtemberApiError } from "@/lib/sebtember/products";
import { chargeOrKeep, retryUnpaid } from "@/lib/unpaid";
import { logCharge } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Sebtember's `MAX_TRANSCRIBE_PER_MINUTE`. */
const PER_MINUTE = 10;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return bad("unauthorized", 401);
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (!mediaType || !AUDIO_TYPES.includes(mediaType)) return bad("unsupported_audio", 415);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) return bad("audio_too_long", 413);
  const audio = new Uint8Array(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (audio.byteLength === 0) return bad("empty_audio");
  if (audio.byteLength > MAX_AUDIO_BYTES) return bad("audio_too_long", 413);

  if (!(await consumeRateLimit(user.uid, "transcribe", PER_MINUTE))) {
    return bad("rate_limited", 429);
  }
  let wallet: Awaited<ReturnType<typeof getBalance>>;
  let languageName: string | null;
  try {
    const [w, context] = await Promise.all([getBalance(user.uid), readUserContext(user.uid)]);
    wallet = w;
    languageName = context.languageName;
  } catch (err) {
    console.error("[transcribe] balance", err);
    return bad(err instanceof SebtemberApiError ? err.code : "unavailable", 502);
  }
  if (wallet.balance < wallet.minimum) return bad("low_balance", 403);

  let result: Awaited<ReturnType<typeof transcribe>>;
  try {
    result = await transcribe(audio, mediaType, languageName);
  } catch (err) {
    console.error(`[transcribe] failed uid=${user.uid} model=${TRANSCRIBE_MODEL}`, err);
    return bad("transcribe_failed", 502);
  }

  let balanceAfter: number | null = null;
  if (result.tokens > 0) {
    const line = {
      id: `transcribe-${randomUUID()}`,
      tokens: result.tokens,
      operation: "transcribe",
      usage: [result.usage],
    };
    logCharge("transcribe", user.uid, line.id, line.tokens, line.usage);
    const charged = await chargeOrKeep("transcribe", user.uid, wallet.source, line);
    balanceAfter = charged?.balanceAfter ?? null;
  }
  after(() => retryUnpaid(user.uid, 5).catch(() => {}));
  return NextResponse.json({ text: result.text, tokens: result.tokens, balanceAfter });
}
