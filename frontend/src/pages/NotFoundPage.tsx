import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f5f8] px-5 text-slate-950">
      <section className="cc-surface max-w-md p-8 text-center sm:p-10" aria-labelledby="not-found-title">
        <p className="text-sm font-semibold text-indigo-600">404</p>
        <h1 id="not-found-title" className="mt-2 text-2xl font-semibold">
          页面不存在
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          当前地址无对应页面，请检查链接或返回管理后台。
        </p>
        <Link
          to="/admin"
          className="cc-button cc-button--primary mt-6"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          返回工作台
        </Link>
      </section>
    </main>
  );
}
