import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleOidcCallback } from "../auth/authService.js";
import { isSignInWindow } from "../auth/popup.js";
import { Loader2 } from "lucide-react";

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  // Set when this is the sign-in window and the browser would not let it close itself.
  const [mustCloseByHand, setMustCloseByHand] = useState(false);

  useEffect(() => {
    // In the sign-in window the page that opened it has already been told, and the app must not load in here: the
    // window closes. If that page was reloaded or gone, nobody else would close it and the whole app would show in it.
    const finish = () => {
      if (!isSignInWindow()) return navigate("/", { replace: true });
      window.close();
      setMustCloseByHand(true);
    };
    handleOidcCallback()
      .catch((err) => console.error("Error en autenticación OIDC:", err))
      .then(finish);
  }, [navigate]);

  if (mustCloseByHand) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4 text-center">
        <h2 className="text-lg font-semibold text-slate-800">Puede cerrar esta ventana</h2>
        <p className="text-sm text-slate-500">Vuelva a la ventana de la aplicación para continuar.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
      <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
      <h2 className="text-lg font-semibold text-slate-800">Verificando credenciales Zero Trust...</h2>
      <p className="text-sm text-slate-500">Completando inicio de sesión seguro con PKCE</p>
    </div>
  );
};
