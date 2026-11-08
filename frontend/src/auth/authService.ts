import { UserManager, WebStorageStateStore, InMemoryWebStorage, User } from "oidc-client-ts";
import { isPopupBlocked, isPopupClosedByPerson } from "./popup.js";
import { logoutUrlOf, revocationEndpointOf } from "./revocation.js";

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
  // The sign-in window returns to the same page that the full-page redirect does.
  popup_redirect_uri: redirectUri,
  post_logout_redirect_uri: postLogoutRedirectUri,
  response_type: "code",
  scope:
    "openid profile email api/projects.write api/donations.write api/donations.read api/audit.read",
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  loadUserInfo: false,
});

const SIGN_IN_WINDOW = { width: 480, height: 720 };

/**
 * Signs in through the identity provider's own page, in a window: the SPA never sees the password and the person keeps
 * their place in the app. If the browser blocks the window, the same sign-in continues in the whole page; if the
 * person closes it, nothing happened.
 */
export async function loginWithOidc(): Promise<void> {
  try {
    await userManager.signinPopup({ popupWindowFeatures: SIGN_IN_WINDOW, popupAbortOnClose: true });
  } catch (error) {
    if (isPopupClosedByPerson(error)) return;
    if (!isPopupBlocked(error)) throw error;
    await userManager.signinRedirect();
  }
}

// The authorization code can be exchanged only once. React may run the callback effect twice (StrictMode in
// development), so every call of the same page load shares the exchange that is already in progress.
let callbackInProgress: Promise<User | null> | undefined;

export function handleOidcCallback(): Promise<User | null> {
  callbackInProgress ??= userManager.signinCallback().then((user) => user ?? null);
  return callbackInProgress;
}

/** Revokes the refresh token (and with it the access and ID tokens minted from it) before the local session is dropped. */
async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const metadata = await userManager.metadataService.getMetadata();
  const response = await fetch(revocationEndpointOf(String(metadata.token_endpoint)), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken, client_id: clientId }),
  });
  if (!response.ok) throw new Error(`Token revocation was refused (HTTP ${response.status})`);
}

/** Where the browser goes to end the hosted UI session too; the SPA's own address if that cannot be worked out. */
async function hostedUiLogoutUrl(): Promise<string> {
  try {
    const metadata = await userManager.metadataService.getMetadata();
    return logoutUrlOf(String(metadata.token_endpoint), clientId, postLogoutRedirectUri);
  } catch (error) {
    console.error("The hosted UI session could not be ended", error);
    return postLogoutRedirectUri;
  }
}

export async function logoutWithOidc(): Promise<void> {
  const user = await userManager.getUser();
  if (user?.refresh_token) {
    try {
      await revokeRefreshToken(user.refresh_token);
    } catch (error) {
      // The local session is dropped anyway, but a failed revocation must be visible.
      console.error("The refresh token could not be revoked", error);
    }
  }
  const destination = await hostedUiLogoutUrl();
  await userManager.removeUser();
  window.location.href = destination;
}
