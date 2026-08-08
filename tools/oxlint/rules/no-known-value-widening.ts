import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

type BroadTargetKind = "object" | "record" | "unknown";
type KnownValueKind = "object" | "record" | "value";
type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    variable.references.every((reference) => reference.init || !reference.isWrite())
  );
}

function knownValueKind(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): KnownValueKind | null {
  const unwrapped = unwrapExpression(expression);
  switch (unwrapped.type) {
    case "ObjectExpression":
      return "record";
    case "ArrayExpression":
    case "ArrowFunctionExpression":
    case "ClassExpression":
    case "FunctionExpression":
    case "NewExpression":
      return "object";
    case "Literal":
    case "TemplateLiteral":
      return "value";
    case "UnaryExpression":
      return "value";
    case "Identifier": {
      const variable = resolveVariable(sourceCode, unwrapped);
      if (variable === null || visitedVariables.has(variable)) return null;
      const declarator = variableDeclarator(variable);
      if (
        declarator === null ||
        declarator.init === null ||
        !isStableConstVariable(variable, declarator)
      ) {
        return null;
      }
      visitedVariables.add(variable);
      return knownValueKind(sourceCode, declarator.init, visitedVariables);
    }
    default:
      return null;
  }
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isGenericRecordKey(type: ESTree.TSType, shadowedTypeNames: ReadonlySet<string>): boolean {
  if (type.type === "TSStringKeyword") return true;
  return (
    type.type === "TSTypeReference" &&
    typeReferenceName(type) === "PropertyKey" &&
    !shadowedTypeNames.has("PropertyKey")
  );
}

function broadTypeKind(
  type: ESTree.TSType,
  aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
  shadowedTypeNames: ReadonlySet<string>,
  environment: TypeAliasEnvironment = new Map(),
  resolvingAliases = new Set<string>(),
): BroadTargetKind | null {
  if (
    type.type === "TSParenthesizedType" ||
    (type.type === "TSTypeOperator" && type.operator === "readonly")
  ) {
    return broadTypeKind(
      type.typeAnnotation,
      aliases,
      shadowedTypeNames,
      environment,
      resolvingAliases,
    );
  }
  if (type.type === "TSUnknownKeyword") return "unknown";
  if (type.type === "TSObjectKeyword") return "object";

  if (type.type === "TSTypeLiteral") {
    if (type.members.length !== 1) return null;
    const [member] = type.members;
    if (member?.type !== "TSIndexSignature" || member.parameters.length !== 1) return null;
    const [parameter] = member.parameters;
    return parameter !== undefined &&
      isGenericRecordKey(parameter.typeAnnotation.typeAnnotation, shadowedTypeNames) &&
      broadTypeKind(
        member.typeAnnotation.typeAnnotation,
        aliases,
        shadowedTypeNames,
        environment,
        resolvingAliases,
      ) === "unknown"
      ? "record"
      : null;
  }

  if (type.type === "TSMappedType") {
    return isGenericRecordKey(type.constraint, shadowedTypeNames) &&
      type.typeAnnotation !== null &&
      broadTypeKind(
        type.typeAnnotation,
        aliases,
        shadowedTypeNames,
        environment,
        resolvingAliases,
      ) === "unknown"
      ? "record"
      : null;
  }

  if (type.type !== "TSTypeReference") return null;
  const name = typeReferenceName(type);
  if (name === null) return null;

  const substituted = environment.get(name);
  if (substituted !== undefined) {
    return broadTypeKind(substituted, aliases, shadowedTypeNames, environment, resolvingAliases);
  }

  if (name === "Readonly" && !shadowedTypeNames.has(name)) {
    const wrapped = type.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : broadTypeKind(wrapped, aliases, shadowedTypeNames, environment, resolvingAliases);
  }

  if (name === "Record" && !shadowedTypeNames.has(name)) {
    const key = type.typeArguments?.params[0];
    const value = type.typeArguments?.params[1];
    return key !== undefined &&
      value !== undefined &&
      isGenericRecordKey(key, shadowedTypeNames) &&
      broadTypeKind(value, aliases, shadowedTypeNames, environment, resolvingAliases) === "unknown"
      ? "record"
      : null;
  }

  const alias = aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return null;
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = type.typeArguments?.params ?? [];
  const aliasEnvironment = new Map(environment);
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index] ?? parameter.default;
    if (argument === null || argument === undefined) return null;
    aliasEnvironment.set(parameter.name.name, argument);
  }

  const nextResolvingAliases = new Set(resolvingAliases);
  nextResolvingAliases.add(name);
  return broadTypeKind(
    alias.typeAnnotation,
    aliases,
    shadowedTypeNames,
    aliasEnvironment,
    nextResolvingAliases,
  );
}

