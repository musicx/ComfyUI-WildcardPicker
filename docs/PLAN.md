# ComfyUI-WildcardPicker — Detailed Plan

A visual browser/picker node for the wildcards library, designed to feed text
into `ImpactWildcardProcessor` (or any compatible downstream node) without
requiring the user to memorize wildcard paths or hand-write dynamic-prompt
syntax.

---

## 1. Goals

- **Discover by browsing**, not by remembering names. Show the actual folder
  structure and file contents of the wildcards library.
- **Compose by clicking**. Build prompt text through point-and-click; manual
  editing remains possible at any time.
- **Respect existing tooling**. Output is plain text. All `__name__`,
  `[a|b|c]`, `{a|b|c}`, `*N*`, `0-1#`, etc. parsing is delegated to
  Impact-Pack downstream — we never reimplement it.
- **One node, full coverage**. Replace the need for 9-selector mega-workflows
  while still exposing the entire wildcards library.

## 2. Non-goals

- Does not parse / resolve wildcard syntax — Impact-Pack does that.
- Does not modify wildcards files (read-only browser).
- Does not auto-randomize on its own.
- Does not manage multiple roots in v1 (impact-pack only). Multi-root in v0.3.

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│ ComfyUI canvas                                               │
│                                                              │
│   ┌─ WildcardPicker ────┐    ┌─ ImpactWildcardProcessor ──┐  │
│   │ text ────────────── │ ──►│ wildcard_text             │  │
│   │ [📂 Browse...]      │    │ ─────────────────►        │  │
│   └─────────────────────┘    └────────────────────────────┘  │
│           ▲                                                   │
│           │ JS modal                                          │
│           │ (tree+preview+insert)                             │
│           │                                                   │
│           │   /wildcard_picker/tree?root=…                    │
│           │   /wildcard_picker/file?path=…                    │
│           ▼                                                   │
│   ┌─ python backend (this plugin) ──────────────────────┐    │
│   │ - tree_builder.py: walk fs, parse yaml              │    │
│   │ - http routes via PromptServer                       │    │
│   │ - 5-min in-memory cache + manual refresh             │    │
│   └──────────────────────────────────────────────────────┘    │
│           ▲                                                   │
│           │ filesystem read                                   │
│           ▼                                                   │
│   custom_nodes/comfyui-impact-pack/wildcards/                 │
│     ├ Junkyard/Hair/Color/general.txt                        │
│     ├ HHP-SET_v6.yaml                                        │
│     └ ...                                                    │
└─────────────────────────────────────────────────────────────┘
```

The custom node itself is a passthrough: `text` widget in → `STRING` out.
All UX happens in the JS modal that mutates the textarea value.

## 4. Data model

### 4.1 Tree node schema (server → client JSON)

```jsonc
{
  "kind": "dir" | "txt" | "yaml" | "yaml_dir" | "yaml_string" | "yaml_list" | "yaml_template",
  "name": "string",            // last path segment
  "path": "string",            // full reference path (e.g. "Junkyard/Hair/Color/general"
                               // or "HHP-SET/character/head/Hair")
  "count": "number | null",    // entry count for txt/yaml_list, child count for dir, else null
  "children": "TreeNode[] | null"  // null until expanded; lazy-load on demand
}
```

Leaf kinds (selectable for insertion):
- `txt` — a `.txt` file. Each non-empty line is a candidate.
- `yaml_string` — a yaml leaf whose value is a single string.
- `yaml_list` — a yaml leaf whose value is a list of strings.
- `yaml_template` — a yaml leaf whose value is a multi-line string with
  embedded `__refs__` and dynamic syntax (treat like a single-string template).

Container kinds:
- `dir` — a filesystem directory.
- `yaml` — a `.yaml` file (root container; first child is its top-level yaml key).
- `yaml_dir` — an inner yaml dict.

### 4.2 File payload schema (server → client JSON)

```jsonc
{
  "path": "string",
  "kind": "txt" | "yaml_string" | "yaml_list" | "yaml_template",
  "lines": ["string", ...],    // candidates (1 entry for yaml_string/template)
  "raw": "string | null"       // for yaml_template, the full raw text (for preview)
}
```

### 4.3 Reference path conventions (must match Impact-Pack's parser)

- `.txt` file `Junkyard/Hair/Color/general.txt`
  → reference: `__Junkyard/Hair/Color/general__`
- yaml leaf `HHP-SET-Scene_v1.yaml` → root key `HHP-SET-Scene` → `Scene` → `home`
  → reference: `__HHP-SET-Scene/Scene/home__`
  (yaml top-level key replaces the `.yaml` filename in the path; this matches
  Impact-Pack's behavior — verify in v0.1 with a smoke test.)

## 5. HTTP API

All routes live under `/wildcard_picker/*` and are added to the running
`PromptServer` instance (same pattern as Impact-Pack itself).

| Method | Path                          | Params                | Returns                   |
|--------|-------------------------------|-----------------------|---------------------------|
| GET    | `/wildcard_picker/tree`       | (none in v1)          | full tree (JSON)          |
| GET    | `/wildcard_picker/file`       | `path=<ref_path>`     | file payload (JSON)       |
| POST   | `/wildcard_picker/refresh`    | (none)                | `{"ok": true}` + rebuilds |

Responses: 400 on path traversal attempts, 404 if path not found, 500 on
internal errors with a JSON body `{"error": "..."}`.

### Caching

- Tree built lazily on first request, kept in memory.
- File payloads also memoized (key = path).
- TTL: 5 minutes; manual `POST /refresh` clears immediately.
- Yaml parse is the slow part (~tens of ms per file); cache it.

### Path safety

`os.path.realpath(os.path.join(ROOT, path))` must start with
`os.path.realpath(ROOT)` — refuse otherwise.

## 6. UI specification

### 6.1 Node widget

```
┌─ WildcardPicker ──────────────────┐
│ ┌─ text ────────────────────────┐ │
│ │ <multiline editable textarea> │ │  default 320px tall
│ └───────────────────────────────┘ │
│ [📂 Browse wildcards]              │  button widget
│                                    │
│ Output: STRING ─────────────────►  │
└────────────────────────────────────┘
```

The `text` widget is the canonical content. The Browse button opens a modal
that **appends to** (or replaces selection in) `text.value`. After the modal
closes, the textarea reflects the new content.

### 6.2 Modal layout

```
┌─ Wildcard Browser ─────────────────────────────────────────────┐
│ 🔍 [______________________] [↻ refresh]                  [×]   │
│                                                                  │
│ ┌─ Tree (350px) ────────┐  ┌─ Preview (flex) ─────────────────┐ │
│ │ ▼ Junkyard            │  │ Junkyard/Hair/Color/general      │ │
│ │   ▼ Hair              │  │ ────────────────────             │ │
│ │     ▼ Color           │  │ ☐ jet black                      │ │
│ │       • general (12)  │  │ ☐ chestnut brown                 │ │
│ │     ▶ Style           │  │ ☑ honey blonde                   │ │
│ │   ▶ Outfits           │  │ ☑ platinum                       │ │
│ │ ▼ HHP-SET (yaml)      │  │ ☐ rose gold                      │ │
│ │   ▼ HHP-SET           │  │ ...                              │ │
│ │     ▼ character       │  │                                  │ │
│ │       ▼ head          │  │ (12 lines, 2 selected)           │ │
│ │         • Hair (24)   │  │                                  │ │
│ └───────────────────────┘  └──────────────────────────────────┘ │
│                                                                  │
│ ─── Insertion mode ────────────────────────────────────────     │
│  ◉ As reference       __Junkyard/Hair/Color/general__           │
│  ○ As literal         honey blonde, platinum                    │
│  ○ As alternation     {honey blonde|platinum}                   │
│  ○ As multi-pick      {1-2$$, $$honey blonde|platinum}          │
│                                                                  │
│ ☐ Wrap with empty option (50% chance of nothing)                 │
│ ☐ Allow duplicates in multi-pick                                 │
│                                                                  │
│ Live preview of insertion:                                       │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ __Junkyard/Hair/Color/general__                          │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│         [Append ↩]  [Replace selection]  [Cancel]                │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3 Behaviors

| Element            | Behavior                                                       |
|--------------------|----------------------------------------------------------------|
| Tree node click    | Container: toggle expand. Leaf: load file payload, render preview, deselect any prior selection. |
| Search box         | Filter tree nodes by substring (path-aware). Auto-expand matched ancestors. |
| Refresh button     | `POST /refresh`, then re-fetch tree.                          |
| Preview row click  | Toggle row selection (checkbox).                               |
| Mode radio change  | Re-render the live preview text.                               |
| Append button      | Append `\n<insert_text>` to textarea (skip leading `\n` if textarea empty). Close modal. |
| Replace button     | Replace current selection in textarea with insert_text. Close modal. |
| Cancel / Esc / ✕   | Close modal without modifying textarea.                        |

### 6.4 Insertion templates

| Mode             | yaml_string / yaml_template      | yaml_list / txt                                                              |
|------------------|----------------------------------|------------------------------------------------------------------------------|
| As reference     | `__path__`                       | `__path__`                                                                  |
| As literal       | the string itself                | comma-joined selected lines (or warning if none selected)                   |
| As alternation   | `{the_string}` (no-op)           | `{a\|b\|c}` of selected lines                                               |
| As multi-pick    | `{1-1$$ , $$the_string}`         | `{1-N$$, $$a\|b\|c}` where N = selected count                               |

Modifiers:
- `Wrap with empty option`: appends an empty alt → `{a\|b\|c\|}` (alternation)
  or `{1-N$$, $$a\|b\|c\|}` (multi-pick).
- `Allow duplicates in multi-pick`: future — Impact-Pack's syntax doesn't
  natively distinguish; keep as no-op stub for now, document as v0.4.

## 7. File / module layout

```
ComfyUI-WildcardPicker/
├ __init__.py                # entry: registers NODE_CLASS_MAPPINGS, WEB_DIRECTORY
├ pyproject.toml             # minimal metadata
├ requirements.txt           # PyYAML (probably already satisfied by ComfyUI)
├ README.md
├ LICENSE                    # MIT (or pick later)
├ docs/
│  ├ PLAN.md                 # this document
│  ├ yaml-format-notes.md    # findings on impact-pack yaml conventions
│  └ api.md                  # http endpoint contract
├ src/
│  ├ __init__.py
│  ├ node.py                 # WildcardPicker node class
│  ├ tree_builder.py         # filesystem walk + yaml flatten
│  ├ server_routes.py        # PromptServer route registration
│  └ paths.py                # root resolution + safety
└ web/
   ├ wildcard_picker.js      # main extension entry
   ├ tree.js                 # tree component
   ├ preview.js              # preview pane
   ├ insertion.js            # insertion templates + live preview
   └ wildcard_picker.css     # styling for modal
```

`__init__.py` exports `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`,
`WEB_DIRECTORY = "./web"`. The PromptServer route registration runs at module
import time (see Impact-Pack pattern).

## 8. Implementation milestones

Strict ordering — each milestone is a working, testable state.

### M1 — Skeleton & passthrough node (1-2 hours)
- `__init__.py` registers a node `WildcardPicker` with one multiline `text`
  widget and one STRING output that returns `text` unchanged.
- Verify it loads, displays, and pipes text into `ImpactWildcardProcessor`.
- No JS yet.
- **Deliverable**: drop the node in a workflow, type `__Junkyard/Hair/Color/general__`,
  see Impact-Pack resolve it downstream.

### M2 — Tree backend (2-3 hours)
- Implement `tree_builder.build_tree(root)`:
  - Walk filesystem; emit `dir` containers and `txt` leaves.
  - Parse `*.yaml` with PyYAML; emit `yaml` → `yaml_dir`* → leaves.
  - Classify yaml leaves: `yaml_list` (list of strings), `yaml_template`
    (string > 100 chars or contains `\n`), `yaml_string` (other strings).
- Implement `/wildcard_picker/tree` and `/wildcard_picker/file` routes.
- Add 5-minute TTL cache + `/refresh` endpoint.
- Verify with curl/browser: tree returns valid JSON, file payload works for
  txt and yaml leaves.
- **Deliverable**: backend can be queried via HTTP, returns clean structured data.

### M3 — Tree UI (3-4 hours)
- `web/wildcard_picker.js` registers the node extension.
- Adds the `[📂 Browse wildcards]` button widget.
- Builds and shows the modal.
- Renders tree with native `<details>`/`<summary>` for expand/collapse.
- Click leaf → fetches file payload, renders rows in preview pane.
- Search box: client-side filter on tree node `path` substring.
- Refresh button.
- **Deliverable**: full visual browse, preview rendering, no insertion yet.

### M4 — Insertion (2-3 hours)
- Mode radios + modifier checkboxes.
- Live preview rendering of insertion text.
- Append / Replace buttons mutate textarea via `widget.value` and trigger
  `widget.callback?.(value)` for ComfyUI to register the change.
- Esc/click-outside cancels.
- **Deliverable**: full v0.3 functionality.

### M5 — Polish & docs (1-2 hours)
- Error toasts for HTTP failures.
- Loading spinner on tree/file fetch.
- README with screenshots and a usage example.
- `docs/api.md` finalized.
- Smoke test: load impact-pack yaml refs through the node.

**Total estimate**: ~10-15 hours focused work for v0.3 complete.

## 9. Tech choices

| Concern        | Choice                              | Reason                                              |
|----------------|-------------------------------------|-----------------------------------------------------|
| Python yaml    | PyYAML                              | Already a ComfyUI dep; Impact-Pack uses it          |
| HTTP           | aiohttp via PromptServer            | Standard ComfyUI extension idiom                    |
| Frontend       | Vanilla JS                          | No bundle step, no third-party deps                 |
| Modal          | Native `<dialog>`                   | Modern browsers, no library needed                  |
| Tree expand    | Native `<details>` + custom CSS     | Free a11y, no JS state machine                      |
| State          | Module-scoped vars in JS            | Single modal at a time; keeps things simple         |
| Styling        | Plain CSS, scoped via prefix class  | Match ComfyUI's dark theme, override-friendly       |

## 10. Open questions

1. **yaml reference path syntax** — does Impact-Pack expect
   `__filename/key/subkey__` or `__yaml_root_key/subkey__`? From sampling
   `HHP-SET_v6.yaml`, the file root key is `HHP-SET` and references inside
   the yaml use `__HHP-SET/...__`. We assume the convention is
   "yaml top-level key → reference root, .yaml filename ignored". Smoke-test
   in M1 by clicking a yaml leaf and checking Impact-Pack resolves it.

2. **Cross-file references** — yaml files reference each other
   (BDSM file uses `__HHP-SET/Scene/...__` defined in SET file). Do we
   need to display this? No — they resolve at runtime; we just present each
   file's declared keys. Cross-references are an Impact-Pack runtime concern.

3. **Multi-root in v0.3** — original plan included merging multiple wildcards
   roots. Per user direction, scoped to impact-pack only for v1. Architecture
   leaves the door open: `paths.get_roots()` returns a list, just hardcode
   one for now. Can add a node widget `root` (combo) later.

4. **Persistence of expanded tree state** — should the user's
   open/closed branches survive modal reopen within a session? Nice-to-have;
   stash in `localStorage` keyed by tree node path.

5. **Handling huge yaml leaves** — `HHP-SET/character/randomEroticArt`
   is a multi-line template ~500 chars long. Preview pane needs a max-height
   with scroll, monospace, and a "copy raw" button. Confirmed in spec.

## 11. Risk register

| Risk                                      | Severity | Mitigation                                |
|-------------------------------------------|----------|-------------------------------------------|
| yaml reference convention wrong → bad refs| Medium   | Verify in M1 smoke test; adjust path builder |
| Large yaml files slow tree build          | Low      | Cache; build is one-shot per refresh      |
| ComfyUI JS API changes                    | Low      | Stick to documented extension hooks       |
| User expects multi-root and we ship one   | Low      | Stated scope; M+1 follow-up               |
| Path traversal via crafted `path` query   | High     | Strict realpath check in `paths.safe_join` |
| Modal blocks workflow editing             | Low      | Modal is dismissable; non-blocking by spec|

## 12. Out of scope (future)

- Editing wildcard files in-browser.
- Auto-import from other wildcard packs (CivitAI Helper, etc.).
- Drag-and-drop tree → textarea.
- Custom user "favorites" / pinned items.
- Show resolved sample output (would require running through Impact-Pack;
  user can wire a ShowText already).
