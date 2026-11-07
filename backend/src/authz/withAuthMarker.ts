/**
 * Marks a handler that was produced by withAuth(). A test reads this marker for every handler declared in
 * infra/template.yaml, so a route cannot be exposed without authorization. Symbol.for keeps it stable across
 * module instances.
 */
export const WITH_AUTH: unique symbol = Symbol.for("aqp.withAuth");
