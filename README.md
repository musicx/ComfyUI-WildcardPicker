# ComfyUI-WildcardPicker

A visual browser for the wildcards library, designed to feed text into
`ImpactWildcardProcessor`.

**Status: planning / not yet implemented.** See [docs/PLAN.md](docs/PLAN.md)
for the full design.

## What it does

Browse the wildcards folder structure (including `.yaml` files expanded as
nested trees), preview file contents, and click to insert references or
literal lines into a textarea — which is then wired to Impact-Pack's
wildcard processor for actual resolution.

## What it's not

Not a wildcards parser. All `__name__`, `[a|b|c]`, `{a|b|c}`, `*N*`, etc.
parsing is delegated to Impact-Pack downstream.

## Roadmap

- [ ] M1 — Skeleton passthrough node
- [ ] M2 — Tree backend + HTTP API
- [ ] M3 — Tree UI in modal
- [ ] M4 — Insertion modes (reference / literal / alternation / multi-pick)
- [ ] M5 — Polish & docs

See [docs/PLAN.md](docs/PLAN.md) for milestone detail.
