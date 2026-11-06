import React, { useState } from "react";
import { Donation } from "../types/index.js";
import { donationsApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";

interface SimulationControlsProps {
  donation: Donation;
  onSuccess: () => void;
}

export const SimulationControls: React.FC<SimulationControlsProps> = ({
  donation,
  onSuccess,
}) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (donation.status !== "PENDIENTE_SIMULACION") {
    return null;
  }

  const handleAction = async (action: "CONFIRMAR" | "RECHAZAR") => {
    if (!user?.access_token) return;
    setErrorMsg(null);
    setIsLoading(true);

    try {
      await donationsApi.simulate(donation.donationId, action, user.access_token);
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || "Error al procesar la simulación");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
          Simulación Académica (Stage de Pruebas)
        </span>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleAction("RECHAZAR")}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
            Simular Rechazo
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleAction("CONFIRMAR")}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Simular Aprobación
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {errorMsg}
        </div>
      )}
    </div>
  );
};
