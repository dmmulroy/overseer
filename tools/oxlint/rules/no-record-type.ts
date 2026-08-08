import { defineRule } from "@oxlint/plugins";

/** Disallow TypeScript Record utility types that erase the meaning of owned data shapes. */
export const noRecordTypeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow TypeScript Record utility types in favor of owner-provided or schema-derived types.",
    },
    messages: {
      recordType:
        "`Record` erases the meaning and provenance of this data shape. Convert each instance to a strongly typed domain type that is parsed at the earliest possible point, as close as possible to the I/O boundary where the data originated.",
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        if (node.typeName.type === "Identifier" && node.typeName.name === "Record") {
          context.report({ node, messageId: "recordType" });
        }
      },
    };
  },
});
