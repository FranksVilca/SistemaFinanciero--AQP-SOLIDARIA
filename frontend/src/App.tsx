import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext.js";
import { Navbar } from "./components/Navbar.js";
import { CatalogPage } from "./pages/CatalogPage.js";
import { ProjectDetailPage } from "./pages/ProjectDetailPage.js";
import { DonorHistoryPage } from "./pages/DonorHistoryPage.js";
import { ManagerDashboardPage } from "./pages/ManagerDashboardPage.js";
import { AuditorPage } from "./pages/AuditorPage.js";
import { ReviewerPage } from "./pages/ReviewerPage.js";
import { AdminPage } from "./pages/AdminPage.js";
import { AuthCallbackPage } from "./pages/AuthCallbackPage.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute cache
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-grow">
              <Routes>
                <Route path="/" element={<CatalogPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/history" element={<DonorHistoryPage />} />
                <Route path="/manager" element={<ManagerDashboardPage />} />
                <Route path="/auditor" element={<AuditorPage />} />
                <Route path="/reviews" element={<ReviewerPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
              </Routes>
            </main>
            <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
              <p>
                © 2026 Fundación AQP-SOLIDARIA — Prototipo Académico Cloud-Native Zero Trust (NIST SP 800-207).
              </p>
              <p className="mt-1 text-slate-400">
                Simulación académica: no se solicitan ni almacenan datos de tarjetas, CVV ni fondos reales.
              </p>
            </footer>
          </div>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
