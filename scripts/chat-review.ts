/**
 * The Chat review — run every two weeks by the self-improvement routine (or by hand):
 *
 *   1. loads every Chat conversation with a trace from the last `--days` (default 14);
 *   2. an independent Opus-tier judge reads each WHOLE conversation and routes every gap to
 *      content / retrieval / generation / grounding (`lib/review/chat-review.ts`);
 *   3. the material generation + grounding gaps — the ones Chat's prompt can fix — go to a
 *      proposer, which writes ONE prompt edit and fresh eval cases;
 *   4. the full report (users' data) is saved PRIVATELY: Plugent's Firestore `chat_reviews`, and
 *      `review-out/report.json` (gitignored). `review-out/proposal.json` holds only counts and the
 *      public-safe proposal, and is written on EVERY run (also "nothing to review"), so the routine
 *      never needs to read the log; stdout prints counts and the proposal, never a question, passage
 *      or answer.
 *
 * ⚠️ Runs where its logs are private (a local shell, a Claude routine) — NEVER in GitHub Actions on
 * this public repo, whose logs anyone can read.
 *
 * Needs PLUGENT_SERVICE_ACCOUNT_JSON (or FIRESTORE_EMULATOR_HOST) and AI_GATEWAY_API_KEY.
 *
 *   pnpm chat:review                     # judge + propose + save
 *   pnpm chat:review -- --dry-run        # load and build the judge prompts only: no model call, no write
 *   pnpm chat:review -- --days=30 --limit=50
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { CHAT_PROMPT_VERSION } from "@/lib/agents/chat-prompt";
import { plugentDb } from "@/lib/firebase/admin";
import {
  JUDGE_MODEL,
  type Judgement,
  judge,
  judgePrompt,
  PROMPT_LEVERS,
  propose,
  tally,
} from "@/lib/review/chat-review";
import { loadConversations } from "@/lib/review/load";

dotenvConfig({ path: ".env.local" });
dotenvConfig();

const flag = (name: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DAYS = Math.max(1, Number(flag("days") ?? 14) || 14);
const LIMIT = Math.max(1, Number(flag("limit") ?? 200) || 200);
const DRY = process.argv.includes("--dry-run");
const OUT = "review-out";
/** A review quotes users' data, so it is kept no longer than the traces it was built from. */
const REVIEW_TTL_DAYS = 30;

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/** `review-out/proposal.json`: counts and the proposal only — the one output a commit or a PR may carry. */
function writeProposal(summary: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "proposal.json"), JSON.stringify(summary, null, 2));
}

async function main() {
  // An earlier run's files must never pass for this run's: a run that fails leaves none.
  rmSync(path.join(OUT, "proposal.json"), { force: true });
  rmSync(path.join(OUT, "report.json"), { force: true });
  const db = plugentDb();
  const conversations = await loadConversations(db, DAYS, LIMIT);
  const turns = conversations.reduce((n, c) => n + c.turns.length, 0);
  const traced = conversations.reduce((n, c) => n + c.turns.filter((t) => t.trace).length, 0);
  const counts = { windowDays: DAYS, conversations: conversations.length, turns, traced };
  console.log(
    `\n🔎 Chat review — last ${DAYS} days, prompt ${CHAT_PROMPT_VERSION}, judge ${JUDGE_MODEL}`,
  );
  console.log(`   ${conversations.length} conversations, ${turns} turns (${traced} with a trace)`);

  if (DRY) {
    let broken = 0;
    const sizes = conversations.map((c) => {
      try {
        return judgePrompt(c).length;
      } catch {
        broken++;
        return 0;
      }
    });
    console.log(
      `   dry run: ${sizes.length - broken} judge prompts built (${broken} malformed), ${Math.max(0, ...sizes)} chars at most. No model call, nothing saved.\n`,
    );
    return;
  }
  if (conversations.length === 0) {
    writeProposal({
      at: new Date().toISOString(),
      promptVersion: CHAT_PROMPT_VERSION,
      counts,
      tally: null,
      proposal: { error: "nothing to review" },
    });
    console.log(`   nothing to review. ${OUT}/proposal.json says so.\n`);
    return;
  }

  const results: Judgement[] = await pool(conversations, 4, judge);
  const t = tally(conversations, results);
  const fixable = results
    .flatMap((r) => r.gaps)
    .filter((g) => g.severity === "material" && PROMPT_LEVERS.includes(g.lever));
  const proposal = await propose(fixable, conversations);

  console.log(
    `\n   verdicts: ${t.verdicts.good} good · ${t.verdicts.minor} minor · ${t.verdicts.material} material · ${t.errors} unjudged`,
  );
  console.log(
    `   material gaps by lever: ${Object.entries(t.material)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
  console.log(
    `   minor gaps by lever:    ${Object.entries(t.minor)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
  if ("error" in proposal) console.log(`\n   no proposal: ${proposal.error}`);
  else
    console.log(
      `\n   PROPOSAL: ${proposal.title}\n   ${proposal.problem}\n   addresses ${proposal.addresses?.gaps}/${proposal.addresses?.of} · ${proposal.cases.length} new case(s)`,
    );

  // proposal.json FIRST: a failed save below must not leave the routine without it.
  const at = new Date().toISOString();
  const summary = {
    reviewId: null as string | null,
    at,
    promptVersion: CHAT_PROMPT_VERSION,
    counts,
    tally: t,
    proposal,
  };
  writeProposal(summary);
  writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ at, tally: t, results, proposal }, null, 2),
  );
  try {
    // `uids` lets an account's deletion remove its results; `expireAt` is the TTL
    // (firestore.indexes.json), so the review quotes no one past the traces' 30 days.
    const ref = await db.collection("chat_reviews").add({
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + REVIEW_TTL_DAYS * 86_400_000),
      windowDays: DAYS,
      promptVersion: CHAT_PROMPT_VERSION,
      judge: JUDGE_MODEL,
      tally: t,
      uids: [...new Set(results.map((r) => r.uid))],
      results,
      proposal,
    });
    writeProposal({ ...summary, reviewId: ref.id });
    console.log(
      `\n   saved: chat_reviews/${ref.id} · ${OUT}/report.json (private) · ${OUT}/proposal.json\n`,
    );
  } catch (err) {
    writeProposal({ ...summary, saveError: "the review was not saved to Firestore" });
    console.error(
      `\n   NOT SAVED to Firestore (${String((err as Error)?.message ?? err).slice(0, 120)}); ${OUT}/proposal.json is written.\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
