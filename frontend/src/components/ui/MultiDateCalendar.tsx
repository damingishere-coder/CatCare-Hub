import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { localDateValue, parseLocalDate } from "./calendarDates";

function dateSummary(values: string[]): string {
  if (!values.length) return "暂不确定，可以留空";
  const formatted = values.slice(0, 3).map((value) => {
    const date = parseLocalDate(value);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  });
  return `${formatted.join("、")}${values.length > 3 ? ` 等 ${values.length} 天` : ""}`;
}

interface MultiDateCalendarProps {
  values: string[];
  onChange: (values: string[]) => void;
  title?: string;
  disabled?: boolean;
}

export function MultiDateCalendar({
  values,
  onChange,
  title = "选择预计上门日期",
  disabled = false,
}: MultiDateCalendarProps) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => (
    values[0] ? parseLocalDate(values[0]) : new Date()
  ));
  const selected = useMemo(() => new Set(values), [values]);

  function toggle(date: Date) {
    const value = localDateValue(date);
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next].sort());
  }

  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-left transition hover:border-brand-400 disabled:opacity-60"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <CalendarDays className="shrink-0 text-brand-700" size={20} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{title}</span>
          <span className="mt-1 block truncate text-xs text-slate-500">{dateSummary(values)}</span>
        </span>
        {values.length ? <span className="shrink-0 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">{values.length} 天</span> : null}
      </button>

      {open ? (
        <section className="mt-3 max-w-full overflow-hidden rounded-2xl border border-brand-100 bg-white p-3 shadow-sm" aria-label="预计上门日期日历">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="cc-icon-button" aria-label="上个月" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
            <p className="text-sm font-bold text-slate-900">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</p>
            <button type="button" className="cc-icon-button" aria-label="下个月" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
          </div>
          <CalendarMonthGrid
            month={visibleMonth}
            className="mt-3 grid min-w-0 grid-cols-7 gap-1 text-center"
            renderDay={(date) => (
              <button
                key={localDateValue(date)}
                type="button"
                className={`aspect-square min-h-10 w-full min-w-0 rounded-xl text-sm font-semibold transition ${selected.has(localDateValue(date)) ? "bg-brand-700 text-white shadow-sm" : "text-slate-700 hover:bg-brand-50"}`}
                aria-pressed={selected.has(localDateValue(date))}
                onClick={() => toggle(date)}
              >
                {date.getDate()}
              </button>
            )}
          />
          <div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-3">
            <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => onChange([])} disabled={!values.length}><RotateCcw size={14} />清空</button>
            <button type="button" className="cc-button cc-button--primary min-h-10 px-4" onClick={() => setOpen(false)}>完成</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
