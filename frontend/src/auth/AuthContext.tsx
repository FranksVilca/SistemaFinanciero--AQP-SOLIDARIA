import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "oidc-client-ts";
import { userManagers, loginWithOidc, logoutWithOidc, AuthRealm } from "./authService.js";

interface AuthContextType {
  user: User | null;
  roles: string[];
  isLoading: boolean;
  login: () => Promise<void>;
  loginStaff: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  roles: [],
  isLoading: true,
  login: async () => {},
  loginStaff: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<Record<AuthRealm, User | null>>({ donor: null, staff: null });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const realms = Object.keys(userManagers) as AuthRealm[];
    const setRealmUser = (realm: AuthRealm, realmUser: User | null) =>
      setUsers((prev) => ({ ...prev, [realm]: realmUser }));

    Promise.all(
      realms.map((realm) =>
        userManagers[realm]
          .getUser()
          .then((loadedUser) => setRealmUser(realm, loadedUser))
          .catch(() => setRealmUser(realm, null))
      )
    ).finally(() => {
      setIsLoading(false);
    });

    const cleanups = realms.map((realm) => {
      const manager = userManagers[realm];
      const onUserLoaded = (loadedUser: User) => setRealmUser(realm, loadedUser);
      const onUserUnloaded = () => setRealmUser(realm, null);
      manager.events.addUserLoaded(onUserLoaded);
      manager.events.addUserUnloaded(onUserUnloaded);
      return () => {
        manager.events.removeUserLoaded(onUserLoaded);
        manager.events.removeUserUnloaded(onUserUnloaded);
      };
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  // Staff session (GESTOR/AUDITOR pool) takes precedence over a donor session.
  const user = users.staff ?? users.donor;

  const roles = React.useMemo(() => {
    if (!user?.profile) return [];
    const rawGroups = user.profile["cognito:groups"];
    if (Array.isArray(rawGroups)) return rawGroups as string[];
    if (typeof rawGroups === "string") return [rawGroups];
    return [];
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        isLoading,
        login: () => loginWithOidc("donor"),
        loginStaff: () => loginWithOidc("staff"),
        logout: logoutWithOidc,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
