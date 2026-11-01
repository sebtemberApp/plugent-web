@AGENTS.md

# Plugent

A marketplace of AI agents. A user picks an agent, the agent asks **sebtember.app** for the knowledge it needs
(the user's catalogues, documents, price lists), does its work and returns a result.

sebtember.app stays the home of accounts, the wallet, catalogues and file extraction. Plugent is a client of it,
built like PeakPick. It NEVER reads sebtember's Firestore or vectors directly. The contract is
`docs/sebtember-api.md`; setup is `docs/setup.md`.

## Invariants
- ⚠️ **ONE LOGIN** — users sign in with SEBTEMBER's Firebase Auth; the uid is the Sebtember uid. Plugent's own
  data lives in Plugent's own Firebase project (`plugent-dev` now; a prod project later), written by the server only.
- ⚠️ **Every route reads the user with `getSessionUser()`** (`lib/auth/session.ts`); never trust a client uid.
- ⚠️ **Money goes through sebtember's product API** — gate on `getBalance` before work, store the returned
  `source` on the run, `charge` with the run's own id as the line id (idempotent). Never re-resolve the source.
  Every line carries its raw model `usage` (`lib/usage.ts`: model, input, output, reasoning, cached), logged as
  one `[charge]` line and kept on the turn; usage never prices a line.
- ⚠️ **A FAILED CHARGE IS KEPT, NEVER DROPPED** — every agent charges through `chargeOrKeep` (`lib/unpaid.ts`): two
  attempts, then `unpaid_charges/{lineId}` with the stored source, retried after the user's next run and by the daily
  cron `/api/cron/unpaid-charges` (needs `CRON_SECRET` in Vercel). Agent routes run 300 s, far above their model
  timeouts, so the charge and the save always get to run; a chat or spec run is claimed (`claimRun`) per request.
- **A sebtember-side API change ships before the Plugent change that uses it.**
- ⚠️ **Plugent's Firestore is SERVER-ONLY** (`lib/firebase/admin.ts`, the same service-account key;
  `firestore.rules` denies every client). Runs live under `users/{uid}/runs/{runId}` + `turns/`, so a run id
  can never reach another user's run; only `lib/runs.ts` touches them. Suggestions: `agent_suggestions`; answer feedback: `answer_feedback` (the stored run names the agent and quotes the turn); rate limits: `rate_limits/{uid}_{scope}_{minute}` (`lib/rate-limit.ts`, 20 runs a minute, every agent route); a deleted run's charges: `users/{uid}/deleted_runs` (the Usage page keeps them); preferences (agents turned off, Chat's default mode): `users/{uid}`, only `lib/prefs.ts`. An agent turned off is hidden from the sidebar and Home and its route refuses (403 `agent_off`).
- ⚠️ **CHAT'S PROMPT IS PLUGENT'S OWN** (since 2026-11-01; sebtember.app's chat is retired and its copy is frozen for
  the Knowledge Widget and Slack). `lib/agents/chat-prompt.ts` (it began as sebtember's `SYSTEM_INSTRUCTION_GPT`
  `gpt-3`, language block, chunk header and version reminder) is edited HERE, never copied in; bump
  `CHAT_PROMPT_VERSION`. The call itself is `lib/agents/ask-prompt.ts` (`askCallOptions`, `askMessages`,
  `buildAskPrompt`, `readAnswer`): pure, no `server-only`, so `runAsk` and the behaviour eval run the SAME code.
  **Every change to either passes `pnpm eval:chat-behavior -- --run`** (`lib/agents/eval/`, baked cases, the
  `Chat behavioral gate` workflow on PRs); a behaviour fixed by a prompt edit gets a case. Chat still continues the
  run's last 10 messages, may ask back through `ask_clarification` and gets its passages from sebtember's search.
- ⚠️ **THE OTHER AGENTS' PROMPTS ARE SEBTEMBER'S, COPIED VERBATIM** — Specification/Quotation
  (`lib/agents/spec-prompts.ts`) and Troubleshooting (`lib/agents/troubleshoot-prompts.ts`) carry sebtember's
  eval-chosen prompts, and the shared `lib/agents/clarify.ts` and `lib/agents/sanitize.ts` stay copies (Chat uses
  them too: fork a Chat-only file before changing one for Chat); change them in sebtember first, then copy. Every agent
  writes in the user's Sebtember language (`lib/agents/profile.ts`, fail-open), user text passes `sanitizeForPrompt`,
  and every agent reads knowledge only through `searchKnowledge` and charges through `charge`.
- ⚠️ **PRICING RUNS ON SEBTEMBER'S ENGINE** (`/api/products/pricing/*`, `lib/sebtember/pricing.ts`); sebtember charges
  each step itself and Plugent keeps each charge as a turn. Its LOGIC is sebtember's, copied verbatim
  (`lib/agents/ipl/*`, `lib/agents/moi/{types,sniff}.ts`, `lib/pricing/{confirm,document,source-export}.ts`, the
  hooks and logic in `components/pricing/*`): fix a figure in sebtember first, then copy. Its LOOK is Plugent's
  own: `PricingView` + `PricingTables` (the canvas's Pricing board: stage tabs in the header, tiles, one table per
  stage, one pill action), and the copied parts wear Plugent's classes.
  ⚠️ A new `[[...run]]` param REMOUNTS the page — the URL moves only once the read is back.
- ⚠️ **COLOURS ARE TOKENS, AND `dark:` FOLLOWS THE PINNED THEME** — `app/globals.css` redefines Tailwind's `dark`
  variant on `data-theme`, then the system setting, as the tokens are. Use `text-warn` / `text-ok` / `text-on-accent`,
  never a palette colour (`amber-600`); radii are `rounded-chip|control|inner|list|card`, never `rounded-md`.

## Environments
`main` → Production → `sebtember-app` login, `https://sebtember.app`; `dev` → Preview → `sebtember-app-dev`,
`https://dev.sebtember.app`. Variables: `.env.example`.

## Commands
`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm eval:chat-behavior` (free shape check;
`-- --run` for the paid suite, needs `AI_GATEWAY_API_KEY`)
