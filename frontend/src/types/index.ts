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
