import {
  Bell,
  CalendarCheck2,
  Camera,
  Cat,
  CircleDollarSign,
  ClipboardCheck,
  KeyRound,
  LoaderCircle,
  Pill,
  Plus,
  RefreshCw,
  Rocket,
  UserPlus,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { PageHeader } from "../../components/ui/PageHeader";
import type { TaskStatus } from "../orders/types";
import { IntakeWorkspace } from "../intake/AdminIntakePage";
import { getDashboard, markTaskPhotosSent } from "./api";
import type {
  DashboardReminder,
  DashboardReminderType,
  DashboardResponse,
} from "./types";

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  ready: "待出发",
  in_progress: "进行中",
  completed: "已完成",
  exception: "有异常",
  cancelled: "已取消",
};

const reminderMeta: Record<
  DashboardReminderType,
  { label: string; icon: ComponentType<{ size?: number; className?: string }>; style: string }
> = {
  key_pickup: { label: "钥匙待取", icon: KeyRound, style: "border-amber-200 bg-amber-50 text-amber-800" },
  medicine: { label: "喂药提醒", icon: Pill, style: "border-red-200 bg-red-50 text-red-800" },
  photos_pending: { label: "待发送照片", icon: Camera, style: "border-blue-200 bg-blue-50 text-blue-800" },
  payment_due: { label: "待收款", icon: WalletCards, style: "border-orange-200 bg-orange-50 text-orange-800" },
  last_service: { label: "今日最后一次服务", icon: CalendarCheck2, style: "border-violet-200 bg-violet-50 text-violet-800" },
  order_starts_tomorrow: { label: "明日开始订单", icon: Rocket, style: "border-cyan-200 bg-cyan-50 text-cyan-800" },
};

