const TOKEN_PATH_SUFFIX = "/token";
const REVOKE_PATH_SUFFIX = "/revoke";

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
