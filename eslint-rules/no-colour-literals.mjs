/**
 * Forbids colour literals outside `src/theme/index.ts`.
 *
 * The theme is the pitch's named deliverable, and its value depends entirely on
 * nothing bypassing it. A convention would not survive nine PRs and a second
 * pitch; a rule that fails CI does.
 *
 * Catches hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, and the CSS named colours
 * that actually get typed by hand. It does not attempt the full 148-name list —
 * the goal is to stop the realistic mistake, not to win an argument about
 * `papayawhip`.
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/;
const NAMED = new RegExp(
  "\\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|" +
    "silver|navy|teal|olive|maroon|lime|aqua|fuchsia|indigo|violet|" +
    "darkgray|darkgrey|lightgray|lightgrey|whitesmoke|gainsboro)\\b",
);

function offence(value) {
  if (typeof value !== "string") return null;
  if (HEX.test(value)) return "a hex colour";
  if (FUNCTIONAL.test(value)) return "a functional colour notation";
  if (NAMED.test(value)) return "a named CSS colour";
  return null;
}

const MESSAGE =
  "{{ kind }} appears outside src/theme/index.ts. Colour lives in the theme and " +
  "is consumed as a token (e.g. sx={{ color: 'text.secondary' }}). If no token " +
  "fits, the theme is incomplete — extend it rather than inlining a value.";

export const noColourLiterals = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Colour literals belong in the theme, which is the single source of truth for them.",
    },
    schema: [],
    messages: { colourLiteral: MESSAGE },
  },

  create(context) {
    function check(node, value) {
      const kind = offence(value);
      if (kind) {
        context.report({ node, messageId: "colourLiteral", data: { kind } });
      }
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      JSXAttribute(node) {
        // `stroke="currentColor"` is fine; `stroke="#7C74FF"` is not.
        if (node.value?.type === "Literal") check(node, node.value.value);
      },
    };
  },
};

const plugin = { rules: { "no-colour-literals": noColourLiterals } };

export default plugin;
