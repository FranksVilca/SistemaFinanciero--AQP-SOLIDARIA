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
  status: "PENDIENTE_SIMULACION" | "CONFIRMADA_SIMULADA" | "RECHAZADA_SIMULADA";
  createdAt: string;
  updatedAt: string;
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
