import {
  AlertCircle,
  Archive,
  Ban,
  ClipboardCopy,
  Clock3,
  ExternalLink,
  FileCheck2,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/ui/PageHeader";
import { MultiDateCalendar } from "../../components/ui/MultiDateCalendar";
import { expandDateRange } from "../../components/ui/calendarDates";
import { customerAddress } from "../../lib/customerDisplay";
import {
  createIntakeToken,
  decideIntakeSubmission,
  getIntakeSubmission,
  listIntakeSubmissions,
  listIntakeTokens,
  saveIntakeReviewDraft,
  updateIntakeToken,
  updateIntakeSubmissionListState,
} from "./api";
import { emptyCat, serviceItemOptions } from "./constants";
import type {
  FormSubmissionStatus,
  FormTokenStatus,
  IntakeAuditEvent,
  IntakeDecisionMode,
  IntakeDraftPayload,
  IntakeSubmissionDetail,
  IntakeSubmissionSummary,
  IntakeTokenRead,
} from "./types";

const tokenStatusLabels: Record<FormTokenStatus, string> = {
  active: "可填写",
  disabled: "已关闭",
  expired: "已过期",
};

const submissionStatusLabels: Record<FormSubmissionStatus, string> = {
  draft: "草稿",
  submitted: "待审核",
  reviewed: "已审核",
  processing: "处理中",
  archived_customer: "已归档客户",
  archived_order: "已归档订单",
  voided: "已作废",
  redacted: "已清理",
  converted: "已归档订单",
  expired: "已过期",
};

const auditEventLabels: Record<string, string> = {
  draft_saved: "客户保存草稿",
  submitted: "客户提交资料",
  review_saved: "保存审核稿",
  reviewed: "标记为已审核",
  processing_claimed: "云端提交已认领",
  processing_reclaimed: "处理租约已续领",
  archived_customer: "仅归档客户",
  archived_order: "归档并生成订单",
  voided: "作废提交",
  completed_customer: "云端确认客户归档",
  completed_order: "云端确认订单归档",
  completed_void: "云端确认作废",
  redacted: "云端敏感资料已清理",
};

const auditActorLabels: Record<string, string> = {
  customer: "客户",
  admin: "本机后台",
  relay: "云端中转",
  system: "定时清理",
};

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function valueOrDash(value: string | null | undefined): string {
  return value || "—";
}

function replaceSubmission(
  items: IntakeSubmissionSummary[],
  detail: IntakeSubmissionDetail,
): IntakeSubmissionSummary[] {
  return items.map((item) => item.id === detail.id ? {
    id: detail.id,
    submission_uuid: detail.submission_uuid,
    status: detail.status,
    customer_name: detail.customer_name,
    community: detail.community,
    cat_count: detail.cat_count,
    start_date: detail.start_date,
    end_date: detail.end_date,
    service_dates: detail.service_dates,
    submitted_at: detail.submitted_at,
    updated_at: detail.updated_at,
    revision: detail.revision,
    removed_at: detail.removed_at,
  } : item);
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{valueOrDash(value)}</dd></div>;
}

function PayloadDetail({ payload }: { payload: IntakeDraftPayload }) {
  const labels = new Map(serviceItemOptions.map((item) => [item.value, item.label]));
  const dates = payload.service.service_dates ?? [];
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">客户资料</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <DetailRow label="名称" value={payload.customer.name} />
          <DetailRow label="手机号" value={payload.customer.phone} />
          <DetailRow label="微信" value={payload.customer.wechat_name} />
          <DetailRow label="客户类型" value={payload.customer.is_repeat_customer ? "老客户" : "新客户"} />
          <div className="sm:col-span-2 xl:col-span-3"><DetailRow label="地址" value={customerAddress(payload.customer)} /></div>
        </dl>
      </section>
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} />门禁与钥匙</h3><span className="text-xs font-medium text-amber-700">敏感信息，仅本地后台可见</span></div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <DetailRow label="门禁方式" value={payload.customer.access_method} />
          <DetailRow label="进门说明" value={payload.customer.access_info} />
          <DetailRow label="钥匙状态 / 编号" value={[payload.customer.key_status, payload.customer.key_code].filter(Boolean).join(" / ")} />
        </dl>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">猫咪资料（{payload.cats.length} 只）</h3>
        <div className="mt-3 space-y-3">{payload.cats.map((cat, index) => <article key={index} className="rounded-lg bg-slate-50 p-3"><h4 className="text-sm font-semibold">{cat.name || `猫咪 ${index + 1}`}</h4><dl className="mt-3 grid gap-3 sm:grid-cols-2"><DetailRow label="性别 / 年龄 / 品种" value={[cat.gender, cat.age, cat.breed].filter(Boolean).join(" / ")} /><DetailRow label="猫砂" value={cat.litter_type} /><DetailRow label="主食与偏好" value={[cat.food, cat.food_preference].filter(Boolean).join("；")} /><DetailRow label="性格" value={cat.personality} /><DetailRow label="喂药" value={cat.medication_required ? cat.medication_notes || "需要喂药（未补充说明）" : "不需要"} /><DetailRow label="特殊情况" value={cat.special_notes} /><div className="sm:col-span-2"><DetailRow label="服务注意事项" value={cat.service_notes} /></div></dl></article>)}</div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">服务计划</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2"><DetailRow label="服务日期" value={dates.length ? `${dates.length} 天：${dates.join("、")}` : `${valueOrDash(payload.service.start_date)} 至 ${valueOrDash(payload.service.end_date)}`} />{dates.length ? null : <DetailRow label="每日次数（旧记录）" value={payload.service.visits_per_day ? `${payload.service.visits_per_day} 次` : null} />}<DetailRow label="服务事项" value={payload.service.service_items.map((item) => labels.get(item) || item).join("、")} /><DetailRow label="补充备注" value={payload.notes} /><div className="sm:col-span-2"><DetailRow label="客户备注" value={payload.customer.notes} /></div></dl>
      </section>
    </div>
  );
}

