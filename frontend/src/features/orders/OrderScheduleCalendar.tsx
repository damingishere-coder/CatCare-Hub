import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { CalendarMonthGrid } from "../../components/ui/CalendarMonthGrid";
import { localDateValue, parseLocalDate } from "../../components/ui/calendarDates";
import { getDayPlan, getPlanDays } from "../plans/api";
import { planTaskStatusLabels } from "../plans/constants";
import type { DayPlan, PlanDaySummary, PlanTaskStatus } from "../plans/types";

function monthBounds(month: Date): [string, string] {
  return [
    localDateValue(new Date(month.getFullYear(), month.getMonth(), 1)),
    localDateValue(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  ];
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function taskStatusStyle(status: PlanTaskStatus): string {
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

interface OrderScheduleCalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onSelectOrder: (orderId: number) => void;
  refreshKey: number;
}

export function OrderScheduleCalendar({
  selectedDate,
  onSelectDate,
  onSelectOrder,
  refreshKey,
}: OrderScheduleCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => parseLocalDate(selectedDate));
  const [days, setDays] = useState<PlanDaySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dayMap = useMemo(() => new Map(days.map((day) => [day.service_date, day])), [days]);

  useEffect(() => {
    let active = true;
    const [from, to] = monthBounds(visibleMonth);
    getPlanDays(from, to)
      .then((response) => {
        if (!active) return;
        setError(null);
        setDays(response.items);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "月历排班加载失败，请重试。");
      });
    return () => { active = false; };
  }, [refreshKey, visibleMonth]);

  function changeMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function selectToday() {
    const today = new Date();
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(localDateValue(today));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="order-calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 id="order-calendar-title" className="flex items-center gap-2 font-semibold"><CalendarDays size={18} />订单月历</h3><p className="mt-1 text-xs text-slate-500">点击日期查看当天全部上门；点击订单编号查看订单详情。</p></div>
        <div className="flex items-center gap-2">
          <button type="button" className="cc-icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button>
          <span className="min-w-28 text-center text-sm font-semibold">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</span>
          <button type="button" className="cc-icon-button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button>
          <button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs whitespace-nowrap" onClick={selectToday}>今天</button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      <CalendarMonthGrid
        month={visibleMonth}
        fixedWeeks
        weekdayPrefix="周"
        className="mt-4 grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200"
        weekdayClassName="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center text-xs font-medium whitespace-nowrap text-slate-500"
        emptyClassName="min-h-24 border-r border-b border-slate-100 bg-slate-50/40"
        renderDay={(date) => {
          const value = localDateValue(date);
          const day = dayMap.get(value);
          return (
            <div className={`min-h-24 min-w-0 border-r border-b border-slate-100 p-1.5 text-left align-top transition hover:bg-orange-50 ${selectedDate === value ? "bg-orange-50 ring-2 ring-inset ring-orange-400" : "bg-white"}`} onClick={() => onSelectDate(value)}>
              <button type="button" className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${value === localDateValue(new Date()) ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => onSelectDate(value)} aria-label={`选择 ${value}`}>{date.getDate()}</button>
              <span className="mt-1 flex flex-wrap gap-1">
                {(day?.orders ?? []).slice(0, 3).map((order) => <button key={order.order_id} type="button" className={`cc-calendar-order-marker inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${order.order_status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-orange-100 text-orange-900"}`} title={`订单 #${order.order_id} · ${order.customer_name}${order.visit_count > 1 ? ` · ${order.visit_count} 次上门` : ""}`} aria-label={`订单 #${order.order_id}，${order.customer_name}${order.visit_count > 1 ? `，${order.visit_count} 次上门` : ""}`} onClick={(event) => { event.stopPropagation(); onSelectOrder(order.order_id); }}>#{order.order_id}</button>)}
                {(day?.orders?.length ?? 0) > 3 ? <span className="block px-1 text-[11px] text-slate-500">还有 {day!.orders!.length - 3} 笔</span> : null}
              </span>
            </div>
          );
        }}
      />
    </section>
  );
}

interface OrderDayVisitsProps {
  selectedDate: string;
  onSelectOrder: (orderId: number) => void;
  refreshKey: number;
}

export function OrderDayVisits({ selectedDate, onSelectOrder, refreshKey }: OrderDayVisitsProps) {
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${selectedDate}:${refreshKey}:${retryKey}`;
  const [result, setResult] = useState<{
    requestKey: string;
    plan: DayPlan | null;
    error: string | null;
  }>({ requestKey: "", plan: null, error: null });

  useEffect(() => {
    let active = true;
    getDayPlan(selectedDate)
      .then((response) => {
        if (active) setResult({ requestKey, plan: response, error: null });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setResult({
          requestKey,
          plan: null,
          error: cause instanceof Error ? cause.message : "当天上门加载失败，请重试。",
        });
      });
    return () => { active = false; };
  }, [requestKey, selectedDate]);

  const loading = result.requestKey !== requestKey;
  const plan = loading ? null : result.plan;
  const error = loading ? null : result.error;
  const tasks = plan?.tasks.filter((task) => task.status !== "cancelled") ?? [];
  const orderCount = new Set(tasks.map((task) => task.order_id)).size;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={`${selectedDate} 当天上门`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-slate-950">{displayDate(selectedDate)} · 当天上门</h3>
          <p className="mt-1 text-xs text-slate-500">{tasks.length} 次上门 · {orderCount} 笔订单；顺序来自路线图最后保存的排程。</p>
        </div>
        <Link className="cc-button cc-button--secondary min-h-9 px-3 text-xs" to={`/admin/routes?date=${selectedDate}`}><MapPin size={14} />去路线图调整顺序</Link>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载当天上门…</div>
      ) : error ? (
        <div className="px-4 py-8 text-center"><p className="text-sm text-red-700">{error}</p><button type="button" className="cc-button cc-button--secondary mt-3" onClick={() => setRetryKey((current) => current + 1)}>重试</button></div>
      ) : tasks.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-3 text-slate-300" size={32} />这一天没有有效上门任务</div>
      ) : (
        <ol className="grid gap-2 p-3 2xl:grid-cols-2">
          {tasks.map((task, index) => (
            <li key={task.id}>
              <button type="button" className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-left transition hover:border-orange-200 hover:bg-orange-50" onClick={() => onSelectOrder(task.order_id)} aria-label={`路线第 ${index + 1} 站，${task.customer.name}，订单 #${task.order_id}`}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#FF9500] text-sm font-semibold text-slate-950">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-950">{task.customer.name}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${taskStatusStyle(task.status)}`}>{planTaskStatusLabels[task.status]}</span></span>
                  <span className="mt-1 block truncate text-xs text-slate-500">订单 #{task.order_id} · {task.customer.address || "地址待补充"}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600"><span className="inline-flex items-center gap-1"><Clock3 size={13} />{task.planned_time?.slice(0, 5) || "时间待设置"}</span><span>{task.cats.length ? task.cats.map((cat) => cat.name).join("、") : `${task.cat_count} 只猫`}</span></span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
