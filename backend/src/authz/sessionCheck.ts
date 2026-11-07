import { readHeader, type ApiEvent } from "../shared/apiEvent.js";
import { SESSION_CHECK_TIMEOUT_MS } from "../shared/constants.js";
import { logError, logWarn } from "../shared/logger.js";

const BEARER_PREFIX = /^Bearer\s+/i;
const HTTP_OK = 200;

function readAccessToken(event: ApiEvent): string | undefined {
  const authorization = readHeader(event, "Authorization");
  return authorization?.replace(BEARER_PREFIX, "") || undefined;
}

/**
 * Asks the identity provider whether the access token is still valid. A revoked session is rejected here
 * even though the gateway still accepts the signed token until it expires. Any doubt (missing token or
 * configuration, timeout, network error, unexpected status) returns false: the check fails closed.
 */
export async function isSessionActive(event: ApiEvent): Promise<boolean> {
  const userInfoUrl = process.env.COGNITO_USERINFO_URL;
  const accessToken = readAccessToken(event);
  if (!userInfoUrl || !accessToken) {
    logWarn("Session check impossible: missing user info URL or access token");
    return false;
  }

  try {
    const response = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
    return response.status === HTTP_OK;
  } catch (error) {
    logError("Session check failed: treating the session as not active", error);
    return false;
  }
}
