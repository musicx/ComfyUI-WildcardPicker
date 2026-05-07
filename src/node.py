"""WildcardPicker node.

M1: passthrough only. The `text` widget is the canonical content. The JS
extension (M3+) will mutate it via the Browse modal; the Python side just
echoes the current value to downstream consumers (typically
ImpactWildcardProcessor).
"""


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
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "passthrough"
    CATEGORY = "WildcardPicker"

    def passthrough(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {
    "WildcardPicker": WildcardPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WildcardPicker": "Wildcard Picker 🌳",
}
