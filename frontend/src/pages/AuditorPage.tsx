import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { formatPEN } from "../types/index.js";
import { ShieldCheck, AlertTriangle, Loader2, RefreshCw } from "lucide-react";

interface AuditEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  requestId: string;
  actorRef: string;
  resourceRef: string;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  /** Why the event happened: a denial reason, the velocity rule that held a donation, or a review decision. */
  reason?: string;
  /** Numeric context of the decision (totals, thresholds, counts); never personal data. */
  details?: Record<string, number>;
}

const formatDetail = (key: string, value: number): string =>
  `${key}: ${key.endsWith("Cents") ? formatPEN(value) : value}`;

/** What the auditor needs to tell a held donation or a review decision from a routine event. */
const EventDetail: React.FC<{ event: AuditEvent }> = ({ event }) => {
  const details = Object.entries(event.details ?? {});
  if (!event.reason && details.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <div className="space-y-0.5">
      {event.reason && <div className="font-semibold text-slate-800 break-all">{event.reason}</div>}
      {details.map(([key, value]) => (
        <div key={key} className="text-[11px] text-slate-500 whitespace-nowrap">
          {formatDetail(key, value)}
        </div>
      ))}
    </div>
  );
};

const ALL_EVENT_TYPES = "";

// Event types recorded by the backend (backend/src/shared/constants.ts).
const AUDIT_EVENT_TYPES = [
  "AUTHZ_DECISION",
  "PROJECT_CREATED",
  "PROJECT_PUBLISHED",
  "DONATION_CREATED",
  "DONATION_TRANSITIONED",
  "ROLE_ASSIGNED",
  "DONATION_RATE_LIMITED",
  "SUSPICIOUS_VELOCITY",
  "REVIEW_DECISION",
  "REVIEW_EXPIRED",
];

export const AuditorPage: React.FC = () => {
  const { user, roles } = useAuth();
  const [eventType, setEventType] = useState(ALL_EVENT_TYPES);

  const isAuditor = roles.includes("AUDITOR");

  const {
    data: auditEvents,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["audit-events", eventType, user?.access_token],
    queryFn: () =>
      apiFetch<AuditEvent[]>(eventType ? `/audit?eventType=${encodeURIComponent(eventType)}` : "/audit", {
        token: user?.access_token,
      }),
    enabled: Boolean(isAuditor && user?.access_token),
  });

  if (!isAuditor) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Reservado para Auditores</h2>
        <p className="text-sm text-slate-600">
          La consulta de eventos de auditoría requiere membresía verificada en el grupo{" "}
          <strong>AUDITOR</strong> con autenticación obligatoria de segundo factor (TOTP MFA).
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" /> Módulo de Cumplimiento y Seguridad (NIST SP 800-207)
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Registro Inmutable de Auditoría</h1>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          >
            <option value={ALL_EVENT_TYPES}>Todos los eventos</option>
            {AUDIT_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-semibold border border-indigo-200"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="flex justify-center items-center py-20" role="status">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="sr-only">Cargando eventos de auditoría...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm mb-6">
          No se pudieron cargar los eventos de auditoría. Verifique sus permisos de red.
        </div>
      )}

      {!isLoading && !error && auditEvents && auditEvents.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8">
          <p className="text-sm text-slate-500">No se encontraron registros para la categoría seleccionada.</p>
        </div>
      )}

      {!isLoading && !error && auditEvents && auditEvents.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Fecha / Hora (UTC)</th>
                  <th className="px-4 py-3">Evento</th>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Actor (Seudónimo)</th>
                  <th className="px-4 py-3">Recurso</th>
                  <th className="px-4 py-3">Resultado</th>
                  <th className="px-4 py-3">Motivo / detalle</th>
                  <th className="px-4 py-3">Correlation ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {auditEvents.map((ev) => (
                  <tr key={ev.eventId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleString("es-PE")}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{ev.eventType}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{ev.action}</td>
                    <td className="px-4 py-3 text-indigo-600">{ev.actorRef}</td>
                    <td className="px-4 py-3 text-slate-700">{ev.resourceRef}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ev.outcome === "SUCCESS"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {ev.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <EventDetail event={ev} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-[11px]">{ev.requestId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
