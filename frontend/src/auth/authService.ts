import { UserManager, WebStorageStateStore, InMemoryWebStorage, User } from "oidc-client-ts";
import {
  buildHostedUiLogoutUrls,
  hostedUiOrigin,
  realmsWithoutValidHostedUiDomain,
  takeNextLogoutHop,
  type LogoutQueue,
} from "./logoutChain.js";

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
// (sessionStorage only holds the pending Hosted UI logout URLs, see LOGOUT_QUEUE_KEY)
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

// Pending Hosted UI /logout hops. Holds only Cognito logout URLs, never tokens.
const LOGOUT_QUEUE_KEY = "aqp.pendingHostedUiLogout";

export async function logoutWithOidc(): Promise<void> {
  const realms = Object.keys(userManagers) as AuthRealm[];
  const hostedUiRealms = hostedUiRealmList();
  // A fresh logout never resumes leftovers from an earlier, abandoned one.
  saveLogoutQueue(null);

  for (const realm of realmsWithoutValidHostedUiDomain(hostedUiRealms)) {
    console.warn(
      `Hosted UI domain missing or not an https URL for ${realm} realm: refresh token not revoked and Hosted UI session not ended`
    );
  }

  for (const realm of realms) {
    const { clientId } = realmConfigs[realm];
    const hostedUi = hostedUiOrigin(realmConfigs[realm].hostedUiDomain);
    try {
      const user = await userManagers[realm].getUser();
      if (user?.refresh_token && hostedUi) {
        const response = await fetch(`${hostedUi}/oauth2/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: user.refresh_token, client_id: clientId }),
        });
        if (!response.ok) {
          console.warn(`Refresh token revocation failed for ${realm} realm: HTTP ${response.status}`);
        }
      }
    } catch {
      console.warn(`Refresh token revocation unreachable for ${realm} realm`);
    }
    await userManagers[realm].removeUser().catch(() => undefined);
  }

  // Visit every realm's /logout, even without an in-memory user (e.g. after a reload),
  // because the Hosted UI cookie outlives the in-memory tokens.
  const [first, ...rest] = buildHostedUiLogoutUrls(hostedUiRealms, window.location.origin);
  if (!first) {
    window.location.href = postLogoutRedirectUri;
    return;
  }
  if (rest.length) saveLogoutQueue({ createdAt: Date.now(), urls: rest });
  window.location.href = first;
}

// Called on LOGOUT_CONTINUE_PATH (see logoutChain.ts). Returns false once every Hosted UI session has ended.
export function continueHostedUiLogout(): boolean {
  const { next, remaining } = takeNextLogoutHop(readLogoutQueue(), Date.now(), hostedUiRealmList());
  saveLogoutQueue(remaining ?? null);
  if (!next) return false;
  window.location.href = next;
  return true;
}

function hostedUiRealmList() {
  return (Object.keys(realmConfigs) as AuthRealm[]).map((realm) => ({ realm, ...realmConfigs[realm] }));
}

function readLogoutQueue(): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(LOGOUT_QUEUE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function saveLogoutQueue(queue: LogoutQueue | null): void {
  try {
    if (queue) sessionStorage.setItem(LOGOUT_QUEUE_KEY, JSON.stringify(queue));
    else sessionStorage.removeItem(LOGOUT_QUEUE_KEY);
  } catch {
    if (queue) {
      console.warn("Session storage unavailable: remaining Hosted UI sessions will not be ended");
    }
  }
}
