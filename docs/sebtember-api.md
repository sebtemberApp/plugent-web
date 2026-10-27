# What Plugent uses from sebtember.app

The contract between the two products. A sebtember-side change ships and deploys **before** the Plugent change
that uses it.

| need | sebtember side | Plugent side |
|---|---|---|
| login | Sebtember's Firebase Auth (`sebtember-app` / `-dev`) | `lib/firebase/client.ts`, `lib/auth/session.ts` |
| read a wallet | `POST /api/products/balance {uid}` → `{source, balance, minimum}`; makes the wallet of a login with none (Step 1173) | `getBalance` in `lib/sebtember/products.ts` |
| charge a wallet | `POST /api/products/charge {uid, source, lines[]}`; idempotent per line id (Step 1171) | `charge` in `lib/sebtember/products.ts` |
| choose catalogues | `/connect/plugent?return=<url>` on sebtember.app; returns only to an origin in `PRODUCT_RETURN_ORIGINS` (Step 1174) | `connectUrl` in `lib/sebtember/products.ts` |
| granted catalogues | `POST /api/products/knowledge/catalogues {uid}` → `{connected, catalogues}` (Step 1174) | `getKnowledgeCatalogues` |
| a catalogue's files | `POST /api/products/knowledge/sources {uid, catalogue_id, limit?, cursor?}` (Step 1174) | `getKnowledgeSources` |
| search | not yet: comes with the first agent (it costs, so it will charge) | — |

Auth for the product API: a Google ID token for `PRODUCT_API_AUDIENCE`, from a service account listed in
sebtember's `PRODUCT_API_CALLERS` as `plugent=<email>`. Unlisted → 401.

## Planned sebtember-side additions
- ~~Milestone 2: catalogue consent~~ done in sebtember Step 1174 (PR #1094).
- **First agent:** a passage search through the grant, charged per call.
- **Pricing:** a structured price-list lookup (code/keyword), which semantic search does not cover.
- **Attribution:** report content usage so Library creators are credited when a Plugent agent uses their content.
