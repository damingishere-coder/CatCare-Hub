import type { LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";

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
    <section className="cc-page" aria-labelledby="page-title">
      <PageHeader eyebrow={phase} title={title} headingId="page-title" description={description} />
      <div className="cc-surface mt-7 flex items-start gap-4 p-5 sm:p-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600" aria-hidden="true"><Icon size={20} /></span>
        <div><h2 className="font-semibold text-slate-950">本地配置优先</h2><p className="mt-2 text-sm leading-6 text-slate-600">运行参数继续通过环境变量与配置模板维护，避免将访问码、地图密钥或业务数据写入仓库。</p></div>
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
