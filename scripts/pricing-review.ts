/**
 * The Pricing review — run every two weeks by the self-improvement routine (or by hand), the twin of
 * `scripts/chat-review.ts` (`docs/pricing-loop.md`):
 *
 *   1. loads every Pricing run with a trace from the last `--days` (default 14);
 *   2. an independent Opus-tier judge reads each run — the read, every match, what the user unticked
 *      or exported — and routes every gap to extraction / identification / pricing / coverage /
 *      experience (`lib/review/pricing-review.ts`);
 *   3. the material gaps of the fixable levers go to a proposer, which writes ONE written proposal
 *      (not code: the operator approves it, then it is built);
 *   4. the full report (users' data) is saved PRIVATELY: Plugent's Firestore `pricing_reviews` and
 *      `review-out/pricing-report.json` (gitignored). `review-out/pricing-proposal.json` (counts and
 *      the guarded proposal) is written on EVERY run, and `review-out/pricing-proposal.md` — the PR's
 *      one file — when there is a proposal; stdout prints counts and the proposal only.
 *
 * ⚠️ Runs where its logs are private (a local shell, a Claude routine) — NEVER in GitHub Actions on
 * this public repo, whose logs anyone can read.
 *
 * Needs PLUGENT_SERVICE_ACCOUNT_JSON (or FIRESTORE_EMULATOR_HOST) and AI_GATEWAY_API_KEY.
 *
 *   pnpm pricing:review                  # judge + propose + save
 *   pnpm pricing:review -- --dry-run     # load and build the judge prompts only: no model call, no write
 *   pnpm pricing:review -- --days=30 --limit=50
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";
import { loadPricingCases } from "@/lib/review/pricing-load";
import {
  FIXABLE_LEVERS,
  judge,
  judgePrompt,
  PRICING_JUDGE_MODEL,
  PRICING_LEVERS,
  type PricingJudgement,
  type PricingTally,
  proposalMarkdown,
  propose,
  tally,
} from "@/lib/review/pricing-review";

dotenvConfig({ path: ".env.local" });
dotenvConfig();

const flag = (name: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DAYS = Math.max(1, Number(flag("days") ?? 14) || 14);
const LIMIT = Math.max(1, Number(flag("limit") ?? 100) || 100);
const DRY = process.argv.includes("--dry-run");
const OUT = "review-out";
const PROPOSALS = "docs/pricing-proposals";
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

const write = (name: string, body: string) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), body);
};

/** Earlier proposals, as "date — title (Status)", so the proposer does not repeat a declined one. */
function history(): string[] {
  if (!existsSync(PROPOSALS)) return [];
  return readdirSync(PROPOSALS)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .map((f) => {
      const md = readFileSync(path.join(PROPOSALS, f), "utf8");
      const title = md.match(/^## (.+)$/m)?.[1] ?? "(untitled)";
      const status = md.match(/^Status:\s*(.+)$/m)?.[1] ?? "unknown";
      return `${f.slice(0, 10)} — ${title} (${status.trim()})`;
    });
}

async function previousTally(db: FirebaseFirestore.Firestore): Promise<PricingTally | null> {
  const snap = await db
    .collection("pricing_reviews")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get()
    .catch(() => null);
  return (snap?.docs[0]?.get("tally") as PricingTally | undefined) ?? null;
}

async function main() {
  // An earlier run's files must never pass for this run's: a run that fails leaves none.
  for (const f of ["pricing-proposal.json", "pricing-proposal.md", "pricing-report.json"])
    rmSync(path.join(OUT, f), { force: true });
  const db = plugentDb();
  const cases = await loadPricingCases(db, DAYS, LIMIT);
  const counts = {
    windowDays: DAYS,
    runs: cases.length,
    reads: cases.filter((c) => c.extract).length,
    matches: cases.reduce((n, c) => n + c.matches.length, 0),
  };
  console.log(`\n🔎 Pricing review — last ${DAYS} days, judge ${PRICING_JUDGE_MODEL}`);
  console.log(`   ${counts.runs} runs, ${counts.reads} reads, ${counts.matches} matches traced`);

  if (DRY) {
    const sizes = cases.map((c) => judgePrompt(c).length);
    console.log(
      `   dry run: ${sizes.length} judge prompts built, ${Math.max(0, ...sizes)} chars at most. No model call, nothing saved.\n`,
    );
    return;
  }
  const at = new Date().toISOString();
  if (cases.length === 0) {
    write(
      "pricing-proposal.json",
      JSON.stringify(
        { at, counts, tally: null, proposal: { error: "nothing to review" } },
        null,
        2,
      ),
    );
    console.log(`   nothing to review. ${OUT}/pricing-proposal.json says so.\n`);
    return;
  }

  const previous = await previousTally(db);
  const results: PricingJudgement[] = await pool(cases, 4, judge);
  const t = tally(cases, results);
  const fixable = results
    .flatMap((r) => r.gaps)
    .filter((g) => g.severity === "material" && FIXABLE_LEVERS.includes(g.lever));
  const proposal = await propose(fixable, cases, history());

  console.log(
    `\n   verdicts: ${t.verdicts.good} good · ${t.verdicts.minor} minor · ${t.verdicts.material} material · ${t.unjudged} unjudged`,
  );
  console.log(
    `   material gaps by lever: ${PRICING_LEVERS.map((l) => `${l} ${t.material[l]}`).join(" · ")}`,
  );
  console.log(
    `   users corrected ${t.corrected} and exported ${t.exported} of ${counts.runs} runs; ${t.unmatched}/${t.lines} lines unmatched`,
  );
  if ("error" in proposal) console.log(`\n   no proposal: ${proposal.error}`);
  else
    console.log(
      `\n   PROPOSAL (${proposal.lever}, ${proposal.owner}): ${proposal.title}\n   ${proposal.problem}`,
    );

  // The public files FIRST: a failed save below must not leave the routine without them.
  const date = at.slice(0, 10);
  const summary = { reviewId: null as string | null, at, counts, tally: t, previous, proposal };
  write("pricing-proposal.json", JSON.stringify(summary, null, 2));
  if (!("error" in proposal))
    write("pricing-proposal.md", proposalMarkdown(date, t, previous, proposal));
  write("pricing-report.json", JSON.stringify({ at, tally: t, results, proposal }, null, 2));
  try {
    // `uids` lets an account's deletion remove its results; `expireAt` is the TTL.
    const ref = await db.collection("pricing_reviews").add({
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + REVIEW_TTL_DAYS * 86_400_000),
      windowDays: DAYS,
      judge: PRICING_JUDGE_MODEL,
      tally: t,
      uids: [...new Set(results.map((r) => r.uid))],
      results,
      proposal,
    });
    write("pricing-proposal.json", JSON.stringify({ ...summary, reviewId: ref.id }, null, 2));
    console.log(
      `\n   saved: pricing_reviews/${ref.id} · ${OUT}/pricing-report.json (private) · ${OUT}/pricing-proposal.json${"error" in proposal ? "" : " · .md"}\n`,
    );
  } catch (err) {
    write(
      "pricing-proposal.json",
      JSON.stringify({ ...summary, saveError: "the review was not saved to Firestore" }, null, 2),
    );
    console.error(
      `\n   NOT SAVED to Firestore (${String((err as Error)?.message ?? err).slice(0, 120)}); ${OUT}/pricing-proposal.json is written.\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
