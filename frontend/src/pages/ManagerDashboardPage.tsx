import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { PlusCircle, Send, CheckCircle2, AlertTriangle, ShieldCheck, Loader2, Lock } from "lucide-react";

const CLOSE_ERRORS: Record<number, string> = {
  403: "Solo el gestor que creó el proyecto puede cerrarlo.",
  404: "No existe un proyecto con ese identificador.",
  409: "Solo se puede cerrar una campaña publicada y abierta.",
};

/** Closing is final and only for the manager who created the project, so it asks for a second click. */
const CloseCampaignSection: React.FC<{ onDone: (message: string) => void }> = ({ onDone }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [closeId, setCloseId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeMutation = useMutation({
    mutationFn: (id: string) => projectsApi.close(id, user?.access_token || ""),
    onSuccess: (closed) => {
      onDone(`La campaña "${closed.title}" se cerró: ya no recibe donaciones y sigue visible con lo recaudado.`);
      setCloseId("");
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error & { statusCode?: number }) => {
      setConfirming(false);
      setError(CLOSE_ERRORS[err.statusCode ?? 0] ?? err.message ?? "No se pudo cerrar la campaña.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!closeId.trim()) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    closeMutation.mutate(closeId.trim());
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm md:col-span-2">
      <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
        <Lock className="w-5 h-5 text-slate-600" /> Cerrar una campaña
      </h2>
      <p className="text-xs text-slate-600 mb-4">
        Una campaña publicada deja de recibir donaciones nuevas y sigue visible con lo recaudado. Las donaciones ya
        registradas se pueden seguir confirmando. Solo la cierra el gestor que la creó, y no se puede reabrir.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <label htmlFor="close-id" className="block text-xs font-semibold text-slate-700 mb-1">
            Identificador del Proyecto (UUID)
          </label>
          <input
            id="close-id"
            type="text"
            value={closeId}
            onChange={(e) => {
              setCloseId(e.target.value);
              setConfirming(false);
            }}
            required
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={closeMutation.isPending}
          className={`px-5 py-2.5 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-70 ${
            confirming ? "bg-red-600 hover:bg-red-700" : "bg-slate-700 hover:bg-slate-800"
          }`}
        >
          {closeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : confirming ? (
            "Confirmar: cerrar definitivamente"
          ) : (
            "Cerrar campaña"
          )}
        </button>
      </form>
    </section>
  );
};

export const ManagerDashboardPage: React.FC = () => {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goalSoles, setGoalSoles] = useState("5000");
  const [publishId, setPublishId] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isGestor = roles.includes("GESTOR");

  const createMutation = useMutation({
    mutationFn: (data: { title: string; description: string; goalAmountCents: number }) =>
      projectsApi.create(data, user?.access_token || ""),
    onSuccess: (newProj) => {
      setSuccessMsg(
        `Proyecto "${newProj.title}" creado exitosamente en estado BORRADOR. Identificador: ${newProj.projectId}`
      );
      // The id is what the publish form asks for: hand it over instead of making the manager find it.
      setPublishId(newProj.projectId);
      setTitle("");
      setDescription("");
      setGoalSoles("5000");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: any) => {
      setErrorMsg(err.message || "Error al crear el proyecto");
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => projectsApi.publish(id, user?.access_token || ""),
    onSuccess: (pubProj) => {
      setSuccessMsg(`Proyecto "${pubProj.title}" publicado con éxito en el catálogo público.`);
      setPublishId("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: any) => {
      setErrorMsg(err.message || "Error al publicar el proyecto");
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    const numericSoles = parseFloat(goalSoles);
    if (isNaN(numericSoles) || numericSoles < 10) {
      setErrorMsg("La meta debe ser de al menos S/ 10.00.");
      return;
    }

    createMutation.mutate({
      title,
      description,
      goalAmountCents: Math.round(numericSoles * 100),
    });
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);
    if (!publishId.trim()) return;
    publishMutation.mutate(publishId.trim());
  };

  if (!isGestor) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Reservado para Gestores</h2>
        <p className="text-sm text-slate-600">
          Esta vista y las operaciones de creación y publicación de proyectos requieren privilegios del
          grupo <strong>GESTOR</strong> con autenticación TOTP MFA obligatoria.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-1">
          <ShieldCheck className="w-4 h-4" /> Módulo de Gestión — Rol GESTOR (MFA Activo)
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Panel de Administración de Proyectos</h1>
      </header>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4 rounded-xl flex items-center gap-2 mb-6">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-4 rounded-xl flex items-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Formulario Crear Proyecto */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-indigo-600" /> Crear Proyecto (BORRADOR)
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="proj-title" className="block text-xs font-semibold text-slate-700 mb-1">
                Título del Proyecto (3 - 100 caracteres)
              </label>
              <input
                id="proj-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={3}
                maxLength={100}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Ej. Comedor Infantil Cono Norte"
              />
            </div>

            <div>
              <label htmlFor="proj-desc" className="block text-xs font-semibold text-slate-700 mb-1">
                Descripción detallada (10 - 2000 caracteres)
              </label>
              <textarea
                id="proj-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
                maxLength={2000}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Explica el objetivo social y beneficiarios..."
              />
            </div>

            <div>
              <label htmlFor="proj-goal" className="block text-xs font-semibold text-slate-700 mb-1">
                Meta de Recaudación en Soles (PEN)
              </label>
              <input
                id="proj-goal"
                type="number"
                min="10"
                step="1"
                value={goalSoles}
                onChange={(e) => setGoalSoles(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 text-sm flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Guardar Proyecto como BORRADOR"
              )}
            </button>
          </form>
        </section>

        {/* Publicar Proyecto */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Send className="w-5 h-5 text-indigo-600" /> Publicar Proyecto Existente
            </h2>
            <p className="text-xs text-slate-600 mb-4">
              Una vez publicado, el proyecto pasa de estado <strong>BORRADOR</strong> a{" "}
              <strong>PUBLICADO</strong> y comenzará a recibir intenciones de donación.
            </p>

            <form onSubmit={handlePublish} className="space-y-4">
              <div>
                <label htmlFor="pub-id" className="block text-xs font-semibold text-slate-700 mb-1">
                  Identificador del Proyecto (UUID)
                </label>
                <input
                  id="pub-id"
                  type="text"
                  value={publishId}
                  onChange={(e) => setPublishId(e.target.value)}
                  required
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={publishMutation.isPending}
                className="w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 text-sm flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Publicar en el Catálogo Público"
                )}
              </button>
            </form>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400">
            Todas las acciones de creación, publicación y cierre emiten eventos inmutables de auditoría
            registrados en DynamoDB y CloudTrail.
          </div>
        </section>

        <CloseCampaignSection
          onDone={(message) => {
            setErrorMsg(null);
            setSuccessMsg(message);
          }}
        />
      </div>
    </div>
  );
};
