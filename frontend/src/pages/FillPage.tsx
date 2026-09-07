import {
  AlertCircle,
  CalendarDays,
  Cat,
  CheckCircle2,
  ChevronDown,
  ClipboardPenLine,
  Home,
  LoaderCircle,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
  getPublicIntake,
  submitPublicIntake,
} from "../features/intake/api";
import {
  emptyPublicCat,
  publicEditableDraft,
} from "../features/intake/constants";
import type {
  PublicAccessMethod,
  PublicIntakeCatDraft,
  PublicIntakeDraftPayload,
  PublicIntakeState,
} from "../features/intake/types";
import { keyStatusOptions } from "../lib/customerDisplay";
import { ModalSurface } from "../components/ui/ModalSurface";
import { useUnsavedChanges } from "../components/ui/useUnsavedChanges";
import { MultiDateCalendar } from "../components/ui/MultiDateCalendar";
import { expandDateRange } from "../components/ui/calendarDates";

const inputClass = "mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100";
const textareaClass = `${inputClass} min-h-28 resize-y leading-6`;

const publicAccessOptions: ReadonlyArray<{ value: PublicAccessMethod; label: string }> = [
  { value: "无", label: "无" },
  { value: "密码", label: "密码（只选类型，请勿填写密码）" },
  { value: "门卡", label: "门卡" },
  { value: "钥匙开门", label: "钥匙开门" },
  { value: "指纹或人脸", label: "指纹或人脸" },
  { value: "联系物业或门卫", label: "联系物业或门卫" },
];

const keyLabels: Record<string, string> = {
  待取: "尚未交接",
  已取: "已交给服务人员",
  已归还: "已归还",
  无需钥匙: "无需钥匙",
};

function valueOf(value: string | null): string {
  return value ?? "";
}

function hasAddressDetails(draft: PublicIntakeDraftPayload): boolean {
  return Boolean(
    draft.customer.address
    || draft.customer.access_method
    || draft.customer.community_access_method
    || draft.customer.building_access_method
    || draft.customer.key_status,
  );
}

function statusCopy(status: Exclude<PublicIntakeState, "editable">): {
  title: string;
  body: string;
} {
  if (status === "archived") {
    return { title: "资料已归档", body: "后台已完成处理；此链接不会再显示具体资料。" };
  }
  if (status === "voided") {
    return { title: "提交已作废", body: "本次资料已停止处理；如需重新填写，请联系服务人员获取新链接。" };
  }
  if (status === "reviewed") {
    return { title: "资料审核中", body: "我们正在核对资料，稍后会通过微信或电话与你联系。" };
  }
  return { title: "资料已提交", body: "我们会通过微信或电话与你联系并确认服务安排。" };
}

function Field({ label, value, onChange, required, type = "text", maxLength, placeholder, error, id }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  error?: string;
  id?: string;
}) {
  const errorId = useId();
  return <div><label className="block text-sm font-semibold text-slate-800">
    {label}{required ? <span className="ml-1 text-red-600">*</span> : null}
    <input
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
      className={inputClass}
      type={type}
      value={valueOf(value)}
      aria-required={required || undefined}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value || null)}
    />
  </label>{error ? <span id={errorId} className="mt-2 block text-sm font-normal text-red-700">{error}</span> : null}</div>;
}

function TextAreaField({ label, value, onChange, maxLength, placeholder }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  return <label className="block text-sm font-semibold text-slate-800">
    {label}
    <textarea className={textareaClass} value={valueOf(value)} maxLength={maxLength} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value || null)} />
  </label>;
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const known = options.some((option) => option.value === value);
  return <label className="block text-sm font-semibold text-slate-800">
    {label}
    <select className={inputClass} value={valueOf(value)} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">待确认</option>
      {!known && value ? <option value={value}>原草稿：{value}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function DisclosureButton({ id, open, icon, title, summary, onClick }: {
  id: string;
  open: boolean;
  icon: ReactNode;
  title: string;
  summary: string;
  onClick: () => void;
}) {
  return <button type="button" className="flex w-full items-center gap-3 px-5 py-5 text-left" aria-expanded={open} aria-controls={id} onClick={onClick}>
    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-950">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{summary}</span></span>
    <ChevronDown className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} size={20} />
  </button>;
}

