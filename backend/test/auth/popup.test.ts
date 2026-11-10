import { describe, expect, it } from "vitest";
import { isPopupBlocked, isPopupClosedByPerson, isSignInWindow } from "../../../frontend/src/auth/popup.js";

describe("sign-in window errors", () => {
  it("recognises a window that the browser blocked", () => {
    expect(isPopupBlocked(new Error("Attempted to navigate on a disposed window"))).toBe(true);
    expect(isPopupClosedByPerson(new Error("Attempted to navigate on a disposed window"))).toBe(false);
  });

  it("recognises a window that the person closed", () => {
    expect(isPopupClosedByPerson(new Error("Popup closed by user"))).toBe(true);
    expect(isPopupBlocked(new Error("Popup closed by user"))).toBe(false);
  });

  it.each([
    new Error("Failed to fetch"),
    new Error("Popup closed"), // the window closed by the library itself after a successful sign-in
    "Popup closed by user", // not an Error
    undefined,
    null,
  ])("treats anything else as a real failure: %s", (error) => {
    expect(isPopupBlocked(error)).toBe(false);
    expect(isPopupClosedByPerson(error)).toBe(false);
  });
});

describe("telling the sign-in window from the whole page", () => {
  it("is the sign-in window when another window opened it", () => {
    expect(isSignInWindow({ opener: {} })).toBe(true);
  });

  it.each([[{ opener: null }], [{}], [{ opener: undefined }]])(
    "is the whole page when nothing opened it: %j",
    (page) => {
      expect(isSignInWindow(page)).toBe(false);
    }
  );

  it("is not the sign-in window when the opener is the window itself", () => {
    const page: { opener?: unknown } = {};
    page.opener = page;

    expect(isSignInWindow(page)).toBe(false);
  });
});
