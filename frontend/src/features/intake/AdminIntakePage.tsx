import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  FileCheck2,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/ui/PageHeader";
import {
  convertIntakeSubmission,
  createIntakeToken,
  getIntakeSubmission,
  listIntakeSubmissions,
  listIntakeTokens,
  reviewIntakeSubmission,
  updateIntakeToken,
} from "./api";
import { serviceItemOptions } from "./constants";
import type {
  FormSubmissionStatus,
  FormTokenStatus,
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
  converted: "已转换",
  expired: "已过期",
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
    status: detail.status,
    customer_name: detail.customer_name,
    community: detail.community,
    cat_count: detail.cat_count,
    start_date: detail.start_date,
    end_date: detail.end_date,
    submitted_at: detail.submitted_at,
    updated_at: detail.updated_at,
    revision: detail.revision,
  } : item);
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{valueOrDash(value)}</dd></div>;
}

function PayloadDetail({ payload }: { payload: IntakeDraftPayload }) {
  const labels = new Map(serviceItemOptions.map((item) => [item.value, item.label]));
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">联系与地址</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <DetailRow label="联系人" value={payload.customer.name} />
          <DetailRow label="微信昵称" value={payload.customer.wechat_name} />
          <DetailRow label="手机号" value={payload.customer.phone} />
          <DetailRow label="小区" value={payload.customer.community} />
          <DetailRow label="详细地址" value={payload.customer.address} />
          <DetailRow label="楼栋 / 单元 / 房号" value={[payload.customer.building, payload.customer.unit, payload.customer.room].filter(Boolean).join(" / ")} />
        </dl>
      </section>
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} />门禁与钥匙</h3><span className="text-xs font-medium text-amber-700">敏感信息，仅本地后台可见</span></div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <DetailRow label="门禁方式" value={payload.customer.access_method} />
          <DetailRow label="钥匙状态 / 编号" value={[payload.customer.key_status, payload.customer.key_code].filter(Boolean).join(" / ")} />
          <div className="sm:col-span-2"><DetailRow label="入户说明" value={payload.customer.access_info} /></div>
        </dl>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">猫咪资料（{payload.cats.length} 只）</h3>
        <div className="mt-3 space-y-3">{payload.cats.map((cat, index) => <article key={index} className="rounded-lg bg-slate-50 p-3"><h4 className="text-sm font-semibold">{cat.name || `猫咪 ${index + 1}`}</h4><dl className="mt-3 grid gap-3 sm:grid-cols-2"><DetailRow label="性别 / 年龄 / 品种" value={[cat.gender, cat.age, cat.breed].filter(Boolean).join(" / ")} /><DetailRow label="猫砂" value={cat.litter_type} /><DetailRow label="主食与偏好" value={[cat.food, cat.food_preference].filter(Boolean).join("；")} /><DetailRow label="性格" value={cat.personality} /><DetailRow label="喂药" value={cat.medication_required ? cat.medication_notes || "需要喂药（未补充说明）" : "不需要"} /><DetailRow label="特殊情况" value={cat.special_notes} /><div className="sm:col-span-2"><DetailRow label="服务注意事项" value={cat.service_notes} /></div></dl></article>)}</div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">服务计划</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2"><DetailRow label="服务日期" value={`${valueOrDash(payload.service.start_date)} 至 ${valueOrDash(payload.service.end_date)}`} /><DetailRow label="每日次数" value={payload.service.visits_per_day ? `${payload.service.visits_per_day} 次` : null} /><DetailRow label="服务事项" value={payload.service.service_items.map((item) => labels.get(item) || item).join("、")} /><DetailRow label="补充备注" value={payload.notes} /><div className="sm:col-span-2"><DetailRow label="客户备注" value={payload.customer.notes} /></div></dl>
      </section>
    </div>
  );
}

