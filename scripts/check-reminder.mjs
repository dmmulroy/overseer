const lines = [
  "",
  "Code added or changed must follow the coding-standards skill and, where applicable, the effect skill.",
  "- This is an Effect-native project built with Alchemy v2; use idiomatic Effect and Alchemy APIs.",
  "- Avoid async/await and raw Promise workflows unless an external boundary makes them unavoidable; isolate such code in the owning Adapter.",
  "- Check repos/effect and repos/alchemy for source and examples before departing from native patterns.",
  "- Before adding a utility, helper, parser, or collection operation, check whether Effect already provides it (for example Array, Record, HashMap, HashSet, Predicate, or Schema); use the existing Effect primitive instead of hand-rolling isRecord/isArray checks or object, Map, and parsing helpers.",
  "- Prefer Effect Option for optional results instead of returning null or undefined.",
  "- Follow established Effect service/tag/layer and Effect.fn patterns.",
  "- Check each new abstraction for an existing owner and duplicate behavior; reject pass-through or speculative seams.",
  "- Parse at outer boundaries and pass parsed domain values inward.",
  "- Make each interface, parameter, function, and combinator earn its place.",
  "- Prefer the simplest correct design and the least code.",
  "",
  "Passing automated checks alone does not prove compliance.",
];

console.log(lines.join("\n"));
