import { randomUUID } from "node:crypto";
import type { DirectoryUser, ListUsersQuery, UserDirectory, UserPage } from "../../src/admin/userDirectory.js";
import type { UserRole } from "../../src/shared/constants.js";

interface Entry {
  user: DirectoryUser;
  groups: string[];
}

/** The people of a pool and their groups, in memory: what the administration functions need from Cognito. */
export class FakeDirectory implements UserDirectory {
  private readonly entries = new Map<string, Entry>();
  readonly calls: string[] = [];
  lastListQuery: ListUsersQuery | undefined;
  /** When set, the next listing returns it as the following page. */
  nextPageToken: string | undefined;

  /** Adds a person and returns it; the username is a fresh UUID and so is the sub, as in the pool. */
  add(email: string, groups: string[], sub: string = randomUUID()): DirectoryUser {
    const user: DirectoryUser = { username: sub, sub, email };
    this.entries.set(user.username, { user, groups: [...groups] });
    return user;
  }

  groupsNow(username: string): string[] {
    return [...(this.entries.get(username)?.groups ?? [])];
  }

  async listUsers(query: ListUsersQuery): Promise<UserPage> {
    this.lastListQuery = query;
    const matching = [...this.entries.values()]
      .map((entry) => entry.user)
      .filter((user) => !query.emailPrefix || user.email?.startsWith(query.emailPrefix));
    return { users: matching.slice(0, query.limit), ...(this.nextPageToken && { nextToken: this.nextPageToken }) };
  }

  async getUser(username: string): Promise<DirectoryUser | undefined> {
    return this.entries.get(username)?.user;
  }

  async groupsOf(username: string): Promise<string[]> {
    this.calls.push(`groupsOf:${username}`);
    return this.groupsNow(username);
  }

  async addToGroup(username: string, role: UserRole): Promise<void> {
    this.calls.push(`add:${username}:${role}`);
    this.entries.get(username)?.groups.push(role);
  }

  async removeFromGroup(username: string, role: UserRole): Promise<void> {
    this.calls.push(`remove:${username}:${role}`);
    const entry = this.entries.get(username);
    if (entry) entry.groups = entry.groups.filter((group) => group !== role);
  }

  /** The calls that changed something (every other call only read). */
  get writes(): string[] {
    return this.calls.filter((call) => call.startsWith("add:") || call.startsWith("remove:"));
  }
}
