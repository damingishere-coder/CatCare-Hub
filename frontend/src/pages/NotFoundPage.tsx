import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-950">
      <section className="max-w-md text-center" aria-labelledby="not-found-title">
        <p className="text-sm font-semibold text-slate-500">404</p>
        <h1 id="not-found-title" className="mt-2 text-2xl font-semibold">
          页面不存在
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          当前地址无对应页面，请检查链接或返回管理后台。
        </p>
        <Link
          to="/admin"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          返回工作台
        </Link>
      </section>
    </main>
  );
}
