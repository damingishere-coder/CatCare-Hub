import { CircleDollarSign, LoaderCircle, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { PaymentCreateInput, PaymentMethod, PaymentReceivable } from "./types";

const inputClass =
  "mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950";
const labelClass = "block text-sm font-medium text-slate-700";

const methodLabels: Record<PaymentMethod, string> = {
  wechat: "微信",
  alipay: "支付宝",
  cash: "现金",
  other: "其他",
};

function shanghaiDateTimeValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function amountIsValid(value: string, dueAmount: string): boolean {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= Number(dueAmount);
}

interface PaymentFormProps {
  orders: PaymentReceivable[];
  initialOrderId: number;
  onCancel: () => void;
  onSave: (payload: PaymentCreateInput) => Promise<void>;
}

export function PaymentForm({ orders, initialOrderId, onCancel, onSave }: PaymentFormProps) {
  const firstOrder = orders.find((order) => order.order_id === initialOrderId) ?? orders[0];
  const [orderId, setOrderId] = useState(firstOrder.order_id);
  const [amount, setAmount] = useState(firstOrder.due_amount);
  const [method, setMethod] = useState<PaymentMethod>("wechat");
  const [paidAt, setPaidAt] = useState(shanghaiDateTimeValue());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedOrder = orders.find((order) => order.order_id === orderId) ?? firstOrder;

  function handleOrderChange(nextOrderId: number) {
    const nextOrder = orders.find((order) => order.order_id === nextOrderId);
    if (!nextOrder) return;
    setOrderId(nextOrderId);
    setAmount(nextOrder.due_amount);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountIsValid(amount, selectedOrder.due_amount)) {
      setError(`金额必须大于 0，且不能超过待收 ¥${selectedOrder.due_amount}。`);
      return;
    }
    if (!paidAt) {
      setError("请填写收款时间。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        order_id: selectedOrder.order_id,
        amount: Number(amount).toFixed(2),
        payment_method: method,
        paid_at: `${paidAt}:00+08:00`,
        notes: notes.trim() || null,
        expected_revision: selectedOrder.revision,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "收款登记失败，请重试。");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-[2px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="payment-form-title">
      <form className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl" onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="payment-form-title" className="text-lg font-semibold text-slate-950">登记收款</h2>
            <p className="mt-1 text-sm text-slate-500">流水保存后不可在本轮编辑、删除或退款。</p>
          </div>
          <button type="button" className="cc-icon-button" onClick={onCancel} disabled={saving} aria-label="关闭收款表单"><X size={18} /></button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          {error ? <p className="cc-alert cc-alert--danger" role="alert">{error}</p> : null}
          <label className={labelClass}>
            待收订单
            <select className={inputClass} value={orderId} onChange={(event) => handleOrderChange(Number(event.target.value))} disabled={saving}>
              {orders.map((order) => <option key={order.order_id} value={order.order_id}>#{order.order_id} · {order.customer_name} · 待收 ¥{order.due_amount}</option>)}
            </select>
          </label>

          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3" aria-label="订单金额摘要">
            <div><p className="text-xs text-slate-500">订单应收</p><p className="mt-1 font-semibold text-slate-950">¥{selectedOrder.total_amount}</p></div>
            <div><p className="text-xs text-slate-500">已经收取</p><p className="mt-1 font-semibold text-emerald-700">¥{selectedOrder.paid_amount}</p></div>
            <div><p className="text-xs text-slate-500">当前待收</p><p className="mt-1 font-semibold text-amber-700">¥{selectedOrder.due_amount}</p></div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              本次金额（元）
              <input className={inputClass} type="number" min="0.01" max={selectedOrder.due_amount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={saving} required />
            </label>
            <label className={labelClass}>
              收款方式
              <select className={inputClass} value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} disabled={saving}>
                {(Object.entries(methodLabels) as Array<[PaymentMethod, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <label className={labelClass}>
            收款时间（Asia/Shanghai）
            <input className={inputClass} type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} disabled={saving} required />
          </label>
          <label className={labelClass}>
            备注（可选，不在批量列表显示）
            <textarea className={`${inputClass} min-h-24 resize-y`} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
          <button type="button" className="cc-button cc-button--secondary" onClick={onCancel} disabled={saving}>取消</button>
          <button type="submit" className="cc-button cc-button--primary" disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" size={16} /> : <CircleDollarSign size={16} />}{saving ? "保存中…" : "确认登记"}
          </button>
        </div>
      </form>
    </div>
  );
}
