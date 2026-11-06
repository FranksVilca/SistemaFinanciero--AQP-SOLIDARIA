import { describe, it, expect } from "vitest";
import { buildErrorResponse, buildSuccessResponse } from "../src/shared/response.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../src/shared/errors.js";

describe("Error responses do not leak internal details", () => {
  it("returns a generic 500 body for an unknown Error and keeps the requestId", () => {
    const sdkError = new Error(
      "Requested resource not found: Table: aqp-audit-academic, ConditionExpression attribute_exists(projectId)"
    );
    sdkError.name = "ResourceNotFoundException";

    const response = buildErrorResponse(sdkError, "req-leak-1");
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(500);
    expect(body).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Ha ocurrido un error interno",
      requestId: "req-leak-1",
    });
    expect(response.body).not.toContain("aqp-audit");
    expect(response.body).not.toContain("ConditionExpression");
    expect(response.body).not.toContain("ResourceNotFoundException");
  });

  it("returns the same generic body for non-Error throwables", () => {
    const body = JSON.parse(buildErrorResponse("raw failure detail", "req-leak-2").body);
    expect(body.message).toBe("Ha ocurrido un error interno");
    expect(JSON.stringify(body)).not.toContain("raw failure detail");
  });

  it.each([
    [new ValidationError("Cuerpo de solicitud requerido"), 400, "BAD_REQUEST"],
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new NotFoundError("Proyecto no encontrado"), 404, "NOT_FOUND"],
    [new ConflictError(), 409, "CONFLICT"],
    [new AppError("Fallo controlado", 422, "UNPROCESSABLE"), 422, "UNPROCESSABLE"],
  ])("keeps status and message for domain error %#", (error, statusCode, code) => {
    const response = buildErrorResponse(error, "req-domain");
    expect(response.statusCode).toBe(statusCode);
    expect(JSON.parse(response.body)).toEqual({ code, message: error.message, requestId: "req-domain" });
  });
});

describe("CORS headers are owned by API Gateway, not by the Lambda responses", () => {
  it.each([
    ["success", buildSuccessResponse({ ok: true })],
    ["error", buildErrorResponse(new Error("boom"), "req-cors")],
  ])("%s response does not send a wildcard Access-Control-Allow-Origin", (_kind, response) => {
    const origin = Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === "access-control-allow-origin"
    );
    expect(origin?.[1]).not.toBe("*");
    expect(response.headers["Content-Type"]).toBe("application/json");
  });
});
