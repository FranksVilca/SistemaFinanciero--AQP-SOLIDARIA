import { UserManager, WebStorageStateStore, InMemoryWebStorage, User } from "oidc-client-ts";

// Two separate Cognito user pools (CA-11.1): donors (MFA optional) and staff GESTOR/AUDITOR (MFA TOTP mandatory).
export type AuthRealm = "donor" | "staff";

interface RealmConfig {
  authority: string;
  // Hosted UI base URL (https://<prefix>.auth.<region>.amazoncognito.com); hosts /oauth2/revoke and /logout.
  hostedUiDomain: string;
  clientId: string;
  redirectPath: string;
  scope: string;
}

const realmConfigs: Record<AuthRealm, RealmConfig> = {
  donor: {
    authority:
      import.meta.env.VITE_COGNITO_AUTHORITY ||
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
    hostedUiDomain: import.meta.env.VITE_COGNITO_DOMAIN || "",
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || "example-client-id",
    redirectPath: "/auth/callback",
    scope: "openid profile email api/donations.write api/donations.read",
  },
  staff: {
    authority:
      import.meta.env.VITE_STAFF_COGNITO_AUTHORITY ||
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_staffexample",
    hostedUiDomain: import.meta.env.VITE_STAFF_COGNITO_DOMAIN || "",
    clientId: import.meta.env.VITE_STAFF_COGNITO_CLIENT_ID || "example-staff-client-id",
    redirectPath: "/auth/staff/callback",
    scope: "openid profile email api/projects.write api/audit.read",
  },
};

const postLogoutRedirectUri = window.location.origin;

// Zero Trust Browser Hardening: Tokens kept strictly in memory, never in localStorage/sessionStorage
function createUserManager(config: RealmConfig): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}${config.redirectPath}`,
    post_logout_redirect_uri: postLogoutRedirectUri,
    response_type: "code",
    scope: config.scope,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    loadUserInfo: false,
  });
}

export const userManagers: Record<AuthRealm, UserManager> = {
  donor: createUserManager(realmConfigs.donor),
  staff: createUserManager(realmConfigs.staff),
};

export async function loginWithOidc(realm: AuthRealm = "donor"): Promise<void> {
  await userManagers[realm].signinRedirect();
}

export async function handleOidcCallback(realm: AuthRealm = "donor"): Promise<User | null> {
  const user = await userManagers[realm].signinCallback();
  return user ?? null;
}

export async function logoutWithOidc(): Promise<void> {
  let hostedUiLogoutUrl: string | undefined;
  for (const realm of Object.keys(userManagers) as AuthRealm[]) {
    const manager = userManagers[realm];
    const { hostedUiDomain, clientId } = realmConfigs[realm];
    const user = await manager.getUser();
    if (user && hostedUiDomain) {
      if (user.refresh_token) {
        try {
          const response = await fetch(`${hostedUiDomain}/oauth2/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: user.refresh_token, client_id: clientId }),
          });
          if (!response.ok) {
            console.warn(`Refresh token revocation failed for ${realm} realm: HTTP ${response.status}`);
          }
        } catch {
          console.warn(`Refresh token revocation unreachable for ${realm} realm`);
        }
      }
      // End the Hosted UI session too; otherwise the next login silently reuses it.
      hostedUiLogoutUrl = `${hostedUiDomain}/logout?${new URLSearchParams({
        client_id: clientId,
        logout_uri: postLogoutRedirectUri,
      })}`;
    }
    await manager.removeUser();
  }
  window.location.href = hostedUiLogoutUrl ?? postLogoutRedirectUri;
}
