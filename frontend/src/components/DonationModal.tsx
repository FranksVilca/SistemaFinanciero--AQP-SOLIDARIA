import React, { useState } from "react";
import { Project, formatPEN } from "../types/index.js";
import { donationsApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { X, ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose, project }) => {
  const { user, login } = useAuth();
  const [amountSoles, setAmountSoles] = useState<string>("50");
  const [isLoading, setIsLoading] = useState(false);
  const [successDonationId, setSuccessDonationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!user || !user.access_token) {
      login();
      return;
    }

    const numericSoles = parseFloat(amountSoles);
    if (isNaN(numericSoles) || numericSoles < 1 || numericSoles > 1000) {
      setErrorMessage("El importe debe ser entre S/ 1.00 y S/ 1,000.00 (máximo dos decimales).");
      return;
    }

    const amountCents = Math.round(numericSoles * 100);
    // Generate new UUID v4 for idempotency
    const idempotencyKey = crypto.randomUUID();

    setIsLoading(true);
    try {
      const result = await donationsApi.create(
        { projectId: project.projectId, amountCents },
        user.access_token,
        idempotencyKey
      );
      setSuccessDonationId(result.donationId);
    } catch (err: any) {
      setErrorMessage(err.message || "Error al registrar la intención de donación");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="donation-modal-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 focus:outline-none"
          aria-label="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        {successDonationId ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">¡Intención Registrada!</h3>
            <p className="text-sm text-slate-600 mb-4">
              Tu intención de aporte por{" "}
              <strong>{formatPEN(Math.round(parseFloat(amountSoles) * 100))}</strong> para{" "}
              <em>{project.title}</em> ha sido registrada en estado{" "}
              <span className="font-semibold text-amber-600">PENDIENTE_SIMULACION</span>.
            </p>
            <div className="bg-slate-50 p-3 rounded-lg text-xs font-mono text-slate-500 mb-6 break-all">
              ID: {successDonationId}
            </div>
            <button
              type="button"
              onClick={() => {
                setSuccessDonationId(null);
                onClose();
              }}
              className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
            >
              Aceptar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 id="donation-modal-title" className="text-xl font-bold text-slate-900 mb-2">
              Registrar Intención de Donación
            </h3>
            <p className="text-xs text-slate-500 mb-4">Causa: {project.title}</p>

            {/* Academic Notice Banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3 items-start mb-5">
              <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                <strong>Simulación académica: no se ha realizado ningún cobro.</strong> Está
                prohibido ingresar números de tarjeta, CVV o claves bancarias reales.
              </p>
            </div>

            {errorMessage && (
              <div className="bg-red-50 text-red-700 text-xs p-3 rounded-lg border border-red-200 mb-4">
                {errorMessage}
              </div>
            )}

            {!user ? (
              <div className="text-center py-4">
                <p className="text-sm text-slate-600 mb-4">
                  Debes iniciar sesión con tu cuenta de Donante para registrar un aporte.
                </p>
                <button
                  type="button"
                  onClick={login}
                  className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
                >
                  Iniciar sesión con Cognito (PKCE)
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <label htmlFor="amount" className="block text-sm font-semibold text-slate-700 mb-2">
                    Monto en Soles (PEN)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-semibold">
                      S/
                    </span>
                    <input
                      id="amount"
                      type="number"
                      step="0.5"
                      min="1"
                      max="1000"
                      value={amountSoles}
                      onChange={(e) => setAmountSoles(e.target.value)}
                      required
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">Mínimo S/ 1.00 — Máximo S/ 1,000.00</p>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 flex items-center justify-center gap-2 disabled:opacity-75"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar Intención"}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
