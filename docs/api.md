# HTTP API contract

All endpoints are registered on the running ComfyUI `PromptServer` at
import time. Routes are namespaced under `/wildcard_picker/*`.

## GET /wildcard_picker/tree

Returns the full wildcard library tree as JSON.

**Query params**: none (in v1).

**Response 200**: a `TreeNode` object.

```jsonc
{
  "kind": "dir",
  "name": "<root>",
  "path": "",
  "count": 7,
  "children": [
    {
      "kind": "dir",
      "name": "Junkyard",
      "path": "Junkyard",
      "count": 11,
      "children": [
        {
          "kind": "dir",
          "name": "Hair",
          "path": "Junkyard/Hair",
          "count": 3,
          "children": [
            {
              "kind": "dir",
              "name": "Color",
              "path": "Junkyard/Hair/Color",
              "count": 1,
              "children": [
                {
                  "kind": "txt",
                  "name": "general",
                  "path": "Junkyard/Hair/Color/general",
                  "count": 12,
                  "children": null
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "kind": "yaml",
      "name": "HHP-SET_v6.yaml",
      "path": "HHP-SET_v6.yaml",
      "count": 1,
      "children": [
        {
          "kind": "yaml_dir",
          "name": "HHP-SET",
          "path": "HHP-SET",
          "count": 5,
          "children": [
            {
              "kind": "yaml_list",
              "name": "Hair",
              "path": "HHP-SET/character/head/Hair",
              "count": 24,
              "children": null
            }
          ]
        }
      ]
    }
  ]
}
```

`path` for txt and yaml leaves is the **reference path** — exactly what
goes between the `__` markers in an Impact-Pack reference.

## GET /wildcard_picker/file

Returns the contents of a single leaf.

**Query params**:
- `path` (required) — reference path of the leaf (matches the `path` field
  on a tree node).

**Response 200**:

```jsonc
// for txt
{
  "path": "Junkyard/Hair/Color/general",
  "kind": "txt",
  "lines": ["jet black", "chestnut brown", "honey blonde", "..."],
  "raw": null
}

// for yaml_list
{
  "path": "HHP-SET/character/head/Hair",
  "kind": "yaml_list",
  "lines": [
    "long flowing silky hair in soft cascading waves",
    "wet hair damp and clinging in glossy strands"
  ],
  "raw": null
}

// for yaml_string
{
  "path": "HHP-SET/Global/Base",
  "kind": "yaml_string",
  "lines": ["masterwork, masterpiece, best quality, ..."],
  "raw": null
}

// for yaml_template
{
  "path": "HHP-SET/Global/randomEroticArt",
  "kind": "yaml_template",
  "lines": ["<first non-empty line as quick label>"],
  "raw": "__HHP-SET/Global/Core__, __HHP-SET/Theme/EroticArt__, ..."
}
```

**Response 400**: invalid path (path traversal attempt or unknown path).

```jsonc
{ "error": "invalid path" }
```

**Response 404**: path not found.

```jsonc
{ "error": "not found" }
```

## POST /wildcard_picker/refresh

Clears the in-memory cache and forces tree rebuild on next `/tree` request.

**Body**: none.

**Response 200**:

```jsonc
{ "ok": true }
```

## Path validation

Server uses `os.path.realpath` to canonicalize:

```python
def safe_join(root: str, ref_path: str) -> str | None:
    target = os.path.realpath(os.path.join(root, ref_path))
    if not target.startswith(os.path.realpath(root) + os.sep):
        return None
    return target
```

Any client-supplied path that escapes the wildcards root → 400.

## Caching

- Tree result cached in-process. TTL 5 minutes.
- File payloads cached by reference path. TTL 5 minutes.
- `POST /refresh` clears both caches.
- No `ETag` / `Last-Modified` headers in v1 — caching is server-side only.

## Errors

All non-200 responses include a JSON body with at least `{"error": "..."}`.
Frontend should toast the error message.
