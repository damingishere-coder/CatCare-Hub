import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { PaymentRecord } from "./types";

const methodLabels = {
  wechat: "微信",
  alipay: "支付宝",
  cash: "现金",
  other: "其他",
} as const;

function currency(value: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(value));
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

interface PaymentVoidDialogProps {
  record: PaymentRecord;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function PaymentVoidDialog({ record, onCancel, onConfirm }: PaymentVoidDialogProps) {
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
      setError("请填写撤销原因。后续核对流水时会保留这段说明。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(normalized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败，请刷新后重试。");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="payment-void-title">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/80 bg-white shadow-2xl">
        <form onSubmit={handleSubmit}>
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div><h2 id="payment-void-title" className="text-lg font-semibold text-slate-950">撤销误登记收款</h2><p className="mt-1 text-xs text-slate-500">原始流水会永久保留，并记录撤销时间和原因。</p></div>
            <button type="button" className="cc-icon-button" aria-label="关闭撤销窗口" onClick={onCancel} disabled={saving}><X size={18} /></button>
          </header>
          <div className="space-y-4 p-5">
            <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">客户 / 订单</dt><dd className="mt-1 font-medium text-slate-900">{record.customer_name} · #{record.order_id}</dd></div>
              <div><dt className="text-xs text-slate-500">服务日期</dt><dd className="mt-1 font-medium text-slate-900">{record.service_date ?? `${record.start_date} 至 ${record.end_date}`}</dd></div>
              <div><dt className="text-xs text-slate-500">方式 / 金额</dt><dd className="mt-1 font-medium text-slate-900">{methodLabels[record.payment_method]} · {currency(record.amount)}</dd></div>
              <div><dt className="text-xs text-slate-500">收款时间</dt><dd className="mt-1 font-medium text-slate-900">{displayDateTime(record.paid_at)}</dd></div>
            </dl>
            <div className="cc-alert cc-alert--warning">这里仅纠正系统里的误登记，不会向微信、支付宝、银行卡或现金渠道发起退款。若真实资金已经到账，请先在线下完成退款。</div>
            <label className="block text-sm font-medium text-slate-700">撤销原因 <span className="text-red-600">*</span>
              <textarea ref={reasonRef} className="mt-1.5 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="例如：重复登记，实际只收到一笔" />
            </label>
            <p className="text-right text-xs text-slate-400">{reason.length}/500</p>
            {error ? <p className="cc-alert cc-alert--danger" role="alert">{error}</p> : null}
          </div>
          <footer className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4">
            <button type="button" className="cc-button cc-button--secondary" onClick={onCancel} disabled={saving}>取消</button>
            <button type="submit" className="cc-button cc-button--primary" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <RotateCcw size={16} />}{saving ? "撤销中…" : "确认撤销"}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
