import { definePlugin } from "@oxlint/plugins";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

/** Generic Oxlint rules that preserve established TypeScript type evidence. */
const typeProvenancePlugin = definePlugin({
  meta: { name: "type-provenance" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-widen-then-assert": noWidenThenAssertRule,
  },
});

export default typeProvenancePlugin;
