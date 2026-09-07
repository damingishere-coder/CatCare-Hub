import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ClipboardCheck } from "lucide-react";
import { listIntakeSubmissions } from "./api";

export function IntakeSummary() {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await listIntakeSubmissions();
      setCount(response.items.filter((item) => !item.removed_at && ["submitted", "reviewed", "processing"].includes(item.status)).length);
      setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => { if (active && document.visibilityState === "visible") void refresh(); };
    update();
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  return <section className="cc-surface mt-5 flex flex-wrap items-center justify-between gap-4 p-4" aria-label="客户资料决策区">
    <div className="flex items-center gap-3"><ClipboardCheck className="text-brand-700" size={22} /><div>
      <h2 className="text-sm font-semibold">客户提交{count !== null ? ` · ${count} 份待处理` : ""}</h2>
      <p className="mt-1 text-xs text-slate-500" role={failed ? "status" : undefined}>{failed ? "暂时无法同步客户提交，今日任务仍可使用。" : count === null ? "正在同步审核摘要…" : "核对资料和价格后，再生成订单。"}</p>
    </div></div>
    <Link className="cc-button cc-button--secondary" to="/admin/intake">处理客户提交<ArrowUpRight size={16} /></Link>
  </section>;
}
