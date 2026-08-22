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
    <main className="flex min-h-dvh items-center justify-center bg-[#f3f5f8] px-5 py-10 text-slate-950">
      <section className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)] md:grid-cols-[0.82fr_1fr]" aria-labelledby="login-title">
        <div className="flex min-h-52 flex-col justify-between bg-[#182033] p-7 text-white sm:p-9">
          <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/30"><PawPrint size={22} /></span><div><p className="font-semibold">CatCare-Hub</p><p className="text-xs text-slate-300">上门喂猫业务中台</p></div></div>
          <div className="mt-10 max-w-sm"><p className="text-xs font-semibold tracking-[0.16em] text-indigo-300 uppercase">Local first</p><p className="mt-3 text-xl font-semibold leading-8">让客户、订单、路线与现场执行，在一个安全工作区内顺畅衔接。</p></div>
        </div>
        <div className="p-7 sm:p-9">
          <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">安全访问</p>
          <h1 id="login-title" className="mt-2 text-2xl font-semibold tracking-tight">使用访问码登录</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">访问码由首次运行 setup.bat 时生成，原文不会保存在项目或数据库中。</p>
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <fieldset><legend className="text-sm font-semibold">登录入口</legend><div className="mt-2 grid grid-cols-2 gap-2">{(["admin", "mobile"] as const).map((item) => <label key={item} className={`cursor-pointer rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${role === item ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}><input className="sr-only" type="radio" name="role" value={item} checked={role === item} onChange={() => setRole(item)} />{item === "admin" ? "管理后台" : "移动执行端"}</label>)}</div></fieldset>
            <label className="block text-sm font-semibold">访问码<div className="relative mt-2"><KeyRound className="absolute top-3 left-3 text-slate-400" size={17} /><input className="min-h-11 w-full rounded-lg border border-slate-300 py-2.5 pr-3 pl-10 text-sm" type="password" autoComplete="current-password" minLength={12} maxLength={256} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} required autoFocus /></div></label>
            {error || sessionError ? <p className="cc-alert cc-alert--danger" role="alert">{error || sessionError}</p> : null}
            <button className="cc-button cc-button--primary min-h-11 w-full" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}{submitting ? "正在登录…" : "安全登录"}</button>
          </form>
          <p className="mt-5 text-center text-xs leading-5 text-slate-500">仅在本机或已配置的可信私网中使用；不要直接暴露管理入口到公网。</p>
        </div>
      </section>
    </main>
  );
}
