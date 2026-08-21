import { Calculator, LoaderCircle, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import type {
  OrderCatOption,
  OrderDetail,
  OrderFormOptions,
  OrderInput,
  OrderStatus,
  ServiceItem,
} from "./types";
import { serviceItemOptions } from "./constants";

const inputClass =
  "mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm";
const labelClass = "block text-sm font-medium text-slate-700";

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function optionalValue(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function serviceDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

interface OrderFormProps {
  options: OrderFormOptions;
  initial?: OrderDetail;
  onCancel: () => void;
  onSave: (payload: OrderInput) => Promise<void>;
}

export function OrderForm({ options, initial, onCancel, onSave }: OrderFormProps) {
  const defaultDate = localDateValue();
  const [customerId, setCustomerId] = useState(initial?.customer.id ?? options.customers[0]?.id ?? 0);
  const [catIds, setCatIds] = useState<number[]>(initial?.cats.map((cat) => cat.id) ?? []);
  const [startDate, setStartDate] = useState(initial?.start_date ?? defaultDate);
  const [endDate, setEndDate] = useState(initial?.end_date ?? defaultDate);
  const [visitsPerDay, setVisitsPerDay] = useState(initial?.visits_per_day ?? 1);
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>(
    initial?.service_items ?? ["feed", "water", "litter", "photo"],
  );
  const [basePrice, setBasePrice] = useState(initial?.base_price ?? options.default_base_price);
  const [hasStairsFee, setHasStairsFee] = useState(Number(initial?.stairs_fee ?? 0) > 0);
  const [otherFee, setOtherFee] = useState(initial?.other_fee ?? "0.00");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(
    initial?.order_status ?? "pending_confirmation",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = options.customers.find((customer) => customer.id === customerId);
  const availableCats = useMemo(() => {
    const cats = new Map<number, OrderCatOption>();
    selectedCustomer?.cats.forEach((cat) => cats.set(cat.id, cat));
    if (initial?.customer.id === customerId) {
      initial.cats.forEach((cat) => cats.set(cat.id, { id: cat.id, name: cat.name }));
    }
    return [...cats.values()];
  }, [customerId, initial, selectedCustomer]);

  const preview = useMemo(() => {
    const days = serviceDays(startDate, endDate);
    const totalVisits = days * visitsPerDay;
    const base = Number(basePrice) || 0;
    const extra = Math.max(catIds.length - 1, 0) * Number(options.extra_cat_unit_price);
    const stairs = hasStairsFee ? Number(options.stairs_unit_price) : 0;
    const other = Number(otherFee) || 0;
    return {
      days,
      totalVisits,
      extra,
      stairs,
      total: (base + extra + stairs) * totalVisits + other,
    };
  }, [basePrice, catIds.length, endDate, hasStairsFee, options, otherFee, startDate, visitsPerDay]);

  function handleCustomerChange(nextCustomerId: number) {
    setCustomerId(nextCustomerId);
    if (nextCustomerId !== initial?.customer.id) {
      setCatIds([]);
    } else {
      setCatIds(initial.cats.map((cat) => cat.id));
    }
  }

  function toggleCat(catId: number) {
    setCatIds((current) =>
      current.includes(catId) ? current.filter((id) => id !== catId) : [...current, catId],
    );
  }

  function toggleService(item: ServiceItem) {
    setServiceItems((current) =>
      current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId) {
      setError("请先选择客户。");
      return;
    }
    if (catIds.length === 0) {
      setError("请至少选择一只猫咪。");
      return;
    }
    if (serviceItems.length === 0) {
      setError("请至少选择一个服务事项。");
      return;
    }
    if (preview.days <= 0 || preview.days > 366) {
      setError("日期范围必须有效且不能超过 366 天。");
      return;
    }

    const payload: OrderInput = {
      customer_id: customerId,
      cat_ids: catIds,
      start_date: startDate,
      end_date: endDate,
      visits_per_day: visitsPerDay,
      service_items: serviceItems,
      base_price: Number(basePrice).toFixed(2),
      stairs_fee: hasStairsFee ? options.stairs_unit_price : "0.00",
      other_fee: Number(otherFee).toFixed(2),
      order_status: orderStatus,
      notes: optionalValue(notes),
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "订单保存失败，请重试。");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-form-title"
    >
      <form className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="order-form-title" className="text-lg font-semibold text-slate-950">
              {initial ? `编辑订单 #${initial.id}` : "新建订单"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">保存后系统会按日期和每日次数自动生成任务。</p>
          </div>
          <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={onCancel} disabled={saving} aria-label="关闭订单表单">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto px-5 py-5 sm:px-6">
          {error ? <p className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
          {initial ? (
            <p className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              修改日期、每日次数、客户、猫咪或服务事项会重建尚未执行的任务；已有执行记录时系统会拒绝修改并保留历史。
            </p>
          ) : null}

          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-7">
              <section aria-labelledby="order-customer-fields">
                <h3 id="order-customer-fields" className="text-sm font-semibold text-slate-950">客户与猫咪</h3>
                <label className={`${labelClass} mt-3`}>
                  客户
                  <select className={inputClass} value={customerId} onChange={(event) => handleCustomerChange(Number(event.target.value))} required>
                    {options.customers.length === 0 ? <option value={0}>暂无可选客户</option> : null}
                    {options.customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}{customer.community ? ` · ${customer.community}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="mt-4">
                  <legend className={labelClass}>猫咪（至少一只）</legend>
                  {availableCats.length === 0 ? (
                    <p className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">该客户没有在档猫咪，请先到客户档案添加或恢复猫咪。</p>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {availableCats.map((cat) => {
                        const inactive = initial?.cats.some((entry) => entry.id === cat.id && !entry.is_active);
                        return (
                          <label key={cat.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
                            <input type="checkbox" checked={catIds.includes(cat.id)} onChange={() => toggleCat(cat.id)} />
                            {cat.name}{inactive ? "（已停用，历史保留）" : ""}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              </section>

              <section aria-labelledby="order-schedule-fields">
                <h3 id="order-schedule-fields" className="text-sm font-semibold text-slate-950">服务日期与次数</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <label className={labelClass}>
                    开始日期
                    <input className={inputClass} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
                  </label>
                  <label className={labelClass}>
                    结束日期
                    <input className={inputClass} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
                  </label>
                  <label className={labelClass}>
                    每日次数
                    <input className={inputClass} type="number" min={1} max={10} value={visitsPerDay} onChange={(event) => setVisitsPerDay(Number(event.target.value))} required />
                  </label>
                </div>
              </section>

              <fieldset aria-labelledby="order-service-fields">
                <legend id="order-service-fields" className="text-sm font-semibold text-slate-950">服务内容</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {serviceItemOptions.map((item) => (
                    <label key={item.value} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
                      <input type="checkbox" checked={serviceItems.includes(item.value)} onChange={() => toggleService(item.value)} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <section aria-labelledby="order-price-fields">
                <h3 id="order-price-fields" className="text-sm font-semibold text-slate-950">价格</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className={labelClass}>
                    基础单价（元/次）
                    <input className={inputClass} type="number" min="0" step="0.01" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} required />
                  </label>
                  <label className={labelClass}>
                    其他费用（整单）
                    <input className={inputClass} type="number" min="0" step="0.01" value={otherFee} onChange={(event) => setOtherFee(event.target.value)} required />
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700 sm:col-span-2">
                    <input type="checkbox" checked={hasStairsFee} onChange={(event) => setHasStairsFee(event.target.checked)} />
                    四层及以上爬楼（+{options.stairs_unit_price} 元/次）
                  </label>
                </div>
              </section>

              <section aria-labelledby="order-status-fields">
                <h3 id="order-status-fields" className="text-sm font-semibold text-slate-950">状态与备注</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className={labelClass}>
                    订单状态
                    <select className={inputClass} value={orderStatus} onChange={(event) => setOrderStatus(event.target.value as OrderStatus)}>
                      <option value="pending_confirmation">待确认</option>
                      <option value="confirmed">已确认</option>
                      {initial ? <option value="in_progress">进行中</option> : null}
                      {initial ? <option value="completed">已完成</option> : null}
                      {initial ? <option value="cancelled">已取消</option> : null}
                    </select>
                  </label>
                  <label className={`${labelClass} sm:col-span-2`}>
                    订单备注
                    <textarea className={inputClass} rows={4} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                </div>
              </section>
            </div>

            <aside className="h-fit rounded-lg border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-0" aria-label="费用预览">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Calculator size={16} />
                自动计算
              </h3>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">服务天数</dt><dd>{preview.days} 天</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">总服务次数</dt><dd className="font-medium">{preview.totalVisits} 次</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">基础单价</dt><dd>¥{money(Number(basePrice) || 0)}/次</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">额外猫咪</dt><dd>¥{money(preview.extra)}/次</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">爬楼费</dt><dd>¥{money(preview.stairs)}/次</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">其他费用</dt><dd>¥{money(Number(otherFee) || 0)}</dd></div>
              </dl>
              <div className="mt-4 border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">预计应收</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">¥{money(preview.total)}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">最终金额由后端按同一规则重新计算，浏览器不能直接提交应收总额。</p>
              </div>
            </aside>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
          <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={onCancel} disabled={saving}>取消</button>
          <button type="submit" className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" disabled={saving || options.customers.length === 0}>
            {saving ? <LoaderCircle className="animate-spin" size={16} /> : null}
            {saving ? "保存中…" : initial ? "保存并同步任务" : "创建订单并生成任务"}
          </button>
        </div>
      </form>
    </div>
  );
}