function AuditTimeline({ events }: { events: IntakeAuditEvent[] }) {
  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="audit-timeline-title">
      <h3 id="audit-timeline-title" className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} />处理记录</h3>
      {events.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无审计事件。</p> : <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{events.map((event) => <li key={event.id} className="relative text-sm"><span className="absolute -left-[1.2rem] top-1.5 h-2 w-2 rounded-full bg-orange-500" /><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium text-slate-800">{auditEventLabels[event.event_type] || event.event_type}</span><time className="text-xs text-slate-500">{dateTime(event.created_at)}</time></div><p className="mt-1 text-xs text-slate-500">{auditActorLabels[event.actor] || event.actor}{event.revision_number !== null ? ` · 版本 ${event.revision_number}` : ""}{event.details.customer_id ? ` · 客户 #${event.details.customer_id}` : ""}{event.details.order_id ? ` · 订单 #${event.details.order_id}` : ""}</p></li>)}</ol>}
    </section>
  );
}

const reviewInputClass = "mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function mergeNote(current: string | null, source: string): string {
  if (!current) return source;
  if (current.includes(source)) return current;
  return `${current}\n${source}`;
}

function editableReviewPayload(detail: IntakeSubmissionDetail): IntakeDraftPayload {
  if (detail.review_payload) return detail.review_payload;
  return { ...detail.payload, notes: null };
}

