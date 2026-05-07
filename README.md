# ComfyUI-WildcardPicker

A visual browser for the wildcards library. Browse the folder tree, peek
into `.txt` files and `.yaml` keys, and click to insert references or
literals into a textarea — which feeds straight into Impact-Pack's
`ImpactWildcardProcessor` for actual resolution.

**Status: v0.3 (feature-complete).** Tested against
`comfyui-impact-pack/wildcards/` (354 .txt + 3 .yaml = 861 leaves).

## Why

The original wildcards UX in ComfyUI is "remember the path and type it"
(`__Junkyard/Hair/Color/general__`). For a library with hundreds of files
and yaml documents nested 5 levels deep, that's a lot of memorization.
WildcardPicker turns it into "browse → click → done", while leaving the
actual parsing to the wildcards processor downstream.

## Install

Drop this folder into `ComfyUI/custom_nodes/`. Requires `PyYAML` (already a
ComfyUI dependency).

## Quick start

1. Add a `Wildcard Picker 🌳` node to your workflow.
2. Add an `ImpactWildcardProcessor` (from comfyui-impact-pack).
3. Wire WildcardPicker `text` → ImpactWildcardProcessor `wildcard_text`
   (right-click the input slot → "Convert wildcard_text to input").
4. Click **📂 Browse wildcards** on the picker node.
5. Find a leaf in the tree → click → choose insertion mode → **Append**.
6. Run the workflow. Impact-Pack will expand all `__refs__`, `[a|b|c]`,
   `{a|b|c}`, etc.

There's a ready-made example workflow at
`ComfyUI/user/default/workflows/Collected_Workflows/wildcardpicker_example.json`.

## Tree structure

The tree mirrors the filesystem layout of
`comfyui-impact-pack/wildcards/`. Yaml files are expanded recursively —
each yaml dict is a folder, each leaf string/list is selectable.

| Icon | Kind            | What you see                              |
|------|-----------------|-------------------------------------------|
| 📁   | dir             | Filesystem directory                      |
| 📋   | yaml            | A `.yaml` file (container)                |
| 📂   | yaml_dir        | An inner yaml dict                        |
| 📄   | txt             | A `.txt` file (lines = candidates)        |
| 🎲   | yaml_list       | A yaml list of strings (candidates)       |
| 📝   | yaml_string     | A short single-string yaml leaf           |
| 📜   | yaml_template   | A multi-line yaml template (with refs)    |

Reference path convention:

| File / yaml leaf                                  | Reference                              |
|---------------------------------------------------|----------------------------------------|
| `Junkyard/Hair/Color/general.txt`                 | `__Junkyard/Hair/Color/general__`      |
| `HHP-SET_v6.yaml` → `HHP-SET/character/head/Hair` | `__HHP-SET/character/head/Hair__`      |

(Yaml top-level key replaces the filename. Verify in the live preview
that says `__path__` — that's exactly what gets inserted.)

## Insertion modes

When you select a leaf, four modes are available (some only enable for
multi-line leaves):

| Mode             | Output                              | When to use                                              |
|------------------|-------------------------------------|----------------------------------------------------------|
| As reference     | `__path__`                          | You want Impact-Pack to randomize at run time            |
| As literal       | `line1, line2, ...` (selected)      | You want specific value(s), no randomization             |
| As alternation   | `{a\|b\|c}` (selected)              | Random pick among a few specific lines                   |
| As multi-pick    | `{1-N$$, $$a\|b\|c}` (selected)     | Pick 1..N distinct lines from the selected set           |

Modifiers:
- **Wrap with empty option** — appends a trailing `|` so "nothing"
  becomes a possible outcome (`{a|b|c|}` or `{1-N$$, $$a|b|c|}`).
- **Allow duplicates** — stub for v0.4.

For `yaml_template` leaves (long multi-line strings with embedded refs),
"As reference" is almost always what you want — Impact-Pack will resolve
the whole template downstream.

## Search

Type in the search box at the top to filter the tree by name + path
substring. Containers auto-expand to reveal matches. Clear the box (or
click the × inside it) to restore the full tree.

## Refresh

Hit `↻` to clear the cache and re-walk the wildcards directory. Use this
after dropping new `.txt` files into the wildcards root, or pulling a
wildcards repo update.

## Architecture

```
WildcardPicker node (passthrough text)
    │
    ▼ (wired by user via "Convert to input")
ImpactWildcardProcessor (resolves all syntax)
    │
    ▼
your CLIPTextEncode / KSampler / etc.
```

The picker node is intentionally dumb — it just holds text. All
intelligence is in the JS modal (browsing/composing) and Impact-Pack
(parsing/resolving). This keeps the surface area small and reuses the
ecosystem's mature wildcards parser.

See [docs/PLAN.md](docs/PLAN.md) and [docs/api.md](docs/api.md) for
internals.

## HTTP API

Three routes, registered on ComfyUI's `PromptServer`:

| Method | Path                          | Purpose                       |
|--------|-------------------------------|-------------------------------|
| GET    | `/wildcard_picker/tree`       | Full tree as JSON             |
| GET    | `/wildcard_picker/file?path=` | One leaf's contents           |
| POST   | `/wildcard_picker/refresh`    | Clear cache, rebuild on next  |

5-minute in-memory TTL on tree + file payloads.

## Roadmap

- [x] M1 — Skeleton passthrough node
- [x] M2 — Tree backend (fs + yaml + cache + HTTP)
- [x] M3 — Tree UI in modal (browse + preview + search)
- [x] M4 — Insertion modes (reference / literal / alternation / multi-pick)
- [x] M5 — Polish + docs + example workflow
- [ ] v0.4 — Multi-root (merge impact-pack + WildPromptor + easy-use)
- [ ] v0.4 — Allow-duplicates modifier
- [ ] v0.4 — Persistent expanded-tree state across modal reopens
- [ ] v0.5 — Drag-from-tree to textarea

## License

MIT.
