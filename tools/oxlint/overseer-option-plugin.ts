import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

const DOMAIN_APPLICATION_PATH =
  /(?:^|\/)src\/(?:domain|application)(?:\/|$)|\.(?:domain|application)\.[cm]?[jt]sx?$/u;
const EXCLUDED_PATH_SEGMENT =
  /(?:^|\/)(?:__fixtures__|__generated__|__mocks__|__snapshots__|__tests__|adapters?|api|boundaries|boundary|build|coverage|dist|external|fixtures?|generated|http|infrastructure|mocks?|platform|snapshots?|tests?|transport)(?:\/|$)/u;
const EXCLUDED_FILE = /(?:\.d\.[cm]?ts|\.(?:fixture|generated|gen|mock|spec|test)\.[cm]?[jt]sx?)$/u;
const GENERATED_SOURCE_MARKER = /@generated|do not edit|generated file/iu;

const functionLikeTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSFunctionType",
  "TSMethodSignature",
]);

type ConditionalEmptyObjectSpread = {
  readonly conditional: ESTree.ConditionalExpression;
  readonly property: ESTree.ObjectProperty | null;
};

type UndefinedCheckedExpression = {
  readonly expression: ESTree.Expression;
  readonly isDefinedWhenTrue: boolean;
};

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function singleObjectProperty(node: ESTree.Expression): ESTree.ObjectProperty | null {
  if (node.type !== "ObjectExpression" || node.properties.length !== 1) return null;

  const [property] = node.properties;
  if (
    property?.type !== "Property" ||
    property.kind !== "init" ||
    property.method ||
    property.computed
  ) {
    return null;
  }

  return property;
}

function conditionalEmptyObjectSpread(
  node: ESTree.Expression,
): ConditionalEmptyObjectSpread | null {
  const conditional = unwrapParentheses(node);
  if (conditional.type !== "ConditionalExpression") return null;

  if (isEmptyObjectExpression(conditional.consequent)) {
    return { conditional, property: singleObjectProperty(conditional.alternate) };
  }

  if (isEmptyObjectExpression(conditional.alternate)) {
    return { conditional, property: singleObjectProperty(conditional.consequent) };
  }

  return null;
}

function undefinedCheckedExpression(test: ESTree.Expression): UndefinedCheckedExpression | null {
  const binary = unwrapParentheses(test);
  if (binary.type !== "BinaryExpression") return null;
  if (binary.operator !== "===" && binary.operator !== "!==") return null;

  const left = unwrapParentheses(binary.left);
  const right = unwrapParentheses(binary.right);
  const leftIsUndefined = left.type === "Identifier" && left.name === "undefined";
  const rightIsUndefined = right.type === "Identifier" && right.name === "undefined";
  if (leftIsUndefined === rightIsUndefined) return null;

  return {
    expression: leftIsUndefined ? right : left,
    isDefinedWhenTrue: binary.operator === "!==",
  };
}

function canAutofixConditionalEmptyObjectSpread(
  sourceCode: SourceCode,
  conditional: ESTree.ConditionalExpression,
  property: ESTree.ObjectProperty,
): boolean {
  const checked = undefinedCheckedExpression(conditional.test);
  if (checked === null) return false;

  const propertyIsConsequent = conditional.consequent === property.parent;
  if (propertyIsConsequent !== checked.isDefinedWhenTrue) return false;

  return (
    sourceCode.getText(unwrapParentheses(checked.expression)) === sourceCode.getText(property.value)
  );
}

/** Return whether a source file is an inner domain or application module governed by the Option standard. */
export function isDomainApplicationOptionFile(filename: string, sourceText = ""): boolean {
  const normalizedFilename = filename.replaceAll("\\", "/");
  if (!DOMAIN_APPLICATION_PATH.test(normalizedFilename)) return false;
  if (EXCLUDED_PATH_SEGMENT.test(normalizedFilename) || EXCLUDED_FILE.test(normalizedFilename)) {
    return false;
  }

  return !GENERATED_SOURCE_MARKER.test(sourceText.split(/\r?\n/u).slice(0, 5).join("\n"));
}

function isNullishType(type: ESTree.TSType): boolean {
  return type.type === "TSNullKeyword" || type.type === "TSUndefinedKeyword";
}

function findOwningTypeAnnotation(node: ESTree.TSUnionType): ESTree.TSTypeAnnotation | null {
  let current: ESTree.Node | null = node.parent;

  while (current !== null && current.type !== "Program") {
    if (current.type === "TSTypeAnnotation") return current;
    if (current.type === "TSTypeAliasDeclaration") return null;
    current = current.parent;
  }

  return null;
}

function isFunctionReturnAnnotation(annotation: ESTree.TSTypeAnnotation): boolean {
  const owner = annotation.parent;
  return (
    functionLikeTypes.has(owner.type) && "returnType" in owner && owner.returnType === annotation
  );
}

