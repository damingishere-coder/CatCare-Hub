import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CalendarMonthGrid } from "../../components/ui/CalendarMonthGrid";
import { localDateValue, parseLocalDate } from "../../components/ui/calendarDates";
import { DailyPlansPage } from "../plans/DailyPlansPage";
import { getPlanDays } from "../plans/api";
import type { PlanDaySummary } from "../plans/types";

function monthBounds(month: Date): [string, string] {
  return [
    localDateValue(new Date(month.getFullYear(), month.getMonth(), 1)),
    localDateValue(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  ];
}

interface OrderScheduleCalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onSelectOrder: (orderId: number) => void;
}

export function OrderScheduleCalendar({ selectedDate, onSelectDate, onSelectOrder }: OrderScheduleCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => parseLocalDate(selectedDate));
  const [days, setDays] = useState<PlanDaySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
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
  }, [visibleMonth]);

  function changeMonth(offset: number) {
    if (dirty) return;
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function selectToday() {
    if (dirty) return;
    const today = new Date();
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(localDateValue(today));
  }

  return (
    <main className="min-w-0 bg-slate-50/60 p-4 sm:p-5" aria-label="订单月历与当天排班">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="order-calendar-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 id="order-calendar-title" className="flex items-center gap-2 font-semibold"><CalendarDays size={18} />订单月历</h3><p className="mt-1 text-xs text-slate-500">点击日期查看当天排班；点击订单编号打开右侧详情。</p></div>
          <div className="flex items-center gap-2">
            <button type="button" className="cc-icon-button" aria-label="上个月" onClick={() => changeMonth(-1)} disabled={dirty}><ChevronLeft size={17} /></button>
            <span className="min-w-28 text-center text-sm font-semibold">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</span>
            <button type="button" className="cc-icon-button" aria-label="下个月" onClick={() => changeMonth(1)} disabled={dirty}><ChevronRight size={17} /></button>
            <button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs whitespace-nowrap" onClick={selectToday} disabled={dirty}>今天</button>
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
              <div className={`min-h-24 min-w-0 border-r border-b border-slate-100 p-1.5 text-left align-top transition hover:bg-orange-50 ${selectedDate === value ? "bg-orange-50 ring-2 ring-inset ring-orange-400" : "bg-white"}`} onClick={() => !dirty && onSelectDate(value)}>
                <button type="button" className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${value === localDateValue(new Date()) ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => !dirty && onSelectDate(value)} disabled={dirty} aria-label={`选择 ${value}`}>{date.getDate()}</button>
                <span className="mt-1 block space-y-1">
                  {(day?.orders ?? []).slice(0, 3).map((order) => <button key={order.order_id} type="button" className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-semibold ${order.order_status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-orange-100 text-orange-900"}`} onClick={(event) => { event.stopPropagation(); onSelectOrder(order.order_id); }}>#{order.order_id}{order.visit_count > 1 ? ` ×${order.visit_count}` : ""} · {order.customer_name}</button>)}
                  {(day?.orders?.length ?? 0) > 3 ? <span className="block px-1 text-[11px] text-slate-500">还有 {day!.orders!.length - 3} 笔</span> : null}
                </span>
              </div>
            );
          }}
        />
      </section>
      <div className="mt-5">
        <DailyPlansPage key={selectedDate} onDirtyChange={setDirty} />
      </div>
    </main>
  );
}
