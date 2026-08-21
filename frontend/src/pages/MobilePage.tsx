import { ArrowLeft, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";

export function MobilePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <div className="mx-auto max-w-lg">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          返回管理后台
        </Link>

        <section className="mt-10" aria-labelledby="mobile-title">
          <Smartphone className="text-slate-700" aria-hidden="true" />
          <p className="mt-5 text-xs font-semibold tracking-wider text-slate-500 uppercase">
            P9 预留入口
          </p>
          <h1 id="mobile-title" className="mt-1 text-2xl font-semibold">
            手机执行端
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            后续只提供今天任务、路线、导航和现场执行能力，不复制完整管理后台。
          </p>
        </section>
      </div>
    </main>
  );
}
