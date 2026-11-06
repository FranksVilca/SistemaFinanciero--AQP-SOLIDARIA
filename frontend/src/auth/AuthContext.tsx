import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "oidc-client-ts";
import { userManager, loginWithOidc, logoutWithOidc } from "./authService.js";

interface AuthContextType {
  user: User | null;
  roles: string[];
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  roles: [],
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    userManager
      .getUser()
      .then((loadedUser) => {
        setUser(loadedUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    const onUserLoaded = (loadedUser: User) => setUser(loadedUser);
    const onUserUnloaded = () => setUser(null);

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);

    return () => {
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
    };
  }, []);

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
        login: loginWithOidc,
        logout: logoutWithOidc,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
