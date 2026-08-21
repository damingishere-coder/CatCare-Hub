import type { LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";

interface PagePlaceholderProps {
  title: string;
  description: string;
  phase: string;
  icon: LucideIcon;
}

function PagePlaceholder({
  title,
  description,
  phase,
  icon: Icon,
}: PagePlaceholderProps) {
  return (
    <section className="mx-auto max-w-6xl" aria-labelledby="page-title">
      <div className="flex items-start gap-4">
        <div
          className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"
          aria-hidden="true"
        >
          <Icon size={20} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {phase}
          </p>
          <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-8 border-t border-slate-200 pt-6">
        <p className="text-sm text-slate-500">
          当前已完成页面与路由骨架，业务功能将严格按开发文档轮次接入。
        </p>
      </div>
    </section>
  );
}

export function SettingsPage() {
  return (
    <PagePlaceholder
      title="设置"
      description="这里将放置本地运行、服务价格和后续地图服务等配置。"
      phase="按需要逐步实现"
      icon={Settings}
    />
  );
}
