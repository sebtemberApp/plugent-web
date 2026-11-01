# Chat's self-improvement loop

Every two weeks, one evaluated change to Chat's prompt is proposed; the operator approves it by merging.

```
 Chat answers ──► traces (30 days) ──► review (judge) ──► ONE proposal ──► draft PR ──► operator merges
      ▲                                                                                       │
      └──────────────────────── the next review starts with "did it help?" ◄──────────────────┘
```

| piece | where | state |
|---|---|---|
| trace: what each turn's model saw and said | `lib/agents/ask.ts` `AskTrace`, `lib/runs.ts` → `users/{uid}/runs/{runId}/traces/{turnId}` | built (TTL 30 days) |
| review: an independent judge over whole conversations | `lib/review/chat-review.ts`, `lib/review/load.ts`, `pnpm chat:review` | built |
| gate: the prompt's behaviour suite | `lib/agents/eval/chat-behavior-*`, `pnpm eval:chat-behavior`, `.github/workflows/chat-behavior-gate.yml` | built |
| routine: runs the review, applies the proposal, opens the PR | a Claude Code scheduled task (below) | needs its environment |

## The review

`pnpm chat:review` (`scripts/chat-review.ts`) loads every Chat conversation with a trace from the last 14 days, and
`anthropic/claude-opus-5.5` — another family than Chat's `openai/gpt-5.4-mini` — judges each WHOLE conversation: it
reconstructs what the user wanted, drafts the best answer the RETRIEVED passages allow, compares it with what shipped,
and routes each gap to one lever. This is the design sebtember agreed when it paused its aggregate digest (at a handful
of answers a week, a list to read beats a statistic):

| lever | means | whose fix |
|---|---|---|
| `content` | the documents do not hold it | the catalogue owner |
| `retrieval` | the documents hold it, the search did not bring it | sebtember (search) |
| `generation` | the passages held it, the answer missed or garbled it | **Chat's prompt** |
| `grounding` | the answer said what the passages do not support | **Chat's prompt** |

Only material `generation` + `grounding` gaps go to the proposer, which writes ONE edit to
`lib/agents/chat-prompt.ts` and 1–3 fresh eval cases. `content` and `retrieval` are reported, not fixed here.

## ⚠️ Privacy — this repository is public

Traces and turns hold users' documents and questions. The review's full results stay in Plugent's Firestore
(`chat_reviews`) and `review-out/report.json` (gitignored). Only `review-out/proposal.json` — written fresh by the
proposer with invented products and numbers — may reach a commit or a PR. Never run the review in GitHub Actions here
(public logs); never paste a question, passage, answer or user note into a PR, a commit message or an issue.

## The routine

A Claude Code scheduled task, on the 1st and 15th of each month, in an environment that has:

- this repository, with push access (it opens a draft PR into `dev`);
- `PLUGENT_SERVICE_ACCOUNT_JSON` — a service account of the PRODUCTION project that can read Firestore and write
  `chat_reviews` (`roles/datastore.user`);
- `AI_GATEWAY_API_KEY` — for the judge, the proposer and the behaviour suite.

Its instructions:

> Run Chat's two-weekly review in plugent-web (`docs/chat-loop.md`). Branch from `dev`. Run `pnpm install`, then
> `pnpm chat:review`. Read `review-out/proposal.json` — NEVER `review-out/report.json` into a message, a commit or a
> PR: it holds users' data. If there is no proposal, stop and report the tally in one line. Otherwise:
> 1. Run `pnpm eval:chat-behavior -- --run` on the unchanged prompt and keep the report as the baseline.
> 2. Apply `proposal.edit` to `SYSTEM_INSTRUCTION_GPT` in `lib/agents/chat-prompt.ts` (replace `find` exactly once,
>    or append when `find` is empty), bump `CHAT_PROMPT_VERSION` (`plugent-N` → `plugent-N+1`), and append
>    `proposal.cases` to `lib/agents/eval/chat-behavior-cases.json` (fix their shape if the smoke check refuses them).
> 3. Run `pnpm eval:chat-behavior` (smoke), then `pnpm eval:chat-behavior -- --run --baseline=<baseline report>`.
> 4. Open a DRAFT PR into `dev` titled "Chat review: <proposal.title>", whose body holds only: the tally (counts by
>    verdict and lever), `proposal.problem`, the edit, the new cases' ids, `proposal.expectedEffect`, and the eval
>    before/after (pass counts, newly failing / newly passing). No user data.
> 5. If the change makes a previously passing case fail, say so at the top of the PR and leave it a draft.
> Report the PR link in one line.

The operator reviews the draft and merges it (and later promotes `dev` → `main`). The next review's tally is the
"did it help?" answer: the same lever should fall.
