import { ClipboardList, Route } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { OrdersPage } from "../orders/OrdersPage";
import { DailyPlansPage } from "./DailyPlansPage";

type PlanView = "schedule" | "orders";

export function PlansPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const view: PlanView = searchParams.get("view") === "orders" ? "orders" : "schedule";

  const handleDirtyChange = useCallback((dirty: boolean) => setScheduleDirty(dirty), []);

  function changeView(nextView: PlanView) {
    if (nextView === view || (scheduleDirty && nextView === "orders")) return;
    const next = new URLSearchParams(searchParams);
    if (nextView === "orders") next.set("view", "orders");
    else next.delete("view");
    setSearchParams(next, { replace: true });
  }

  return (
    <section className="mx-auto max-w-[1600px]" aria-labelledby="plans-page-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">P5 · 地图与路线</p>
          <h1 id="plans-page-title" className="text-2xl font-semibold tracking-tight">订单计划</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">按日期安排任务、查看地图路线与推荐顺序，并核对当前客户和猫咪要求。</p>
        </div>
        <nav className="flex rounded-lg border border-slate-200 bg-white p-1" aria-label="订单计划视图">
          <button type="button" className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${view === "schedule" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => changeView("schedule")}><Route size={16} />按天计划</button>
          <button type="button" className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${view === "orders" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => changeView("orders")} disabled={scheduleDirty}><ClipboardList size={16} />订单管理</button>
        </nav>
      </div>
      {scheduleDirty ? <p className="mt-3 text-right text-xs text-amber-700">当前排程尚未保存；保存或撤销后才能切换到订单管理。</p> : null}
      <div className="mt-6">
        {view === "orders" ? (
          <OrdersPage initialCreate={searchParams.get("action") === "create"} />
        ) : (
          <DailyPlansPage onDirtyChange={handleDirtyChange} />
        )}
      </div>
    </section>
  );
}
