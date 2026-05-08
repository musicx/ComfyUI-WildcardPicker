"""HTTP route registration on ComfyUI's PromptServer.

Importing this module registers three routes:
    GET  /wildcard_picker/tree
    GET  /wildcard_picker/file?path=<ref>
    POST /wildcard_picker/refresh

The routes share a singleton TreeIndex with a 5-minute TTL.
"""
from __future__ import annotations

import time

from aiohttp import web
import server  # ComfyUI's server module — provides PromptServer

from .paths import get_wildcards_roots
from .tree_builder import TreeIndex


_TTL_SECONDS = 5 * 60

_index: TreeIndex | None = None
_built_at: float = 0.0


def _get_index() -> TreeIndex:
    global _index, _built_at
    now = time.monotonic()
    if _index is None or (now - _built_at) > _TTL_SECONDS:
        _index = TreeIndex(get_wildcards_roots())
        _built_at = now
    return _index


# Eager build at import time? No — defer to first request to keep ComfyUI
# startup snappy and to allow ComfyUI's other plugins to populate the
# wildcards directory first if they're going to.

routes = server.PromptServer.instance.routes


@routes.get("/wildcard_picker/tree")
async def _route_tree(request: web.Request) -> web.Response:
    try:
        idx = _get_index()
        return web.json_response(idx.tree)
    except Exception as e:  # noqa: BLE001 — surface anything to client
        return web.json_response({"error": f"tree build failed: {e}"}, status=500)


@routes.get("/wildcard_picker/file")
async def _route_file(request: web.Request) -> web.Response:
    path = request.query.get("path")
    if not path:
        return web.json_response({"error": "missing 'path' query param"}, status=400)
    # No traversal protection needed here — TreeIndex.get_file only matches
    # against paths registered during the walk, so unknown paths return None.
    try:
        idx = _get_index()
        result = idx.get_file(path)
    except Exception as e:  # noqa: BLE001
        return web.json_response({"error": str(e)}, status=500)
    if result is None:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response(result)


@routes.post("/wildcard_picker/refresh")
async def _route_refresh(request: web.Request) -> web.Response:
    global _index, _built_at
    _index = None
    _built_at = 0.0
    try:
        _get_index()
    except Exception as e:  # noqa: BLE001
        return web.json_response({"error": f"refresh failed: {e}"}, status=500)
    return web.json_response({"ok": True})
