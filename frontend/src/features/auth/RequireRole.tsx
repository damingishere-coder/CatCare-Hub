import { LoaderCircle, ShieldAlert } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./authContext";
import type { AccessRole } from "./types";

export function RequireRole({ allowed }: { allowed: readonly AccessRole[] }) {
  const { session, loading, error, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="flex min-h-dvh items-center justify-center bg-[#f3f5f8] text-sm text-slate-600"><LoaderCircle className="mr-2 animate-spin text-indigo-600" size={18} />正在验证登录状态…</main>;
  }
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (!allowed.includes(session.role)) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f3f5f8] px-5">
        <section className="cc-surface w-full max-w-md p-6">
          <ShieldAlert className="text-amber-600" size={28} />
          <h1 className="mt-4 text-xl font-bold">当前账号没有此页面权限</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">执行端账号只能进入移动任务页。如需管理客户、订单或收款，请退出后使用管理员访问码登录。</p>
          {error ? <p className="cc-alert cc-alert--danger mt-3">{error}</p> : null}
          <div className="mt-5 flex gap-3"><a className="cc-button cc-button--primary" href="/mobile">返回执行端</a><button className="cc-button cc-button--secondary" type="button" onClick={() => void logout()}>退出登录</button></div>
        </section>
      </main>
    );
  }
  return <Outlet />;
}
