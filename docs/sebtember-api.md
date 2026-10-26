# What Plugent uses from sebtember.app

The contract between the two products. A sebtember-side change ships and deploys **before** the Plugent change
that uses it.

| need | sebtember side | Plugent side |
|---|---|---|
| login | Sebtember's Firebase Auth (`sebtember-app` / `-dev`) | `lib/firebase/client.ts`, `lib/auth/session.ts` |
| read a wallet | `POST /api/products/balance {uid}` → `{source, balance, minimum}`; makes the wallet of a login with none (Step 1173) | `getBalance` in `lib/sebtember/products.ts` |
| charge a wallet | `POST /api/products/charge {uid, source, lines[]}`; idempotent per line id (Step 1171) | `charge` in `lib/sebtember/products.ts` |
| knowledge | MCP `search_knowledge`, `search_passages`, `fetch`, `list_sources`, scoped to chosen catalogues (Steps 642, 1169, 1170) | not wired yet (milestone 2) |

Auth for the product API: a Google ID token for `PRODUCT_API_AUDIENCE`, from a service account listed in
sebtember's `PRODUCT_API_CALLERS` as `plugent=<email>`. Unlisted → 401.

## Planned sebtember-side additions
- **Milestone 2:** an OAuth consent screen where the user ticks which catalogues Plugent may read (today scoped
  keys are minted only by `scripts/mint-scoped-api-key.ts`).
- **Pricing:** a structured price-list lookup (code/keyword), which semantic search does not cover.
- **Attribution:** report content usage so Library creators are credited when a Plugent agent uses their content.
