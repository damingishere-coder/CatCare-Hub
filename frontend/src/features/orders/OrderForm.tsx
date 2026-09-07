import {
  BookUser,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { ModalSurface } from "../../components/ui/ModalSurface";
import { useUnsavedChanges } from "../../components/ui/useUnsavedChanges";
import { CalendarMonthGrid } from "../../components/ui/CalendarMonthGrid";
import { localDateValue, parseLocalDate } from "../../components/ui/calendarDates";
import { serviceItemOptions } from "./constants";
import { parseOrderAddress } from "./addressParser";
import {
  accessMethodOptions,
  keyStatusOptions,
  optionsWithLegacy,
} from "../../lib/customerDisplay";
import type {
  OrderAdjustmentType,
  OrderAmountAdjustment,
  OrderCreateInput,
  OrderDetail,
  OrderFormOptions,
  OrderPatchInput,
  OrderSaveInput,
  OrderServiceContact,
  OrderSettlementMode,
  ServiceItem,
} from "./types";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100";
const labelClass = "block text-sm font-medium text-slate-700";
const defaultServices: ServiceItem[] = ["feed", "water", "litter", "photo"];
function optionalValue(value: string): string | null {
  return value.trim() || null;
}

function sameItems(left: ServiceItem[], right: ServiceItem[]): boolean {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function emptyContact(name = ""): OrderServiceContact {
  return {
    name,
    wechat_name: null,
    phone: null,
    community: null,
    address: null,
    building: null,
    unit: null,
    room: null,
    access_method: null,
    community_access_method: null,
    building_access_method: null,
    access_info: null,
    key_status: null,
    key_code: null,
    notes: null,
    is_repeat_customer: false,
    latitude: null,
    longitude: null,
    geocode_status: null,
  };
}

interface OrderFormProps {
  options: OrderFormOptions;
  initial?: OrderDetail;
  onCancel: () => void;
  onSave: (payload: OrderSaveInput) => Promise<void>;
}

export function OrderForm({ options, initial, onCancel, onSave }: OrderFormProps) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const initialDates = initial?.service_schedule.map((entry) => entry.service_date) ?? [];
  const firstDate = initialDates[0] ?? localDateValue();
  const [serviceContact, setServiceContact] = useState<OrderServiceContact>(
    initial?.service_contact ?? emptyContact(),
  );
  const [sourceCustomerId, setSourceCustomerId] = useState<number | null>(
    initial?.source_customer_id ?? null,
  );
  const [catSnapshot, setCatSnapshot] = useState(initial?.cat_snapshot ?? []);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [catCount, setCatCount] = useState(initial?.cat_count ?? 1);
  const [selectedDates, setSelectedDates] = useState<string[]>(initialDates);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseLocalDate(firstDate);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>(initial?.service_items ?? defaultServices);
  const [unitPrice, setUnitPrice] = useState(initial?.unit_price ?? options.default_base_price);
  const [settlementMode, setSettlementMode] = useState<OrderSettlementMode>(
    initial?.settlement_mode ?? "daily",
  );
  const [adjustmentType, setAdjustmentType] = useState<OrderAdjustmentType>(
    initial?.amount_adjustment.type ?? "none",
  );
  const [adjustmentAmount, setAdjustmentAmount] = useState(
    initial?.amount_adjustment.amount ?? "0.00",
  );
  const [adjustmentReason, setAdjustmentReason] = useState(
    initial?.amount_adjustment.reason ?? "",
  );
  const [adjustmentDate, setAdjustmentDate] = useState(
    initial?.amount_adjustment.service_date ?? firstDate,
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [smartAddressText, setSmartAddressText] = useState("");
  const [addressParseMessage, setAddressParseMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftSnapshot = JSON.stringify({ serviceContact, sourceCustomerId, catSnapshot, catCount, selectedDates, serviceItems, unitPrice, settlementMode, adjustmentType, adjustmentAmount, adjustmentReason, adjustmentDate, notes });
  const [originalSnapshot] = useState(draftSnapshot);
  const draftDirty = draftSnapshot !== originalSnapshot;
  const confirmDiscard = useUnsavedChanges(draftDirty && !saving);
  const close = () => { if (!saving && confirmDiscard()) onCancel(); };

  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const adjustmentValue = adjustmentType === "none" ? 0 : Number(adjustmentAmount) || 0;
  const initialVisitCounts = useMemo(
    () => new Map(initial?.service_schedule.map((entry) => [entry.service_date, entry.visit_count]) ?? []),
    [initial],
  );
  const dailyAmounts = selectedDates.map((serviceDate) => {
    const visitCount = scheduleDirty ? 1 : (initialVisitCounts.get(serviceDate) ?? 1);
    const baseAmount = (Number(unitPrice) || 0) * visitCount;
    const adjustment = serviceDate === adjustmentDate
      ? (adjustmentType === "surcharge" ? adjustmentValue : adjustmentType === "discount" ? -adjustmentValue : 0)
      : 0;
    return { serviceDate, visitCount, baseAmount, finalAmount: Math.max(baseAmount + adjustment, 0) };
  });
  const baseTotal = dailyAmounts.reduce((sum, item) => sum + item.baseAmount, 0);
  const total = dailyAmounts.reduce((sum, item) => sum + item.finalAmount, 0);
  const historyLocked = Boolean(initial?.has_payment_history);

  function selectCustomer(customerId: number) {
    const customer = options.customers.find((entry) => entry.id === customerId);
    if (!customer) return;
    setSourceCustomerId(customer.id);
    setServiceContact({
      name: customer.name,
      wechat_name: customer.wechat_name,
      phone: customer.phone,
      community: customer.community,
      address: customer.address,
      building: customer.building,
      unit: customer.unit,
      room: customer.room,
      access_method: customer.access_method,
      community_access_method: customer.community_access_method,
      building_access_method: customer.building_access_method,
      access_info: customer.access_info,
      key_status: customer.key_status,
      key_code: customer.key_code,
      notes: customer.notes,
      is_repeat_customer: customer.is_repeat_customer,
      latitude: customer.latitude,
      longitude: customer.longitude,
      geocode_status: customer.geocode_status,
    });
    const snapshots = customer.cats.map((cat) => ({
      ...cat,
      source_cat_id: cat.id,
    }));
    setCatSnapshot(snapshots);
    if (snapshots.length > 0) setCatCount(snapshots.length);
    setProfilePickerOpen(false);
  }

  function updateContact(
    field: keyof OrderServiceContact,
    value: string | boolean | null,
  ) {
    setServiceContact((current) => ({
      ...current,
      [field]: value,
      ...(
        ["community_access_method", "building_access_method"].includes(field)
          ? { access_method: null }
          : {}
      ),
      ...(
        ["community", "address", "building"].includes(field)
          ? { latitude: null, longitude: null, geocode_status: null }
          : {}
      ),
    }));
  }

  function handleSmartAddressPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text");
    const parsed = parseOrderAddress(pasted);
    setSmartAddressText(pasted);
    setServiceContact((current) => {
      const routeChanged = (
        current.community !== parsed.community
        || current.address !== parsed.address
        || current.building !== parsed.building
      );
      return {
        ...current,
        community: parsed.community,
        address: parsed.address,
        building: parsed.building,
        unit: parsed.unit,
        room: parsed.room,
        ...(routeChanged
          ? { latitude: null, longitude: null, geocode_status: null }
          : {}),
      };
    });
    setAddressParseMessage(
      parsed.recognizedParts > 0
        ? "已自动拆分地址，请核对后再保存。"
        : "未识别到可靠的住宅层级，原文已保留在详细地址中。",
    );
  }

  function stepUnitPrice(delta: number) {
    const current = Number(unitPrice);
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    setUnitPrice((Math.round(next * 100) / 100).toFixed(2));
  }

  function handleUnitPriceKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    stepUnitPrice(event.key === "ArrowUp" ? 5 : -5);
  }

  function toggleDate(date: Date) {
    if (historyLocked) return;
    const value = localDateValue(date);
    setSelectedDates((current) => {
      const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort();
      if (!next.includes(adjustmentDate)) setAdjustmentDate(next[0] ?? "");
      return next;
    });
    setScheduleDirty(true);
  }

  function toggleService(item: ServiceItem) {
    setServiceItems((current) => current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = serviceContact.name.trim();
    if (!name) {
      setError("请填写联系人名称。");
      return;
    }
    if (!initial && selectedDates.length === 0) {
      setError("请在日历中至少选择一个服务日期。");
      return;
    }
    if (scheduleDirty && selectedDates.length === 0) {
      setError("服务日期不能为空。");
      return;
    }
    if (serviceItems.length === 0) {
      setError("请至少选择一个服务事项。");
      return;
    }
    if (!unitPrice.trim() || !Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0) {
      setError("每次价格必须是大于或等于 0 的数字。");
      return;
    }
    if (adjustmentType !== "none") {
      if (!adjustmentDate || !selectedDates.includes(adjustmentDate)) {
        setError("请选择订单内的金额变动服务日期。");
        return;
      }
      if (!Number.isFinite(Number(adjustmentAmount)) || Number(adjustmentAmount) <= 0) {
        setError("加收或减免金额必须大于 0。");
        return;
      }
      if (!adjustmentReason.trim()) {
        setError("请填写加收或减免原因。");
        return;
      }
      if (adjustmentType === "discount" && Number(adjustmentAmount) > Number(unitPrice)) {
        setError("减免后当日应收不能小于 0。");
        return;
      }
    }

    const amountAdjustment: OrderAmountAdjustment = adjustmentType === "none"
      ? { type: "none", amount: "0.00", reason: null, service_date: null }
      : {
          type: adjustmentType,
          amount: Number(adjustmentAmount).toFixed(2),
          reason: adjustmentReason.trim(),
          service_date: adjustmentDate,
        };

    let payload: OrderCreateInput | OrderPatchInput;
    if (!initial) {
      payload = {
        ...(sourceCustomerId ? { source_customer_id: sourceCustomerId } : {}),
        service_contact: { ...serviceContact, name },
        cat_snapshot: catSnapshot,
        cat_count: catCount,
        service_dates: selectedDates,
        service_items: serviceItems,
        unit_price: Number(unitPrice).toFixed(2),
        settlement_mode: settlementMode,
        amount_adjustment: amountAdjustment,
        notes: optionalValue(notes),
      } satisfies OrderCreateInput;
    } else {
      const patch: OrderPatchInput = {};
      if (sourceCustomerId !== initial.source_customer_id) patch.source_customer_id = sourceCustomerId;
      const nextContact = { ...serviceContact, name };
      if (JSON.stringify(nextContact) !== JSON.stringify(initial.service_contact)) patch.service_contact = nextContact;
      if (JSON.stringify(catSnapshot) !== JSON.stringify(initial.cat_snapshot)) patch.cat_snapshot = catSnapshot;
      if (catCount !== initial.cat_count) patch.cat_count = catCount;
      if (scheduleDirty) patch.service_dates = selectedDates;
      if (!sameItems(serviceItems, initial.service_items)) patch.service_items = serviceItems;
      if (Number(unitPrice).toFixed(2) !== Number(initial.unit_price).toFixed(2)) patch.unit_price = Number(unitPrice).toFixed(2);
      if (patch.unit_price !== undefined && initial.has_payment_history) {
        patch.expected_financial_revision = initial.financial_revision;
      }
      if (settlementMode !== initial.settlement_mode) patch.settlement_mode = settlementMode;
      if (JSON.stringify(amountAdjustment) !== JSON.stringify(initial.amount_adjustment)) patch.amount_adjustment = amountAdjustment;
      if (optionalValue(notes) !== initial.notes) patch.notes = optionalValue(notes);
      payload = patch;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "订单保存失败，请重试。");
      setSaving(false);
    }
  }

  const historicalMultipleVisits = initial?.service_schedule.some((entry) => entry.visit_count > 1);

  return (
    <ModalSurface labelledBy="order-form-title" onClose={close} busy={saving} className="max-w-6xl">
        <form className="contents" onSubmit={handleSubmit}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-7 sm:py-5">
            <div><h2 id="order-form-title" className="text-xl font-semibold tracking-tight text-[var(--cc-text)]">{initial ? `编辑订单 #${initial.id}` : "新建订单"}</h2><p className="mt-1 text-sm text-slate-500">选择具体上门日期，每个日期生成一次服务任务。</p></div>
            <button type="button" className="cc-icon-button" onClick={close} disabled={saving} aria-label="关闭订单表单"><X size={18} /></button>
          </header>

          <div className="cc-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {error ? <p className="cc-alert cc-alert--danger mb-5" role="alert">{error}</p> : null}
            {historicalMultipleVisits && !scheduleDirty ? <p className="cc-alert cc-alert--warning mb-5">这是历史多次服务订单。只要不重新点选日历，原有每日多次安排就会完整保留。</p> : null}
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-7">
                <section aria-labelledby="order-customer-fields">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h3 id="order-customer-fields" className="text-sm font-semibold text-slate-950">订单联系人与上门信息</h3><p className="mt-1 text-xs text-slate-500">这些内容会固定保存在订单中，不受客户档案后续修改影响。</p></div>
                    <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => setProfilePickerOpen((open) => !open)}><BookUser size={15} />从客户档案带入</button>
                  </div>
                  {profilePickerOpen ? <div className="mt-3 rounded-2xl border border-brand-200 bg-brand-50/60 p-3"><label className={labelClass}>选择档案（可选）<select className={inputClass} defaultValue="" onChange={(event) => { if (event.target.value) selectCustomer(Number(event.target.value)); }}><option value="" disabled>请选择客户档案</option>{options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.address ? ` · ${customer.address}` : ""}</option>)}</select></label><p className="mt-2 text-xs text-brand-800">带入后仍可修改本订单内容；不会反向修改客户档案。</p></div> : null}
                  <label className={`${labelClass} mt-4`}>粘贴地址智能填写
                    <textarea
                      className={`${inputClass} min-h-20 resize-y`}
                      value={smartAddressText}
                      placeholder="把网购地址粘贴到这里；缺少地区时默认补深圳市龙岗区"
                      onChange={(event) => setSmartAddressText(event.target.value)}
                      onPaste={handleSmartAddressPaste}
                    />
                  </label>
                  <p className="mt-2 text-xs leading-5 text-slate-500">粘贴会补齐缺失的深圳市龙岗区并替换下面五个地址字段；明确写了其他地区时保留原文。只在本页本地解析，不会调用第三方地址识别服务。</p>
                  {addressParseMessage ? <p className="cc-alert mt-2 border border-blue-200 bg-blue-50 text-blue-800">{addressParseMessage}</p> : null}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className={labelClass}>联系人名称 <span className="text-red-600">*</span><input data-autofocus ref={firstInputRef} className={inputClass} value={serviceContact.name} placeholder="直接输入名称，不需要下拉确认" onChange={(event) => updateContact("name", event.target.value)} required /></label>
                    <label className={labelClass}>联系电话<input className={inputClass} value={serviceContact.phone ?? ""} onChange={(event) => updateContact("phone", optionalValue(event.target.value))} /></label>
                    <label className={labelClass}>微信名<input className={inputClass} value={serviceContact.wechat_name ?? ""} onChange={(event) => updateContact("wechat_name", optionalValue(event.target.value))} /></label>
                    <label className={labelClass}>小区<input className={inputClass} value={serviceContact.community ?? ""} onChange={(event) => updateContact("community", optionalValue(event.target.value))} /></label>
                    <label className={`${labelClass} sm:col-span-2`}>详细地址<input className={inputClass} value={serviceContact.address ?? ""} placeholder="未填写时订单仍可保存，但不能自动规划路线" onChange={(event) => updateContact("address", optionalValue(event.target.value))} /></label>
                    <label className={labelClass}>楼栋<input className={inputClass} value={serviceContact.building ?? ""} onChange={(event) => updateContact("building", optionalValue(event.target.value))} /></label>
                    <label className={labelClass}>单元 / 房间<input className={inputClass} value={[serviceContact.unit, serviceContact.room].filter(Boolean).join(" / ")} placeholder="例如 2 单元 / 1201" onChange={(event) => { const [unit, room] = event.target.value.split("/"); updateContact("unit", optionalValue(unit ?? "")); updateContact("room", optionalValue(room ?? "")); }} /></label>
                    <label className={labelClass}>小区门禁<select className={inputClass} value={serviceContact.community_access_method ?? ""} onChange={(event) => updateContact("community_access_method", optionalValue(event.target.value))}><option value="">请选择</option>{optionsWithLegacy(accessMethodOptions, serviceContact.community_access_method).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className={labelClass}>楼下门禁<select className={inputClass} value={serviceContact.building_access_method ?? ""} onChange={(event) => updateContact("building_access_method", optionalValue(event.target.value))}><option value="">请选择</option>{optionsWithLegacy(accessMethodOptions, serviceContact.building_access_method).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className={labelClass}>钥匙状态<select className={inputClass} value={serviceContact.key_status ?? ""} onChange={(event) => updateContact("key_status", optionalValue(event.target.value))}><option value="">请选择</option>{optionsWithLegacy(keyStatusOptions, serviceContact.key_status).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className={labelClass}>钥匙编号<input className={inputClass} value={serviceContact.key_code ?? ""} onChange={(event) => updateContact("key_code", optionalValue(event.target.value))} /></label>
                    {serviceContact.access_method ? <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-600 sm:col-span-2">历史门禁方式（待分类）：{serviceContact.access_method}</p> : null}
                    <label className={`${labelClass} sm:col-span-2`}>门禁与入户说明<textarea className={`${inputClass} min-h-20 resize-y`} value={serviceContact.access_info ?? ""} onChange={(event) => updateContact("access_info", optionalValue(event.target.value))} /></label>
                    <label className={`${labelClass} sm:col-span-2`}>客户备注<textarea className={`${inputClass} min-h-20 resize-y`} value={serviceContact.notes ?? ""} onChange={(event) => updateContact("notes", optionalValue(event.target.value))} /></label>
                  </div>
                  {!serviceContact.address && !serviceContact.community ? <p className="cc-alert cc-alert--warning mt-4">尚未填写地址：订单可以保存，但路线图无法自动定位或规划该任务。</p> : null}
                  <label className={`${labelClass} mt-4 max-w-48`}>猫咪数量
                    <input className={inputClass} type="number" min={1} max={50} value={catCount} onChange={(event) => { const next = Math.min(50, Math.max(1, Number(event.target.value) || 1)); setCatCount(next); if (catSnapshot.length > 0 && catSnapshot.length !== next) setCatSnapshot([]); }} disabled={historyLocked} required />
                  </label>
                  <p className="mt-2 text-xs leading-5 text-slate-500">未从档案带入时只记录数量；带入的猫咪详情会作为订单执行快照保存。</p>
                </section>

                <section aria-labelledby="order-schedule-fields">
                  <div className="flex items-center justify-between gap-3"><div><h3 id="order-schedule-fields" className="text-sm font-semibold text-slate-950">服务日期</h3><p className="mt-1 text-xs text-slate-500">点击日期添加，再次点击取消；可以选择不连续日期。</p></div><span className="shrink-0 whitespace-nowrap rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">已选 {selectedDates.length} 天</span></div>
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between"><button type="button" className="cc-icon-button" aria-label="上个月" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><p className="text-sm font-semibold">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</p><button type="button" className="cc-icon-button" aria-label="下个月" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div>
                    <CalendarMonthGrid
                      month={visibleMonth}
                      weekStartsOn={1}
                      fixedWeeks
                      className="mt-3 grid grid-cols-7 gap-1 text-center"
                      renderDay={(date) => <button type="button" aria-pressed={selectedSet.has(localDateValue(date))} className={`aspect-square min-h-10 w-full rounded-xl text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${selectedSet.has(localDateValue(date)) ? "bg-brand-700 text-white shadow-sm" : "text-slate-700 hover:bg-brand-50 hover:text-brand-700"}`} onClick={() => toggleDate(date)} disabled={historyLocked}>{date.getDate()}</button>}
                    />
                  </div>
                </section>

                <fieldset aria-labelledby="order-service-fields">
                  <legend id="order-service-fields" className="text-sm font-semibold text-slate-950">服务内容</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">{serviceItemOptions.map((item) => <label key={item.value} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm transition ${serviceItems.includes(item.value) ? "border-brand-200 bg-brand-50 text-brand-900" : "border-slate-200 text-slate-700"}`}><input type="checkbox" checked={serviceItems.includes(item.value)} onChange={() => toggleService(item.value)} />{item.label}</label>)}</div>
                  <label className={`${labelClass} mt-4`}>服务备注<textarea className={`${inputClass} min-h-24 resize-y`} rows={3} maxLength={4000} value={notes} placeholder="例如喂食用量、猫咪习惯或需要特别留意的事项" onChange={(event) => setNotes(event.target.value)} /></label>
                </fieldset>

              </div>

              <aside className="h-fit rounded-2xl border border-brand-100 bg-brand-50/60 p-4 lg:sticky lg:top-0" aria-label="金额预览">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Calculator size={16} />自动计算</h3>
                <label className={`${labelClass} mt-4`}>每次价格（元）
                  <span className="mt-1.5 flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                    <input className="min-h-16 min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-slate-950 outline-none" type="text" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} onKeyDown={handleUnitPriceKeyDown} required />
                    <span className="flex w-11 shrink-0 flex-col border-l border-slate-200">
                      <button type="button" className="flex h-8 items-center justify-center text-slate-600 hover:bg-brand-50 hover:text-brand-700" aria-label="每次价格增加 5 元" onClick={() => stepUnitPrice(5)}><ChevronUp size={18} /></button>
                      <button type="button" className="flex h-8 items-center justify-center border-t border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-700" aria-label="每次价格减少 5 元" onClick={() => stepUnitPrice(-5)}><ChevronDown size={18} /></button>
                    </span>
                  </span>
                </label>
                <label className={`${labelClass} mt-3`}>结算方式<select className={inputClass} value={settlementMode} onChange={(event) => setSettlementMode(event.target.value as OrderSettlementMode)} disabled={historyLocked}><option value="daily">按日期日结</option><option value="order_total">整单结算</option></select></label>
                <label className={`${labelClass} mt-3`}>金额变动<select className={inputClass} value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value as OrderAdjustmentType)} disabled={historyLocked}><option value="none">无变动</option><option value="surcharge">加收</option><option value="discount">减免</option></select></label>
                {adjustmentType !== "none" ? <div className="mt-3 space-y-3"><label className={labelClass}>服务日期<select className={inputClass} value={adjustmentDate} onChange={(event) => setAdjustmentDate(event.target.value)} disabled={historyLocked}>{selectedDates.map((date) => <option key={date} value={date}>{date}</option>)}</select></label><label className={labelClass}>变动金额（元）<input className={inputClass} type="number" min="0.01" step="0.01" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} disabled={historyLocked} /></label><label className={labelClass}>原因<input className={inputClass} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} maxLength={1000} disabled={historyLocked} /></label></div> : null}
                <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">服务日期</dt><dd>{selectedDates.length} 天</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">基础应收</dt><dd>¥{money(baseTotal)}</dd></div>{adjustmentType !== "none" ? <div className="flex justify-between gap-4"><dt className="text-slate-500">{adjustmentType === "surcharge" ? "加收" : "减免"}</dt><dd>{adjustmentType === "surcharge" ? "+" : "-"}¥{money(adjustmentValue)}</dd></div> : null}</dl>
                {dailyAmounts.length > 0 ? <div className="mt-4 space-y-1.5 rounded-xl bg-white/70 p-3" aria-label="每日金额"><p className="text-xs font-semibold text-slate-700">每日金额</p>{dailyAmounts.map((item) => <div key={item.serviceDate} className="flex justify-between gap-3 text-xs text-slate-600"><span>{item.serviceDate}{item.visitCount > 1 ? ` · ${item.visitCount} 次` : ""}</span><span>¥{money(item.finalAmount)}</span></div>)}</div> : null}
                <div className="mt-4 border-t border-brand-200 pt-4"><p className="text-xs text-slate-500">最终应收</p><p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--cc-text)]">¥{money(total)}</p><p className="mt-2 text-xs leading-5 text-slate-500">每次基础 ¥{money(Number(unitPrice) || 0)}；指定日期的加收或减免只计入当天。</p></div>
                {historyLocked ? <p className="cc-alert cc-alert--warning mt-4">订单已有收款历史；可以调整每次价格，服务日期、结算方式、金额变动和猫咪数量保持锁定。</p> : null}
              </aside>
            </div>
          </div>

          <footer className="cc-order-footer flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7"><div className="mr-auto"><p className="text-sm font-semibold">{selectedDates.length} 天 · 合计 ¥{money(total)}</p><p className="cc-save-state">{draftDirty ? "有未保存的修改" : "填写后保存订单"}</p></div><button type="button" className="cc-button cc-button--secondary" onClick={close} disabled={saving}>取消</button><button type="submit" className="cc-button cc-button--primary" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : null}{saving ? "保存中…" : initial ? "保存订单" : "创建订单"}</button></footer>
        </form>
    </ModalSurface>
  );
}
