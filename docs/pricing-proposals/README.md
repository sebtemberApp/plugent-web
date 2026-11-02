# Pricing proposals

One file per two-weekly Pricing review that found something worth changing (`docs/pricing-loop.md`), written by
`pnpm pricing:review` and opened as a PR by the routine. Each starts `Status: proposed`. The operator changes the
status:

- `approved`: it is built in its own PR, in sebtember-web first when sebtember owns it;
- `declined — <reason>`: the proposer does not offer it again without new evidence;
- `implemented (<PR link>)`: it has been built.

The proposer reads these files, so the history it sees is this folder.
