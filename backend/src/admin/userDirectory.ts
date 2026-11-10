import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
  UserNotFoundException,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognitoClient } from "../shared/cognito.js";
import type { UserRole } from "../shared/constants.js";

export interface DirectoryUser {
  /** The name of the user in the pool: what every administrative call of the identity provider asks for. */
  username: string;
  sub: string;
  email?: string;
}

export interface UserPage {
  users: DirectoryUser[];
  nextToken?: string;
}

export interface ListUsersQuery {
  limit: number;
  paginationToken?: string;
  /** Only the users whose email starts with this text. */
  emailPrefix?: string;
}

/**
 * The people of the pool and their groups. The administration functions talk to this port, never to Cognito directly,
 * so the rules of roles can be proven without an identity provider.
 */
export interface UserDirectory {
  listUsers(query: ListUsersQuery): Promise<UserPage>;
  getUser(username: string): Promise<DirectoryUser | undefined>;
  groupsOf(username: string): Promise<string[]>;
  addToGroup(username: string, role: UserRole): Promise<void>;
  removeFromGroup(username: string, role: UserRole): Promise<void>;
}

// An administrative call is more than a token check: it may page through users, so it gets more room than the 2 s of
// the session check, and still far less than the 10 s of the function.
const TIMEOUT_MS = 5_000;
const signal = () => ({ abortSignal: AbortSignal.timeout(TIMEOUT_MS) });

function userPoolId(): string {
  const id = process.env.COGNITO_USER_POOL_ID;
  if (!id) throw new Error("COGNITO_USER_POOL_ID is not configured");
  return id;
}

const attributeOf = (attributes: AttributeType[] | undefined, name: string) =>
  attributes?.find((attribute) => attribute.Name === name)?.Value;

function toDirectoryUser(username: string | undefined, attributes: AttributeType[] | undefined) {
  const sub = attributeOf(attributes, "sub");
  if (!username || !sub) return undefined;
  const email = attributeOf(attributes, "email");
  return { username, sub, ...(email && { email }) } satisfies DirectoryUser;
}

const cognitoDirectory: UserDirectory = {
  async listUsers({ limit, paginationToken, emailPrefix }) {
    const page = await cognitoClient().send(
      new ListUsersCommand({
        UserPoolId: userPoolId(),
        Limit: limit,
        AttributesToGet: ["sub", "email"],
        ...(paginationToken && { PaginationToken: paginationToken }),
        // The prefix was validated by the caller (letters, digits and . _ % + @ -): it cannot close the quotes.
        ...(emailPrefix && { Filter: `email ^= "${emailPrefix}"` }),
      }),
      signal()
    );
    const users = (page.Users ?? []).flatMap((user) => toDirectoryUser(user.Username, user.Attributes) ?? []);
    return { users, ...(page.PaginationToken && { nextToken: page.PaginationToken }) };
  },

  async getUser(username) {
    try {
      const user = await cognitoClient().send(
        new AdminGetUserCommand({ UserPoolId: userPoolId(), Username: username }),
        signal()
      );
      return toDirectoryUser(user.Username, user.UserAttributes);
    } catch (error) {
      if (error instanceof UserNotFoundException) return undefined;
      throw error;
    }
  },

  async groupsOf(username) {
    // A person has a handful of groups (the roles), far below the 60 that one page returns.
    const { Groups = [] } = await cognitoClient().send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId(), Username: username }),
      signal()
    );
    return Groups.flatMap((group) => (group.GroupName ? [group.GroupName] : []));
  },

  async addToGroup(username, role) {
    await cognitoClient().send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId(), Username: username, GroupName: role }),
      signal()
    );
  },

  async removeFromGroup(username, role) {
    await cognitoClient().send(
      new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId(), Username: username, GroupName: role }),
      signal()
    );
  },
};

let directory: UserDirectory = cognitoDirectory;

export const userDirectory = (): UserDirectory => directory;

/** For tests: replaces the directory, or restores the one that calls Cognito when called without an argument. */
export function replaceUserDirectory(replacement?: UserDirectory): void {
  directory = replacement ?? cognitoDirectory;
}
