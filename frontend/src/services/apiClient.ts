import {
  AdminUsersPage,
  AssignableRole,
  Project,
  Donation,
  ReviewDecision,
  ReviewQueuePage,
  RoleChangeResult,
} from "../types/index.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/v1";

interface RequestOptions extends RequestInit {
  token?: string;
  idempotencyKey?: string;
}

export async function apiFetch<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { token, idempotencyKey, headers = {}, ...rest } = options;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  }

  if (idempotencyKey) {
    requestHeaders["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...rest,
    headers: requestHeaders,
  });

  if (!response.ok) {
    let errorData: { code?: string; message?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // Body not JSON
    }
    const message = errorData.message || `Error HTTP ${response.status}: ${response.statusText}`;
    const err = new Error(message);
    (err as any).statusCode = response.status;
    (err as any).code = errorData.code;
    throw err;
  }

  return response.json();
}

export const projectsApi = {
  list: () => apiFetch<Project[]>("/projects"),
  getById: (id: string) => apiFetch<Project>(`/projects/${id}`),
  create: (data: { title: string; description: string; goalAmountCents: number }, token: string) =>
    apiFetch<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
      token,
    }),
  publish: (id: string, token: string) =>
    apiFetch<Project>(`/projects/${id}/publish`, {
      method: "PATCH",
      token,
    }),
  close: (id: string, token: string) =>
    apiFetch<Project>(`/projects/${id}/close`, {
      method: "PATCH",
      token,
    }),
};

export const donationsApi = {
  create: (
    data: { projectId: string; amountCents: number },
    token: string,
    idempotencyKey: string
  ) =>
    apiFetch<Donation>("/donations", {
      method: "POST",
      body: JSON.stringify(data),
      token,
      idempotencyKey,
    }),
  simulate: (id: string, action: "CONFIRMAR" | "RECHAZAR", token: string) =>
    apiFetch<Donation>(`/donations/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ action }),
      token,
    }),
  getMyHistory: (token: string) =>
    apiFetch<Donation[]>("/donations/me", {
      token,
    }),
};

export const reviewsApi = {
  list: (token: string, nextToken?: string) =>
    apiFetch<ReviewQueuePage>(nextToken ? `/reviews?nextToken=${encodeURIComponent(nextToken)}` : "/reviews", {
      token,
    }),
  decide: (donationId: string, decision: ReviewDecision, motivo: string, token: string) =>
    apiFetch<{ donationId: string; status: Donation["status"] }>(`/donations/${donationId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, motivo }),
      token,
    }),
};

export const adminApi = {
  list: (token: string, options: { email?: string; nextToken?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.email) query.set("email", options.email);
    if (options.nextToken) query.set("nextToken", options.nextToken);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return apiFetch<AdminUsersPage>(`/admin/users${suffix}`, { token });
  },
  changeRole: (userId: string, action: "ADD" | "REMOVE", role: AssignableRole, token: string) =>
    apiFetch<RoleChangeResult>(`/admin/users/${encodeURIComponent(userId)}/roles`, {
      method: "POST",
      body: JSON.stringify({ action, role }),
      token,
    }),
};
