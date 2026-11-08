const TOKEN_PATH_SUFFIX = "/token";
const REVOKE_PATH_SUFFIX = "/revoke";
const OAUTH_TOKEN_PATH_SUFFIX = "/oauth2/token";
const LOGOUT_PATH = "/logout";

/**
 * Cognito serves token revocation next to its token endpoint (…/oauth2/token and …/oauth2/revoke), on the hosted
 * domain advertised by the discovery document, not under the issuer URL that the SPA uses as authority.
 */
export function revocationEndpointOf(tokenEndpoint: string): string {
  if (!tokenEndpoint.endsWith(TOKEN_PATH_SUFFIX)) {
    throw new Error(`Unexpected token endpoint, cannot derive the revocation endpoint: ${tokenEndpoint}`);
  }
  return `${tokenEndpoint.slice(0, -TOKEN_PATH_SUFFIX.length)}${REVOKE_PATH_SUFFIX}`;
}

/**
 * The hosted UI keeps its own session in a cookie of the hosted domain. Dropping the SPA's tokens does not end it:
 * the next sign-in would come straight back as the same person without asking for credentials. Cognito ends it at
 * <hosted domain>/logout, which then sends the browser to one of the client's allowed logout URLs.
 */
export function logoutUrlOf(tokenEndpoint: string, clientId: string, logoutUri: string): string {
  if (!tokenEndpoint.endsWith(OAUTH_TOKEN_PATH_SUFFIX)) {
    throw new Error(`Unexpected token endpoint, cannot derive the logout endpoint: ${tokenEndpoint}`);
  }
  const hostedDomain = tokenEndpoint.slice(0, -OAUTH_TOKEN_PATH_SUFFIX.length);
  const query = new URLSearchParams({ client_id: clientId, logout_uri: logoutUri });
  return `${hostedDomain}${LOGOUT_PATH}?${query.toString()}`;
}
