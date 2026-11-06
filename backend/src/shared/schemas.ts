import { z } from "zod";

export const CurrencySchema = z.literal("PEN");

export const ProjectStatusSchema = z.enum(["BORRADOR", "PUBLICADO"]);

export const DonationStatusSchema = z.enum([
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
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
    .max(100000, "Monto máximo S/ 1,000.00 (100,000 céntimos)"),
});

export const SimulateDonationSchema = z.object({
  action: z.enum(["CONFIRMAR", "RECHAZAR"]),
});

export const IdempotencyHeaderSchema = z
  .string()
  .uuid("Idempotency-Key debe ser un UUID v4 válido");

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateDonationInput = z.infer<typeof CreateDonationSchema>;
export type SimulateDonationInput = z.infer<typeof SimulateDonationSchema>;
