import {
  AlertCircle,
  Cat,
  CheckCircle2,
  ClipboardPenLine,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  getPublicIntake,
  savePublicDraft,
  submitPublicIntake,
} from "../features/intake/api";
import {
  emptyPublicCat,
  publicEditableDraft,
} from "../features/intake/constants";
import type {
  PublicIntakeCatDraft,
  PublicIntakeDraftPayload,
  PublicIntakeState,
} from "../features/intake/types";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400";
const textareaClass = `${inputClass} min-h-24 resize-y leading-6`;

function valueOf(value: string | null): string {
  return value ?? "";
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
    return { title: "资料审核中", body: "后台已查看并正在补充确认，处理结果不会在此链接展示具体内容。" };
  }
  return { title: "资料已提交", body: "提交后不能修改；后台会人工联系并核对资料。" };
}

function Field({ label, value, onChange, required, type = "text", maxLength, placeholder }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return <label className="block text-sm font-medium text-slate-700">
    {label}{required ? <span className="ml-1 text-red-600">*</span> : null}
    <input className={inputClass} type={type} value={valueOf(value)} required={required} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value || null)} />
  </label>;
}

function TextAreaField({ label, value, onChange, maxLength, placeholder }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  return <label className="block text-sm font-medium text-slate-700">
    {label}
    <textarea className={textareaClass} value={valueOf(value)} maxLength={maxLength} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value || null)} />
  </label>;
}

