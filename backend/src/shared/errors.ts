export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = "INTERNAL_SERVER_ERROR") {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(message, 404, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Credencial ausente o inválida") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acceso denegado") {
    super(message, 403, "FORBIDDEN");
  }
}

/** Refusals that a handler decides by a rule of the domain; withAuth records them as authorization denials. */
export type HandlerDenialReason = "CONFLICT_OF_INTEREST";

export class PolicyDenialError extends ForbiddenError {
  public readonly reason: HandlerDenialReason;

  constructor(reason: HandlerDenialReason, message?: string) {
    super(message);
    this.reason = reason;
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflicto con el estado actual del recurso") {
    super(message, 409, "CONFLICT");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Parámetros de solicitud inválidos") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Demasiadas donaciones en poco tiempo; intente nuevamente en un minuto") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}
