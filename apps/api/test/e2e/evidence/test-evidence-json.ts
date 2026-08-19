import { Inspectable, Schema } from "effect";

const encodeDefect = Schema.encodeSync(Schema.Defect({ includeStack: true }));
const parseJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

/** Encode arbitrary diagnostic evidence as JSON without affecting the observed test behavior. */
export const encodeTestEvidenceJson = <A>(value: A): Schema.Json => {
  try {
    const serialized = JSON.stringify(encodeDefect(value));
    return serialized === undefined
      ? Inspectable.toStringUnknown(value)
      : parseJsonString(serialized);
  } catch {
    return Inspectable.toStringUnknown(value);
  }
};
