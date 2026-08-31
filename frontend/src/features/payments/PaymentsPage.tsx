import { ArchiveRestore, CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, Plus, RefreshCw, RotateCcw, Trash2, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { PageHeader } from "../../components/ui/PageHeader";
import { deletePayment, getPaymentsOverview, registerPayment, restorePayment, voidPayment } from "./api";
import { PaymentDeleteDialog } from "./PaymentDeleteDialog";
import { PaymentForm } from "./PaymentForm";
import { PaymentVoidDialog } from "./PaymentVoidDialog";
import type { PaymentCreateInput, PaymentMethod, PaymentRecord, PaymentRecordStatus, PaymentsOverview } from "./types";

function receivableKey(order: PaymentsOverview["receivables"][number]): string {
  return `${order.order_id}:${order.service_date ?? "order"}`;
}

function defaultReceivable(overview: PaymentsOverview, orderId?: number | null) {
  const candidates = orderId == null
    ? overview.receivables
    : overview.receivables.filter((item) => item.order_id === orderId);
  return candidates.find((item) => item.service_date === overview.business_date)
    ?? candidates[0]
    ?? null;
}

const methodLabels: Record<PaymentMethod, string> = {
  wechat: "微信",
  alipay: "支付宝",
  cash: "现金",
  other: "其他",
};

const statusLabels: Record<PaymentRecordStatus, string> = {
  pending: "待确认",
  completed: "已完成",
  refunded: "已退款",
  voided: "已撤销",
};

function currency(value: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(Number(value));
}

function dateRange(start: string, end: string): string {
  return start === end ? start : `${start} 至 ${end}`;
}

function displayDateTime(value: string | null): string {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function businessDateLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date(`${value}T00:00:00+08:00`));
}

function recordStatusStyle(status: PaymentRecordStatus): string {
  return {
    pending: "bg-amber-50 text-amber-700",
    completed: "bg-emerald-50 text-emerald-700",
    refunded: "bg-slate-200 text-slate-600",
    voided: "bg-red-50 text-red-700",
  }[status];
}

interface PaymentsPageProps {
  initialCreate?: boolean;
  initialOrderId?: number | null;
}

