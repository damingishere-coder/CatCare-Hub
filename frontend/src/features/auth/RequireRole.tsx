import { LoaderCircle, ShieldAlert } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./authContext";
import type { AccessRole } from "./types";

export function RequireRole({ allowed }: { allowed: readonly AccessRole[] }) {
  const { session, loading, error, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm text-slate-600"><LoaderCircle className="mr-2 animate-spin" size={18} />正在验证登录状态…</main>;
  }
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (!allowed.includes(session.role)) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5">
        <section className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <ShieldAlert className="text-amber-600" size={28} />
          <h1 className="mt-4 text-xl font-bold">当前账号没有此页面权限</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">执行端账号只能进入移动任务页。如需管理客户、订单或收款，请退出后使用管理员访问码登录。</p>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
          <div className="mt-5 flex gap-3"><a className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white" href="/mobile">返回执行端</a><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" type="button" onClick={() => void logout()}>退出登录</button></div>
        </section>
      </main>
    );
  }
  return <Outlet />;
}