export function FillPage({ token }: { token: string | null }) {
  const [draft, setDraft] = useState<PublicIntakeDraftPayload | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [state, setState] = useState<PublicIntakeState | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "当前链接缺少专属 Token，请向服务人员索取完整填写链接。",
  );
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [initialDraft, setInitialDraft] = useState<string | null>(null);
  useUnsavedChanges(Boolean(draft && initialDraft && JSON.stringify(draft) !== initialDraft && !submitting));
  const nameError = validationAttempted && !draft?.customer.name?.trim() ? "请填写客户姓名或称呼。" : undefined;
  const contactError = validationAttempted && !draft?.customer.phone?.trim() && !draft?.customer.wechat_name?.trim() ? "手机号和微信至少填写一项。" : undefined;
  const submitKey = useRef(window.crypto.randomUUID());

  useEffect(() => {
    if (!token) return;
    let active = true;
    getPublicIntake(token)
      .then((response) => {
        if (!active) return;
        setState(response.status);
        setExpiresAt(response.expires_at);
        setRevision(response.revision);
        if (response.status === "editable") {
          const editable = publicEditableDraft(response.draft);
          setDraft(editable);
          setInitialDraft(JSON.stringify(editable));
          setAddressOpen(hasAddressDetails(editable));
          setCatsOpen(editable.cats.length > 0);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "填写链接读取失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  function updateCustomer(field: keyof PublicIntakeDraftPayload["customer"], value: string | null) {
    setError(null);
    setDraft((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateAccessMethod(
    field: "community_access_method" | "building_access_method",
    value: string | null,
  ) {
    setDraft((current) => current ? {
      ...current,
      customer: {
        ...current.customer,
        access_method: null,
        [field]: value,
      },
    } : current);
  }

  function updateCat(index: number, updates: Partial<PublicIntakeCatDraft>) {
    setDraft((current) => current ? {
      ...current,
      cats: current.cats.map((cat, catIndex) => catIndex === index ? { ...cat, ...updates } : cat),
    } : current);
  }

  function requestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setValidationAttempted(true);
    if (!draft.customer.name?.trim()) {
      setError("请检查标记的联系信息。");
      document.getElementById("fill-name")?.focus();
      return;
    }
    if (!draft.customer.phone?.trim() && !draft.customer.wechat_name?.trim()) {
      setError("手机号和微信至少填写一项。");
      document.getElementById("fill-phone")?.focus();
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    if (!token || !draft || !revision) return;
    setSubmitting(true);
    setConfirmOpen(false);
    setError(null);
    try {
      const response = await submitPublicIntake(token, draft, revision, submitKey.current);
      setState(response.status);
      setRevision(null);
      setDraft(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请检查后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const terminalCopy = state && state !== "editable" ? statusCopy(state) : null;
  const keyOptions = keyStatusOptions.map((value) => ({ value, label: keyLabels[value] ?? value }));
  const selectedDates = draft
    ? draft.service.service_dates ?? expandDateRange(draft.service.start_date, draft.service.end_date)
    : [];

  return <main className="min-h-screen overflow-x-hidden bg-[var(--cc-app)] px-4 py-5 text-[var(--cc-text)] sm:py-8">
    <section className="mx-auto max-w-xl" aria-labelledby="fill-title">
      <header className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
        <div className="bg-brand-50 p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><ClipboardPenLine aria-hidden="true" size={23} /></span>
          <p className="mt-5 text-xs font-bold tracking-[0.16em] text-brand-700 uppercase">CatCare · 客户登记</p>
          <h1 id="fill-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">上门喂猫资料</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">先留下基本信息，我们会再通过微信或电话与你确认细节。</p>
          {expiresAt ? <p className="mt-4 inline-flex rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-500">链接有效期至 {new Date(expiresAt).toLocaleString("zh-CN")}</p> : null}
        </div>
      </header>

      {loading ? <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-brand-100 bg-white py-16 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />正在读取填写链接…</div> : null}
      {!loading && error && !draft ? <div className="cc-alert cc-alert--danger mt-5 p-5" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div> : null}
      {!loading && terminalCopy ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto text-emerald-600" size={42} /><h2 className="mt-5 text-xl font-bold text-emerald-950">{terminalCopy.title}</h2><p className="mt-2 text-sm leading-6 text-emerald-800">{terminalCopy.body}</p></div> : null}

      {!loading && draft ? <form className="mt-5 space-y-4 pb-32" noValidate onSubmit={requestSubmit}>
        {error ? <div className="cc-alert cc-alert--danger" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div> : null}

        <section className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="contact-title">
          <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">1</span><div><h2 id="contact-title" className="text-lg font-bold">怎么联系你</h2><p className="mt-1 text-xs leading-5 text-slate-500">称呼必填；微信或手机号至少填写一项。</p></div></div>
          <div className="mt-6 space-y-5">
            <Field id="fill-name" error={nameError} label="客户姓名 / 称呼" required maxLength={100} placeholder="怎么称呼你" value={draft.customer.name} onChange={(value) => updateCustomer("name", value)} />
            <Field id="fill-phone" error={contactError} label="手机号" type="tel" maxLength={32} placeholder="可选" value={draft.customer.phone} onChange={(value) => updateCustomer("phone", value)} />
            <Field label="微信号 / 微信昵称" maxLength={100} placeholder="可选，方便核对微信联系人" value={draft.customer.wechat_name} onChange={(value) => updateCustomer("wechat_name", value)} />
          </div>
        </section>

        <section className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="schedule-title">
          <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><CalendarDays size={19} /></span><div><h2 id="schedule-title" className="text-lg font-bold">预计上门时间</h2><p className="mt-1 text-xs leading-5 text-slate-500">可以选择多个不连续日期；暂不确定也可以留空。</p></div></div>
          <div className="mt-6 min-w-0 max-w-full">
            <MultiDateCalendar
              values={selectedDates}
              onChange={(values) => {
                setScheduleTouched(true);
                setDraft({
                  ...draft,
                  service: {
                    service_dates: values,
                    start_date: null,
                    end_date: null,
                    visits_per_day: null,
                  },
                });
              }}
            />
            {!scheduleTouched && !draft.service.service_dates && draft.service.start_date ? <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">这是旧草稿的连续日期安排；不修改会按原安排保留，点击日历修改后将改为每个选中日期一次。</p> : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
          <DisclosureButton id="address-fields" open={addressOpen} icon={<Home size={19} />} title="地址与交接（选填）" summary="服务地址、门禁类型和钥匙交接状态" onClick={() => setAddressOpen((current) => !current)} />
          {addressOpen ? <div id="address-fields" className="space-y-5 border-t border-brand-100 px-5 py-6 sm:px-6">
            <TextAreaField label="完整服务地址" maxLength={1000} placeholder="可以稍后确认；请勿填写门禁密码或具体进门步骤" value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} />
            {draft.customer.access_method ? <p className="rounded-2xl bg-brand-50 px-4 py-3 text-xs leading-5 text-brand-900">旧草稿记录的门禁方式为“{draft.customer.access_method}”。如不修改会继续保留；如需更新，请分别选择下面两项。</p> : null}
            <SelectField label="小区门禁" value={draft.customer.community_access_method} options={publicAccessOptions} onChange={(value) => updateAccessMethod("community_access_method", value)} />
            <SelectField label="楼下门禁" value={draft.customer.building_access_method} options={publicAccessOptions} onChange={(value) => updateAccessMethod("building_access_method", value)} />
            <SelectField label="钥匙状态" value={draft.customer.key_status} options={keyOptions} onChange={(value) => updateCustomer("key_status", value)} />
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">这里只选择交接类型，不要填写门禁密码、钥匙编号或具体进门步骤。</p>
          </div> : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
          <DisclosureButton id="cat-fields" open={catsOpen} icon={<Cat size={19} />} title={`猫咪资料（选填）${draft.cats.length ? ` · ${draft.cats.length} 只` : ""}`} summary="名字和需要特别注意的事情" onClick={() => setCatsOpen((current) => !current)} />
          {catsOpen ? <div id="cat-fields" className="border-t border-brand-100 px-5 py-6 sm:px-6">
            <button type="button" className="cc-button cc-button--secondary min-h-11 w-full justify-center" disabled={draft.cats.length >= 20} onClick={() => setDraft({ ...draft, cats: [...draft.cats, emptyPublicCat()] })}><Plus size={16} />添加猫咪</button>
            {draft.cats.length === 0 ? <p className="mt-4 rounded-2xl bg-brand-50/70 px-4 py-7 text-center text-sm text-slate-500">可以先不填，之后再通过微信补充。</p> : <div className="mt-4 space-y-4">{draft.cats.map((cat, index) => <article key={index} className="rounded-2xl border border-brand-100 bg-brand-50 p-4" aria-label={`猫咪 ${index + 1}`}>
              <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-bold text-slate-900"><Cat size={17} />猫咪 {index + 1}</h3><button type="button" className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-red-700" onClick={() => setDraft({ ...draft, cats: draft.cats.filter((_, catIndex) => catIndex !== index) })}><Trash2 size={14} />移除</button></div>
              <div className="mt-4 space-y-5">
                <Field label="名字" maxLength={100} placeholder="可稍后补充" value={cat.name} onChange={(value) => updateCat(index, { name: value })} />
                <TextAreaField label="特殊注意事项" maxLength={4000} placeholder="例如性格、健康或容易紧张的情况" value={cat.special_notes} onChange={(value) => updateCat(index, { special_notes: value })} />
              </div>
            </article>)}</div>}
          </div> : null}
        </section>

        <section className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm sm:p-6">
          <TextAreaField label="还有什么需要告诉我们（选填）" maxLength={4000} placeholder="你可以补充尚未确定的安排或其他需要我们留意的事情" value={draft.notes} onChange={(value) => setDraft({ ...draft, notes: value })} />
          <div className="mt-4 text-xs leading-5 text-slate-500"><p>仅用于服务沟通与人工审核；提交后不可修改。</p><p>处理完成 30 天后，云端会清理敏感资料。</p></div>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-100 bg-white/95 px-4 pt-3 shadow-[0_-12px_35px_rgba(80,45,10,0.10)] backdrop-blur" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <div className="mx-auto max-w-xl"><button type="submit" className="cc-button cc-button--primary min-h-12 w-full justify-center rounded-2xl text-base font-bold" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}{submitting ? "正在提交…" : "提交资料"}</button></div>
        </div>
      </form> : null}
    </section>

    {confirmOpen ? <ModalSurface role="alertdialog" labelledBy="submit-confirm-title" onClose={() => setConfirmOpen(false)} busy={submitting} className="cc-dialog--compact max-w-sm p-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><Send size={20} /></span>
        <h2 id="submit-confirm-title" className="mt-5 text-xl font-bold text-slate-950">确认提交资料？</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">提交后将不能修改。我们会再通过微信或电话与你确认服务细节。</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" className="cc-button cc-button--secondary min-h-11 justify-center" onClick={() => setConfirmOpen(false)}>返回检查</button><button type="button" className="cc-button cc-button--primary min-h-11 justify-center" onClick={() => void confirmSubmit()}>确认提交</button></div>
    </ModalSurface> : null}
  </main>;
}
