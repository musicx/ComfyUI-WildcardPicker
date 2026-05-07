# YAML format notes

Findings from sampling Impact-Pack wildcards `*.yaml` files. These observations
shape the tree-builder logic.

## Files inspected

- `comfyui-impact-pack/wildcards/HHP-SET_v6.yaml`
- `comfyui-impact-pack/wildcards/HHP-BDSM_v1.yaml`
- (HHP-SET-Scene_v1.yaml — same family, similar shape)

## Top-level shape

Each file has **exactly one top-level key** which acts as the reference root.
The filename is **not** part of the reference path — only the top key is.

```yaml
# HHP-SET_v6.yaml
HHP-SET:                        # ← this becomes the reference root segment
  Global:
    Base: "..."
    ...
  character:
    head:
      Hair:
        - "long flowing silky hair..."
        - ...
```

Reference for the `Hair` list above:

```
__HHP-SET/character/head/Hair__
```

Note: the yaml top key `HHP-SET` differs from the filename `HHP-SET_v6.yaml`.
This is intentional — multiple files can share the same top key (versioning),
and references stay stable as files evolve.

## Leaf value shapes

Three observed shapes for leaf values:

### 1. List of strings — the canonical "wildcard pool"

```yaml
Hair:
  - "long flowing silky hair in soft cascading waves"
  - "wet hair damp and clinging in glossy strands"
  - ...
```

Behaviour with Impact-Pack: `__path__` picks one line at random.
**Tree kind**: `yaml_list`. Supports all 4 insertion modes.

### 2. Single string — a fixed value or template

```yaml
Base: "masterwork, masterpiece, best quality, ..."
```

Behaviour: `__path__` substitutes the string verbatim.
**Tree kind**: `yaml_string`. Only "as reference" or "as literal" make sense.

### 3. Multi-line string — a composed template with embedded refs

```yaml
randomEroticArt: |
  __HHP-SET/Global/Core__, __HHP-SET/Theme/EroticArt__,
  a breathtakingly seductive young beauty with __HHP-SET/modifier/.../getEroticArtSet__
  ...
```

These are full prompt templates. They contain `__refs__`, `[a|b|c]`,
`{a|b|c}`, comments (`#`), and Impact-Pack's `${var=...}` variable syntax.

Behaviour: `__path__` substitutes the whole block; Impact-Pack then resolves
all nested refs and dynamic syntax.
**Tree kind**: `yaml_template` (heuristic: string with `\n` or length > 100).
Preview shows the raw template with monospace font + scroll.

## Heuristic for classifying yaml leaves

```python
def classify_yaml_leaf(value):
    if isinstance(value, list) and all(isinstance(x, (str, int, float)) for x in value):
        return "yaml_list"
    if isinstance(value, str):
        if "\n" in value or len(value) > 100:
            return "yaml_template"
        return "yaml_string"
    if isinstance(value, dict):
        return "yaml_dir"   # not a leaf — recurse
    return None             # skip unsupported (numbers alone, mixed lists, etc.)
```

## Depth

Observed depth in HHP-SET: 5 levels (`HHP-SET/character/head/Hair`).
Observed depth in HHP-BDSM: similar, ~5 levels.

**Decision**: do not impose a depth limit. The UI tree already handles
arbitrary depth via collapsible nodes. Limiting would break legitimate
references.

## Cross-file references

`HHP-BDSM_v1.yaml` contains `__HHP-SET/Scene/getScene__` referencing the
`HHP-SET` file's content. **The picker does not need to resolve these** —
Impact-Pack handles cross-file resolution at runtime. The picker just
displays each file's own keys.

## Comments

YAML comments (`# ...`) are stripped by PyYAML during parsing — they don't
appear in the tree. The original file's structural comments
(`# ==================== Character ====================`) are lost.
**Acceptable trade-off**: we display the structural folder names anyway.

## Special syntax inside leaf values (impact-pack runtime)

These appear inside the string content of yaml leaves and are handled by
Impact-Pack at resolution time, not by us:

- `__path__` — recursive wildcard reference
- `[a|b|c]` — pick-one
- `{a|b|c}` — pick-one (alternative syntax)
- `*N*[...]` — weight
- `0-1#[...]` — count modifier
- `${var=value}` — variable assignment
- `!{__pool__}` — function-call-style invocation
- `${var}` — variable substitution

We display these literally in the preview. The user understands that the
text is a template that will be expanded downstream.

## Decision summary

1. **Reference path** = `<yaml_top_key>/<sub>/<sub>/...`. Filename ignored.
2. **No depth limit** in tree.
3. **3 leaf kinds**: `yaml_list`, `yaml_string`, `yaml_template`.
4. **Cross-file refs** ignored at picker layer.
5. **Comments** lost (acceptable).
6. **Mixed types & numbers-only** lists skipped (rare in practice).
