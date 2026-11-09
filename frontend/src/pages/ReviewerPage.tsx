import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewsApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import { formatPEN, type ReviewDecision, type ReviewQueueItem, type ReviewQueuePage } from "../types/index.js";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

// Same bounds as the API (backend/src/shared/schemas.ts): the motivo is trimmed before it is counted.
const MOTIVO_MIN = 10;
const MOTIVO_MAX = 500;

const REASON_LABELS: Record<string, string> = {
  HOURLY_AMOUNT: "Monto horario sobre el umbral",
  STRUCTURING: "Patrón de fraccionamiento",
};

const DECIDED_MESSAGES: Record<ReviewDecision, string> = {
  APROBAR: "Donación aprobada: el donante ya puede confirmarla.",
  RECHAZAR: "Donación rechazada: no se sumará al proyecto.",
};

type ApiError = Error & { statusCode?: number };

const statusOf = (error: unknown): number | undefined => (error as ApiError | null)?.statusCode;

// What the reviewer is told for each refusal of the API; anything else shows the message of the API.
const DECISION_ERRORS: Record<number, string> = {
  409: "La donación ya no está en revisión: otro revisor la resolvió o venció. La cola se actualizó.",
  403: "Acceso denegado: no puede decidir sobre esta donación (es suya, es de un proyecto que usted creó o su rol REVISOR ya no está vigente).",
  401: "Su sesión ya no es válida. Inicie sesión nuevamente para continuar.",
};

const QUEUE_ERRORS: Record<number, string> = {
  401: "Su sesión ya no es válida. Inicie sesión nuevamente para continuar.",
  403: "Acceso denegado: su rol REVISOR no está vigente para esta sesión.",
};

function decisionErrorOf(error: unknown): string {
  return DECISION_ERRORS[statusOf(error) ?? 0] ?? ((error as Error)?.message || "No se pudo registrar la decisión.");
}

const LoginLink: React.FC = () => {
  const { login } = useAuth();
  return (
    <button type="button" onClick={login} className="ml-2 underline font-semibold">
      Iniciar sesión
    </button>
  );
};

const AccessReserved: React.FC = () => (
  <div className="max-w-xl mx-auto px-4 py-16 text-center">
    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
    <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Reservado para Revisores</h2>
    <p className="text-sm text-slate-600">
      La revisión de donaciones retenidas requiere membresía verificada en el grupo <strong>REVISOR</strong> con
      autenticación obligatoria de segundo factor (TOTP MFA).
    </p>
  </div>
);

const ReasonBadges: React.FC<{ reasons?: string[] }> = ({ reasons = [] }) => (
  <div className="flex flex-wrap gap-1.5 mb-4">
    {reasons.map((reason) => (
      <span
        key={reason}
        className="text-[11px] font-bold px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200"
      >
        {REASON_LABELS[reason] ?? reason}
      </span>
    ))}
  </div>
);

function countHint(length: number): string {
  if (length > 0 && length < MOTIVO_MIN) return ` (faltan ${MOTIVO_MIN - length})`;
  if (length > MOTIVO_MAX) return ` (sobran ${length - MOTIVO_MAX})`;
  return "";
}

const MotivoField: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const length = value.trim().length;
  const isOutOfBounds = length > 0 && (length < MOTIVO_MIN || length > MOTIVO_MAX);
  return (
    <div>
      <label htmlFor="review-motivo" className="block text-xs font-semibold text-slate-700 mb-1">
        Motivo de la decisión (obligatorio, {MOTIVO_MIN} - {MOTIVO_MAX} caracteres)
      </label>
      <textarea
        id="review-motivo"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="Explique la verificación realizada y por qué aprueba o rechaza la donación..."
        aria-describedby="review-motivo-count"
      />
      <p
        id="review-motivo-count"
        aria-live="polite"
        className={`text-[11px] mt-1 ${isOutOfBounds ? "text-red-600" : "text-slate-500"}`}
      >
        {length} / {MOTIVO_MAX} caracteres{countHint(length)}
      </p>
    </div>
  );
};

