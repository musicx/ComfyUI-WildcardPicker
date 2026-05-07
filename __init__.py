"""ComfyUI-WildcardPicker — visual browser for the wildcards library.

Entry point loaded by ComfyUI at startup. Re-exports node mappings from
src.node and (in M3+) registers the web extension directory.
"""
from .src.node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# Importing this for its side effect: registers HTTP routes on PromptServer.
# Wrapped in try so a missing PromptServer (e.g. running tests outside
# ComfyUI) doesn't blow up node loading.
try:
    from .src import server_routes  # noqa: F401
except Exception as e:  # noqa: BLE001
    print(f"[WildcardPicker] server route registration skipped: {e}")

# Web extension directory will host the JS frontend in M3+. Pointing at it
# now is harmless even before files exist — ComfyUI tolerates missing dirs.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
