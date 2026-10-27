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
- **A sebtember-side API change ships before the Plugent change that uses it.**
- ⚠️ **Plugent's Firestore is SERVER-ONLY** (`lib/firebase/admin.ts`, the same service-account key;
  `firestore.rules` denies every client). Runs live under `users/{uid}/runs/{runId}` + `turns/`, so a run id
  can never reach another user's run; only `lib/runs.ts` touches them. Suggestions: `agent_suggestions`; answer feedback: `answer_feedback`; preferences (agents turned off, Chat's default mode): `users/{uid}`, only `lib/prefs.ts`. An agent turned off is hidden from the sidebar and Home and its route refuses (403 `agent_off`).

## Environments
`main` → Production → `sebtember-app` login, `https://sebtember.app`; `dev` → Preview → `sebtember-app-dev`,
`https://dev.sebtember.app`. Variables: `.env.example`.

## Commands
`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck`