const DecisionButtons: React.FC<{ disabled: boolean; isPending: boolean; onDecide: (choice: ReviewDecision) => void }> = ({
  disabled,
  isPending,
  onDecide,
}) => (
  <div className="flex gap-3 mt-4">
    <button
      type="button"
      disabled={disabled}
      onClick={() => onDecide("RECHAZAR")}
      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 text-sm font-semibold disabled:opacity-50"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
      Rechazar
    </button>
    <button
      type="button"
      disabled={disabled}
      onClick={() => onDecide("APROBAR")}
      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-semibold disabled:opacity-50 shadow-sm"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
      Aprobar
    </button>
  </div>
);

const DonationSummary: React.FC<{ item: ReviewQueueItem }> = ({ item }) => (
  <div>
    <h2 className="text-lg font-bold text-slate-900">{formatPEN(item.amountCents)}</h2>
    <p className="text-xs text-slate-500 font-mono">Donación: {item.donationId}</p>
    <p className="text-xs text-slate-500 font-mono">Proyecto: {item.projectId}</p>
    <p className="text-xs text-slate-500 font-mono">Donante (seudónimo): {item.donorRef}</p>
    <p className="text-xs text-slate-500">Registrada: {new Date(item.createdAt).toLocaleString("es-PE")}</p>
  </div>
);

/** Decision on one held donation: a required motivo, then Aprobar or Rechazar. */
const ReviewPanel: React.FC<{
  item: ReviewQueueItem;
  onClose: () => void;
  onDecided: (message: string) => void;
  onStale: () => void;
}> = ({ item, onClose, onDecided, onStale }) => {
  const { user } = useAuth();
  const [motivo, setMotivo] = useState("");
  const length = motivo.trim().length;

  const decision = useMutation({
    mutationFn: (choice: ReviewDecision) =>
      reviewsApi.decide(item.donationId, choice, motivo.trim(), user?.access_token || ""),
    onSuccess: (_result, choice) => onDecided(DECIDED_MESSAGES[choice]),
    onError: (error) => {
      if (statusOf(error) === 409) onStale();
    },
  });

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm" aria-label="Detalle de la donación">
      <div className="flex justify-between items-start gap-3 mb-4">
        <DonationSummary item={item} />
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
          title="Cerrar"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ReasonBadges reasons={item.reviewReasons} />
      <MotivoField value={motivo} onChange={setMotivo} />
      {decision.error && (
        <div role="alert" className="mt-3 bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">
          {decisionErrorOf(decision.error)}
          {statusOf(decision.error) === 401 && <LoginLink />}
        </div>
      )}
      <DecisionButtons
        disabled={length < MOTIVO_MIN || length > MOTIVO_MAX || decision.isPending}
        isPending={decision.isPending}
        onDecide={(choice) => decision.mutate(choice)}
      />
    </section>
  );
};

const QueueError: React.FC<{ error: unknown }> = ({ error }) => (
  <div role="alert" className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm mb-6">
    {QUEUE_ERRORS[statusOf(error) ?? 0] ?? "No se pudo cargar la cola de revisión."}
    {statusOf(error) === 401 && <LoginLink />}
  </div>
);

