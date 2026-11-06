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
