export interface Project {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: "PEN";
  status: "BORRADOR" | "PUBLICADO";
  createdAt: string;
  updatedAt: string;
}

export interface Donation {
  donationId: string;
  projectId: string;
  donorSub: string;
  amountCents: number;
  currency: "PEN";
  /**
   * EN_REVISION: held by the anti-abuse velocity controls until a REVISOR decides; it can be neither confirmed nor
   * rejected by the donor. RECHAZADA_REVISION: rejected by a reviewer (or expired unreviewed); it never counts.
   */
  status: "PENDIENTE_SIMULACION" | "CONFIRMADA_SIMULADA" | "RECHAZADA_SIMULADA" | "EN_REVISION" | "RECHAZADA_REVISION";
  createdAt: string;
  updatedAt: string;
}

/** A held donation as the review queue shows it: never the donor, only a stable pseudonym. */
export interface ReviewQueueItem {
  donationId: string;
  projectId: string;
  amountCents: number;
  createdAt: string;
  reviewReasons?: string[];
  donorRef: string;
}

export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  nextToken?: string;
}

export type ReviewDecision = "APROBAR" | "RECHAZAR";

/** The roles an administrator gives and takes away in the application; AUDITOR and ADMIN go through the operator script. */
export type AssignableRole = "DONANTE" | "GESTOR" | "REVISOR";

/** A person of the pool as the administration screen shows them: what the rules still let the administrator do. */
export interface AdminUser {
  userId: string;
  email?: string;
  roles: string[];
  isSelf: boolean;
  /** Holds AUDITOR or ADMIN: only the operator script changes them. */
  isProtected: boolean;
  addable: AssignableRole[];
  removable: AssignableRole[];
}

export interface AdminUsersPage {
  items: AdminUser[];
  nextToken?: string;
}

export interface RoleChangeResult {
  userId: string;
  roles: string[];
  /** False when the person already was as asked: nothing was written. */
  changed: boolean;
}

export interface ProjectStats {
  projectId: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: "PEN";
  progressPercentage: number;
}

export function formatPEN(amountCents: number): string {
  const soles = amountCents / 100;
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  }).format(soles);
}
