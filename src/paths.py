"""Wildcards root resolution and path safety.

The picker reads the same two roots Impact-Pack reads at runtime:

  1. Impact-Pack's built-in   custom_nodes/comfyui-impact-pack/wildcards/
  2. The user's custom path   from custom_nodes/impact-pack.ini
                              [default] custom_wildcards = ...

This keeps the tree shown in the picker exactly aligned with what
ImpactWildcardProcessor (and our own self-resolving WildcardPicker)
will see at execution time. No surprises.
"""
from __future__ import annotations

import configparser
import os


# ---------------------------------------------------------------------------
# Path discovery
# ---------------------------------------------------------------------------


def _custom_nodes_dir() -> str:
    """.../custom_nodes/  (parent of this plugin's folder)."""
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.dirname(plugin_dir)


def _impact_builtin_wildcards() -> str:
    return os.path.normpath(
        os.path.join(_custom_nodes_dir(), "comfyui-impact-pack", "wildcards")
    )


def _impact_pack_ini_path() -> str:
    """impact-pack.ini lives in custom_nodes/, not inside the plugin folder."""
    return os.path.join(_custom_nodes_dir(), "impact-pack.ini")


def _read_custom_wildcards_from_ini() -> str | None:
    """Read [default] custom_wildcards from impact-pack.ini if present.

    Mirrors Impact-Pack's own logic (config.py): strip surrounding quotes,
    treat empty as unset, and silently ignore unreadable / malformed files.
    """
    ini = _impact_pack_ini_path()
    if not os.path.isfile(ini):
        return None
    cp = configparser.ConfigParser()
    try:
        cp.read(ini, encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"[WildcardPicker] failed to read {ini}: {e}")
        return None
    raw = cp.get("default", "custom_wildcards", fallback="")
    raw = raw.strip("'\"").strip()
    return raw or None


def get_wildcards_roots() -> list[tuple[str, str]]:
    """Return ordered list of (display_label, fs_path) roots.

    Order matches Impact-Pack's runtime scan order: built-in first, then
    custom. When two roots contain the same relative file, Impact-Pack's
    last-wins behavior means the custom version is what runs; the picker
    will display both, last-wins for click-to-load.
    """
    roots: list[tuple[str, str]] = []

    builtin = _impact_builtin_wildcards()
    if os.path.isdir(builtin):
        roots.append(("Built-in (impact-pack)", builtin))

    custom = _read_custom_wildcards_from_ini()
    if custom:
        if os.path.isdir(custom):
            roots.append(("Custom", custom))
        else:
            print(
                f"[WildcardPicker] custom_wildcards configured but not found: {custom}"
            )

    return roots


def get_wildcards_root() -> str:
    """Deprecated: returns the first configured root.

    Kept for any external callers; new code should use get_wildcards_roots().
    """
    roots = get_wildcards_roots()
    return roots[0][1] if roots else _impact_builtin_wildcards()


# ---------------------------------------------------------------------------
# Path safety (kept for completeness; TreeIndex builds its own leaf map)
# ---------------------------------------------------------------------------


def safe_join(root: str, ref_path: str | None) -> str | None:
    """Join `root` and `ref_path`; return None on path traversal attempts."""
    if ref_path is None:
        return os.path.realpath(root)
    rel = ref_path.replace("\\", "/").lstrip("/")
    candidate = os.path.realpath(os.path.join(root, rel))
    canonical_root = os.path.realpath(root)
    a = os.path.normcase(canonical_root)
    b = os.path.normcase(candidate)
    if b != a and not b.startswith(a + os.sep):
        return None
    return candidate