export function AdminIntakePage() {
  const [tokens, setTokens] = useState<IntakeTokenRead[]>([]);
  const [submissions, setSubmissions] = useState<IntakeSubmissionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<IntakeSubmissionDetail | null>(null);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [confirmingConvert, setConfirmingConvert] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokenResponse, submissionResponse] = await Promise.all([
        listIntakeTokens(),
        listIntakeSubmissions(),
      ]);
      setTokens(tokenResponse.items);
      setSubmissions(submissionResponse.items);
      setSelectedId((current) => current && submissionResponse.items.some((item) => item.id === current)
        ? current
        : submissionResponse.items[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "客户填写记录加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([listIntakeTokens(), listIntakeSubmissions()])
      .then(([tokenResponse, submissionResponse]) => {
        if (!active) return;
        setTokens(tokenResponse.items);
        setSubmissions(submissionResponse.items);
        setSelectedId(submissionResponse.items[0]?.id ?? null);
        if (submissionResponse.items.length === 0) setDetail(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "客户填写记录加载失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    let active = true;
    getIntakeSubmission(selectedId)
      .then((response) => {
        if (active) setDetail(response);
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
      await navigator.clipboard.writeText(`${window.location.origin}${token.fill_path}`);
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

  async function handleReview() {
    if (!detail) return;
    setAction("review");
    setError(null);
    try {
      const reviewed = await reviewIntakeSubmission(detail.id, detail.revision);
      setDetail(reviewed);
      setSubmissions((current) => replaceSubmission(current, reviewed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标记审核失败，请刷新后重试。");
    } finally {
      setAction(null);
    }
  }

  async function handleConvert() {
    if (!detail) return;
    setAction("convert");
    setError(null);
    try {
      await convertIntakeSubmission(detail.id, detail.revision);
      const converted = await getIntakeSubmission(detail.id);
      setDetail(converted);
      setSubmissions((current) => replaceSubmission(current, converted));
      setConfirmingConvert(false);
      const tokenResponse = await listIntakeTokens();
      setTokens(tokenResponse.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认转换失败；系统未写入半套业务数据，请重试。");
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="cc-page cc-page--wide" aria-labelledby="intake-title">
      <PageHeader
        eyebrow="资料收集"
        title="客户填写"
        headingId="intake-title"
        description="生成专属链接、查看客户提交，并在人工确认后建立正式档案与待确认订单。"
        actions={<><Link to="/admin/customers" className="cc-button cc-button--secondary">返回客户档案</Link><button type="button" className="cc-button cc-button--secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} size={15} />刷新</button></>}
      />
      <div className="cc-alert mt-5 border border-emerald-200 bg-emerald-50 text-emerald-900"><ShieldCheck className="mt-0.5 shrink-0" size={17} /><span><strong>安全提示：</strong>后台资料已受管理员会话保护；填写链接只在生成时显示一次，请直接交给对应客户并妥善保管。</span></div>
      {error ? <div className="cc-alert cc-alert--danger mt-4" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="space-y-6">
          <section className="cc-surface p-5" aria-labelledby="new-link-title">
            <h2 id="new-link-title" className="flex items-center gap-2 font-semibold"><Link2 size={17} />生成填写链接</h2>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={handleCreate}><label className="text-sm font-medium text-slate-700">有效天数<input className="mt-1.5 block min-h-10 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={1} max={90} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} required /></label><button type="submit" className="cc-button cc-button--primary" disabled={action !== null}>{action === "create" ? <LoaderCircle className="animate-spin" size={15} /> : <Plus size={15} />}生成链接</button></form>
          </section>

          <section className="cc-surface overflow-hidden" aria-labelledby="links-title">
            <div className="border-b border-slate-200 px-5 py-4"><h2 id="links-title" className="font-semibold">填写链接（{tokens.length}）</h2></div>
            {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载…</div> : tokens.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">还没有填写链接。</p> : <ul className="divide-y divide-slate-100">{tokens.map((token) => <li key={token.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">链接 #{token.id}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${token.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{tokenStatusLabels[token.status]}</span>{token.submission_status ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{submissionStatusLabels[token.submission_status]}</span> : null}</div><p className="mt-2 text-xs text-slate-500">有效期至 {dateTime(token.expires_at)}</p>{token.fill_path ? <p className="mt-1 text-xs font-medium text-amber-700">新链接仅本次可查看，请立即复制保存</p> : <p className="mt-1 text-xs text-slate-400">链接原文未保存；需要时请重新生成</p>}</div></div><div className="mt-3 flex flex-wrap gap-2">{token.fill_path ? <><a href={token.fill_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium"><ExternalLink size={13} />打开</a><button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium" onClick={() => void handleCopy(token)}><ClipboardCopy size={13} />{copiedId === token.id ? "已复制" : "复制"}</button></> : null}{!token.submitted_at && token.status !== "expired" ? <button type="button" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium disabled:opacity-50" onClick={() => void handleTokenStatus(token)} disabled={action === `token-${token.id}`}>{token.status === "active" ? "关闭" : "恢复"}</button> : null}</div></li>)}</ul>}
          </section>
        </div>

        <section className="cc-surface min-w-0 overflow-hidden" aria-labelledby="submissions-title">
          <div className="border-b border-slate-200 px-5 py-4"><h2 id="submissions-title" className="font-semibold">提交审核（{submissions.length}）</h2><p className="mt-1 text-xs text-slate-500">列表仅显示摘要；手机号、详细地址、门禁和钥匙只在右侧详情中读取。</p></div>
          <div className="grid min-h-[600px] lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="cc-scrollbar overflow-y-auto border-b border-slate-200 bg-slate-50/60 lg:border-r lg:border-b-0" aria-label="提交记录列表">{loading ? <div className="flex justify-center py-12"><LoaderCircle className="animate-spin text-slate-400" size={18} /></div> : submissions.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">还没有客户提交。</p> : <ul className="p-2">{submissions.map((item) => <li key={item.id}><button type="button" className={`mb-1 w-full rounded-lg px-3 py-3 text-left ${selectedId === item.id ? "bg-indigo-600 text-white shadow-sm" : "hover:bg-slate-100"}`} onClick={() => { setSelectedId(item.id); setConfirmingConvert(false); }}><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold">{item.customer_name || "未填写姓名"}</span><span className={`shrink-0 text-[11px] ${selectedId === item.id ? "text-indigo-100" : "text-slate-500"}`}>{submissionStatusLabels[item.status]}</span></div><p className={`mt-1 truncate text-xs ${selectedId === item.id ? "text-indigo-100" : "text-slate-500"}`}>{item.community || "未填写小区"} · {item.cat_count} 只猫</p><p className={`mt-2 text-xs ${selectedId === item.id ? "text-indigo-100" : "text-slate-500"}`}>{item.start_date || "日期未填"} 至 {item.end_date || "—"}</p></button></li>)}</ul>}</aside>
            <div className="min-w-0 bg-slate-50/40 p-4 sm:p-5">{selectedId !== null && detail?.id !== selectedId ? <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />正在读取敏感详情…</div> : !detail ? <div className="flex min-h-80 flex-col items-center justify-center text-center text-sm text-slate-500"><FileCheck2 className="text-slate-300" size={34} /><p className="mt-3">选择一条提交查看详情。</p></div> : <div><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{detail.customer_name || "未填写姓名"}</h2><span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{submissionStatusLabels[detail.status]}</span></div><p className="mt-1 text-xs text-slate-500">提交于 {dateTime(detail.submitted_at)}</p></div><div className="flex flex-wrap gap-2">{detail.status === "submitted" ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50" onClick={() => void handleReview()} disabled={action !== null}>{action === "review" ? <LoaderCircle className="animate-spin" size={14} /> : <FileCheck2 size={14} />}标记已审核</button> : null}{detail.status === "submitted" || detail.status === "reviewed" ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => setConfirmingConvert(true)} disabled={action !== null}>{action === "convert" ? <LoaderCircle className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}确认并创建订单</button> : null}</div></div>{confirmingConvert && (detail.status === "submitted" || detail.status === "reviewed") ? <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="确认创建正式记录"><p className="text-sm font-semibold text-amber-950">请再次确认：将创建正式客户、猫咪、待确认订单和每日任务。</p><p className="mt-1 text-xs leading-5 text-amber-800">资料提交本身不会自动创建；只有点击下方确认按钮才会执行。</p><div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900" onClick={() => setConfirmingConvert(false)}>取消</button><button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => void handleConvert()}>再次确认创建</button></div></div> : null}{detail.status === "converted" && detail.converted_customer_id && detail.converted_order_id ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">已完成转换，重复操作不会创建重复记录。</p><div className="mt-2 flex flex-wrap gap-3"><Link className="font-medium underline underline-offset-4" to="/admin/customers">查看客户 #{detail.converted_customer_id}</Link><Link className="font-medium underline underline-offset-4" to="/admin/plans?view=orders">查看订单 #{detail.converted_order_id}</Link></div></div> : null}<PayloadDetail payload={detail.payload} /></div>}</div>
          </div>
        </section>
      </div>
    </section>
  );
}
