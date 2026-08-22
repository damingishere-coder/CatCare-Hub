import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { unauthorizedEventName } from "../../lib/authEvents";
import { AuthApiError, getAuthSession, loginWithAccessCode, logoutSession } from "./api";
import { AuthContext } from "./authContext";
import type { AccessRole, AuthSession } from "./types";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAuthSession()
      .then((current) => {
        if (active) setSession(current);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (!(cause instanceof AuthApiError) || cause.status !== 401) {
          setError(cause instanceof Error ? cause.message : "登录状态检查失败。");
        }
        setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => setSession(null);
    window.addEventListener(unauthorizedEventName, handleUnauthorized);
    return () => window.removeEventListener(unauthorizedEventName, handleUnauthorized);
  }, []);

  const login = useCallback(async (role: AccessRole, accessCode: string) => {
    const current = await loginWithAccessCode(role, accessCode);
    setSession(current);
    setError(null);
    return current;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } catch (cause) {
      if (!(cause instanceof AuthApiError) || cause.status !== 401) throw cause;
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({ session, loading, error, login, logout }),
    [session, loading, error, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
