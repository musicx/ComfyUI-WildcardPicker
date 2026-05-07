"""ComfyUI-WildcardPicker — visual browser for the wildcards library.

Entry point loaded by ComfyUI at startup. Re-exports node mappings from
src.node and (in M3+) registers the web extension directory.
"""
from .src.node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# Web extension directory will host the JS frontend in M3+. Pointing at it
# now is harmless even before files exist — ComfyUI tolerates missing dirs.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
