import { FillPage } from "./pages/FillPage";

function PublicNotFound() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-center"><div><h1 className="text-xl font-semibold text-slate-900">填写链接无效</h1><p className="mt-2 text-sm text-slate-600">请确认微信中的链接完整，或联系服务人员重新获取。</p></div></main>;
}

export function PublicApp() {
  const path = window.location.pathname;
  const match = path.match(/^\/(?:f|fill)\/([A-Za-z0-9_-]+)\/?$/);
  if (match) return <FillPage token={match[1]} />;
  if (/^\/(?:f|fill)\/?$/.test(path)) return <FillPage token={null} />;
  return <PublicNotFound />;
}
