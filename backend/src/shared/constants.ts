export const ROLES = {
  donor: "DONANTE",
  manager: "GESTOR",
  auditor: "AUDITOR",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const DONATION_STATUS = {
  pending: "PENDIENTE_SIMULACION",
  confirmed: "CONFIRMADA_SIMULADA",
  rejected: "RECHAZADA_SIMULADA",
} as const;

export const PROJECT_STATUS = {
  draft: "BORRADOR",
  published: "PUBLICADO",
} as const;

export const CURRENCY = "PEN";

export const IDEMPOTENCY_TTL_SECONDS = 86_400;

export const SESSION_CHECK_TIMEOUT_MS = 2_000;

export const AUDIT_QUERY_MAX_DAYS = 7;
export const AUDIT_QUERY_MAX_EVENTS = 50;

export const AUTHZ_ACTIONS = {
  listProjects: "ListProjects",
  viewProject: "ViewProject",
  viewProjectStats: "ViewProjectStats",
  createProject: "CreateProject",
  publishProject: "PublishProject",
  createDonation: "CreateDonation",
  simulateDonation: "SimulateDonation",
  viewMyDonations: "ViewMyDonations",
  viewAudit: "ViewAudit",
} as const;

export type AuthzAction = (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS];

/** Actions the system performs by itself (not requests of a person): they are audited but never authorized. */
export const SYSTEM_ACTIONS = {
  assignInitialRole: "AssignInitialRole",
} as const;

export type AuditAction = AuthzAction | (typeof SYSTEM_ACTIONS)[keyof typeof SYSTEM_ACTIONS];

/** Actions that never require identity and are never audited. */
export const PUBLIC_ACTIONS: readonly AuthzAction[] = [
  AUTHZ_ACTIONS.listProjects,
  AUTHZ_ACTIONS.viewProject,
  AUTHZ_ACTIONS.viewProjectStats,
];

/** Actions that change state: their successes are audited. */
export const STATE_CHANGING_ACTIONS: readonly AuthzAction[] = [
  AUTHZ_ACTIONS.createProject,
  AUTHZ_ACTIONS.publishProject,
  AUTHZ_ACTIONS.createDonation,
  AUTHZ_ACTIONS.simulateDonation,
];

/** Actions whose session must be revalidated against the identity provider. */
export const SENSITIVE_ACTIONS: readonly AuthzAction[] = [AUTHZ_ACTIONS.publishProject, AUTHZ_ACTIONS.viewAudit];

export const AUDIT_EVENT_TYPES = {
  authorizationDecision: "AUTHZ_DECISION",
  projectCreated: "PROJECT_CREATED",
  projectPublished: "PROJECT_PUBLISHED",
  donationCreated: "DONATION_CREATED",
  donationTransitioned: "DONATION_TRANSITIONED",
  roleAssigned: "ROLE_ASSIGNED",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/** Audit event type recorded when a state-changing action succeeds. */
export const AUDIT_EVENT_TYPE_BY_ACTION: Partial<Record<AuthzAction, AuditEventType>> = {
  [AUTHZ_ACTIONS.createProject]: AUDIT_EVENT_TYPES.projectCreated,
  [AUTHZ_ACTIONS.publishProject]: AUDIT_EVENT_TYPES.projectPublished,
  [AUTHZ_ACTIONS.createDonation]: AUDIT_EVENT_TYPES.donationCreated,
  [AUTHZ_ACTIONS.simulateDonation]: AUDIT_EVENT_TYPES.donationTransitioned,
};

export const AUDIT_OUTCOME = {
  success: "SUCCESS",
  denied: "DENIED",
  failed: "FAILED",
} as const;

export type AuditOutcome = (typeof AUDIT_OUTCOME)[keyof typeof AUDIT_OUTCOME];

export const ANONYMOUS_ACTOR = "anonymous";
export const NO_RESOURCE_REF = "-";
