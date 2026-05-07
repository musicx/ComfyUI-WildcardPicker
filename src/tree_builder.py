"""Filesystem walker + yaml flattener.

Public surface:
    TreeIndex(root)         — build the tree and a flat leaf lookup
    TreeIndex.tree          — TreeNode dict (serializable JSON)
    TreeIndex.get_file(ref) — load a leaf's content; returns FilePayload | None
    TreeIndex.refresh()     — rebuild from disk

A TreeNode is a dict:
    {
      "kind":     "dir" | "txt" | "yaml" | "yaml_dir"
                | "yaml_string" | "yaml_list" | "yaml_template",
      "name":     "<display>",
      "path":     "<reference path or empty for root>",
      "count":    int | None,
      "children": [TreeNode] | None,
    }

Reference path conventions
--------------------------
- For .txt at  <root>/Junkyard/Hair/Color/general.txt
       path =                    Junkyard/Hair/Color/general
- For yaml leaves: yaml top-level key replaces the .yaml filename, e.g.
  the yaml file HHP-SET_v6.yaml whose top key is "HHP-SET" and which
  contains character/head/Hair  -> path = HHP-SET/character/head/Hair
  This matches Impact-Pack's __HHP-SET/.../...__ convention.

The .yaml file itself is a "yaml" container whose visible path is the
filename (so the user can find it in the tree); but every descendant's
path uses the yaml-top-key root, not the filename.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import yaml


_TEMPLATE_LEN = 100  # strings longer than this are treated as templates


def _classify_yaml_value(value: Any) -> Optional[str]:
    """Return one of yaml_dir / yaml_list / yaml_string / yaml_template, or None."""
    if isinstance(value, dict):
        return "yaml_dir"
    if isinstance(value, list):
        if value and all(isinstance(x, (str, int, float)) for x in value):
            return "yaml_list"
        return None
    if isinstance(value, str):
        if "\n" in value or len(value) > _TEMPLATE_LEN:
            return "yaml_template"
        return "yaml_string"
    if isinstance(value, (int, float, bool)):
        # treat scalar primitives as short strings
        return "yaml_string"
    return None


class TreeIndex:
    def __init__(self, root: str):
        self.root = root
        self.tree: dict = {}
        # ref_path -> source descriptor for leaf loading
        # txt:        {"kind":"txt", "fs":<abs path to .txt>}
        # yaml_*:     {"kind":<kind>, "yaml_fs":<abs path to .yaml>, "key_path":[k1,k2,...]}
        self._leaves: dict[str, dict] = {}
        # Cache parsed yaml docs by fs path
        self._yaml_cache: dict[str, Any] = {}
        self.refresh()

    # ----- public -----

    def refresh(self) -> None:
        self._leaves.clear()
        self._yaml_cache.clear()
        if not os.path.isdir(self.root):
            self.tree = {
                "kind": "dir", "name": "<missing>", "path": "",
                "count": 0, "children": [],
            }
            return
        self.tree = self._walk_dir(self.root, "")

    def get_file(self, ref_path: str) -> Optional[dict]:
        """Return file payload dict, or None if ref not in index."""
        descr = self._leaves.get(ref_path)
        if descr is None:
            return None
        kind = descr["kind"]
        if kind == "txt":
            return self._load_txt(ref_path, descr["fs"])
        if kind in ("yaml_string", "yaml_list", "yaml_template"):
            return self._load_yaml_leaf(ref_path, descr)
        return None

    # ----- fs walk -----

    def _walk_dir(self, fs_path: str, ref_path: str) -> dict:
        children: list[dict] = []
        try:
            entries = sorted(os.listdir(fs_path))
        except OSError:
            entries = []

        for entry in entries:
            if entry.startswith(".") or entry == "put_wildcards_here":
                continue
            full = os.path.join(fs_path, entry)
            if os.path.isdir(full):
                child_ref = f"{ref_path}/{entry}" if ref_path else entry
                children.append(self._walk_dir(full, child_ref))
            elif entry.endswith(".txt"):
                stem = os.path.splitext(entry)[0]
                stem_ref = f"{ref_path}/{stem}" if ref_path else stem
                line_count = self._count_nonempty_lines(full)
                self._leaves[stem_ref] = {"kind": "txt", "fs": full}
                children.append({
                    "kind": "txt",
                    "name": stem,
                    "path": stem_ref,
                    "count": line_count,
                    "children": None,
                })
            elif entry.endswith((".yaml", ".yml")):
                yaml_node = self._build_yaml_node(full, entry)
                if yaml_node is not None:
                    children.append(yaml_node)

        name = os.path.basename(fs_path) if ref_path else "<root>"
        return {
            "kind": "dir",
            "name": name,
            "path": ref_path,
            "count": len(children),
            "children": children,
        }

    @staticmethod
    def _count_nonempty_lines(fs_path: str) -> int:
        try:
            with open(fs_path, "r", encoding="utf-8", errors="ignore") as f:
                return sum(1 for line in f if line.strip())
        except OSError:
            return 0

    # ----- yaml -----

    def _load_yaml(self, fs_path: str) -> Any:
        if fs_path in self._yaml_cache:
            return self._yaml_cache[fs_path]
        try:
            with open(fs_path, "r", encoding="utf-8", errors="ignore") as f:
                data = yaml.safe_load(f)
        except Exception as e:
            print(f"[WildcardPicker] yaml parse failed for {fs_path}: {e}")
            data = None
        self._yaml_cache[fs_path] = data
        return data

    def _build_yaml_node(self, fs_path: str, filename: str) -> Optional[dict]:
        data = self._load_yaml(fs_path)
        if not isinstance(data, dict) or not data:
            return None

        children: list[dict] = []
        for top_key, top_val in data.items():
            top_key_str = str(top_key)
            child = self._yaml_value_to_node(
                value=top_val,
                ref_path=top_key_str,
                name=top_key_str,
                yaml_fs=fs_path,
                key_path=[top_key_str],
            )
            if child is not None:
                children.append(child)

        # The yaml file itself is a container whose 'path' is the filename
        # (used purely as a visible tag in the tree; not a reference path).
        return {
            "kind": "yaml",
            "name": filename,
            # Distinct path namespace so tree rendering can show the filename
            # without confusing it for a real ref path. We never store this in
            # _leaves, so it can never be loaded as a file.
            "path": f"@yaml:{filename}",
            "count": len(children),
            "children": children,
        }

    def _yaml_value_to_node(
        self,
        value: Any,
        ref_path: str,
        name: str,
        yaml_fs: str,
        key_path: list[str],
    ) -> Optional[dict]:
        kind = _classify_yaml_value(value)
        if kind is None:
            return None

        if kind == "yaml_dir":
            grandchildren: list[dict] = []
            for k, v in value.items():
                ks = str(k)
                child_ref = f"{ref_path}/{ks}"
                child = self._yaml_value_to_node(
                    value=v,
                    ref_path=child_ref,
                    name=ks,
                    yaml_fs=yaml_fs,
                    key_path=key_path + [ks],
                )
                if child is not None:
                    grandchildren.append(child)
            return {
                "kind": "yaml_dir",
                "name": name,
                "path": ref_path,
                "count": len(grandchildren),
                "children": grandchildren,
            }

        # Leaf — register in the lookup so the file endpoint can load it.
        self._leaves[ref_path] = {
            "kind": kind,
            "yaml_fs": yaml_fs,
            "key_path": list(key_path),
        }

        if kind == "yaml_list":
            return {
                "kind": "yaml_list",
                "name": name,
                "path": ref_path,
                "count": len(value),
                "children": None,
            }

        # yaml_string / yaml_template
        return {
            "kind": kind,
            "name": name,
            "path": ref_path,
            "count": None,
            "children": None,
        }

    # ----- file loaders -----

    @staticmethod
    def _load_txt(ref: str, fs: str) -> dict:
        try:
            with open(fs, "r", encoding="utf-8", errors="ignore") as f:
                lines = [ln.strip() for ln in f if ln.strip()]
        except OSError as e:
            return {"path": ref, "kind": "txt", "lines": [], "raw": None,
                    "error": f"read failed: {e}"}
        return {"path": ref, "kind": "txt", "lines": lines, "raw": None}

    def _load_yaml_leaf(self, ref: str, descr: dict) -> Optional[dict]:
        data = self._load_yaml(descr["yaml_fs"])
        if data is None:
            return None
        # Walk key_path
        cur: Any = data
        for k in descr["key_path"]:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                return None
        kind = descr["kind"]
        if kind == "yaml_list":
            lines = [str(x) for x in cur]
            return {"path": ref, "kind": "yaml_list", "lines": lines, "raw": None}
        if kind == "yaml_string":
            s = str(cur)
            return {"path": ref, "kind": "yaml_string", "lines": [s], "raw": None}
        if kind == "yaml_template":
            s = str(cur)
            # First non-empty stripped line as a quick label
            first = ""
            for line in s.splitlines():
                if line.strip():
                    first = line.strip()
                    break
            return {"path": ref, "kind": "yaml_template",
                    "lines": [first] if first else [], "raw": s}
        return None
