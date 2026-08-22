import { createContext, useContext } from "react";

import type { AccessRole, AuthSession } from "./types";


export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  login: (role: AccessRole, accessCode: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return value;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