function currency(value: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function businessDateLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

function statusStyle(status: TaskStatus): string {
  return {
    pending: "bg-amber-50 text-amber-700",
    confirmed: "bg-blue-50 text-blue-700",
    ready: "bg-cyan-50 text-cyan-700",
    in_progress: "bg-violet-50 text-violet-700",
    completed: "bg-emerald-50 text-emerald-700",
    exception: "bg-red-50 text-red-700",
    cancelled: "bg-slate-200 text-slate-600",
  }[status];
}

function reminderTarget(reminder: DashboardReminder): string {
  if (reminder.task_id) return `/admin/tasks/${reminder.task_id}`;
  if (reminder.kind === "payment_due" && reminder.order_id) {
    return `/admin/payments?action=create&order_id=${reminder.order_id}`;
  }
  if (reminder.kind === "payment_due") return "/admin/payments";
  return "/admin/orders";
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getDashboard());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作台加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getDashboard()
      .then((response) => {
        if (active) setDashboard(response);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "工作台加载失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handlePhotosSent(reminder: DashboardReminder) {
    if (!reminder.task_id || !reminder.expected_revision) return;
    if (!window.confirm(`确认已通过外部渠道向“${reminder.customer_name}”发送本次照片吗？`)) return;
    setBusyReminderId(reminder.id);
    setError(null);
    try {
      await markTaskPhotosSent(reminder.task_id, reminder.expected_revision);
      setDashboard(await getDashboard());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片发送状态保存失败，请重试。");
    } finally {
      setBusyReminderId(null);
    }
  }

  return (
    <section className="cc-page" aria-labelledby="dashboard-title">
      <PageHeader
        eyebrow="今日经营概览"
        title="工作台"
        headingId="dashboard-title"
        description={dashboard ? businessDateLabel(dashboard.business_date) : "快速掌握今天的任务、提醒和收款概况。"}
        actions={<button type="button" className="cc-button cc-button--secondary" onClick={() => void loadDashboard()} disabled={loading}>
          {loading ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}刷新
        </button>}
      />

      {error ? (
        <ConnectionErrorAlert className="mt-5" message={error} onRetry={() => void loadDashboard()} />
      ) : null}

      {loading && !dashboard ? (
        <div className="cc-surface mt-8 flex min-h-80 items-center justify-center text-sm text-slate-500">
          <LoaderCircle className="mr-2 animate-spin" size={18} />正在汇总今日数据…
        </div>
      ) : dashboard ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "当月订单", value: `${dashboard.metrics.month_order_count}`, unit: "单", icon: ClipboardCheck },
              { label: "待执行", value: `${dashboard.metrics.pending_task_count}`, unit: "项", icon: CalendarCheck2 },
              { label: "待收款", value: `${dashboard.metrics.pending_payment_count}`, unit: "单", icon: WalletCards },
              { label: "本月收入", value: currency(dashboard.metrics.month_income), unit: "", icon: CircleDollarSign },
            ].map(({ label, value, unit, icon: Icon }) => (
              <article key={label} className="cc-metric p-4 sm:p-5">
                <div className="flex items-center justify-between text-slate-500"><p className="text-sm font-medium">{label}</p><span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon size={17} /></span></div>
                <p className="mt-5 text-2xl font-bold tracking-[-0.035em] text-slate-950">{value}{unit ? <span className="ml-1 text-sm font-medium text-slate-500">{unit}</span> : null}</p>
              </article>
            ))}
          </div>

          <section className="cc-surface mt-5 p-4 sm:p-5" aria-labelledby="quick-actions-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="quick-actions-title" className="text-sm font-semibold text-slate-950">快捷入口</h2><p className="mt-1 text-xs text-slate-500">常用录入操作直接开始</p></div>
              <div className="flex flex-wrap gap-2">
                <Link className="cc-button cc-button--primary" to="/admin/orders?action=create"><Plus size={15} />新增订单</Link>
                <Link className="cc-button cc-button--secondary" to="/admin/customers?action=create"><UserPlus size={15} />新增客户</Link>
                <Link className="cc-button cc-button--secondary" to="/admin/intake#links"><Rocket size={15} />客户填写入口</Link>
              </div>
            </div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <section className="cc-surface overflow-hidden" aria-labelledby="today-schedule-title">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div><h2 id="today-schedule-title" className="font-semibold text-slate-950">今日安排</h2><p className="mt-1 text-xs text-slate-500">按已保存的路线顺序，共 {dashboard.schedule.length} 项任务</p></div>
                <Cat size={19} className="text-slate-400" />
              </div>
              {dashboard.schedule.length ? (
                <div className="divide-y divide-slate-100">
                  {dashboard.schedule.map((task, index) => (
                    <Link key={task.id} to={`/admin/tasks/${task.id}`} className="grid gap-2 px-5 py-4 transition-colors hover:bg-orange-50/50 sm:grid-cols-[76px_minmax(0,1fr)_auto] sm:items-center">
                      <div><p className="text-sm font-semibold text-slate-950">{task.planned_time?.slice(0, 5) || "待定"}</p><p className="mt-1 text-xs text-slate-400">第 {index + 1} 站</p></div>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{task.customer_name}</p><p className="mt-1 truncate text-xs text-slate-500">{task.address || "地址未填写"} · {task.cat_count} 只猫</p></div>
                      <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(task.status)}`}>{taskStatusLabels[task.status]}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="px-5 py-12 text-center text-sm text-slate-500">今天没有需要展示的任务。</p>}
            </section>

            <section className="cc-surface" aria-labelledby="today-reminders-title">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div><h2 id="today-reminders-title" className="font-semibold text-slate-950">今日提醒</h2><p className="mt-1 text-xs text-slate-500">{dashboard.reminders.length} 条需要留意</p></div>
                <Bell size={19} className="text-slate-400" />
              </div>
              {dashboard.reminders.length ? (
                <div className="space-y-3 p-4">
                  {dashboard.reminders.map((reminder) => {
                    const meta = reminderMeta[reminder.kind];
                    const Icon = meta.icon;
                    return (
                      <article key={reminder.id} className={`rounded-lg border p-3 ${meta.style}`}>
                        <div className="flex items-start gap-2"><Icon className="mt-0.5 shrink-0" size={16} /><div className="min-w-0"><p className="text-xs font-semibold">{meta.label}</p><p className="mt-1 text-sm leading-5">{reminder.message}</p></div></div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-2">
                          <Link className="text-xs font-medium underline underline-offset-2" to={reminderTarget(reminder)}>{reminder.task_id ? "查看任务" : reminder.kind === "payment_due" ? "查看收款" : "查看订单"}</Link>
                          {reminder.kind === "photos_pending" ? (
                            <button type="button" className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-1 text-xs font-semibold disabled:opacity-50" onClick={() => void handlePhotosSent(reminder)} disabled={busyReminderId !== null}>
                              {busyReminderId === reminder.id ? <LoaderCircle className="animate-spin" size={13} /> : <Camera size={13} />}标记已发送
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : <p className="px-5 py-12 text-center text-sm text-slate-500">今天没有额外提醒。</p>}
            </section>
          </div>

          <p className="mt-4 text-xs leading-5 text-slate-500">工作台仅展示客户名称、地址和数量摘要；门禁、钥匙编号及照片请进入单任务详情查看。当前后台仍只限本机或可信私网使用。</p>
        </>
      ) : null}

      <IntakeWorkspace embedded />
    </section>
  );
}
