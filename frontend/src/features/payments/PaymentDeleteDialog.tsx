import { LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { PaymentRecord } from "./types";

const methodLabels = {
  wechat: "微信",
  alipay: "支付宝",
  cash: "现金",
  other: "其他",
} as const;

interface PaymentDeleteDialogProps {
  record: PaymentRecord;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function currency(value: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(value));
}

export function PaymentDeleteDialog({ record, onCancel, onConfirm }: PaymentDeleteDialogProps) {
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = reason.trim();
    if (!normalized) {
      setError("请填写删除原因，便于后续核对操作记录。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(normalized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请刷新后重试。");
      setSaving(false);
    }
  }

  const completed = record.payment_status === "completed";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="payment-delete-title">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/80 bg-white shadow-2xl">
        <form onSubmit={handleSubmit}>
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div><h2 id="payment-delete-title" className="text-lg font-semibold text-slate-950">删除收款流水</h2><p className="mt-1 text-xs text-slate-500">流水不会物理消失，可在“已删除”中恢复显示。</p></div>
            <button type="button" className="cc-icon-button" aria-label="关闭删除窗口" onClick={onCancel} disabled={saving}><X size={18} /></button>
          </header>
          <div className="space-y-4 p-5">
            <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">客户 / 订单</dt><dd className="mt-1 font-medium text-slate-900">{record.customer_name} · #{record.order_id}</dd></div>
              <div><dt className="text-xs text-slate-500">方式 / 金额</dt><dd className="mt-1 font-medium text-slate-900">{methodLabels[record.payment_method]} · {currency(record.amount)}</dd></div>
            </dl>
            <div className="cc-alert cc-alert--warning">{completed ? "这条流水会先自动撤销，订单已收金额、待收金额和统计会立即重算；恢复显示不会重新计入金额。" : "这条流水会移入已删除；恢复只改变可见性，不改变当前付款状态。"}</div>
            <label className="block text-sm font-medium text-slate-700">删除原因 <span className="text-red-600">*</span>
              <textarea ref={reasonRef} className="mt-1.5 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="例如：重复录入，保留审计后从当前列表移除" />
            </label>
            <p className="text-right text-xs text-slate-400">{reason.length}/500</p>
            {error ? <p className="cc-alert cc-alert--danger" role="alert">{error}</p> : null}
          </div>
          <footer className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4">
            <button type="button" className="cc-button cc-button--secondary" onClick={onCancel} disabled={saving}>取消</button>
            <button type="submit" className="cc-button bg-red-600 text-white hover:bg-red-700" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Trash2 size={16} />}{saving ? "处理中…" : completed ? "撤销并删除" : "确认删除"}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
