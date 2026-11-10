import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../services/apiClient.js";
import { formatPEN, type Project } from "../types/index.js";
import { Loader2, ArrowLeft, Heart, ShieldCheck } from "lucide-react";
import { DonationModal } from "../components/DonationModal.js";
import { useAuth } from "../auth/AuthContext.js";

const ProjectNotAvailable: React.FC = () => (
  <div className="max-w-3xl mx-auto px-4 py-16 text-center">
    <h2 className="text-2xl font-bold text-slate-800 mb-2">Proyecto no disponible</h2>
    <p className="text-slate-600 mb-6">
      El proyecto solicitado no existe, no ha sido publicado o ha sido retirado.
    </p>
    <Link
      to="/"
      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
    >
      <ArrowLeft className="w-4 h-4" /> Volver al catálogo
    </Link>
  </div>
);

const ProjectProgress: React.FC<{ project: Project }> = ({ project }) => {
  // The figure is the real one (a campaign can raise more than its goal); only the bar stops at its end.
  const percentage = Math.round((project.confirmedAmountCents / project.goalAmountCents) * 100);

  return (
    <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 mb-8">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-2xl font-bold text-slate-900">{formatPEN(project.confirmedAmountCents)}</span>
        <span className="text-sm font-medium text-slate-600">
          Meta: {formatPEN(project.goalAmountCents)} ({percentage}%)
        </span>
      </div>

      <div
        className="w-full bg-slate-200 rounded-full h-3 overflow-hidden mb-2"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={Math.max(100, percentage)}
        aria-label="Progreso de recaudación"
      >
        <div
          className="bg-indigo-600 h-3 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      {percentage > 100 && (
        <p className="text-sm font-medium text-emerald-700">Meta superada: se recaudó más de lo que se pedía.</p>
      )}
    </div>
  );
};

/** A closed campaign takes no new donation: the page says so instead of offering an action the API refuses. */
const ClosedNotice: React.FC = () => (
  <p role="note" className="text-sm font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg px-4 py-3">
    Esta campaña está cerrada y ya no recibe donaciones. ¡Gracias a quienes participaron!
  </p>
);

/** Only donors donate: someone signed in with another role is told so instead of being offered an action the API refuses. */
const DonationAction: React.FC<{ onDonate: () => void }> = ({ onDonate }) => {
  const { user, roles } = useAuth();
  const cannotDonate = Boolean(user) && !roles.includes("DONANTE");

  if (cannotDonate) {
    return (
      <p
        role="note"
        className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3"
      >
        Solo las cuentas con rol DONANTE pueden registrar donaciones.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onDonate}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
    >
      <Heart className="w-5 h-5" /> Registrar intención de donación
    </button>
  );
};

export const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [isDonationModalOpen, setIsDonationModalOpen] = useState(false);

  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getById(projectId!),
    enabled: Boolean(projectId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20" role="status">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <span className="sr-only">Cargando proyecto...</span>
      </div>
    );
  }
  if (error || !project) return <ProjectNotAvailable />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Volver al catálogo
      </Link>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden p-8">
        <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-2">
          <ShieldCheck className="w-4 h-4" /> Causa Social Verificada
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 mb-4">{project.title}</h1>
        <p className="text-slate-700 text-base leading-relaxed whitespace-pre-line mb-8">
          {project.description}
        </p>

        <ProjectProgress project={project} />

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            * Las donaciones registradas son simulaciones académicas protegidas con Zero Trust.
          </p>
          {project.status === "CERRADO" ? (
            <ClosedNotice />
          ) : (
            <DonationAction onDonate={() => setIsDonationModalOpen(true)} />
          )}
        </div>
      </div>

      <DonationModal
        isOpen={isDonationModalOpen}
        onClose={() => setIsDonationModalOpen(false)}
        project={project}
      />
    </div>
  );
};
