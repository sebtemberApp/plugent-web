# What Plugent uses from sebtember.app

The contract between the two products. A sebtember-side change ships and deploys **before** the Plugent change
that uses it.

| need | sebtember side | Plugent side |
|---|---|---|
| login | Sebtember's Firebase Auth (`sebtember-app` / `-dev`) | `lib/firebase/client.ts`, `lib/auth/session.ts` |
| read a wallet | `POST /api/products/balance {uid}` → `{source, balance, minimum}`; makes the wallet of a login with none (Step 1173) | `getBalance` in `lib/sebtember/products.ts` |
| charge a wallet | `POST /api/products/charge {uid, source, lines[]}`; idempotent per line id (Step 1171) | `charge` in `lib/sebtember/products.ts` |
| catalogues | every catalogue the user can open is connected by default; the one control is Pause (Step 1178). `POST /api/products/knowledge/catalogues {uid}` → `{connected: true, catalogues: [{id, name, library, owner, paused}]}` (Steps 1174, 1176-1178) | `getKnowledgeCatalogues`; the Knowledge page |
| pause | `POST /api/products/knowledge/pause {uid, catalogue_id, paused}` → `{catalogue_id, paused}`; 404 when the user cannot open it (Step 1178) | `setCataloguePaused`, `app/actions/knowledge.ts` |
| a catalogue's files | `POST /api/products/knowledge/sources {uid, catalogue_id, limit?, cursor?}`; a paused one is 404 (Steps 1174, 1178) | `getKnowledgeSources` |
| search | `POST /api/products/knowledge/search {uid, source, query, request_id, limit?, history?}`, never a paused catalogue → `{passages, retrievalStrength, catalogue_guidance, source_quality, whole_files, charged, usage, balanceAfter}`; sebtember charges its own search as line `{request_id}-search` (Step 1175). Step 1185: `history` (≤ 10 `{role: user\|assistant, content ≤ 20,000}`, oldest first) feeds chat's query rewrite; each passage also carries `collection_name`, `section`, `kind`, `is_note` (chat's chunk header) | `searchKnowledge`; the Ask agent (`lib/agents/ask.ts`) sends the chat's history, pastes `catalogue_guidance` before `<retrieved_data>` and builds `<source_quality>` / `<complete_files>` with sebtember's own builders; charges its model work as `{runId}-answer` |
| pricing | `POST /api/products/pricing/{start,extract,match,get,discount-client,cancel,document,delete}` — the engine, price lists and discount tables stay in sebtember. `start` returns a signed PUT URL the browser uploads to; `extract` and `match` run a step and charge it as `{request_id}-extract` / `{request_id}-match-{n}` with `usage`; `get` is polled while a step runs. **REQUESTED, not on dev yet** — the full contract is `/mnt/project-files/plugent/pricing-api.md` | `lib/sebtember/pricing.ts`, `app/api/agents/pricing/route.ts`; each charge is a `kind: "charge"` turn on the run (`recordPricingCharge`) |

Auth for the product API: a Google ID token for `PRODUCT_API_AUDIENCE`, from a service account listed in
sebtember's `PRODUCT_API_CALLERS` as `plugent=<email>`. Unlisted → 401.

**What sebtember is for Chat:** the search above, and nothing after it. Since 2026-11-01 Chat's prompt, clarify tool use,
answer model and evals are Plugent's (`lib/agents/chat-prompt.ts`, `lib/agents/ask-prompt.ts`, `lib/agents/eval/`).
Sebtember.app's own chat is retired; its `system-instruction-gpt.ts` stays only as the frozen Knowledge Widget / Slack
prompt and is no longer copied here. A retrieval problem (wrong or missing passages, a bad rewrite, a wrong strength) is
still a sebtember change, made first.

## Planned sebtember-side additions
- ~~Milestone 2: catalogue consent~~ done in sebtember Step 1174 (PR #1094); replaced by connected-by-default + Pause in Step 1178.
- ~~First agent: a passage search through the grant~~ done in sebtember Step 1175 (PR #1095).
- **Pricing:** the `pricing/*` routes above (requested 2026-10-28). Plugent's screens are built and tested against a local mock of that contract.
- **Attribution:** report content usage so Library creators are credited when a Plugent agent uses their content.
