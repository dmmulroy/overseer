import { definePlugin, defineRule } from "@oxlint/plugins";
import type { Context, ESTree } from "@oxlint/plugins";

const isEmptyObjectExpression = (expression: ESTree.Expression): boolean =>
  expression.type === "ObjectExpression" && expression.properties.length === 0;

const getConditionalSpreadProperties = (
  spread: ESTree.SpreadElement,
): ESTree.ObjectExpression | undefined => {
  const argument = spread.argument;
  if (argument.type !== "ConditionalExpression") return undefined;

  const { consequent, alternate } = argument;
  if (consequent.type !== "ObjectExpression" || alternate.type !== "ObjectExpression") {
    return undefined;
  }

  if (isEmptyObjectExpression(consequent) === isEmptyObjectExpression(alternate)) return undefined;
  return isEmptyObjectExpression(consequent) ? alternate : consequent;
};

const conditionReferencesPropertyValue = (
  context: Context,
  spread: ESTree.SpreadElement,
  properties: ESTree.ObjectExpression,
): boolean => {
  if (spread.argument.type !== "ConditionalExpression") return false;
  const conditionText = context.sourceCode.getText(spread.argument.test);

  return properties.properties.some((property) => {
    if (property.type !== "Property" || property.kind !== "init") return false;
    const value = property.value;
    if (value.type !== "Identifier" && value.type !== "MemberExpression") return false;
    return conditionText.includes(context.sourceCode.getText(value));
  });
};

/** Reports object properties hidden behind conditional object spreads. */
export const preferDirectObjectPropertiesRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer direct object properties over conditional object spreads.",
    },
    hasSuggestions: true,
    messages: {
      preferDirectProperties:
        "Declare these object properties directly instead of conditionally spreading them.",
      replaceWithDirectProperties: "Replace the conditional spread with direct object properties.",
    },
  },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const properties = getConditionalSpreadProperties(node);
        if (properties === undefined) return;

        if (!conditionReferencesPropertyValue(context, node, properties)) {
          context.report({ node, messageId: "preferDirectProperties" });
          return;
        }

        context.report({
          node,
          messageId: "preferDirectProperties",
          suggest: [
            {
              messageId: "replaceWithDirectProperties",
              fix: (fixer) =>
                fixer.replaceText(node, context.sourceCode.getText(properties).slice(1, -1).trim()),
            },
          ],
        });
      },
    };
  },
});

/** Overseer-specific Oxlint rules. */
export default definePlugin({
  meta: { name: "overseer" },
  rules: {
    "prefer-direct-object-properties": preferDirectObjectPropertiesRule,
  },
});