function ReviewEditor({ payload, sourceNote, unitPrice, disabled, onPayloadChange, onUnitPriceChange }: {
  payload: IntakeDraftPayload;
  sourceNote: string | null;
  unitPrice: string;
  disabled: boolean;
  onPayloadChange: (payload: IntakeDraftPayload) => void;
  onUnitPriceChange: (value: string) => void;
}) {
  function customer(field: keyof IntakeDraftPayload["customer"], value: string | boolean | null) {
    onPayloadChange({ ...payload, customer: { ...payload.customer, [field]: value } });
  }
  function customerFields(fields: Partial<IntakeDraftPayload["customer"]>) {
    onPayloadChange({ ...payload, customer: { ...payload.customer, ...fields } });
  }
  function service(field: keyof IntakeDraftPayload["service"], value: IntakeDraftPayload["service"][keyof IntakeDraftPayload["service"]]) {
    onPayloadChange({ ...payload, service: { ...payload.service, [field]: value } });
  }
  function cat(index: number, field: keyof IntakeDraftPayload["cats"][number], value: string | boolean | null) {
    onPayloadChange({ ...payload, cats: payload.cats.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) });
  }
  function copySourceNote(target: "customer" | "order") {
    if (!sourceNote) return;
    if (target === "customer") {
      customer("notes", mergeNote(payload.customer.notes, sourceNote));
      return;
    }
    onPayloadChange({ ...payload, notes: mergeNote(payload.notes, sourceNote) });
  }
  const optional = (value: string) => value.trim() || null;
  const serviceDates = payload.service.service_dates
    ?? expandDateRange(payload.service.start_date, payload.service.end_date);
  return <div className="space-y-4">
    <section className="rounded-lg border border-orange-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">后台审核稿</h3><p className="mt-1 text-xs text-slate-500">客户原始提交不会被覆盖；这里的修改只用于最终落档和生成订单。</p></div><label className="text-sm font-semibold text-orange-900">每次价格（元）<input className={`${reviewInputClass} w-40 border-orange-300`} type="number" min="0" step="0.01" value={unitPrice} disabled={disabled} onChange={(event) => onUnitPriceChange(event.target.value)} /></label></div>
      {sourceNote ? <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-semibold text-blue-900">客户填写的待审核备注</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-950">{sourceNote}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-900 disabled:opacity-50" disabled={disabled} onClick={() => copySourceNote("customer")}>填入客户长期备注</button>
          <button type="button" className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-900 disabled:opacity-50" disabled={disabled} onClick={() => copySourceNote("order")}>填入本次订单备注</button>
        </div>
      </div> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">联系人名称<input className={reviewInputClass} value={payload.customer.name ?? ""} disabled={disabled} onChange={(event) => customer("name", event.target.value)} /></label>
        <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={payload.customer.is_repeat_customer} disabled={disabled} onChange={(event) => customer("is_repeat_customer", event.target.checked)} />标记为老客户</label>
        <label className="text-xs font-medium text-slate-600">电话<input className={reviewInputClass} value={payload.customer.phone ?? ""} disabled={disabled} onChange={(event) => customer("phone", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">微信名<input className={reviewInputClass} value={payload.customer.wechat_name ?? ""} disabled={disabled} onChange={(event) => customer("wechat_name", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">小区<input className={reviewInputClass} value={payload.customer.community ?? ""} disabled={disabled} onChange={(event) => customer("community", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">详细地址<input className={reviewInputClass} value={payload.customer.address ?? ""} disabled={disabled} onChange={(event) => customer("address", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">楼栋 / 单元 / 房间<input className={reviewInputClass} value={[payload.customer.building, payload.customer.unit, payload.customer.room].filter(Boolean).join(" / ")} disabled={disabled} onChange={(event) => { const [building, unit, room] = event.target.value.split("/"); customerFields({ building: optional(building ?? ""), unit: optional(unit ?? ""), room: optional(room ?? "") }); }} /></label>
        <label className="text-xs font-medium text-slate-600">入户方式<input className={reviewInputClass} value={payload.customer.access_method ?? ""} disabled={disabled} onChange={(event) => customer("access_method", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">门禁说明<textarea className={`${reviewInputClass} min-h-20`} value={payload.customer.access_info ?? ""} disabled={disabled} onChange={(event) => customer("access_info", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">钥匙状态<input className={reviewInputClass} value={payload.customer.key_status ?? ""} disabled={disabled} onChange={(event) => customer("key_status", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">钥匙编号<input className={reviewInputClass} value={payload.customer.key_code ?? ""} disabled={disabled} onChange={(event) => customer("key_code", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">客户备注<textarea className={`${reviewInputClass} min-h-20`} value={payload.customer.notes ?? ""} disabled={disabled} onChange={(event) => customer("notes", optional(event.target.value))} /></label>
      </div>
    </section>
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">猫咪资料</h3><button type="button" className="cc-button cc-button--secondary px-3 py-1.5 text-xs" disabled={disabled} onClick={() => onPayloadChange({ ...payload, cats: [...payload.cats, emptyCat()] })}><Plus size={14} />添加猫咪</button></div>
      <div className="mt-3 space-y-3">{payload.cats.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">客户未填写猫咪，可由后台添加。</p> : payload.cats.map((item, index) => <div key={index} className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
        <div className="flex items-end gap-2"><label className="grow text-xs font-medium text-slate-600">猫咪名称<input className={reviewInputClass} value={item.name ?? ""} disabled={disabled} onChange={(event) => cat(index, "name", optional(event.target.value))} /></label><button type="button" className="mb-2 text-red-700" aria-label={`移除猫咪 ${index + 1}`} disabled={disabled} onClick={() => onPayloadChange({ ...payload, cats: payload.cats.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={15} /></button></div>
        <label className="text-xs font-medium text-slate-600">性别<input className={reviewInputClass} value={item.gender ?? ""} disabled={disabled} onChange={(event) => cat(index, "gender", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">年龄<input className={reviewInputClass} type="number" min="0" step="0.1" value={item.age ?? ""} disabled={disabled} onChange={(event) => cat(index, "age", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">品种<input className={reviewInputClass} value={item.breed ?? ""} disabled={disabled} onChange={(event) => cat(index, "breed", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">主食<input className={reviewInputClass} value={item.food ?? ""} disabled={disabled} onChange={(event) => cat(index, "food", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">饮食偏好<input className={reviewInputClass} value={item.food_preference ?? ""} disabled={disabled} onChange={(event) => cat(index, "food_preference", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600">猫砂类型<input className={reviewInputClass} value={item.litter_type ?? ""} disabled={disabled} onChange={(event) => cat(index, "litter_type", optional(event.target.value))} /></label>
        <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={item.medication_required} disabled={disabled} onChange={(event) => cat(index, "medication_required", event.target.checked)} />需要用药</label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">性格<textarea className={`${reviewInputClass} min-h-16`} value={item.personality ?? ""} disabled={disabled} onChange={(event) => cat(index, "personality", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">用药说明<textarea className={`${reviewInputClass} min-h-16`} value={item.medication_notes ?? ""} disabled={disabled} onChange={(event) => cat(index, "medication_notes", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">特殊注意事项<textarea className={`${reviewInputClass} min-h-16`} value={item.special_notes ?? ""} disabled={disabled} onChange={(event) => cat(index, "special_notes", optional(event.target.value))} /></label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">服务注意事项<textarea className={`${reviewInputClass} min-h-16`} value={item.service_notes ?? ""} disabled={disabled} onChange={(event) => cat(index, "service_notes", optional(event.target.value))} /></label>
      </div>)}</div>
    </section>
    <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="text-sm font-semibold">服务计划</h3><div className="mt-3 max-w-xl"><MultiDateCalendar values={serviceDates} disabled={disabled} title="选择预计上门日期" onChange={(dates) => onPayloadChange({ ...payload, service: { ...payload.service, service_dates: dates, start_date: null, end_date: null, visits_per_day: null } })} /></div>{payload.service.service_dates === null && payload.service.visits_per_day ? <p className="mt-2 text-xs text-amber-700">旧记录当前仍按每天 {payload.service.visits_per_day} 次处理；修改日历后将转换为每个选中日期一次。</p> : null}<fieldset className="mt-4"><legend className="text-xs font-medium text-slate-600">服务事项</legend><div className="mt-2 flex flex-wrap gap-2">{serviceItemOptions.map((option) => <label key={option.value} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><input className="mr-2" type="checkbox" checked={payload.service.service_items.includes(option.value)} disabled={disabled} onChange={() => service("service_items", payload.service.service_items.includes(option.value) ? payload.service.service_items.filter((item) => item !== option.value) : [...payload.service.service_items, option.value])} />{option.label}</label>)}</div></fieldset><label className="mt-4 block text-xs font-medium text-slate-600">本次订单备注<textarea className={`${reviewInputClass} min-h-20`} value={payload.notes ?? ""} disabled={disabled} onChange={(event) => onPayloadChange({ ...payload, notes: optional(event.target.value) })} /></label></section>
  </div>;
}

export function IntakeWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [tokens, setTokens] = useState<IntakeTokenRead[]>([]);
  const [submissions, setSubmissions] = useState<IntakeSubmissionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<IntakeSubmissionDetail | null>(null);
  const [reviewDraft, setReviewDraft] = useState<IntakeDraftPayload | null>(null);
  const [unitPrice, setUnitPrice] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [confirmingDecision, setConfirmingDecision] = useState<IntakeDecisionMode | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decisionKeys = useRef(new Map<string, string>());
  const selectedIdRef = useRef<number | null>(null);
  const showRemovedRef = useRef(false);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [tokenResponse, submissionResponse] = await Promise.all([
        listIntakeTokens(),
        listIntakeSubmissions(),
      ]);
      setTokens(tokenResponse.items);
      setSubmissions(submissionResponse.items);
      setLoadedOnce(true);
      const matchingSubmissions = submissionResponse.items.filter(
        (item) => Boolean(item.removed_at) === showRemovedRef.current,
      );
      setSelectedId((current) => current && matchingSubmissions.some((item) => item.id === current)
        ? current
        : matchingSubmissions[0]?.id ?? null);
      const activeId = selectedIdRef.current;
      if (!silent && activeId && submissionResponse.items.some((item) => item.id === activeId)) {
        const refreshedDetail = await getIntakeSubmission(activeId);
        setDetail(refreshedDetail);
        setReviewDraft(editableReviewPayload(refreshedDetail));
        setUnitPrice(refreshedDetail.review_unit_price ?? "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "客户填写记录加载失败，请重试。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(initialRefresh);
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    let active = true;
    getIntakeSubmission(selectedId)
      .then((response) => {
        if (active) {
          setDetail(response);
          setReviewDraft(editableReviewPayload(response));
          setUnitPrice(response.review_unit_price ?? "");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "提交详情加载失败，请重试。");
      })
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("create");
    setError(null);
    try {
      const created = await createIntakeToken(expiresInDays);
      setTokens((current) => [created, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "填写链接生成失败，请重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleCopy(token: IntakeTokenRead) {
    if (!token.fill_path) {
      setError("该链接原文已不再保存。如未妥善留存，请关闭旧链接并重新生成。");
      return;
    }
    try {
      await navigator.clipboard.writeText(new URL(token.fill_path, window.location.origin).toString());
      setCopiedId(token.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setError("复制失败，请打开链接后手工复制浏览器地址。");
    }
  }

  async function handleTokenStatus(token: IntakeTokenRead) {
    const next = token.status === "active" ? "disabled" : "active";
    setAction(`token-${token.id}`);
    setError(null);
    try {
      const updated = await updateIntakeToken(token.id, next, token.revision);
      setTokens((current) => current.map((item) => item.id === token.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "链接状态修改失败，请刷新后重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleSaveReview() {
    if (!detail || !reviewDraft) return;
    if (unitPrice && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0)) {
      setError("请填写有效的每次价格。");
      return;
    }
    setAction("save-review");
    setError(null);
    try {
      const reviewed = await saveIntakeReviewDraft(
        detail.id,
        reviewDraft,
        unitPrice ? Number(unitPrice).toFixed(2) : null,
        detail.revision,
      );
      setDetail(reviewed);
      setReviewDraft(editableReviewPayload(reviewed));
      setUnitPrice(reviewed.review_unit_price ?? "");
      setSubmissions((current) => replaceSubmission(current, reviewed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核稿保存失败，请刷新后重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleDecision(mode: IntakeDecisionMode) {
    if (!detail) return;
    const keyName = `${detail.submission_uuid}:${mode}`;
    const idempotencyKey = detail.decision_idempotency_key
      ?? decisionKeys.current.get(keyName)
      ?? window.crypto.randomUUID();
    decisionKeys.current.set(keyName, idempotencyKey);
    setAction(`decision-${mode}`);
    setError(null);
    try {
      await decideIntakeSubmission(
        detail.id,
        mode,
        detail.revision,
        idempotencyKey,
      );
      const updated = await getIntakeSubmission(detail.id);
      setDetail(updated);
      setReviewDraft(editableReviewPayload(updated));
      setUnitPrice(updated.review_unit_price ?? "");
      setSubmissions((current) => replaceSubmission(current, updated));
      setConfirmingDecision(null);
      decisionKeys.current.delete(keyName);
      const tokenResponse = await listIntakeTokens();
      setTokens(tokenResponse.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核动作失败；请保留当前页面并重试。");
      try {
        const latest = await getIntakeSubmission(detail.id);
        setDetail(latest);
        setReviewDraft(editableReviewPayload(latest));
        setUnitPrice(latest.review_unit_price ?? "");
        setSubmissions((current) => replaceSubmission(current, latest));
      } catch {
        // 保留原始错误；云端不可用不能伪装成空列表或成功。
      }
    } finally {
      setAction(null);
    }
  }

  async function handleListState(item: IntakeSubmissionSummary, removed: boolean) {
    setAction(`list-state-${item.id}`);
    setError(null);
    try {
      const updated = await updateIntakeSubmissionListState(item.id, removed, item.revision);
      const nextSubmissions = replaceSubmission(submissions, updated);
      setSubmissions(nextSubmissions);
      if (selectedIdRef.current === item.id) {
        const nextVisible = nextSubmissions.find(
          (candidate) => Boolean(candidate.removed_at) === showRemovedRef.current,
        );
        setSelectedId(nextVisible?.id ?? null);
        if (!nextVisible) {
          setDetail(null);
          setReviewDraft(null);
          setUnitPrice("");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "列表状态修改失败，请刷新后重试。");
    } finally {
      setAction(null);
    }
  }

  function selectSubmissionList(removed: boolean) {
    showRemovedRef.current = removed;
    setShowRemoved(removed);
    const first = submissions.find((item) => Boolean(item.removed_at) === removed);
    setSelectedId(first?.id ?? null);
    if (!first) setDetail(null);
    setConfirmingDecision(null);
  }

  const reviewDirty = Boolean(
    detail
    && reviewDraft
    && (
      JSON.stringify(reviewDraft) !== JSON.stringify(detail.review_payload)
      || Number(unitPrice || -1).toFixed(2) !== Number(detail.review_unit_price ?? -1).toFixed(2)
    ),
  );
  const reviewSaved = Boolean(detail?.review_payload && !reviewDirty);
  const hasServiceSchedule = Boolean(reviewDraft && (
    (reviewDraft.service.service_dates?.length ?? 0) > 0
    || (reviewDraft.service.start_date && reviewDraft.service.end_date && reviewDraft.service.visits_per_day)
  ));
  const orderReady = Boolean(reviewSaved && detail?.review_unit_price !== null && hasServiceSchedule);
  const canEdit = detail?.status === "submitted" || detail?.status === "reviewed";
  const canDecide = canEdit || detail?.status === "processing";
  const terminal = Boolean(detail && [
    "archived_customer",
    "archived_order",
    "converted",
    "voided",
    "redacted",
  ].includes(detail.status));
  const visibleSubmissions = submissions.filter((item) => Boolean(item.removed_at) === showRemoved);
  const visibleTokens = linksExpanded ? tokens : tokens.slice(0, 3);

  return (
    <section className={embedded ? "mt-6" : "cc-page cc-page--wide"} aria-labelledby="intake-title">
      {embedded ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold tracking-wide text-orange-600">客户资料决策区</p><h2 id="intake-title" className="mt-1 text-xl font-semibold">客户填写、审核与归档</h2><p className="mt-1 text-sm text-slate-500">窗口可见时每 30 秒同步一次；云端异常不会影响上方工作台数据。</p></div><div className="flex gap-2"><Link to="/admin/intake" className="cc-button cc-button--secondary">查看全部历史</Link><button type="button" className="cc-button cc-button--secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} size={15} />刷新</button></div></div> : <PageHeader
        eyebrow="资料收集"
        title="客户填写"
        headingId="intake-title"
        description="生成专属链接、查看客户提交，并在人工复核后一次生成客户档案、已确认订单和每日任务。"
        actions={<><Link to="/admin/customers" className="cc-button cc-button--secondary">返回客户档案</Link><button type="button" className="cc-button cc-button--secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} size={15} />刷新</button></>}
      />}
      <div className={`cc-alert border border-emerald-200 bg-emerald-50 text-emerald-900 ${embedded ? "" : "mt-5"}`}><ShieldCheck className="mt-0.5 shrink-0" size={17} /><span><strong>安全提示：</strong>后台仅限本机使用；链接原文只在生成时返回，请复制后通过微信发送给对应客户。</span></div>
      {error ? <div className="cc-alert cc-alert--danger mt-4" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="space-y-6">
          <section id="links" className="cc-surface p-5" aria-labelledby="new-link-title">
            <h2 id="new-link-title" className="flex items-center gap-2 font-semibold"><Link2 size={17} />生成填写链接</h2>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={handleCreate}><label className="text-sm font-medium text-slate-700">有效天数<input className="mt-1.5 block min-h-10 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={1} max={90} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} required /></label><button type="submit" className="cc-button cc-button--primary" disabled={action !== null}>{action === "create" ? <LoaderCircle className="animate-spin" size={15} /> : <Plus size={15} />}生成链接</button></form>
          </section>

          <section className="cc-surface overflow-hidden" aria-labelledby="links-title">
            <div className="border-b border-slate-200 px-5 py-4"><h2 id="links-title" className="font-semibold">填写链接（{tokens.length}）</h2></div>
            {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载…</div> : !loadedOnce && error ? <p className="px-5 py-10 text-center text-sm font-medium text-red-700">云端暂不可用，未把失败当作空列表。</p> : tokens.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">还没有填写链接。</p> : <><ul className="divide-y divide-slate-100">{visibleTokens.map((token) => <li key={token.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">链接 #{token.id}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${token.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{tokenStatusLabels[token.status]}</span>{token.submission_status ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{submissionStatusLabels[token.submission_status]}</span> : null}</div><p className="mt-2 text-xs text-slate-500">有效期至 {dateTime(token.expires_at)}</p>{token.fill_path ? <p className="mt-1 text-xs font-medium text-amber-700">新链接仅本次可查看，请立即复制保存</p> : <p className="mt-1 text-xs text-slate-400">链接原文未保存；需要时请重新生成</p>}</div></div><div className="mt-3 flex flex-wrap gap-2">{token.fill_path ? <><a href={token.fill_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium"><ExternalLink size={13} />打开</a><button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium" onClick={() => void handleCopy(token)}><ClipboardCopy size={13} />{copiedId === token.id ? "已复制" : "复制"}</button></> : null}{!token.submitted_at && token.status !== "expired" ? <button type="button" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium disabled:opacity-50" onClick={() => void handleTokenStatus(token)} disabled={action === `token-${token.id}`}>{token.status === "active" ? "关闭" : "恢复"}</button> : null}</div></li>)}</ul>{tokens.length > 3 ? <div className="border-t border-slate-100 p-3 text-center"><button type="button" className="text-sm font-medium text-orange-700" onClick={() => setLinksExpanded((value) => !value)}>{linksExpanded ? "收起" : `展开全部（${tokens.length}）`}</button></div> : null}</>}
          </section>
        </div>

        <section className="cc-surface min-w-0 overflow-hidden" aria-labelledby="submissions-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 id="submissions-title" className="font-semibold">提交审核（{visibleSubmissions.length}）</h2><p className="mt-1 text-xs text-slate-500">列表仅显示摘要；完整地址、门禁和钥匙只在右侧详情中读取。</p></div><div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-medium"><button type="button" className={`rounded-md px-3 py-1.5 ${!showRemoved ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => selectSubmissionList(false)}>当前记录</button><button type="button" className={`rounded-md px-3 py-1.5 ${showRemoved ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} onClick={() => selectSubmissionList(true)}>已移除记录</button></div></div>
          <div className="grid min-h-[600px] lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="cc-scrollbar overflow-y-auto border-b border-slate-200 bg-slate-50/60 lg:border-r lg:border-b-0" aria-label="提交记录列表">{loading ? <div className="flex justify-center py-12"><LoaderCircle className="animate-spin text-slate-400" size={18} /></div> : !loadedOnce && error ? <p className="px-4 py-12 text-center text-sm font-medium text-red-700">云端暂不可用，请稍后刷新。</p> : visibleSubmissions.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">{showRemoved ? "还没有已移除记录。" : "还没有客户提交。"}</p> : <ul className="p-2">{visibleSubmissions.map((item) => { const serviceDates = item.service_dates ?? []; const customerName = item.customer_name || "未填写名称"; const listStateAction = action === `list-state-${item.id}`; return <li key={item.id} className="relative"><button type="button" className={`mb-1 w-full rounded-xl px-3 py-3 pr-11 text-left ${selectedId === item.id ? "bg-orange-50 text-slate-950 shadow-sm ring-1 ring-orange-200" : "hover:bg-slate-100"}`} onClick={() => { setSelectedId(item.id); setConfirmingDecision(null); }}><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold">{customerName}</span><span className={`shrink-0 text-[11px] ${selectedId === item.id ? "text-orange-800" : "text-slate-500"}`}>{submissionStatusLabels[item.status]}</span></div><p className={`mt-1 truncate text-xs ${selectedId === item.id ? "text-orange-800" : "text-slate-500"}`}>{item.cat_count} 只猫</p><p className={`mt-2 text-xs ${selectedId === item.id ? "text-orange-800" : "text-slate-500"}`}>{serviceDates.length ? `${serviceDates.length} 天 · ${serviceDates.slice(0, 2).join("、")}${serviceDates.length > 2 ? "…" : ""}` : `${item.start_date || "日期未填"} 至 ${item.end_date || "—"}`}</p></button><button type="button" className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={showRemoved ? `恢复 ${customerName}` : `从列表删除 ${customerName}`} title={showRemoved ? "恢复到当前列表" : "从当前列表删除"} disabled={action !== null} onClick={() => void handleListState(item, !showRemoved)}>{listStateAction ? <LoaderCircle className="animate-spin" size={15} /> : showRemoved ? <RefreshCw size={15} /> : <X size={16} />}</button></li>; })}</ul>}</aside>
            <div className="min-w-0 bg-slate-50/40 p-4 sm:p-5">
              {selectedId !== null && detail?.id !== selectedId ? <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />正在读取敏感详情…</div> : !detail ? <div className="flex min-h-80 flex-col items-center justify-center text-center text-sm text-slate-500"><FileCheck2 className="text-slate-300" size={34} /><p className="mt-3">选择一条提交查看详情。</p></div> : <div>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{detail.customer_name || "未填写名称"}</h2><span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{submissionStatusLabels[detail.status]}</span></div><p className="mt-1 text-xs text-slate-500">提交于 {dateTime(detail.submitted_at)} · 来源 {detail.submission_uuid}</p></div>
                  {canDecide ? <div className="flex flex-wrap gap-2">
                    {canEdit ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50" onClick={() => void handleSaveReview()} disabled={action !== null || !reviewDraft}>{action === "save-review" ? <LoaderCircle className="animate-spin" size={14} /> : <FileCheck2 size={14} />}保存审核稿</button> : null}
                    {(detail.status !== "processing" || detail.decision_mode === "customer") ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50" onClick={() => setConfirmingDecision("customer")} disabled={action !== null || !reviewSaved} title={reviewSaved ? undefined : "请先保存审核稿"}><Archive size={14} />仅归档客户</button> : null}
                    {(detail.status !== "processing" || detail.decision_mode === "order") ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => setConfirmingDecision("order")} disabled={action !== null || !orderReady} title={orderReady ? undefined : "请先保存审核稿和每次价格"}><ShoppingCart size={14} />归档并生成订单</button> : null}
                    {(detail.status !== "processing" || detail.decision_mode === "void") ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50" onClick={() => setConfirmingDecision("void")} disabled={action !== null}><Ban size={14} />作废提交</button> : null}
                  </div> : null}
                </div>
                {detail.status === "processing" ? <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">云端记录正在处理。如上次因回写失败中断，请使用同一动作重试；本机唯一回执会阻止重复建档。</div> : null}
                {confirmingDecision ? <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="确认审核动作"><p className="text-sm font-semibold text-amber-950">{confirmingDecision === "customer" ? "确认新建客户档案（不会设置为已归档），并创建已补齐名称的猫咪？" : confirmingDecision === "order" ? "确认新建客户、猫咪、已确认订单和每日任务？" : "确认作废本次提交？"}</p><p className="mt-1 text-xs leading-5 text-amber-800">客户原稿保持只读；失败不会留下半套订单，重复重试不会重复建档。</p><div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900" onClick={() => setConfirmingDecision(null)}>取消</button><button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => void handleDecision(confirmingDecision)}>{action === `decision-${confirmingDecision}` ? <LoaderCircle className="inline animate-spin" size={14} /> : null}确认执行</button></div></div> : null}
                {terminal ? <div className={`mb-4 rounded-lg border p-4 text-sm ${detail.status === "voided" ? "border-slate-300 bg-slate-100 text-slate-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><p className="font-semibold">{detail.status === "voided" ? "该提交已作废。" : detail.status === "redacted" ? "云端敏感资料已按期限清理。" : "已完成本机幂等归档。"}</p><div className="mt-2 flex flex-wrap items-center gap-3">{detail.converted_customer_id ? <Link className="font-medium underline underline-offset-4" to="/admin/customers">查看客户 #{detail.converted_customer_id}</Link> : null}{detail.converted_order_id ? <Link className="font-medium underline underline-offset-4" to="/admin/orders">查看订单 #{detail.converted_order_id}</Link> : null}</div></div> : null}
                {terminal ? <PayloadDetail payload={detail.review_payload ?? detail.payload} /> : reviewDraft ? <><ReviewEditor payload={reviewDraft} sourceNote={detail.payload.notes} unitPrice={unitPrice} disabled={action !== null || detail.status === "processing"} onPayloadChange={setReviewDraft} onUnitPriceChange={setUnitPrice} /><details className="mt-4 rounded-lg border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">查看客户原始提交（永久只读）</summary><div className="mt-4"><PayloadDetail payload={detail.payload} /></div></details></> : null}
                <AuditTimeline events={detail.audit_events} />
              </div>}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export function AdminIntakePage() {
  return <IntakeWorkspace />;
}
