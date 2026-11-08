import { beforeEach } from "vitest";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";

// Unless a test says otherwise, the identity provider agrees with the token: the person still holds the groups the
// token was issued with. The real lookup (a call to Cognito) is exercised against the emulator.
beforeEach(() => replaceGroupsLookup(async (principal) => principal.groups));