function annotationBroadTypeKind(
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
  shadowedTypeNames: ReadonlySet<string>,
): BroadTargetKind | null {
  return annotation === null || annotation === undefined
    ? null
    : broadTypeKind(annotation.typeAnnotation, aliases, shadowedTypeNames);
}

function destinationAcceptsKnownValue(
  destination: BroadTargetKind,
  source: KnownValueKind,
): boolean {
  if (destination === "unknown") return true;
  if (destination === "object") return source === "object" || source === "record";
  return source === "record";
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function broadTargetCategory(destination: BroadTargetKind): string {
  return destination === "record" ? "generic record" : destination;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
  if (owner === null) return "anonymous function";
  if (owner.id !== null) return owner.id.name;
  const parent = owner.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
  return "anonymous function";
}

/** Detect sound syntactic cases where a known value is explicitly widened to an unknown, object, or generic record type. */
export const noKnownValueWideningRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow syntactically established values from flowing into explicitly broad unknown, object, or generic record types.",
    },
    messages: {
      widening:
        "The known initializer supplying {{subject}} carries established type evidence, but the explicit broad {{target}} target type discards it. Remove the broad annotation and preserve the inferred or owner-provided type. If this value is genuinely external, parse it once at the boundary instead.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
    const shadowedTypeNames = new Set<string>();

    const registerAlias = (node: ESTree.TSTypeAliasDeclaration) => {
      const existing = aliases.get(node.id.name);
      if (existing === node) return;
      if (existing !== undefined) shadowedTypeNames.add(node.id.name);
      else aliases.set(node.id.name, node);
      if (
        node.id.name === "PropertyKey" ||
        node.id.name === "Readonly" ||
        node.id.name === "Record"
      ) {
        shadowedTypeNames.add(node.id.name);
      }
    };

    const reportFlow = (
      expression: ESTree.Expression,
      destination: BroadTargetKind | null,
      subject: string,
    ) => {
      if (destination === null) return;
      const source = knownValueKind(context.sourceCode, expression);
      if (source !== null && destinationAcceptsKnownValue(destination, source)) {
        context.report({
          node: expression,
          messageId: "widening",
          data: { subject, target: broadTargetCategory(destination) },
        });
      }
    };

    return {
      Program(node) {
        for (const statement of node.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type === "TSTypeAliasDeclaration") registerAlias(declaration);
          if (declaration?.type === "ImportDeclaration") {
            for (const specifier of declaration.specifiers) {
              if (
                specifier.local.name === "PropertyKey" ||
                specifier.local.name === "Readonly" ||
                specifier.local.name === "Record"
              ) {
                shadowedTypeNames.add(specifier.local.name);
              }
            }
          }
          if (
            declaration?.type === "TSInterfaceDeclaration" ||
            declaration?.type === "TSEnumDeclaration"
          ) {
            shadowedTypeNames.add(declaration.id.name);
          }
          if (declaration?.type === "ClassDeclaration" && declaration.id !== null) {
            shadowedTypeNames.add(declaration.id.name);
          }
        }
      },
      TSTypeAliasDeclaration: registerAlias,
      VariableDeclarator(node) {
        if (node.init === null || node.id.type !== "Identifier") return;
        reportFlow(
          node.init,
          annotationBroadTypeKind(node.id.typeAnnotation, aliases, shadowedTypeNames),
          `binding \`${node.id.name}\``,
        );
      },
      PropertyDefinition(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          annotationBroadTypeKind(node.typeAnnotation, aliases, shadowedTypeNames),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AccessorProperty(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          annotationBroadTypeKind(node.typeAnnotation, aliases, shadowedTypeNames),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") return;
        const variable = resolveVariable(context.sourceCode, node.left);
        if (variable === null) return;
        const declarator = variableDeclarator(variable);
        if (declarator === null || declarator.id.type !== "Identifier") return;
        reportFlow(
          node.right,
          annotationBroadTypeKind(declarator.id.typeAnnotation, aliases, shadowedTypeNames),
          `binding \`${declarator.id.name}\``,
        );
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const owner = enclosingFunction(node);
        reportFlow(
          node.argument,
          annotationBroadTypeKind(owner?.returnType, aliases, shadowedTypeNames),
          `return value of \`${functionName(context.sourceCode, owner)}\``,
        );
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") return;
        reportFlow(
          node.body,
          annotationBroadTypeKind(node.returnType, aliases, shadowedTypeNames),
          `return value of \`${functionName(context.sourceCode, node)}\``,
        );
      },
    };
  },
});
