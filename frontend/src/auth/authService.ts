import { UserManager, WebStorageStateStore, InMemoryWebStorage, User } from "oidc-client-ts";

const authority =
  import.meta.env.VITE_COGNITO_AUTHORITY ||
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || "example-client-id";
const redirectUri = `${window.location.origin}/auth/callback`;
const postLogoutRedirectUri = window.location.origin;

// Zero Trust Browser Hardening: Tokens kept strictly in memory, never in localStorage/sessionStorage
export const userManager = new UserManager({
  authority,
  client_id: clientId,
  redirect_uri: redirectUri,
  post_logout_redirect_uri: postLogoutRedirectUri,
  response_type: "code",
  scope:
    "openid profile email api/projects.write api/donations.write api/donations.read api/audit.read",
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  loadUserInfo: false,
});

export async function loginWithOidc(): Promise<void> {
  await userManager.signinRedirect();
}

export async function handleOidcCallback(): Promise<User | null> {
  const user = await userManager.signinCallback();
  return user ?? null;
}

export async function logoutWithOidc(): Promise<void> {
  const user = await userManager.getUser();
  if (user?.refresh_token) {
    try {
      // Revoke token endpoint
      await fetch(`${authority}/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: user.refresh_token,
          client_id: clientId,
        }),
      });
    } catch {
      // Ignored if network unavailable
    }
  }
  await userManager.removeUser();
  window.location.href = postLogoutRedirectUri;
}