export function PaymentsPage({ initialCreate = false, initialOrderId = null }: PaymentsPageProps) {
  const [overview, setOverview] = useState<PaymentsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formReceivableKey, setFormReceivableKey] = useState<string | null>(null);
  const [voidRecord, setVoidRecord] = useState<PaymentRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<PaymentRecord | null>(null);
  const [recordView, setRecordView] = useState<"current" | "deleted">("current");
  const [mutatingRecordId, setMutatingRecordId] = useState<number | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getPaymentsOverview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "收款页面加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getPaymentsOverview()
      .then((response) => {
        if (!active) return;
        setOverview(response);
        if (!initialCreate) return;
        if (response.receivables.length === 0) {
          setError("当前没有可登记的待收订单。");
        } else if (initialOrderId !== null) {
          const requested = defaultReceivable(response, initialOrderId);
          if (requested) {
            setFormReceivableKey(receivableKey(requested));
          } else {
            setError(`订单 #${initialOrderId} 已不在待收列表，请刷新工作台确认。`);
          }
        } else {
          const requested = defaultReceivable(response);
          if (requested) setFormReceivableKey(receivableKey(requested));
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "收款页面加载失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialCreate, initialOrderId]);

  async function handleSave(payload: PaymentCreateInput) {
    await registerPayment(payload);
    setFormReceivableKey(null);
    await loadOverview();
  }

  async function handleVoid(reason: string) {
    if (!voidRecord) return;
    await voidPayment(voidRecord.id, {
      expected_revision: voidRecord.revision,
      reason,
    });
    setVoidRecord(null);
    await loadOverview();
  }

  async function handleDelete(reason: string) {
    if (!deleteRecord) return;
    await deletePayment(deleteRecord.id, {
      expected_revision: deleteRecord.revision,
      reason,
    });
    setDeleteRecord(null);
    setRecordView("deleted");
    await loadOverview();
  }

  async function handleRestore(record: PaymentRecord) {
    if (!window.confirm("恢复后只会重新显示这条流水，不会重新计入收入或订单已收金额。确认恢复显示吗？")) return;
    setMutatingRecordId(record.id);
    setError(null);
    try {
      await restorePayment(record.id, { expected_revision: record.revision });
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复显示失败，请刷新后重试。");
    } finally {
      setMutatingRecordId(null);
    }
  }

  const deletedRecords = overview?.deleted_records ?? [];
  const visibleRecords = recordView === "current" ? overview?.records ?? [] : deletedRecords;

  return (
    <section className="cc-page" aria-labelledby="payments-title">
      <PageHeader
        eyebrow="财务与回款"
        title="收款记录"
        headingId="payments-title"
        description={overview ? businessDateLabel(overview.business_date) : "统一查看待收订单与不可变收款流水。"}
        actions={<>
          <button type="button" className="cc-button cc-button--secondary" onClick={() => void loadOverview()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}刷新</button>
          <button type="button" className="cc-button cc-button--primary" onClick={() => { const requested = overview ? defaultReceivable(overview) : null; if (requested) setFormReceivableKey(receivableKey(requested)); }} disabled={!overview?.receivables.length}><Plus size={16} />登记收款</button>
        </>}
      />

      {error ? <ConnectionErrorAlert className="mt-5" message={error} onRetry={() => void loadOverview()} /> : null}

      {loading && !overview ? (
        <div className="cc-surface mt-8 flex min-h-80 items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 animate-spin" size={18} />正在汇总收款数据…</div>
      ) : overview ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "今日收款", value: currency(overview.metrics.today_income), icon: CircleDollarSign },
              { label: "待收款", value: `${overview.metrics.pending_order_count} 项`, icon: WalletCards },
              { label: "本月收入", value: currency(overview.metrics.month_income), icon: CheckCircle2 },
              { label: "累计完成订单", value: `${overview.metrics.completed_order_count} 单`, icon: Clock3 },
            ].map(({ label, value, icon: Icon }) => <article key={label} className="cc-metric p-4"><div className="flex items-center justify-between text-slate-500"><p className="text-sm font-medium">{label}</p><span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon size={18} /></span></div><p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{value}</p></article>)}
          </div>

          <section className="cc-surface mt-5 overflow-hidden p-0" aria-labelledby="receivables-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 id="receivables-title" className="font-semibold text-slate-950">待收项目</h2><p className="mt-1 text-xs text-slate-500">由未取消订单的应收金额自动生成；登记、撤销或删除收款后会自动重算。</p></div><div className="flex items-center gap-3"><span className="text-sm font-medium text-slate-500">{overview.receivables.length} 项</span><Link className="cc-button cc-button--secondary min-h-9 px-3 text-xs" to="/admin/orders?action=create"><Plus size={14} />新建订单</Link></div></div>
            {overview.receivables.length ? (
              <div className="overflow-x-auto"><table className="cc-table min-w-full text-left text-sm"><thead><tr><th className="px-5 py-3 font-medium">客户 / 订单</th><th className="px-4 py-3 font-medium">结算日期</th><th className="px-4 py-3 font-medium">应收</th><th className="px-4 py-3 font-medium">已收</th><th className="px-4 py-3 font-medium">待收</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{overview.receivables.map((order) => <tr key={receivableKey(order)}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{order.customer_name}</p><p className="mt-1 text-xs text-slate-500">订单 #{order.order_id}{order.address ? ` · ${order.address}` : ""}</p></td><td className="px-4 py-4 text-slate-600"><p>{order.service_date ?? dateRange(order.start_date, order.end_date)}</p><p className="mt-1 text-xs text-slate-500">{order.service_date ? "按日结算" : "整单结算"} · {order.cat_count} 只猫</p></td><td className="px-4 py-4 text-slate-700">{currency(order.total_amount)}</td><td className="px-4 py-4 text-emerald-700">{currency(order.paid_amount)}</td><td className="px-4 py-4 font-semibold text-amber-700">{currency(order.due_amount)}</td><td className="px-5 py-4 text-right"><button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs" onClick={() => setFormReceivableKey(receivableKey(order))}>登记</button></td></tr>)}</tbody></table></div>
            ) : <div className="px-5 py-10 text-center"><p className="text-sm text-slate-500">当前没有待收订单。待收项目无需单独新建，会随订单金额自动出现。</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Link className="cc-button cc-button--primary" to="/admin/orders?action=create"><Plus size={15} />新建订单</Link><Link className="cc-button cc-button--secondary" to="/admin/orders">查看或调整订单金额</Link></div></div>}
          </section>

          <section className="cc-surface mt-5 overflow-hidden p-0" aria-labelledby="records-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div><h2 id="records-title" className="font-semibold text-slate-950">收款流水</h2><p className="mt-1 text-xs text-slate-500">删除采用可审计的软删除；完成流水会先撤销金额影响。</p></div>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="流水范围">
                <button type="button" role="tab" aria-selected={recordView === "current"} className={`rounded-lg px-3 py-2 text-xs font-semibold ${recordView === "current" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => setRecordView("current")}>当前流水（{overview.records.length}）</button>
                <button type="button" role="tab" aria-selected={recordView === "deleted"} className={`rounded-lg px-3 py-2 text-xs font-semibold ${recordView === "deleted" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => setRecordView("deleted")}>已删除（{deletedRecords.length}）</button>
              </div>
            </div>
            {visibleRecords.length ? (
              <div className="overflow-x-auto"><table className="cc-table min-w-full text-left text-sm"><thead><tr><th className="px-5 py-3 font-medium">客户</th><th className="px-4 py-3 font-medium">项目</th><th className="px-4 py-3 font-medium">支付方式</th><th className="px-4 py-3 font-medium">金额</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">时间</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{visibleRecords.map((record) => <tr key={record.id}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{record.customer_name}</p><p className="mt-1 text-xs text-slate-500">订单 #{record.order_id}</p></td><td className="px-4 py-4 text-slate-600"><p>{record.service_date ?? dateRange(record.start_date, record.end_date)}</p><p className="mt-1 text-xs text-slate-500">{record.service_date ? "日结" : "整单"} · {record.cat_count} 只猫</p></td><td className="px-4 py-4 text-slate-700">{methodLabels[record.payment_method]}</td><td className="px-4 py-4 font-semibold text-slate-900">{currency(record.amount)}</td><td className="max-w-64 px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${recordStatusStyle(record.payment_status)}`}>{statusLabels[record.payment_status]}</span>{recordView === "deleted" && record.deleted_reason ? <p className="mt-2 text-xs leading-5 text-red-700">删除原因：{record.deleted_reason}</p> : record.voided_reason ? <p className="mt-2 text-xs leading-5 text-red-700">撤销原因：{record.voided_reason}</p> : null}</td><td className="px-4 py-4 text-slate-600"><p>{displayDateTime(record.paid_at)}</p>{record.voided_at ? <p className="mt-1 text-xs text-red-700">撤销：{displayDateTime(record.voided_at)}</p> : null}{record.deleted_at ? <p className="mt-1 text-xs text-red-700">删除：{displayDateTime(record.deleted_at)}</p> : null}</td><td className="px-5 py-4 text-right">{recordView === "deleted" ? <button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs" onClick={() => void handleRestore(record)} disabled={mutatingRecordId === record.id}>{mutatingRecordId === record.id ? <LoaderCircle className="animate-spin" size={14} /> : <ArchiveRestore size={14} />}恢复显示</button> : <div className="flex justify-end gap-2">{record.payment_status === "completed" ? <button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs text-red-700" onClick={() => setVoidRecord(record)}><RotateCcw size={14} />撤销</button> : null}<button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs text-red-700" onClick={() => setDeleteRecord(record)}><Trash2 size={14} />删除</button></div>}</td></tr>)}</tbody></table></div>
            ) : <p className="px-5 py-12 text-center text-sm text-slate-500">{recordView === "current" ? "还没有当前收款流水。" : "还没有已删除流水。"}</p>}
          </section>

          <p className="mt-4 text-xs leading-5 text-slate-500">收款页只展示客户名称、完整地址、订单日期、猫咪数量和金额摘要；门禁、钥匙与备注不会出现在批量响应。当前后台仅限本机或可信私网使用。</p>
        </>
      ) : null}

      {overview && formReceivableKey !== null ? <PaymentForm orders={overview.receivables} initialReceivableKey={formReceivableKey} onCancel={() => setFormReceivableKey(null)} onSave={handleSave} /> : null}
      {voidRecord ? <PaymentVoidDialog record={voidRecord} onCancel={() => setVoidRecord(null)} onConfirm={handleVoid} /> : null}
      {deleteRecord ? <PaymentDeleteDialog record={deleteRecord} onCancel={() => setDeleteRecord(null)} onConfirm={handleDelete} /> : null}
    </section>
  );
}
