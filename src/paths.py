"""Wildcards root resolution and path safety.

v1: hardcoded to comfyui-impact-pack/wildcards. v0.3 (multi-root) keeps the
single-function shape so callers can adopt a list-returning version later
without churn.
"""
import os


def get_wildcards_root() -> str:
    """Return the absolute path to the wildcards root.

    Resolved relative to this file: .../custom_nodes/<plugin>/src/paths.py
    -> .../custom_nodes/comfyui-impact-pack/wildcards
    """
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    custom_nodes = os.path.dirname(plugin_dir)
    return os.path.normpath(
        os.path.join(custom_nodes, "comfyui-impact-pack", "wildcards")
    )


def safe_join(root: str, ref_path: str) -> str | None:
    """Join `root` and `ref_path`; return None on path traversal attempts.

    `ref_path` uses forward slashes (the reference convention). Backslashes
    and leading slashes are tolerated and normalized.
    """
    if ref_path is None:
        return os.path.realpath(root)
    rel = ref_path.replace("\\", "/").lstrip("/")
    candidate = os.path.realpath(os.path.join(root, rel))
    canonical_root = os.path.realpath(root)
    # Windows paths are case-insensitive
    a = os.path.normcase(canonical_root)
    b = os.path.normcase(candidate)
    if b != a and not b.startswith(a + os.sep):
        return None
    return candidate