const QueueList: React.FC<{
  page: ReviewQueuePage;
  selectedId?: string;
  canGoBack: boolean;
  onSelect: (item: ReviewQueueItem) => void;
  onPrevious: () => void;
  onNext: (token: string) => void;
}> = ({ page, selectedId, canGoBack, onSelect, onPrevious, onNext }) => (
  <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    {page.items.length === 0 && (
      <p className="text-sm text-slate-500 text-center py-16">No hay donaciones pendientes de revisión.</p>
    )}
    <ul className="divide-y divide-slate-100">
      {page.items.map((item) => (
        <li key={item.donationId}>
          <button
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selectedId === item.donationId ? "bg-indigo-50" : ""}`}
          >
            <div className="flex justify-between items-center gap-3">
              <span className="font-bold text-slate-900">{formatPEN(item.amountCents)}</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-orange-50 text-orange-700 border-orange-200">
                En revisión
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {new Date(item.createdAt).toLocaleString("es-PE")} · <span className="font-mono">{item.donorRef}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
    <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100 text-sm">
      <button
        type="button"
        disabled={!canGoBack}
        onClick={onPrevious}
        className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40"
      >
        Anterior
      </button>
      <button
        type="button"
        disabled={!page.nextToken}
        onClick={() => page.nextToken && onNext(page.nextToken)}
        className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40"
      >
        Siguiente
      </button>
    </div>
  </section>
);

const PageHeader: React.FC<{ isFetching: boolean; onRefresh: () => void }> = ({ isFetching, onRefresh }) => (
  <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
    <div>
      <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-1">
        <ShieldCheck className="w-4 h-4" /> Revisión de Cuatro Ojos — Rol REVISOR (MFA Activo)
      </div>
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
        <ClipboardCheck className="w-6 h-6 text-indigo-600" /> Donaciones en Revisión
      </h1>
      <p className="text-sm text-slate-600 mt-1">
        Donaciones retenidas por los controles antifraude, de la más antigua a la más reciente.
      </p>
    </div>
    <button
      type="button"
      onClick={onRefresh}
      disabled={isFetching}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-semibold border border-indigo-200"
    >
      <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
    </button>
  </header>
);

/** The queue a page at a time; the tokens of the pages already visited allow going back. */
function useReviewQueue(enabled: boolean, accessToken?: string) {
  const queryClient = useQueryClient();
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined]);
  const currentToken = pageTokens[pageTokens.length - 1];
  const query = useQuery({
    queryKey: ["review-queue", currentToken, accessToken],
    queryFn: () => reviewsApi.list(accessToken!, currentToken),
    enabled: enabled && Boolean(accessToken),
    retry: false,
  });
  return {
    ...query,
    canGoBack: pageTokens.length > 1,
    previous: () => setPageTokens((tokens) => tokens.slice(0, -1)),
    next: (token: string) => setPageTokens((tokens) => [...tokens, token]),
    restart: () => {
      setPageTokens([undefined]);
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
  };
}

const SuccessBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4 rounded-xl flex items-center gap-2 mb-6">
    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
    <span>{message}</span>
  </div>
);

const QueueLoading: React.FC = () => (
  <div className="flex justify-center items-center py-20" role="status">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
    <span className="sr-only">Cargando la cola de revisión...</span>
  </div>
);

export const ReviewerPage: React.FC = () => {
  const { user, roles } = useAuth();
  const isRevisor = roles.includes("REVISOR");
  const queue = useReviewQueue(isRevisor, user?.access_token);
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isRevisor) return <AccessReserved />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <PageHeader isFetching={queue.isFetching} onRefresh={() => queue.refetch()} />
      {successMsg && <SuccessBanner message={successMsg} />}
      {queue.isLoading && <QueueLoading />}
      {queue.error && <QueueError error={queue.error} />}
      {queue.data && !queue.error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <QueueList
            page={queue.data}
            selectedId={selected?.donationId}
            canGoBack={queue.canGoBack}
            onSelect={(item) => {
              setSuccessMsg(null);
              setSelected(item);
            }}
            onPrevious={queue.previous}
            onNext={queue.next}
          />
          {selected ? (
            <ReviewPanel
              key={selected.donationId}
              item={selected}
              onClose={() => setSelected(null)}
              onDecided={(message) => {
                setSelected(null);
                setSuccessMsg(message);
                queue.restart();
              }}
              onStale={queue.restart}
            />
          ) : (
            <p className="text-sm text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
              Seleccione una donación para revisarla. No puede decidir sobre sus propias donaciones ni sobre las de
              proyectos que usted creó.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
