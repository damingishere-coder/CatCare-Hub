import { LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useOptionalAuth } from "./authContext";

export function SessionControls({ compact = false }: { compact?: boolean }) {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!auth?.session) return null;

  async function handleLogout() {
    if (!auth) return;
    setBusy(true);
    try {
      await auth.logout();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className={`cc-button cc-button--secondary px-3 text-xs ${compact ? "cc-touch" : ""}`} onClick={() => void handleLogout()} disabled={busy} aria-label="退出登录"><LogOut size={14} />{compact ? "退出" : "退出登录"}</button>;
}
