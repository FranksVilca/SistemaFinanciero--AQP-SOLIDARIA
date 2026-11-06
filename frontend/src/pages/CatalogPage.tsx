import React from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../services/apiClient.js";
import { ProjectCard, EmptyCatalogState } from "../components/ProjectCard.js";
import { Loader2, AlertCircle } from "lucide-react";

export const CatalogPage: React.FC = () => {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <header className="mb-10 text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mb-3">
          Proyectos Sociales — Fundación AQP-SOLIDARIA
        </h1>
        <p className="text-slate-600">
          Explora nuestras iniciativas de educación, nutrición y salud comunitaria en Arequipa y apoya
          mediante intenciones de donación verificables.
        </p>
      </header>

      {isLoading && (
        <div className="flex justify-center items-center py-20" role="status">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="sr-only">Cargando proyectos...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">
            No se pudieron cargar los proyectos. Intente nuevamente en unos instantes.
          </p>
        </div>
      )}

      {!isLoading && !error && projects && projects.length === 0 && <EmptyCatalogState />}

      {!isLoading && !error && projects && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <ProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};