export function FillPage() {
  const { token } = useParams<{ token: string }>();
  const [draft, setDraft] = useState<PublicIntakeDraftPayload | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [state, setState] = useState<PublicIntakeState | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [action, setAction] = useState<"save" | "submit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    token ? null : "当前链接缺少专属 Token，请向服务人员索取完整填写链接。",
  );
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
        if (response.status === "editable") setDraft(publicEditableDraft(response.draft));
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
    setDraft((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateCat(index: number, updates: Partial<PublicIntakeCatDraft>) {
    setDraft((current) => current ? {
      ...current,
      cats: current.cats.map((cat, catIndex) => catIndex === index ? { ...cat, ...updates } : cat),
    } : current);
  }

  async function handleSave() {
    if (!token || !draft || !revision) return;
    setAction("save");
    setError(null);
    setMessage(null);
    try {
      const response = await savePublicDraft(token, draft, revision);
      setDraft(publicEditableDraft(response.draft));
      setRevision(response.revision);
      setMessage("草稿已保存。你可以稍后用同一链接继续填写。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草稿保存失败，请重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !draft || !revision) return;
    if (!draft.customer.name) {
      setError("请填写客户姓名或称呼。");
      return;
    }
    if (!draft.customer.phone && !draft.customer.wechat_name) {
      setError("手机号和微信至少填写一项。");
      return;
    }
    setAction("submit");
    setError(null);
    setMessage(null);
    try {
      const response = await submitPublicIntake(token, draft, revision, submitKey.current);
      setState(response.status);
      setRevision(null);
      setDraft(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请检查后重试。");
    } finally {
      setAction(null);
    }
  }

  const terminalCopy = state && state !== "editable" ? statusCopy(state) : null;

  return <main className="min-h-screen overflow-x-hidden bg-[#F5F5F7] px-4 py-6 text-[#1D1D1F] sm:px-6 sm:py-10">
    <section className="mx-auto max-w-3xl" aria-labelledby="fill-title">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <span className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><ClipboardPenLine aria-hidden="true" size={20} /></span>
        <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-orange-600 uppercase">CatCare-Hub · 客户填写</p>
        <h1 id="fill-title" className="mt-1 text-2xl font-semibold tracking-tight">上门喂猫服务资料</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">资料仅用于联系、服务准备和后台人工审核，不会自动生成订单。</p>
        {expiresAt ? <p className="mt-2 text-xs text-slate-500">链接有效期至：{new Date(expiresAt).toLocaleString("zh-CN")}</p> : null}
      </header>

      {loading ? <div className="cc-surface mt-5 flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />正在读取填写链接…</div> : null}
      {!loading && error && !draft ? <div className="cc-alert cc-alert--danger mt-5 p-5" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div> : null}
      {!loading && terminalCopy ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm"><CheckCircle2 className="mx-auto text-emerald-700" size={36} /><h2 className="mt-4 text-lg font-semibold text-emerald-950">{terminalCopy.title}</h2><p className="mt-2 text-sm leading-6 text-emerald-800">{terminalCopy.body}</p></div> : null}

      {!loading && draft ? <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
        {error ? <div className="cc-alert cc-alert--danger" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div> : null}
        {message ? <div className="cc-alert border border-emerald-200 bg-emerald-50 text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 shrink-0" size={17} />{message}</div> : null}

        <section className="cc-surface p-5 sm:p-6" aria-labelledby="contact-title">
          <h2 id="contact-title" className="text-lg font-semibold">1. 联系与地址</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">姓名必填；手机号或微信至少填写一项，其余可稍后由后台补齐。</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="客户姓名 / 称呼" required maxLength={100} value={draft.customer.name} onChange={(value) => updateCustomer("name", value)} />
            <Field label="手机号" type="tel" maxLength={32} value={draft.customer.phone} onChange={(value) => updateCustomer("phone", value)} />
            <Field label="微信号 / 微信昵称" maxLength={100} value={draft.customer.wechat_name} onChange={(value) => updateCustomer("wechat_name", value)} />
            <Field label="门禁方式" maxLength={100} placeholder="例如：联系门卫、刷卡" value={draft.customer.access_method} onChange={(value) => updateCustomer("access_method", value)} />
            <div className="sm:col-span-2"><TextAreaField label="完整服务地址" maxLength={1000} placeholder="可暂不填写；请勿在这里填写门禁密码或进门说明" value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} /></div>
            <Field label="钥匙状态" maxLength={50} placeholder="例如：待交接、已放门卫" value={draft.customer.key_status} onChange={(value) => updateCustomer("key_status", value)} />
            <div className="sm:col-span-2"><TextAreaField label="补充说明" maxLength={4000} value={draft.customer.notes} onChange={(value) => updateCustomer("notes", value)} /></div>
          </div>
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">请不要填写门禁密码、具体进门步骤或钥匙编号；这些信息会由后台审核时另行补录。</p>
        </section>

        <section className="cc-surface p-5 sm:p-6" aria-labelledby="cats-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="cats-title" className="text-lg font-semibold">2. 猫咪资料（可选）</h2><p className="mt-1 text-xs text-slate-500">可以先不填；添加后也允许暂缺名字，由后台联系补齐。</p></div><button type="button" className="cc-button cc-button--secondary min-h-10 px-3" onClick={() => setDraft({ ...draft, cats: [...draft.cats, emptyPublicCat()] })}><Plus size={16} />添加猫咪</button></div>
          {draft.cats.length === 0 ? <p className="mt-5 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">尚未添加猫咪资料。</p> : <div className="mt-5 space-y-4">{draft.cats.map((cat, index) => <article key={index} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:p-5" aria-label={`猫咪 ${index + 1}`}><div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Cat size={17} />猫咪 {index + 1}</h3><button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-red-700" onClick={() => setDraft({ ...draft, cats: draft.cats.filter((_, catIndex) => catIndex !== index) })}><Trash2 size={14} />移除</button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="名字" maxLength={100} value={cat.name} onChange={(value) => updateCat(index, { name: value })} /><Field label="猫砂类型" maxLength={100} value={cat.litter_type} onChange={(value) => updateCat(index, { litter_type: value })} /><TextAreaField label="饮食" maxLength={4000} value={cat.food} onChange={(value) => updateCat(index, { food: value })} /><TextAreaField label="特殊注意事项" maxLength={4000} value={cat.special_notes} onChange={(value) => updateCat(index, { special_notes: value })} /><label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={cat.medication_required} onChange={(event) => updateCat(index, { medication_required: event.target.checked })} />需要用药</label>{cat.medication_required ? <div className="sm:col-span-2"><TextAreaField label="用药说明" maxLength={4000} value={cat.medication_notes} onChange={(value) => updateCat(index, { medication_notes: value })} /></div> : null}</div></article>)}</div>}
        </section>

        <section className="cc-surface p-5 sm:p-6" aria-labelledby="service-title">
          <h2 id="service-title" className="text-lg font-semibold">3. 服务需求（可选）</h2>
          <p className="mt-1 text-xs text-slate-500">服务事项和价格由后台核对后补录。</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3"><Field label="开始日期" type="date" value={draft.service.start_date} onChange={(value) => setDraft({ ...draft, service: { ...draft.service, start_date: value } })} /><Field label="结束日期" type="date" value={draft.service.end_date} onChange={(value) => setDraft({ ...draft, service: { ...draft.service, end_date: value } })} /><label className="block text-sm font-medium text-slate-700">每日次数<input className={inputClass} type="number" min={1} max={10} value={draft.service.visits_per_day ?? ""} onChange={(event) => setDraft({ ...draft, service: { ...draft.service, visits_per_day: event.target.value ? Number(event.target.value) : null } })} /></label></div>
          <div className="mt-5"><TextAreaField label="本次服务补充备注" maxLength={4000} value={draft.notes} onChange={(value) => setDraft({ ...draft, notes: value })} /></div>
        </section>

        <section className="rounded-2xl border border-orange-200 bg-orange-50/70 p-5">
          <h2 className="font-semibold text-orange-950">4. 提交与资料留存</h2>
          <p className="mt-2 text-sm leading-6 text-orange-900">提交后客户不能修改原稿；后台可以在只读原稿旁制作审核稿。云端会保存待审核资料，处理完成 30 天后清除原稿、审核稿和联系方式，只保留非敏感状态与幂等回执；本地正式档案按业务需要保留。</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end"><button type="button" className="cc-button cc-button--secondary min-h-11" onClick={() => void handleSave()} disabled={action !== null}>{action === "save" ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存草稿</button><button type="submit" className="cc-button cc-button--primary min-h-11" disabled={action !== null}>{action === "submit" ? <LoaderCircle className="animate-spin" size={16} /> : <Send size={16} />}提交资料</button></div>
        </section>
      </form> : null}
    </section>
  </main>;
}
