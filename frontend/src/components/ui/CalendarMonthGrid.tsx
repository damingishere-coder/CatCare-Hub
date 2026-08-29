import { useMemo, type ReactNode } from "react";

import { localDateValue, monthGrid } from "./calendarDates";

const sundayFirst = ["日", "一", "二", "三", "四", "五", "六"];
const mondayFirst = ["一", "二", "三", "四", "五", "六", "日"];

interface CalendarMonthGridProps {
  month: Date;
  renderDay: (date: Date) => ReactNode;
  weekStartsOn?: 0 | 1;
  fixedWeeks?: boolean;
  weekdayPrefix?: string;
  className?: string;
  weekdayClassName?: string;
  emptyClassName?: string;
}

export function CalendarMonthGrid({
  month,
  renderDay,
  weekStartsOn = 0,
  fixedWeeks = false,
  weekdayPrefix = "",
  className = "grid grid-cols-7 gap-1 text-center",
  weekdayClassName = "py-2 text-xs font-medium text-slate-400",
  emptyClassName = "",
}: CalendarMonthGridProps) {
  const cells = useMemo(
    () => monthGrid(month, weekStartsOn, fixedWeeks),
    [fixedWeeks, month, weekStartsOn],
  );
  const weekdays = weekStartsOn === 1 ? mondayFirst : sundayFirst;

  return (
    <div className={className}>
      {weekdays.map((day) => (
        <div key={day} className={weekdayClassName}>{weekdayPrefix}{day}</div>
      ))}
      {cells.map((date, index) => (
        date
          ? <div key={localDateValue(date)} className="min-w-0">{renderDay(date)}</div>
          : <div key={`empty-${index}`} className={emptyClassName} />
      ))}
    </div>
  );
}
