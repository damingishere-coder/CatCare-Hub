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

  return <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50" onClick={() => void handleLogout()} disabled={busy} aria-label="退出登录"><LogOut size={14} />{compact ? "退出" : "退出登录"}</button>;
}
