import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../services/apiClient.js";
import { useAuth } from "../auth/AuthContext.js";
import type { AdminUser, AssignableRole } from "../types/index.js";
import { AlertTriangle, CheckCircle2, Loader2, Lock, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";

type Action = "ADD" | "REMOVE";
interface PendingChange {
  user: AdminUser;
  action: Action;
  role: AssignableRole;
}

type ApiError = Error & { statusCode?: number };
const statusOf = (error: unknown): number | undefined => (error as ApiError | null)?.statusCode;

// What the administrator is told for each refusal of the API; anything else shows the message of the API.
const CHANGE_ERRORS: Record<number, string> = {
  401: "Su sesión ya no es válida. Inicie sesión nuevamente para continuar.",
  403: "Acceso denegado: no puede cambiar a esta persona (es su propia cuenta, es AUDITOR o ADMIN, o su rol ADMIN ya no está vigente).",
  404: "Esa persona ya no existe en el sistema.",
};
const LIST_ERRORS: Record<number, string> = {
  401: "Su sesión ya no es válida. Inicie sesión nuevamente para continuar.",
  403: "Acceso denegado: su rol ADMIN no está vigente para esta sesión.",
};

const ROLE_STYLES: Record<string, string> = {
  DONANTE: "bg-sky-50 text-sky-700 border-sky-200",
  GESTOR: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVISOR: "bg-orange-50 text-orange-700 border-orange-200",
  AUDITOR: "bg-violet-50 text-violet-700 border-violet-200",
  ADMIN: "bg-rose-50 text-rose-700 border-rose-200",
};

const AccessReserved: React.FC = () => (
  <div className="max-w-xl mx-auto px-4 py-16 text-center">
    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
    <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Reservado para Administradores</h2>
    <p className="text-sm text-slate-600">
      La administración de roles requiere membresía verificada en el grupo <strong>ADMIN</strong> con autenticación
      obligatoria de segundo factor (TOTP MFA).
    </p>
  </div>
);

const RoleBadge: React.FC<{ role: string }> = ({ role }) => (
  <span
    className={`text-[11px] font-bold px-2 py-0.5 rounded border ${ROLE_STYLES[role] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}
  >
    {role}
  </span>
);

const ActionButton: React.FC<{ action: Action; role: AssignableRole; onClick: () => void }> = ({
  action,
  role,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
      action === "ADD"
        ? "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
        : "border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
    }`}
  >
    {action === "ADD" ? `+ ${role}` : `Quitar ${role}`}
  </button>
);

/** Why an account has no buttons, when it has none: the rules are in the API, this only says so. */
function lockedReason(user: AdminUser): string | undefined {
  if (user.isSelf) return "Su propia cuenta: no puede cambiar sus roles";
  if (user.isProtected) return "Protegido: solo se cambia con el script de operación";
  return undefined;
}

const UserRow: React.FC<{ user: AdminUser; onChange: (change: PendingChange) => void }> = ({ user, onChange }) => {
  const locked = lockedReason(user);
  return (
    <tr className="hover:bg-slate-50 align-top">
      <td className="px-4 py-3 font-medium text-slate-900 break-all">
        {user.email ?? user.userId}
        {user.isSelf && <span className="ml-2 text-[10px] font-bold text-indigo-600">(usted)</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {user.roles.length > 0 ? user.roles.map((role) => <RoleBadge key={role} role={role} />) : "—"}
        </div>
      </td>
      <td className="px-4 py-3">
        {locked ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="w-3.5 h-3.5" /> {locked}
          </span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.addable.map((role) => (
              <ActionButton key={`add-${role}`} action="ADD" role={role} onClick={() => onChange({ user, action: "ADD", role })} />
            ))}
            {user.removable.map((role) => (
              <ActionButton
                key={`remove-${role}`}
                action="REMOVE"
                role={role}
                onClick={() => onChange({ user, action: "REMOVE", role })}
              />
            ))}
            {user.addable.length === 0 && user.removable.length === 0 && (
              <span className="text-xs text-slate-400">Sin cambios posibles</span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

const ConfirmPanel: React.FC<{
  change: PendingChange;
  isPending: boolean;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ change, isPending, error, onConfirm, onCancel }) => (
  <section
    role="alertdialog"
    aria-label="Confirmar cambio de rol"
    className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6"
  >
    <p className="text-sm text-amber-900">
      {change.action === "ADD" ? "Dar" : "Quitar"} el rol <strong>{change.role}</strong>{" "}
      {change.action === "ADD" ? "a" : "de"} <strong>{change.user.email ?? change.user.userId}</strong>. Quedará
      registrado en la auditoría.
    </p>
    {error !== null && error !== undefined && (
      <p role="alert" className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
        {CHANGE_ERRORS[statusOf(error) ?? 0] ?? (error as Error).message ?? "No se pudo cambiar el rol."}
      </p>
    )}
    <div className="flex gap-3 mt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold bg-white hover:bg-slate-50 disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar
      </button>
    </div>
  </section>
);

/** The people a page at a time; the tokens of the pages already visited allow going back. */
function useUsers(enabled: boolean, accessToken: string | undefined, email: string) {
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined]);
  const currentToken = pageTokens[pageTokens.length - 1];
  const query = useQuery({
    queryKey: ["admin-users", email, currentToken, accessToken],
    queryFn: () => adminApi.list(accessToken!, { email: email || undefined, nextToken: currentToken }),
    enabled: enabled && Boolean(accessToken),
    retry: false,
  });
  return {
    ...query,
    canGoBack: pageTokens.length > 1,
    previous: () => setPageTokens((tokens) => tokens.slice(0, -1)),
    next: (token: string) => setPageTokens((tokens) => [...tokens, token]),
    restart: () => setPageTokens([undefined]),
  };
}

const SearchBox: React.FC<{ onSearch: (email: string) => void }> = ({ onSearch }) => {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
      className="flex gap-2"
    >
      <label htmlFor="admin-search" className="sr-only">
        Buscar por correo
      </label>
      <input
        id="admin-search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Buscar por correo (inicio)"
        className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-64"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-semibold border border-indigo-200"
      >
        <Search className="w-4 h-4" /> Buscar
      </button>
    </form>
  );
};

export const AdminPage: React.FC = () => {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("ADMIN");
  const [email, setEmail] = useState("");
  const users = useUsers(isAdmin, user?.access_token, email);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: ({ user: target, action, role }: PendingChange) =>
      adminApi.changeRole(target.userId, action, role, user?.access_token || ""),
    onSuccess: (result, variables) => {
      setPending(null);
      setDone(
        result.changed
          ? `Listo: ${variables.user.email ?? variables.user.userId} ahora tiene ${result.roles.join(" + ") || "ningún rol"}. Debe cerrar sesión y volver a entrar para que su token lo refleje.`
          : "No hubo nada que cambiar: la persona ya estaba así."
      );
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  if (!isAdmin) return <AccessReserved />;

  const choose = (selected: PendingChange) => {
    change.reset();
    setDone(null);
    setPending(selected);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" /> Administración de Roles — Rol ADMIN (MFA Activo)
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" /> Usuarios y Roles
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Aquí se dan y quitan DONANTE, GESTOR y REVISOR. AUDITOR y ADMIN solo se asignan con el script de operación.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox
            onSearch={(text) => {
              users.restart();
              setEmail(text);
            }}
          />
          <button
            type="button"
            onClick={() => users.refetch()}
            disabled={users.isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-semibold border border-indigo-200"
          >
            <RefreshCw className={`w-4 h-4 ${users.isFetching ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </header>

      {done && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4 rounded-xl flex items-center gap-2 mb-6">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{done}</span>
        </div>
      )}
      {pending && (
        <ConfirmPanel
          change={pending}
          isPending={change.isPending}
          error={change.error}
          onConfirm={() => change.mutate(pending)}
          onCancel={() => {
            change.reset();
            setPending(null);
          }}
        />
      )}

      {users.isLoading && (
        <div className="flex justify-center items-center py-20" role="status">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="sr-only">Cargando usuarios...</span>
        </div>
      )}
      {users.error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm mb-6">
          {LIST_ERRORS[statusOf(users.error) ?? 0] ?? "No se pudo cargar la lista de usuarios."}
        </div>
      )}
      {users.data && !users.error && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {users.data.items.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-16">
              {users.data.nextToken
                ? "No hay coincidencias en esta página. Use «Siguiente» para ver más."
                : "No se encontraron usuarios."}
            </p>
          )}
          {users.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Correo</th>
                    <th className="px-4 py-3">Roles</th>
                    <th className="px-4 py-3">Cambios posibles</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.data.items.map((item) => (
                    <UserRow key={item.userId} user={item} onChange={choose} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100 text-sm">
            <button
              type="button"
              disabled={!users.canGoBack}
              onClick={users.previous}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!users.data.nextToken}
              onClick={() => users.data.nextToken && users.next(users.data.nextToken)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
