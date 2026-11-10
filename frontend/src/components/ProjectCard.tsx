import React from "react";
import { Link } from "react-router-dom";
import { Project, formatPEN } from "../types/index.js";
import { HeartHandshake, ArrowRight } from "lucide-react";

interface ProjectCardProps {
  project: Project;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  // The figure is the real one (a campaign can raise more than its goal); only the bar stops at its end.
  const percentage = Math.round((project.confirmedAmountCents / project.goalAmountCents) * 100);
  const isClosed = project.status === "CERRADO";

  return (
    <article className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow flex flex-col justify-between">
      <div className="p-6">
        <div className="flex items-center gap-2 text-indigo-600 mb-3">
          <HeartHandshake className="w-5 h-5" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">Causa Social</span>
          {isClosed && (
            <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full border bg-slate-100 text-slate-700 border-slate-300">
              Campaña cerrada
            </span>
          )}
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">{project.title}</h3>
        <p className="text-slate-600 text-sm line-clamp-3 mb-6">{project.description}</p>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium text-slate-700">
            <span>Recaudado: {formatPEN(project.confirmedAmountCents)}</span>
            <span>{percentage}%</span>
          </div>
          <div
            className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={Math.max(100, percentage)}
            aria-label={`Progreso de ${project.title}`}
          >
            <div
              className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <div className="text-right text-xs text-slate-500">
            Meta: {formatPEN(project.goalAmountCents)}
          </div>
        </div>
      </div>

      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
        <Link
          to={`/projects/${project.projectId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700 focus:outline-none focus:underline"
        >
          {isClosed ? "Ver resultado" : "Ver detalle y donar"} <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
};

export const EmptyCatalogState: React.FC = () => (
  <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200">
    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
      <HeartHandshake className="w-6 h-6" />
    </div>
    <h3 className="text-lg font-bold text-slate-800 mb-1">No hay proyectos publicados por el momento</h3>
    <p className="text-slate-500 text-sm max-w-md mx-auto">
      La Fundación AQP-SOLIDARIA está preparando nuevas iniciativas sociales. Vuelve a consultar pronto.
    </p>
  </div>
);
