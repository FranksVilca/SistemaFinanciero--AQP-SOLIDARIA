import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { continueHostedUiLogout } from "../auth/authService.js";
import { Loader2 } from "lucide-react";

export const LogoutContinuePage: React.FC = () => {
  const navigate = useNavigate();
  // StrictMode runs effects twice in development; each run consumes a queued hop.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!continueHostedUiLogout()) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
      <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
      <h2 className="text-lg font-semibold text-slate-800">Cerrando sesión segura...</h2>
      <p className="text-sm text-slate-500">Finalizando las sesiones de Cognito Hosted UI</p>
    </div>
  );
};
