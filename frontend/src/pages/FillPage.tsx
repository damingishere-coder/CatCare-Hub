import { type FormEvent, useEffect, useState } from "react";
import { AlertCircle, Cat, CheckCircle2, ClipboardPenLine, LoaderCircle, Plus, Save, Send, Trash2 } from "lucide-react";
import { useParams } from "react-router-dom";

import { getPublicIntake, savePublicDraft, submitPublicIntake } from "../features/intake/api";
import { editableDraft, emptyCat, serviceItemOptions } from "../features/intake/constants";
import type { IntakeCatDraft, IntakeCustomerDraft, IntakeDraftPayload, PublicIntakeState, TaskItemType } from "../features/intake/types";
import { accessMethodOptions, keyStatusOptions, optionsWithLegacy } from "../lib/customerDisplay";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400";
const textareaClass = `${inputClass} min-h-24 resize-y leading-6`;

function valueOf(value: string | null): string {
  return value ?? "";
}

function statusMessage(status: Exclude<PublicIntakeState, "editable">) {
  if (status === "converted") return "资料已确认，并已建立正式客户与待确认订单。";
  if (status === "reviewed") return "资料已提交，后台正在审核。";
  return "资料已提交成功，后台确认后才会建立正式订单。";
}

interface FieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
}

function Field({ label, value, onChange, required, type = "text", maxLength, placeholder }: FieldProps) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}{required ? <span className="ml-1 text-red-600">*</span> : null}
      <input
        className={inputClass}
        type={type}
        value={valueOf(value)}
        onChange={(event) => onChange(event.target.value || null)}
        onInput={type === "date" ? (event) => onChange(event.currentTarget.value || null) : undefined}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </label>
  );
}

interface TextAreaFieldProps extends Omit<FieldProps, "type"> {
  rows?: number;
}

function TextAreaField({ label, value, onChange, required, maxLength, placeholder, rows = 3 }: TextAreaFieldProps) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}{required ? <span className="ml-1 text-red-600">*</span> : null}
      <textarea
        className={textareaClass}
        value={valueOf(value)}
        onChange={(event) => onChange(event.target.value || null)}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        rows={rows}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select className={inputClass} value={valueOf(value)} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">未选择</option>
        {optionsWithLegacy(options, value).map((option) => (
          <option key={option} value={option}>{options.includes(option) ? option : `历史值：${option}`}</option>
        ))}
      </select>
    </label>
  );
}

