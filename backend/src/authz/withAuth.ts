import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "../audit/recordAuditEvent.js";
import { resolveResourceRef } from "../audit/resourceRef.js";
import type { ApiEvent } from "../shared/apiEvent.js";
import {
  AUDIT_EVENT_TYPE_BY_ACTION,
  AUDIT_EVENT_TYPES,
  AUDIT_OUTCOME,
  PUBLIC_ACTIONS,
  SENSITIVE_ACTIONS,
  type AuthzAction,
} from "../shared/constants.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";
import { logError, logInfo } from "../shared/logger.js";
import { buildErrorResponse, type ApiResponse } from "../shared/response.js";
import { extractAuthClaims, type AuthPrincipal } from "./claims.js";
import { authorize, type AuthzDecision, type ResourceType } from "./evaluateAuthz.js";
import { isSessionActive } from "./sessionCheck.js";
import { WITH_AUTH } from "./withAuthMarker.js";

export { WITH_AUTH };

export interface LoadedResource<TResource> {
  resource: TResource;
  /** Identifier of the owner (for example the donor); required to enforce ownership. */
  ownerSub?: string;
}

export interface AuthedContext<TResource> {
  event: ApiEvent;
  requestId: string;
  principal: AuthPrincipal | undefined;
  resource: TResource | undefined;
}

export interface WithAuthOptions<TResource> {
  action: AuthzAction;
  resourceType: ResourceType;
  /** Loads the resource so the policy can compare its owner. Throws NotFoundError when it does not exist. */
  loadResource?: (event: ApiEvent) => Promise<LoadedResource<TResource>>;
  /** Marks a request of an otherwise normal action as sensitive, so its session is revalidated. */
  sensitiveWhen?: (event: ApiEvent) => boolean;
}

export type AuthedHandler = ((event: ApiEvent) => Promise<ApiResponse>) & { [WITH_AUTH]: true };

type Denial = Extract<AuthzDecision, { allowed: false }>;

interface RequestAudit {
  event: ApiEvent;
  requestId: string;
  principal?: AuthPrincipal;
  action: AuthzAction;
}

const ALLOWED: AuthzDecision = { allowed: true };
const SESSION_REVOKED: Denial = { allowed: false, reason: "SESSION_REVOKED" };

/** Returns the authenticated principal; protected handlers can only run after authorization succeeded. */
export function requirePrincipal(context: { principal: AuthPrincipal | undefined }): AuthPrincipal {
  if (!context.principal) throw new UnauthorizedError("Identidad no provista o token inválido");
  return context.principal;
}

function toError(denial: Denial, action: AuthzAction): Error {
  if (denial.reason === "UNAUTHENTICATED") {
    return new UnauthorizedError("Identidad no provista o token inválido");
  }
  if (denial.reason === "SESSION_REVOKED") {
    return new UnauthorizedError("La sesión ya no es válida; inicie sesión nuevamente");
  }
  return new ForbiddenError(`Acceso denegado: rol o permiso insuficiente para la acción ${action}`);
}

/** A failed audit write must never change the response, but it must never go unnoticed either. */
async function recordSafely(write: () => Promise<void>, request: RequestAudit): Promise<void> {
  try {
    await write();
  } catch (error) {
    logError("Audit event could not be written", error, { requestId: request.requestId, action: request.action });
  }
}

async function auditDenial(denial: Denial, request: RequestAudit): Promise<void> {
  if (PUBLIC_ACTIONS.includes(request.action)) return;
  await recordSafely(
    () =>
      recordAuditEvent({
        eventType: AUDIT_EVENT_TYPES.authorizationDecision,
        requestId: request.requestId,
        actorSub: request.principal?.sub,
        resourceRef: resolveResourceRef(request.event),
        action: request.action,
        outcome: AUDIT_OUTCOME.denied,
        reason: denial.reason,
      }),
    request
  );
}

async function auditSuccess(response: ApiResponse, request: RequestAudit): Promise<void> {
  const eventType = AUDIT_EVENT_TYPE_BY_ACTION[request.action];
  if (!eventType) return; // only state-changing actions audit their successes
  await recordSafely(
    () =>
      recordAuditEvent({
        eventType,
        requestId: request.requestId,
        actorSub: request.principal?.sub,
        resourceRef: resolveResourceRef(request.event, response.body),
        action: request.action,
        outcome: AUDIT_OUTCOME.success,
      }),
    request
  );
}

async function rejectIfDenied(decision: AuthzDecision, request: RequestAudit): Promise<void> {
  if (decision.allowed) return;
  await auditDenial(decision, request);
  throw toError(decision, request.action);
}

async function checkSession(
  request: RequestAudit,
  sensitiveWhen?: (event: ApiEvent) => boolean
): Promise<AuthzDecision> {
  const isSensitive = SENSITIVE_ACTIONS.includes(request.action) || sensitiveWhen?.(request.event) === true;
  if (!isSensitive) return ALLOWED;
  return (await isSessionActive(request.event)) ? ALLOWED : SESSION_REVOKED;
}

/**
 * Order of the checks (see specs/002-zta-hardening/contracts/with-auth.md): role, then resource and owner,
 * then session revalidation for sensitive requests. The role is checked before the resource is loaded so a
 * caller without the role learns nothing about whether the resource exists.
 */
async function authorizeRequest<TResource>(
  options: WithAuthOptions<TResource>,
  request: RequestAudit
): Promise<LoadedResource<TResource> | undefined> {
  const { action, resourceType, loadResource, sensitiveWhen } = options;
  const { principal, event } = request;

  await rejectIfDenied(await authorize({ principal, action, resourceType }), request);

  const loaded = loadResource ? await loadResource(event) : undefined;
  if (loaded) {
    const ownerDecision = await authorize({
      principal,
      action,
      resourceType,
      resourceOwnerSub: loaded.ownerSub,
      requiresOwner: true,
    });
    await rejectIfDenied(ownerDecision, request);
  }

  await rejectIfDenied(await checkSession(request, sensitiveWhen), request);
  return loaded;
}

/**
 * The only way to export an API handler. It authenticates, authorizes, runs the business logic, audits and
 * maps every failure to an HTTP response without leaking internals.
 */
export function withAuth<TResource = undefined>(
  handlerFn: (context: AuthedContext<TResource>) => Promise<ApiResponse>,
  options: WithAuthOptions<TResource>
): AuthedHandler {
  const guarded = async (event: ApiEvent): Promise<ApiResponse> => {
    const requestId = event.requestContext?.requestId ?? `req-${randomUUID()}`;
    const principal = extractAuthClaims(event);
    const request: RequestAudit = { event, requestId, principal, action: options.action };
    logInfo("Request received", { requestId, action: options.action });

    try {
      const loaded = await authorizeRequest(options, request);
      const response = await handlerFn({ event, requestId, principal, resource: loaded?.resource });
      await auditSuccess(response, request);
      return response;
    } catch (error) {
      logError("Request failed", error, { requestId, action: options.action });
      return buildErrorResponse(error, requestId);
    }
  };

  return Object.assign(guarded, { [WITH_AUTH]: true as const });
}