function isParameterAnnotation(annotation: ESTree.TSTypeAnnotation): boolean {
  let current: ESTree.Node = annotation.parent;

  while (current.type !== "Program") {
    const parent = current.parent;
    if (parent === null) return false;
    if (functionLikeTypes.has(parent.type) && "params" in parent) {
      return parent.params.some((parameter) => parameter === current);
    }
    if (parent.type === "TSTypeAnnotation" || parent.type === "TSTypeAliasDeclaration") {
      return false;
    }
    current = parent;
  }

  return false;
}

function isPropertyAnnotation(annotation: ESTree.TSTypeAnnotation): boolean {
  return (
    annotation.parent.type === "AccessorProperty" ||
    annotation.parent.type === "PropertyDefinition" ||
    annotation.parent.type === "TSAbstractAccessorProperty" ||
    annotation.parent.type === "TSAbstractPropertyDefinition" ||
    annotation.parent.type === "TSPropertySignature"
  );
}

function isGovernedAnnotation(annotation: ESTree.TSTypeAnnotation): boolean {
  return (
    isPropertyAnnotation(annotation) ||
    isParameterAnnotation(annotation) ||
    isFunctionReturnAnnotation(annotation)
  );
}

function isOptionalParameter(node: ESTree.Node): boolean {
  if (!("optional" in node) || node.optional !== true) return false;
  const typeAnnotation = "typeAnnotation" in node ? node.typeAnnotation : null;
  return typeAnnotation?.type === "TSTypeAnnotation" && isParameterAnnotation(typeAnnotation);
}

function isOptionalProperty(node: ESTree.Node): boolean {
  if (!("optional" in node) || node.optional !== true) return false;
  return (
    node.type === "MethodDefinition" ||
    node.type === "PropertyDefinition" ||
    node.type === "TSAbstractMethodDefinition" ||
    node.type === "TSAbstractPropertyDefinition" ||
    node.type === "TSMethodSignature" ||
    node.type === "TSPropertySignature"
  );
}

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Do not use the case-insensitive substring "shape" in symbol names (found "{{name}}").',
    },
  },
  create(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});

/** Ban conditional empty-object spreads and autofix equivalent direct property declarations. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Disallow object spreads that conditionally spread an empty object to omit fields.",
    },
    messages: {
      avoid:
        "Do not use conditional empty-object spreads. Prefer a direct property or build the object in separate statements.",
    },
  },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;

        const match = conditionalEmptyObjectSpread(node.argument);
        if (match === null) return;

        const { conditional, property } = match;
        if (
          property !== null &&
          canAutofixConditionalEmptyObjectSpread(context.sourceCode, conditional, property)
        ) {
          context.report({
            node,
            messageId: "avoid",
            fix: (fixer) => fixer.replaceText(node, context.sourceCode.getText(property)),
          });
          return;
        }

        context.report({ node, messageId: "avoid" });
      },
    };
  },
});

/** Enforce Effect Option on optional domain and application declaration surfaces. */
export const requireOptionForOptionalValuesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Effect Option instead of nullish unions and optional markers in domain and application contracts.",
    },
    messages: {
      nullishUnion:
        "Represent this optional domain/application value with Effect Option, not a null or undefined union.",
      optionalMarker:
        "Represent this optional domain/application value with a required Effect Option, not an optional marker.",
    },
  },
  createOnce(context) {
    let enabled = false;
    const reportedOptionalRanges = new Set<string>();
    const reportOptionalMarker = (node: ESTree.Node) => {
      const rangeKey = `${node.start}:${node.end}`;
      if (reportedOptionalRanges.has(rangeKey)) return;
      reportedOptionalRanges.add(rangeKey);
      context.report({ node, messageId: "optionalMarker" });
    };

    return {
      Program() {
        enabled = isDomainApplicationOptionFile(context.filename, context.sourceCode.text);
      },
      TSUnionType(node) {
        if (!enabled || !node.types.some(isNullishType)) return;
        const annotation = findOwningTypeAnnotation(node);
        if (annotation !== null && isGovernedAnnotation(annotation)) {
          // Replacing the type alone would leave producers and consumers semantically inconsistent.
          context.report({ node, messageId: "nullishUnion" });
        }
      },
      Identifier(node) {
        if (enabled && isOptionalParameter(node)) reportOptionalMarker(node);
      },
      ArrayPattern(node) {
        if (enabled && isOptionalParameter(node)) reportOptionalMarker(node);
      },
      ObjectPattern(node) {
        if (enabled && isOptionalParameter(node)) reportOptionalMarker(node);
      },
      RestElement(node) {
        if (enabled && isOptionalParameter(node)) reportOptionalMarker(node);
      },
      MethodDefinition(node) {
        if (enabled && isOptionalProperty(node)) reportOptionalMarker(node);
      },
      PropertyDefinition(node) {
        if (enabled && isOptionalProperty(node)) reportOptionalMarker(node);
      },
      TSMethodSignature(node) {
        if (enabled && isOptionalProperty(node)) reportOptionalMarker(node);
      },
      TSPropertySignature(node) {
        if (enabled && isOptionalProperty(node)) reportOptionalMarker(node);
      },
    };
  },
});

export default definePlugin({
  meta: { name: "overseer" },
  rules: {
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
    "require-option-for-optional-values": requireOptionForOptionalValuesRule,
  },
});
