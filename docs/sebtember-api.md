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
| search | `POST /api/products/knowledge/search {uid, source, query, request_id, limit?}`, never a paused catalogue → `{passages, retrievalStrength, charged, balanceAfter}`; sebtember charges its own search as line `{request_id}-search` (Step 1175) | `searchKnowledge`; the Ask agent (`lib/agents/ask.ts`) charges its model work as `{runId}-answer` |

Auth for the product API: a Google ID token for `PRODUCT_API_AUDIENCE`, from a service account listed in
sebtember's `PRODUCT_API_CALLERS` as `plugent=<email>`. Unlisted → 401.

## Planned sebtember-side additions
- ~~Milestone 2: catalogue consent~~ done in sebtember Step 1174 (PR #1094); replaced by connected-by-default + Pause in Step 1178.
- ~~First agent: a passage search through the grant~~ done in sebtember Step 1175 (PR #1095).
- **Pricing:** a structured price-list lookup (code/keyword), which semantic search does not cover.
- **Attribution:** report content usage so Library creators are credited when a Plugent agent uses their content.
