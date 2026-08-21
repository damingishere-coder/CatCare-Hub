import type { LucideIcon } from "lucide-react";
import {
  CalendarRange,
  CircleGauge,
  CreditCard,
  Settings,
} from "lucide-react";

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

export function DashboardPage() {
  return (
    <PagePlaceholder
      title="工作台"
      description="这里将汇总今日订单、待执行任务、待收款、本月收入和今日提醒。"
      phase="P7 实现业务功能"
      icon={CircleGauge}
    />
  );
}

export function PlansPage() {
  return (
    <PagePlaceholder
      title="订单计划"
      description="这里将采用按天计划、地图路线和右侧任务详情三栏布局。"
      phase="P3–P5 分阶段实现"
      icon={CalendarRange}
    />
  );
}

export function PaymentsPage() {
  return (
    <PagePlaceholder
      title="收款记录"
      description="这里将管理订单应收、已收、待收和付款方式，并提供简单汇总。"
      phase="P8 实现业务功能"
      icon={CreditCard}
    />
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
