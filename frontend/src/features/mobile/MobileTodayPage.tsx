import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Navigation,
  PawPrint,
  RefreshCw,
  Route,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { TaskStatus } from "../orders/types";
import { planTaskStatusLabels } from "../plans/constants";
import { getMobileToday } from "./api";
import { PwaInstallPrompt } from "./PwaInstallPrompt";
import type { MobileTodayRead, NavigationState } from "./types";

function statusStyle(status: TaskStatus): string {
  return {
    pending: "bg-amber-100 text-amber-800",
    confirmed: "bg-blue-100 text-blue-800",
    ready: "bg-cyan-100 text-cyan-800",
    in_progress: "bg-violet-100 text-violet-800",
    completed: "bg-emerald-100 text-emerald-800",
    exception: "bg-red-100 text-red-800",
    cancelled: "bg-slate-200 text-slate-600",
  }[status];
}

function navigationMessage(state: NavigationState): string {
  return state === "missing_coordinates"
    ? "地址坐标尚未在电脑计划页解析"
    : "地图服务尚未配置，仍可查看文字地址";
}

function displayBusinessDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

export function MobileTodayPage() {
  const [today, setToday] = useState<MobileTodayRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setToday(await getMobileToday());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "今日任务加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getMobileToday()
      .then((response) => {
        if (active) setToday(response);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "今日任务加载失败，请重试。");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mobile-safe-area min-h-dvh overflow-x-hidden bg-[#F5F5F7] text-[#1D1D1F]">
      <div className="mx-auto max-w-xl px-4 py-6 sm:px-5 sm:py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-orange-600 uppercase">移动执行端</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">今天的喂猫任务</h1>
            <p className="mt-2 text-sm text-slate-600">
              {today ? `${displayBusinessDate(today.business_date)} · 上海业务时间` : "按上海业务时间读取"}
            </p>
          </div>
          <div className="flex items-center gap-2"><button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm disabled:opacity-50"
            aria-label="刷新今日任务"
            onClick={() => void loadToday()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={18} />
          </button></div>
        </header>

        <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs leading-5 text-slate-600 shadow-sm">
          <ShieldAlert className="mt-0.5 shrink-0" size={16} />
          当前为免登录本地模式，仅允许从运行 CatCare-Hub 的这台电脑访问。
        </div>

        <PwaInstallPrompt />

        {error ? (
          <div className="cc-alert cc-alert--danger mt-5" role="alert">
            <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{error}</span>
          </div>
        ) : null}

        {loading && !today ? (
          <div className="cc-surface mt-6 flex min-h-52 items-center justify-center text-sm text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />正在加载今天的任务…
          </div>
        ) : today ? (
          <>
            <section className="mt-6 grid grid-cols-3 gap-2" aria-label="今日任务概览">
              <div className="rounded-2xl bg-[#FF9500] p-3 text-[#1D1D1F] shadow-sm">
                <p className="text-xs text-orange-950/70">全部</p>
                <p className="mt-1 text-2xl font-bold">{today.task_count}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">待执行</p>
                <p className="mt-1 text-2xl font-bold">{today.open_task_count}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-700">已完成</p>
                <p className="mt-1 text-2xl font-bold text-emerald-800">{today.completed_task_count}</p>
              </div>
            </section>

            <section className="mt-7" aria-labelledby="mobile-route-title">
              <div className="flex items-center gap-2">
                <Route size={19} className="text-slate-500" />
                <h2 id="mobile-route-title" className="text-lg font-bold">今日路线</h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">按电脑端已保存的计划顺序执行；手机端不重新排程。</p>

              {today.tasks.length ? (
                <ol className="mt-4 space-y-3">
                  {today.tasks.map((task) => (
                    <li key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#FF9500] text-sm font-bold text-[#1D1D1F]">
                          {task.sequence}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="truncate font-bold">{task.customer_name}</p>
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyle(task.status)}`}>
                              {planTaskStatusLabels[task.status]}
                            </span>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                            <MapPin size={14} className="shrink-0" />
                            <span className="truncate">{task.address || task.community || "地址未填写"}</span>
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                            <PawPrint size={13} />计划 {task.planned_time?.slice(0, 5) || "待设置"} · {task.cat_count} 只猫
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {task.navigation_url ? (
                          <a
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"
                            href={task.navigation_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Navigation size={16} />一键导航
                          </a>
                        ) : (
                          <span className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-2 text-center text-xs leading-4 text-slate-500">
                            {navigationMessage(task.navigation_state)}
                          </span>
                        )}
                        <Link
                          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#FF9500] px-3 text-sm font-semibold text-[#1D1D1F] shadow-sm hover:bg-orange-500"
                          to={`/mobile/tasks/${task.id}`}
                        >
                          查看任务<ChevronRight size={16} />
                        </Link>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
                  <CheckCircle2 className="mx-auto text-emerald-600" size={28} />
                  <p className="mt-3 font-semibold">今天没有待展示的任务</p>
                  <p className="mt-1 text-sm text-slate-500">新增或确认订单后，任务会按计划顺序出现在这里。</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
