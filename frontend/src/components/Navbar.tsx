import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { HeartHandshake, LogIn, LogOut, Shield, User, FileText, ClipboardCheck, Users } from "lucide-react";

export const Navbar: React.FC = () => {
  const { user, roles, authError, login, logout } = useAuth();

  const isDonante = roles.includes("DONANTE");
  const isGestor = roles.includes("GESTOR");
  const isAuditor = roles.includes("AUDITOR");
  const isRevisor = roles.includes("REVISOR");
  const isAdmin = roles.includes("ADMIN");

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap justify-between items-center gap-y-3 py-3 md:py-0 md:h-16">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-slate-900 tracking-tight text-base sm:text-lg block leading-none">
                AQP-SOLIDARIA
              </span>
              <span className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wider block">
                Donaciones Seguras Zero Trust
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="order-3 flex w-full flex-wrap items-center gap-x-6 gap-y-3 pb-1 text-sm font-medium md:order-none md:w-auto md:pb-0">
            <Link to="/" className="text-slate-600 hover:text-indigo-600 transition-colors">
              Proyectos
            </Link>

            {isDonante && (
              <Link to="/history" className="text-slate-600 hover:text-indigo-600 transition-colors">
                Mis Donaciones
              </Link>
            )}

            {isGestor && (
              <Link
                to="/manager"
                className="text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <FileText className="w-4 h-4" /> Gestión Proyectos
              </Link>
            )}

            {isRevisor && (
              <Link
                to="/reviews"
                className="text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <ClipboardCheck className="w-4 h-4" /> Revisión
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin"
                className="text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <Users className="w-4 h-4" /> Usuarios
              </Link>
            )}

            {isAuditor && (
              <Link
                to="/auditor"
                className="text-slate-600 hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <Shield className="w-4 h-4" /> Auditoría
              </Link>
            )}
          </div>

          {/* Auth Actions */}
          <div className="ml-auto md:ml-0 flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1 justify-end">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    {user.profile.email || "Usuario autenticado"}
                  </span>
                  <div className="flex gap-1 justify-end mt-0.5">
                    {roles.map((role) => (
                      <span
                        key={role}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5" /> Salir
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={login}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <LogIn className="w-4 h-4" /> Iniciar Sesión (PKCE)
              </button>
            )}
          </div>
        </div>
      </div>
      {authError && (
        <div role="alert" className="bg-red-50 border-t border-red-200 text-red-800 text-sm px-4 py-2 text-center">
          {authError}
        </div>
      )}
    </nav>
  );
};
