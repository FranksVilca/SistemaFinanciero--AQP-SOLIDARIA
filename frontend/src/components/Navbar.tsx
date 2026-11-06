import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { HeartHandshake, LogIn, LogOut, Shield, User, FileText } from "lucide-react";

export const Navbar: React.FC = () => {
  const { user, roles, login, logout } = useAuth();

  const isDonante = roles.includes("DONANTE");
  const isGestor = roles.includes("GESTOR");
  const isAuditor = roles.includes("AUDITOR");

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
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
          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
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
          <div className="flex items-center gap-3">
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5" /> Salir
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={login}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors focus:outline-none"
              >
                <LogIn className="w-4 h-4" /> Iniciar Sesión (PKCE)
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
