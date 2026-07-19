import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { OverseerApi } from "./http-api.ts";

/** Generate Overseer's OpenAPI 3.1 document from the shared HTTP contract. */
export function openApiDocument(): OpenApi.OpenAPISpec {
  return OpenApi.fromApi(OverseerApi);
}
