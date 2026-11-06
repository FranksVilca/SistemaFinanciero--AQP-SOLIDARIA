import React from "react";
import { useQuery } from "@tanstack/react-query";
import { donationsApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { formatPEN } from "../types/index.js";
import { SimulationControls } from "../components/SimulationControls.js";
import { History, Loader2, AlertCircle, HeartHandshake } from "lucide-react";

export const DonorHistoryPage: React.FC = () => {
  const { user, login } = useAuth();

  const {
    data: donations,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["my-donations", user?.access_token],
    queryFn: () => donationsApi.getMyHistory(user!.access_token),
    enabled: Boolean(user?.access_token),
  });

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <History className="w-12 h-12 text-indigo-600 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Inicia Sesión para ver tu Historial</h2>
        <p className="text-sm text-slate-600 mb-6">
          Tu historial privado de donaciones está protegido bajo el modelo Zero Trust.
        </p>
        <button
          type="button"
          onClick={login}
          className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-sm"
        >
          Iniciar sesión con Cognito (PKCE)
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <History className="w-6 h-6 text-indigo-600" /> Mi Historial de Donaciones Simuladas
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Visualiza el estado de tus aportes. En este entorno académico puedes simular su confirmación o
          rechazo.
        </p>
      </header>

      {isLoading && (
        <div className="flex justify-center items-center py-20" role="status">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="sr-only">Cargando historial...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">No se pudo cargar tu historial de donaciones.</p>
        </div>
      )}

      {!isLoading && !error && donations && donations.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8">
          <HeartHandshake className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800 mb-1">Aún no registras donaciones</h3>
          <p className="text-sm text-slate-500 mb-4">
            Explora las causas activas en nuestro catálogo y registra tu primera intención.
          </p>
        </div>
      )}

      {!isLoading && !error && donations && donations.length > 0 && (
        <div className="space-y-4">
          {donations.map((d) => {
            const isPending = d.status === "PENDIENTE_SIMULACION";
            const isConfirmed = d.status === "CONFIRMADA_SIMULADA";

            return (
              <div
                key={d.donationId}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div>
                    <span className="text-lg font-bold text-slate-900">
                      {formatPEN(d.amountCents)}
                    </span>
                    <span className="text-xs text-slate-400 block font-mono">
                      ID: {d.donationId}
                    </span>
                  </div>

                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      isConfirmed
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : isPending
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    }`}
                  >
                    {d.status}
                  </span>
                </div>

                <div className="text-xs text-slate-500">
                  Fecha de registro: {new Date(d.createdAt).toLocaleString("es-PE")}
                </div>

                <SimulationControls donation={d} onSuccess={() => refetch()} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
