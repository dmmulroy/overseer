import { Option, Schema } from "effect";

/** Opaque continuation token owned by the collection that issued it. */
export const PaginationCursor = Schema.String.pipe(Schema.brand("PaginationCursor"));

/** Page size bounded to between one and one hundred items. */
export const PaginationLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("PaginationLimit"));

/** Shared cursor pagination request used by HTTP and application services. */
export const PaginationRequest = Schema.Struct({
  cursor: Schema.OptionFromNullOr(PaginationCursor),
  limit: PaginationLimit,
});

/** Parsed cursor pagination request. */
export interface PaginationRequest extends Schema.Schema.Type<typeof PaginationRequest> {}

/** Build the shared cursor pagination response schema for an item schema. */
export const PaginationPage = <Item extends Schema.Top>(item: Item) =>
  Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.OptionFromNullOr(PaginationCursor),
  });

/** Cursor pagination response containing immutable items and an optional continuation token. */
export interface PaginationPage<Item> {
  readonly items: ReadonlyArray<Item>;
  readonly nextCursor: Option.Option<PaginationCursor>;
}

/** Opaque cursor value accepted by paginated collection operations. */
export type PaginationCursor = typeof PaginationCursor.Type;

/** Bounded number of items requested from a paginated collection. */
export type PaginationLimit = typeof PaginationLimit.Type;
