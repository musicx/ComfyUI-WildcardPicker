"""WildcardPicker node.

The `text` widget is the canonical content; the JS modal mutates it via
the Browse button. At execution time the node resolves wildcards using
Impact-Pack's parser (the same one ImpactWildcardProcessor uses) and
returns the populated string.

Why resolve here instead of relying on a downstream ImpactWildcardProcessor:
the upstream populate flow only fires when wildcard_text is a *widget*; once
it's converted to an *input slot* (which is exactly what we need to wire
this node to it), the frontend can't read the runtime value and the
resolution silently no-ops. Self-resolving sidesteps that entirely.
"""
from __future__ import annotations


def _resolve(text: str, seed: int) -> str:
    """Run text through Impact-Pack's wildcards.process. Pass through on error."""
    try:
        from impact import wildcards as impact_wildcards  # type: ignore
    except Exception as e:  # noqa: BLE001 — log + degrade
        print(
            "[WildcardPicker] impact-pack wildcards module unavailable "
            f"({e}); returning raw text. Install comfyui-impact-pack."
        )
        return text
    try:
        return impact_wildcards.process(text=text, seed=seed)
    except Exception as e:  # noqa: BLE001
        print(f"[WildcardPicker] resolve failed, returning raw text: {e}")
        return text


class WildcardPicker:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "Click '📂 Browse wildcards' to compose, or type/paste here.",
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "tooltip": "Random seed for wildcard resolution. Set control to 'randomize' for a new prompt every run.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "process"
    CATEGORY = "WildcardPicker"

    # OUTPUT_NODE is what makes ComfyUI forward the `ui` payload from
    # process() to the frontend. The frontend then injects the populated
    # text into a read-only display widget on the node.
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, text: str, seed: int = 0):
        # Make ComfyUI re-execute whenever the seed (or text) changes so the
        # randomization actually rerolls. Without this, ComfyUI may cache the
        # output across runs even when the user wants a new sample.
        return f"{seed}|{text}"

    def process(self, text: str, seed: int = 0):
        resolved = _resolve(text, seed)
        return {
            "ui": {"populated_text": [resolved]},
            "result": (resolved,),
        }


NODE_CLASS_MAPPINGS = {
    "WildcardPicker": WildcardPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WildcardPicker": "Wildcard Picker 🌳",
}
