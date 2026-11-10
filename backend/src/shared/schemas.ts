import { z } from "zod";
import { DONATION_MAX_CENTS, REVIEW_MOTIVO_MAX_LENGTH, REVIEW_MOTIVO_MIN_LENGTH, ROLES } from "./constants.js";

export const CurrencySchema = z.literal("PEN");

export const ProjectStatusSchema = z.enum(["BORRADOR", "PUBLICADO", "CERRADO"]);

export const DonationStatusSchema = z.enum([
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
  "EN_REVISION",
  "RECHAZADA_REVISION",
]);

export const AuditOutcomeSchema = z.enum(["SUCCESS", "DENIED", "FAILED"]);

export const CreateProjectSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "El título debe tener al menos 3 caracteres")
    .max(100, "El título no puede exceder 100 caracteres"),
  description: z
    .string()
    .trim()
    .min(10, "La descripción debe tener al menos 10 caracteres")
    .max(2000, "La descripción no puede exceder 2000 caracteres"),
  goalAmountCents: z
    .number()
    .int("El monto debe ser un número entero de céntimos")
    .positive("La meta debe ser positiva")
    .min(1000, "Meta mínima S/ 10.00 (1000 céntimos)"),
});

export const CreateDonationSchema = z.object({
  projectId: z.string().uuid("Identificador de proyecto inválido (debe ser UUID)"),
  amountCents: z
    .number()
    .int("El monto debe ser un número entero de céntimos")
    .min(100, "Monto mínimo S/ 1.00 (100 céntimos)")
    .max(DONATION_MAX_CENTS, "Monto máximo S/ 1,000.00 (100,000 céntimos)"),
});

export const SimulateDonationSchema = z.object({
  action: z.enum(["CONFIRMAR", "RECHAZAR"]),
});

export const ReviewDonationSchema = z.object({
  decision: z.enum(["APROBAR", "RECHAZAR"], "La decisión debe ser APROBAR o RECHAZAR"),
  motivo: z
    .string("El motivo es obligatorio")
    .trim()
    .min(REVIEW_MOTIVO_MIN_LENGTH, `El motivo debe tener al menos ${REVIEW_MOTIVO_MIN_LENGTH} caracteres`)
    .max(REVIEW_MOTIVO_MAX_LENGTH, `El motivo no puede exceder ${REVIEW_MOTIVO_MAX_LENGTH} caracteres`),
});

const ROLE_NAMES = Object.values(ROLES) as [string, ...string[]];

/** Any role is accepted here so a refusal can say why; which ones are assignable is decided by roleRules.ts. */
export const ChangeUserRoleSchema = z.object({
  action: z.enum(["ADD", "REMOVE"], "La acción debe ser ADD o REMOVE"),
  role: z.enum(ROLE_NAMES, "El rol no es válido"),
});

/** The name of a user of the pool, as Cognito hands it out (a UUID here): never anything that could reach a filter. */
export const UserIdSchema = z.string().regex(/^[A-Za-z0-9._@+-]{1,128}$/, "Identificador de usuario inválido");

export const IdempotencyHeaderSchema = z.string().uuid("Idempotency-Key debe ser un UUID v4 válido");

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateDonationInput = z.infer<typeof CreateDonationSchema>;
export type SimulateDonationInput = z.infer<typeof SimulateDonationSchema>;
export type ReviewDonationInput = z.infer<typeof ReviewDonationSchema>;
export type ReviewDecision = ReviewDonationInput["decision"];
export type ChangeUserRoleInput = z.infer<typeof ChangeUserRoleSchema>;