export function FillPage() {
  const { token } = useParams<{ token: string }>();
  const [draft, setDraft] = useState<IntakeDraftPayload | null>(null);
  const [state, setState] = useState<PublicIntakeState | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [action, setAction] = useState<"save" | "submit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "当前链接缺少专属 Token，请向服务人员索取完整填写链接。");

  useEffect(() => {
    if (!token) return;
    let active = true;
    getPublicIntake(token)
      .then((response) => {
        if (!active) return;
        setState(response.status);
        setExpiresAt(response.expires_at);
        if (response.status === "editable") setDraft(editableDraft(response.draft));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "填写链接读取失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  function updateCustomer<K extends keyof IntakeCustomerDraft>(field: K, value: IntakeCustomerDraft[K]) {
    setDraft((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateCat(index: number, updates: Partial<IntakeCatDraft>) {
    setDraft((current) => current ? {
      ...current,
      cats: current.cats.map((cat, catIndex) => catIndex === index ? { ...cat, ...updates } : cat),
    } : current);
  }

  function toggleServiceItem(item: TaskItemType) {
    setDraft((current) => {
      if (!current) return current;
      const selected = current.service.service_items.includes(item);
      return {
        ...current,
        service: {
          ...current.service,
          service_items: selected
            ? current.service.service_items.filter((value) => value !== item)
            : [...current.service.service_items, item],
        },
      };
    });
  }

  async function handleSave() {
    if (!token || !draft) return;
    setAction("save");
    setError(null);
    setMessage(null);
    try {
      const response = await savePublicDraft(token, draft);
      setDraft(editableDraft(response.draft));
      setMessage("草稿已保存。你可以稍后用同一链接继续填写。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草稿保存失败，请重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !draft) return;
    if (draft.service.service_items.length === 0) {
      setError("请至少选择一个服务事项。");
      return;
    }
    setAction("submit");
    setError(null);
    setMessage(null);
    try {
      const response = await submitPublicIntake(token, draft);
      setState(response.status);
      setDraft(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请检查后重试。");
    } finally {
      setAction(null);
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F5F5F7] px-4 py-7 text-[#1D1D1F] sm:px-6 sm:py-10">
      <section className="mx-auto max-w-3xl" aria-labelledby="fill-title">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><ClipboardPenLine aria-hidden="true" size={20} /></span>
          <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-orange-600 uppercase">CatCare-Hub · 客户填写</p>
          <h1 id="fill-title" className="mt-1 text-2xl font-semibold tracking-tight">上门喂猫服务资料</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">请填写本次服务所需资料。提交后由后台人工审核，不会自动生成或确认正式订单。</p>
          {expiresAt ? <p className="mt-2 text-xs text-slate-500">链接有效期至：{new Date(expiresAt).toLocaleString("zh-CN")}</p> : null}
        </header>

        {loading ? (
          <div className="cc-surface mt-5 flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <LoaderCircle className="animate-spin" size={18} />正在读取填写链接…
          </div>
        ) : error && !draft ? (
          <div className="cc-alert cc-alert--danger mt-5 p-5" role="alert">
            <AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span>
          </div>
        ) : state && state !== "editable" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto text-emerald-700" size={36} />
            <h2 className="mt-4 text-lg font-semibold text-emerald-950">资料已收到</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-800">{statusMessage(state)}</p>
          </div>
        ) : draft ? (
          <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
            {error ? <div className="cc-alert cc-alert--danger" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div> : null}
            {message ? <div className="cc-alert border border-emerald-200 bg-emerald-50 text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 shrink-0" size={17} />{message}</div> : null}

            <section className="cc-surface p-5 sm:p-6" aria-labelledby="contact-title">
              <h2 id="contact-title" className="text-lg font-semibold">1. 客户资料</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">只填写服务真正需要的信息，名称与地址为必填。</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="名称" required maxLength={100} value={draft.customer.name} onChange={(value) => updateCustomer("name", value)} />
                <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={draft.customer.is_repeat_customer} onChange={(event) => updateCustomer("is_repeat_customer", event.target.checked)} />
                  我是老客户
                </label>
                <div className="sm:col-span-2"><TextAreaField label="地址" required maxLength={1000} value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} rows={2} /></div>
                <SelectField label="门禁方式" value={draft.customer.access_method} options={accessMethodOptions} onChange={(value) => updateCustomer("access_method", value)} />
                <SelectField label="钥匙状态" value={draft.customer.key_status} options={keyStatusOptions} onChange={(value) => updateCustomer("key_status", value)} />
                <Field label="钥匙编号" maxLength={100} value={draft.customer.key_code} onChange={(value) => updateCustomer("key_code", value)} />
                <div className="sm:col-span-2"><TextAreaField label="客户备注" maxLength={4000} value={draft.customer.notes} onChange={(value) => updateCustomer("notes", value)} /></div>
              </div>
            </section>

            <section className="cc-surface p-5 sm:p-6" aria-labelledby="cats-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 id="cats-title" className="text-lg font-semibold">2. 猫咪资料</h2><p className="mt-1 text-xs text-slate-500">至少填写一只，最多 20 只。</p></div>
                <button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => setDraft({ ...draft, cats: [...draft.cats, emptyCat()] })}><Plus size={16} />添加猫咪</button>
              </div>
              <div className="mt-5 space-y-4">
                {draft.cats.map((cat, index) => (
                  <article key={index} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:p-5" aria-label={`猫咪 ${index + 1}`}>
                    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Cat size={17} />猫咪 {index + 1}</h3>{draft.cats.length > 1 ? <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-red-700" onClick={() => setDraft({ ...draft, cats: draft.cats.filter((_, catIndex) => catIndex !== index) })}><Trash2 size={14} />移除</button> : null}</div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="名字" required maxLength={100} value={cat.name} onChange={(value) => updateCat(index, { name: value })} />
                      <Field label="性别" maxLength={32} value={cat.gender} onChange={(value) => updateCat(index, { gender: value })} />
                      <Field label="年龄" type="number" value={cat.age} onChange={(value) => updateCat(index, { age: value })} />
                      <Field label="品种" maxLength={100} value={cat.breed} onChange={(value) => updateCat(index, { breed: value })} />
                      <TextAreaField label="性格" maxLength={4000} value={cat.personality} onChange={(value) => updateCat(index, { personality: value })} />
                      <TextAreaField label="主食" maxLength={4000} value={cat.food} onChange={(value) => updateCat(index, { food: value })} />
                      <TextAreaField label="饮食偏好" maxLength={4000} value={cat.food_preference} onChange={(value) => updateCat(index, { food_preference: value })} />
                      <Field label="猫砂类型" maxLength={100} value={cat.litter_type} onChange={(value) => updateCat(index, { litter_type: value })} />
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={cat.medication_required} onChange={(event) => updateCat(index, { medication_required: event.target.checked })} />需要喂药</label>
                      {cat.medication_required ? <div className="sm:col-span-2"><TextAreaField label="喂药说明" maxLength={4000} value={cat.medication_notes} onChange={(value) => updateCat(index, { medication_notes: value })} /></div> : null}
                      <TextAreaField label="特殊情况" maxLength={4000} value={cat.special_notes} onChange={(value) => updateCat(index, { special_notes: value })} />
                      <TextAreaField label="服务注意事项" maxLength={4000} value={cat.service_notes} onChange={(value) => updateCat(index, { service_notes: value })} />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="cc-surface p-5 sm:p-6" aria-labelledby="service-title">
              <h2 id="service-title" className="text-lg font-semibold">3. 服务计划</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Field label="开始日期" required type="date" value={draft.service.start_date} onChange={(value) => setDraft({ ...draft, service: { ...draft.service, start_date: value } })} />
                <Field label="结束日期" required type="date" value={draft.service.end_date} onChange={(value) => setDraft({ ...draft, service: { ...draft.service, end_date: value } })} />
                <label className="block text-sm font-medium text-slate-700">每日次数<span className="ml-1 text-red-600">*</span><input className={inputClass} type="number" min={1} max={10} required value={draft.service.visits_per_day ?? 1} onChange={(event) => setDraft({ ...draft, service: { ...draft.service, visits_per_day: Number(event.target.value) || null } })} /></label>
              </div>
              <fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">服务事项 <span className="text-red-600">*</span></legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{serviceItemOptions.map((item) => <label key={item.value} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><input type="checkbox" checked={draft.service.service_items.includes(item.value)} onChange={() => toggleServiceItem(item.value)} />{item.label}</label>)}</div></fieldset>
              <div className="mt-5"><TextAreaField label="本次服务补充备注" maxLength={4000} value={draft.notes} onChange={(value) => setDraft({ ...draft, notes: value })} /></div>
            </section>

            <section className="rounded-2xl border border-orange-200 bg-orange-50/70 p-5">
              <h2 className="font-semibold text-orange-950">4. 确认提交</h2>
              <p className="mt-2 text-sm leading-6 text-orange-900">提交后不能继续修改；后台仍会人工核对资料，订单不会自动确认。若还没填完，可以先保存草稿。</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="cc-button cc-button--secondary min-h-11" onClick={() => void handleSave()} disabled={action !== null}>{action === "save" ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存草稿</button>
                <button type="submit" className="cc-button cc-button--primary min-h-11" disabled={action !== null}>{action === "submit" ? <LoaderCircle className="animate-spin" size={16} /> : <Send size={16} />}提交资料</button>
              </div>
            </section>
          </form>
        ) : null}
      </section>
    </main>
  );
}
