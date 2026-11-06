import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { handleOidcCallback } from "../auth/authService.js";
import { Loader2 } from "lucide-react";

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    handleOidcCallback()
      .then(() => {
        navigate("/", { replace: true });
      })
      .catch((err) => {
        console.error("Error en autenticación OIDC:", err);
        navigate("/", { replace: true });
      });
  }, [navigate]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
      <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
      <h2 className="text-lg font-semibold text-slate-800">Verificando credenciales Zero Trust...</h2>
      <p className="text-sm text-slate-500">Completando inicio de sesión seguro con PKCE</p>
    </div>
  );
};
