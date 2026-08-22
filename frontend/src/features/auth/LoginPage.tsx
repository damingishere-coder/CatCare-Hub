import { KeyRound, LoaderCircle, PawPrint, ShieldCheck } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "./authContext";
import type { AccessRole } from "./types";

function safeNext(value: string | null, role: AccessRole): string {
  if (value?.startsWith("/admin") && role === "admin") return value;
  if (value?.startsWith("/mobile")) return value;
  return role === "admin" ? "/admin" : "/mobile";
}

export function LoginPage() {
  const { session, login, error: sessionError } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preferredRole = useMemo<AccessRole>(
    () => searchParams.get("next")?.startsWith("/mobile") ? "mobile" : "admin",
    [searchParams],
  );
  const [role, setRole] = useState<AccessRole>(preferredRole);
  const [accessCode, setAccessCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={session.role === "admin" ? "/admin" : "/mobile"} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const current = await login(role, accessCode);
      navigate(safeNext(searchParams.get("next"), current.role), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-5 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="login-title">
        <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-slate-900 text-white"><PawPrint size={22} /></span><div><p className="font-semibold">CatCare-Hub</p><p className="text-xs text-slate-500">本地安全登录</p></div></div>
        <h1 id="login-title" className="mt-7 text-2xl font-bold tracking-tight">使用访问码登录</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">访问码由首次运行 setup.bat 时生成，原文不会保存在项目或数据库中。</p>
        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <fieldset><legend className="text-sm font-semibold">登录入口</legend><div className="mt-2 grid grid-cols-2 gap-2">{(["admin", "mobile"] as const).map((item) => <label key={item} className={`cursor-pointer rounded-xl border px-3 py-3 text-sm ${role === item ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}><input className="sr-only" type="radio" name="role" value={item} checked={role === item} onChange={() => setRole(item)} />{item === "admin" ? "管理后台" : "移动执行端"}</label>)}</div></fieldset>
          <label className="block text-sm font-semibold">访问码<div className="relative mt-2"><KeyRound className="absolute top-3 left-3 text-slate-400" size={17} /><input className="w-full rounded-xl border border-slate-300 py-2.5 pr-3 pl-10 text-sm" type="password" autoComplete="current-password" minLength={12} maxLength={256} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} required autoFocus /></div></label>
          {error || sessionError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error || sessionError}</p> : null}
          <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}{submitting ? "正在登录…" : "安全登录"}</button>
        </form>
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">仅在本机或已配置的可信私网中使用；不要直接暴露管理入口到公网。</p>
      </section>
    </main>
  );
}
