/**
 * What oidc-client-ts reports when the sign-in window cannot be used. The library gives no error codes, only messages,
 * so they are recognised here in one place.
 */

// window.open returned null: the browser blocked the window.
const POPUP_BLOCKED = "Attempted to navigate on a disposed window";
// The person closed the window before finishing (only reported with popupAbortOnClose).
const POPUP_CLOSED_BY_PERSON = "Popup closed by user";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : "");

/**
 * True inside the window that the sign-in opened: its opener is the page that waits for the result. The library tells
 * that page, which is the one that closes the window; if that page is gone, nobody does and the window stays open.
 */
export const isSignInWindow = (candidate: { opener?: unknown } = window): boolean =>
  candidate.opener !== null && candidate.opener !== undefined && candidate.opener !== candidate;

/** The browser refused to open the window: the sign-in has to continue in the whole page instead. */
export const isPopupBlocked = (error: unknown): boolean => messageOf(error).includes(POPUP_BLOCKED);

/** The person gave up by closing the window: there is nothing to report. */
export const isPopupClosedByPerson = (error: unknown): boolean => messageOf(error).includes(POPUP_CLOSED_BY_PERSON);
