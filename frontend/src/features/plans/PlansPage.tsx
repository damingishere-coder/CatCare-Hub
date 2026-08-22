import { ClipboardList, Route } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PageHeader } from "../../components/ui/PageHeader";
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
    <section className="cc-page cc-page--wide" aria-labelledby="plans-page-title">
      <PageHeader
        eyebrow="计划与路线"
        title="订单计划"
        headingId="plans-page-title"
        description="按日期安排任务、查看地图路线与推荐顺序，并核对当前客户和猫咪要求。"
        actions={<nav className="flex rounded-[10px] border border-[#e4e8ef] bg-white p-1 shadow-sm" aria-label="订单计划视图">
          <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${view === "schedule" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => changeView("schedule")}><Route size={16} />按天计划</button>
          <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${view === "orders" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => changeView("orders")} disabled={scheduleDirty}><ClipboardList size={16} />订单管理</button>
        </nav>}
      />
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
