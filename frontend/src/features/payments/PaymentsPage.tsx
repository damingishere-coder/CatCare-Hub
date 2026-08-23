import { CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, Plus, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { PageHeader } from "../../components/ui/PageHeader";
import { getPaymentsOverview, registerPayment } from "./api";
import { PaymentForm } from "./PaymentForm";
import type { PaymentCreateInput, PaymentMethod, PaymentRecordStatus, PaymentsOverview } from "./types";

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
  const [formOrderId, setFormOrderId] = useState<number | null>(null);

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
          const requested = response.receivables.find((order) => order.order_id === initialOrderId);
          if (requested) {
            setFormOrderId(requested.order_id);
          } else {
            setError(`订单 #${initialOrderId} 已不在待收列表，请刷新工作台确认。`);
          }
        } else {
          setFormOrderId(response.receivables[0].order_id);
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
    setFormOrderId(null);
    await loadOverview();
  }

  return (
    <section className="cc-page" aria-labelledby="payments-title">
      <PageHeader
        eyebrow="财务与回款"
        title="收款记录"
        headingId="payments-title"
        description={overview ? businessDateLabel(overview.business_date) : "统一查看待收订单与不可变收款流水。"}
        actions={<>
          <button type="button" className="cc-button cc-button--secondary" onClick={() => void loadOverview()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}刷新</button>
          <button type="button" className="cc-button cc-button--primary" onClick={() => overview?.receivables[0] && setFormOrderId(overview.receivables[0].order_id)} disabled={!overview?.receivables.length}><Plus size={16} />登记收款</button>
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
              { label: "待收款", value: `${overview.metrics.pending_order_count} 单`, icon: WalletCards },
              { label: "本月收入", value: currency(overview.metrics.month_income), icon: CheckCircle2 },
              { label: "累计完成订单", value: `${overview.metrics.completed_order_count} 单`, icon: Clock3 },
            ].map(({ label, value, icon: Icon }) => <article key={label} className="cc-metric p-4"><div className="flex items-center justify-between text-slate-500"><p className="text-sm font-medium">{label}</p><span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon size={18} /></span></div><p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{value}</p></article>)}
          </div>

          <section className="cc-surface mt-5 overflow-hidden p-0" aria-labelledby="receivables-title">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 id="receivables-title" className="font-semibold text-slate-950">待收订单</h2><p className="mt-1 text-xs text-slate-500">仅列出未取消、非退款且仍有余额的订单</p></div><span className="text-sm font-medium text-slate-500">{overview.receivables.length} 单</span></div>
            {overview.receivables.length ? (
              <div className="overflow-x-auto"><table className="cc-table min-w-full text-left text-sm"><thead><tr><th className="px-5 py-3 font-medium">客户 / 订单</th><th className="px-4 py-3 font-medium">服务项目</th><th className="px-4 py-3 font-medium">应收</th><th className="px-4 py-3 font-medium">已收</th><th className="px-4 py-3 font-medium">待收</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{overview.receivables.map((order) => <tr key={order.order_id}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{order.customer_name}</p><p className="mt-1 text-xs text-slate-500">订单 #{order.order_id}{order.address ? ` · ${order.address}` : ""}</p></td><td className="px-4 py-4 text-slate-600"><p>{dateRange(order.start_date, order.end_date)}</p><p className="mt-1 text-xs text-slate-500">{order.cat_count} 只猫</p></td><td className="px-4 py-4 text-slate-700">{currency(order.total_amount)}</td><td className="px-4 py-4 text-emerald-700">{currency(order.paid_amount)}</td><td className="px-4 py-4 font-semibold text-amber-700">{currency(order.due_amount)}</td><td className="px-5 py-4 text-right"><button type="button" className="cc-button cc-button--secondary min-h-9 px-3 text-xs" onClick={() => setFormOrderId(order.order_id)}>登记</button></td></tr>)}</tbody></table></div>
            ) : <p className="px-5 py-12 text-center text-sm text-slate-500">当前没有待收订单。</p>}
          </section>

          <section className="cc-surface mt-5 overflow-hidden p-0" aria-labelledby="records-title">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 id="records-title" className="font-semibold text-slate-950">收款流水</h2><p className="mt-1 text-xs text-slate-500">流水仅追加；P8 不提供编辑、删除或退款</p></div><span className="text-sm font-medium text-slate-500">{overview.records.length} 条</span></div>
            {overview.records.length ? (
              <div className="overflow-x-auto"><table className="cc-table min-w-full text-left text-sm"><thead><tr><th className="px-5 py-3 font-medium">客户</th><th className="px-4 py-3 font-medium">项目</th><th className="px-4 py-3 font-medium">支付方式</th><th className="px-4 py-3 font-medium">金额</th><th className="px-4 py-3 font-medium">状态</th><th className="px-5 py-3 font-medium">时间</th></tr></thead><tbody>{overview.records.map((record) => <tr key={record.id}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{record.customer_name}</p><p className="mt-1 text-xs text-slate-500">订单 #{record.order_id}</p></td><td className="px-4 py-4 text-slate-600"><p>{dateRange(record.start_date, record.end_date)}</p><p className="mt-1 text-xs text-slate-500">{record.cat_count} 只猫</p></td><td className="px-4 py-4 text-slate-700">{methodLabels[record.payment_method]}</td><td className="px-4 py-4 font-semibold text-slate-900">{currency(record.amount)}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${recordStatusStyle(record.payment_status)}`}>{statusLabels[record.payment_status]}</span></td><td className="px-5 py-4 text-slate-600">{displayDateTime(record.paid_at)}</td></tr>)}</tbody></table></div>
            ) : <p className="px-5 py-12 text-center text-sm text-slate-500">还没有收款流水。</p>}
          </section>

          <p className="mt-4 text-xs leading-5 text-slate-500">收款页只展示客户名称、完整地址、订单日期、猫咪数量和金额摘要；门禁、钥匙与备注不会出现在批量响应。当前后台仅限本机或可信私网使用。</p>
        </>
      ) : null}

      {overview && formOrderId !== null ? <PaymentForm orders={overview.receivables} initialOrderId={formOrderId} onCancel={() => setFormOrderId(null)} onSave={handleSave} /> : null}
    </section>
  );
}
