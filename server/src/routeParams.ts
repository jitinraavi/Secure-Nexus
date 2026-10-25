import type { Request } from "express";

/** Named application route parameters are single decoded path segments, never wildcards. */
export class RouteParameterError extends Error {
  readonly status = 400;
  readonly code = "INVALID_ROUTE_PARAMETER";

  constructor() {
    super("Invalid route parameter");
    this.name = "RouteParameterError";
  }
}

export function routeParam(request: Pick<Request, "params">, name: string): string {
  const value = request.params[name];
  // Express 5 also supports array-valued wildcard parameters. Do not coerce them
  // into IDs, authorization inputs, encryption contexts, or database bindings.
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RouteParameterError();
  }
  return value;
}
