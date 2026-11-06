// Pure helpers for ending Cognito Hosted UI sessions across realms (no browser globals).

export interface HostedUiRealm {
  realm: string;
  // Hosted UI base URL (https://<prefix>.auth.<region>.amazoncognito.com); empty when not configured.
  hostedUiDomain: string;
  clientId: string;
}

// Cognito redirects here after each /logout hop; the app then continues with the next realm.
export const LOGOUT_CONTINUE_PATH = "/auth/logout/continue";

// One /logout URL per configured realm. Each Hosted UI session has its own cookie,
// so every realm must be visited; redirecting only to the last one leaves the others alive.
export function buildHostedUiLogoutUrls(realms: HostedUiRealm[], origin: string): string[] {
  return realms
    .filter(({ hostedUiDomain }) => hostedUiDomain)
    .map(
      ({ hostedUiDomain, clientId }) =>
        `${hostedUiDomain}/logout?${new URLSearchParams({
          client_id: clientId,
          logout_uri: `${origin}${LOGOUT_CONTINUE_PATH}`,
        })}`
    );
}

export function realmsMissingHostedUiDomain(realms: HostedUiRealm[]): string[] {
  return realms.filter(({ hostedUiDomain }) => !hostedUiDomain).map(({ realm }) => realm);
}

// A logout chain abandoned midway (closed tab, Cognito error page) must not replay later.
export const LOGOUT_QUEUE_TTL_MS = 5 * 60 * 1000;

export interface LogoutQueue {
  createdAt: number;
  urls: string[];
}

// Only an exact configured Hosted UI origin with the /logout path may be followed,
// so a tampered queue can never turn the continuation route into an open redirect.
function isHostedUiLogoutUrl(candidate: string, realms: HostedUiRealm[]): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (
    url.pathname === "/logout" &&
    realms.some(({ hostedUiDomain }) => hostedUiDomain && new URL(hostedUiDomain).origin === url.origin)
  );
}

export function takeNextLogoutHop(
  queue: unknown,
  now: number,
  realms: HostedUiRealm[]
): { next?: string; remaining?: LogoutQueue } {
  if (!queue || typeof queue !== "object" || Array.isArray(queue)) return {};
  const { createdAt, urls } = queue as Partial<LogoutQueue>;
  if (typeof createdAt !== "number" || !Array.isArray(urls)) return {};
  if (now - createdAt > LOGOUT_QUEUE_TTL_MS) return {};

  const [next, ...rest] = urls.filter(
    (url): url is string => typeof url === "string" && isHostedUiLogoutUrl(url, realms)
  );
  if (!next) return {};
  return rest.length ? { next, remaining: { createdAt, urls: rest } } : { next };
}
