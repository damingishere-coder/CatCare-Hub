import { CircleDollarSign } from "lucide-react";
import { useState, type FormEvent } from "react";

import { FormDialog } from "../../components/ui/FormDialog";
import type { PaymentCreateInput, PaymentMethod, PaymentReceivable } from "./types";

const inputClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950";
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
  initialReceivableKey: string;
  onCancel: () => void;
  onSave: (payload: PaymentCreateInput) => Promise<void>;
}

function receivableKey(order: PaymentReceivable): string {
  return `${order.order_id}:${order.service_date ?? "order"}`;
}

export function PaymentForm({ orders, initialReceivableKey, onCancel, onSave }: PaymentFormProps) {
  const firstOrder = orders.find((order) => receivableKey(order) === initialReceivableKey) ?? orders[0];
  const [selectedKey, setSelectedKey] = useState(receivableKey(firstOrder));
  const [amount, setAmount] = useState(firstOrder.due_amount);
  const [method, setMethod] = useState<PaymentMethod>("wechat");
  const [paidAt, setPaidAt] = useState(shanghaiDateTimeValue());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedOrder = orders.find((order) => receivableKey(order) === selectedKey) ?? firstOrder;

  function handleOrderChange(nextKey: string) {
    const nextOrder = orders.find((order) => receivableKey(order) === nextKey);
    if (!nextOrder) return;
    setSelectedKey(nextKey);
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
        service_date: selectedOrder.service_date,
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
    <FormDialog
      title="登记收款"
      description="流水保存后不可编辑；误登记可带原因撤销或移入已删除，实际退款仍在线下处理。"
      saving={saving}
      error={error}
      submitLabel="确认登记"
      submitIcon={<CircleDollarSign size={16} />}
      maxWidthClass="max-w-2xl"
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
        <div className="space-y-5">
          <label className={labelClass}>
            待收订单
            <select className={inputClass} value={selectedKey} onChange={(event) => handleOrderChange(event.target.value)} disabled={saving}>
              {orders.map((order) => <option key={receivableKey(order)} value={receivableKey(order)}>#{order.order_id} · {order.customer_name} · {order.service_date ?? "整单"} · 待收 ¥{order.due_amount}</option>)}
            </select>
          </label>

          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3" aria-label="订单金额摘要">
            <div><p className="text-xs text-slate-500">{selectedOrder.service_date ? `${selectedOrder.service_date} 应收` : "订单应收"}</p><p className="mt-1 font-semibold text-slate-950">¥{selectedOrder.total_amount}</p></div>
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
    </FormDialog>
  );
}
