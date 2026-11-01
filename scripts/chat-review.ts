/**
 * The Chat review — run every two weeks by the self-improvement routine (or by hand):
 *
 *   1. loads every Chat conversation with a trace from the last `--days` (default 14);
 *   2. an independent Opus-tier judge reads each WHOLE conversation and routes every gap to
 *      content / retrieval / generation / grounding (`lib/review/chat-review.ts`);
 *   3. the material generation + grounding gaps — the ones Chat's prompt can fix — go to a
 *      proposer, which writes ONE prompt edit and fresh eval cases;
 *   4. the full report (users' data) is saved PRIVATELY: Plugent's Firestore `chat_reviews`, and
 *      `review-out/report.json` (gitignored). `review-out/proposal.json` holds only the public-safe
 *      proposal; stdout prints counts and the proposal, never a question, passage or answer.
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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { FieldValue } from "firebase-admin/firestore";
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

async function main() {
  const db = plugentDb();
  const conversations = await loadConversations(db, DAYS, LIMIT);
  const turns = conversations.reduce((n, c) => n + c.turns.length, 0);
  const traced = conversations.reduce((n, c) => n + c.turns.filter((t) => t.trace).length, 0);
  console.log(
    `\n🔎 Chat review — last ${DAYS} days, prompt ${CHAT_PROMPT_VERSION}, judge ${JUDGE_MODEL}`,
  );
  console.log(`   ${conversations.length} conversations, ${turns} turns (${traced} with a trace)`);

  if (DRY) {
    const sizes = conversations.map((c) => judgePrompt(c).length);
    console.log(
      `   dry run: ${sizes.length} judge prompts built, ${Math.max(0, ...sizes)} chars at most. No model call, nothing saved.\n`,
    );
    return;
  }
  if (conversations.length === 0) {
    console.log("   nothing to review.\n");
    return;
  }

  const results: Judgement[] = await pool(conversations, 4, judge);
  const t = tally(conversations, results);
  const fixable = results
    .flatMap((r) => r.gaps)
    .filter((g) => g.severity === "material" && PROMPT_LEVERS.includes(g.lever));
  const proposal = await propose(fixable);

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

  const at = new Date().toISOString();
  const ref = await db.collection("chat_reviews").add({
    createdAt: FieldValue.serverTimestamp(),
    windowDays: DAYS,
    promptVersion: CHAT_PROMPT_VERSION,
    judge: JUDGE_MODEL,
    tally: t,
    results,
    proposal,
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ id: ref.id, at, tally: t, results, proposal }, null, 2),
  );
  writeFileSync(
    path.join(OUT, "proposal.json"),
    JSON.stringify(
      { reviewId: ref.id, at, promptVersion: CHAT_PROMPT_VERSION, tally: t, proposal },
      null,
      2,
    ),
  );
  console.log(
    `\n   saved: chat_reviews/${ref.id} · ${OUT}/report.json (private) · ${OUT}/proposal.json\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
