import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { noBypassedE2eEvidenceRule } from "./rules/no-bypassed-e2e-evidence.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";

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
    "no-bypassed-e2e-evidence": noBypassedE2eEvidenceRule,
    "no-service-constructor-imports": noServiceConstructorImportsRule,
    "require-option-for-optional-values": requireOptionForOptionalValuesRule,
  },
});
