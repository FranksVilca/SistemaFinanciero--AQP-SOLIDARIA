export const ROLES = {
  donor: "DONANTE",
  manager: "GESTOR",
  auditor: "AUDITOR",
  /** Decides on the donations held by the velocity controls (four eyes: never on their own or their project's). */
  reviewer: "REVISOR",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const DONATION_STATUS = {
  pending: "PENDIENTE_SIMULACION",
  confirmed: "CONFIRMADA_SIMULADA",
  rejected: "RECHAZADA_SIMULADA",
  /** Recorded but held by the velocity controls: it can be neither confirmed nor rejected by the donor. */
  underReview: "EN_REVISION",
  /** Terminal: a reviewer rejected it, or nobody reviewed it in time. It never counts toward the project total. */
  rejectedByReview: "RECHAZADA_REVISION",
} as const;

export const PROJECT_STATUS = {
  draft: "BORRADOR",
  published: "PUBLICADO",
} as const;

export const CURRENCY = "PEN";

/** Largest single donation the API accepts (S/ 1,000.00). */
export const DONATION_MAX_CENTS = 100_000;

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
  listReviews: "ListReviews",
  reviewDonation: "ReviewDonation",
} as const;

export type AuthzAction = (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS];

/** Actions the system performs by itself (not requests of a person): they are audited but never authorized. */
export const SYSTEM_ACTIONS = {
  assignInitialRole: "AssignInitialRole",
  expireReview: "ExpireReview",
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
  AUTHZ_ACTIONS.reviewDonation,
];

/** Actions whose session must be revalidated against the identity provider. */
export const SENSITIVE_ACTIONS: readonly AuthzAction[] = [
  AUTHZ_ACTIONS.publishProject,
  AUTHZ_ACTIONS.viewAudit,
  AUTHZ_ACTIONS.reviewDonation,
];

export const AUDIT_EVENT_TYPES = {
  authorizationDecision: "AUTHZ_DECISION",
  projectCreated: "PROJECT_CREATED",
  projectPublished: "PROJECT_PUBLISHED",
  donationCreated: "DONATION_CREATED",
  donationTransitioned: "DONATION_TRANSITIONED",
  roleAssigned: "ROLE_ASSIGNED",
  donationRateLimited: "DONATION_RATE_LIMITED",
  suspiciousVelocity: "SUSPICIOUS_VELOCITY",
  reviewDecision: "REVIEW_DECISION",
  reviewExpired: "REVIEW_EXPIRED",
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
/** Actor of what the system does on its own schedule (for example expiring a review). */
export const SYSTEM_ACTOR = "system";
export const NO_RESOURCE_REF = "-";

/** Index of the donations by status, oldest first: the review queue and the expiry job read it. */
export const DONATIONS_STATUS_INDEX = "status-createdAt-index";
export const REVIEW_QUEUE_DEFAULT_LIMIT = 20;
export const REVIEW_QUEUE_MAX_LIMIT = 50;
export const REVIEW_MOTIVO_MIN_LENGTH = 10;
export const REVIEW_MOTIVO_MAX_LENGTH = 500;
export const REVIEW_EXPIRY_DEFAULT_DAYS = 7;
/** Most donations one run of the expiry job resolves; the rest wait for the next run. */
export const REVIEW_EXPIRY_MAX_PER_RUN = 100;
export const REVIEW_EXPIRY_PAGE_SIZE = 25;
export const REVIEW_EXPIRED_MOTIVO = "Vencida sin revisión";
