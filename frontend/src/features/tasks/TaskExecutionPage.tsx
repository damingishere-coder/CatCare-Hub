import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock3,
  KeyRound,
  LoaderCircle,
  MapPin,
  PawPrint,
  Phone,
  Play,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { serviceItemOptions } from "../orders/constants";
import type { ServiceItem, TaskStatus } from "../orders/types";
import { planTaskStatusLabels } from "../plans/constants";
import {
  completeTaskExecution,
  getTaskExecution,
  markTaskException,
  saveTaskText,
  startTaskExecution,
  TaskApiError,
  taskPhotoUrl,
  updateTaskChecklist,
  uploadTaskPhoto,
} from "./api";
import type { TaskExecutionDetail } from "./types";

const serviceLabels = Object.fromEntries(
  serviceItemOptions.map((item) => [item.value, item.label]),
) as Record<ServiceItem, string>;

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function displayDateTime(value: string | null): string {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function addressLine(detail: TaskExecutionDetail): string {
  return [
    detail.customer.community,
    detail.customer.address,
    detail.customer.building,
    detail.customer.unit,
    detail.customer.room,
  ].filter(Boolean).join(" · ") || "未填写地址";
}

function statusStyle(status: TaskStatus): string {
  return {
    pending: "bg-amber-50 text-amber-700",
    confirmed: "bg-blue-50 text-blue-700",
    ready: "bg-cyan-50 text-cyan-700",
    in_progress: "bg-violet-50 text-violet-700",
    completed: "bg-emerald-50 text-emerald-700",
    exception: "bg-red-50 text-red-700",
    cancelled: "bg-slate-200 text-slate-600",
  }[status];
}

function FieldValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value || "未填写"}</dd>
    </div>
  );
}

export function TaskExecutionPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const validTaskId = Number.isInteger(taskId) && taskId > 0;
  const [detail, setDetail] = useState<TaskExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [notes, setNotes] = useState("");
  const [catStatus, setCatStatus] = useState("");
  const [exceptionNotes, setExceptionNotes] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const applyDetail = useCallback((next: TaskExecutionDetail, syncText = false) => {
    setDetail(next);
    if (syncText) {
      setNotes(next.notes ?? "");
      setCatStatus(next.cat_status ?? "");
      setExceptionNotes(next.exception_notes ?? "");
    }
  }, []);

  const loadTask = useCallback(async () => {
    if (!validTaskId) {
      setError("任务编号无效，请从订单计划重新进入。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await getTaskExecution(taskId);
      applyDetail(response, true);
      setStale(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务执行记录加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [applyDetail, taskId, validTaskId]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!validTaskId) throw new Error("任务编号无效，请从订单计划重新进入。");
        return getTaskExecution(taskId);
      })
      .then((response) => {
        if (!active) return;
        applyDetail(response, true);
        setStale(false);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "任务执行记录加载失败，请重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyDetail, taskId, validTaskId]);

  function handleMutationError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : "操作失败，请重试。";
    if (cause instanceof TaskApiError && cause.status === 409) {
      setStale(true);
      setError(`${message} 请刷新任务后再继续。`);
    } else {
      setError(message);
    }
  }

  async function handleStart() {
    if (!detail) return;
    setBusy("start");
    setError(null);
    try {
      applyDetail(await startTaskExecution(detail.id, { expected_revision: detail.revision }), true);
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function handleChecklist(itemId: number, completed: boolean) {
    if (!detail) return;
    setBusy(`item-${itemId}`);
    setError(null);
    try {
      applyDetail(await updateTaskChecklist(detail.id, itemId, {
        expected_revision: detail.revision,
        completed,
      }));
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveText() {
    if (!detail) return;
    setBusy("notes");
    setError(null);
    try {
      applyDetail(await saveTaskText(detail.id, {
        expected_revision: detail.revision,
        notes: optionalText(notes),
        cat_status: optionalText(catStatus),
      }), true);
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload() {
    if (!detail || !selectedPhoto) return;
    if (selectedPhoto.size > 10 * 1024 * 1024) {
      setError("单张图片不能超过 10 MiB。");
      return;
    }
    setBusy("photo");
    setError(null);
    try {
      applyDetail(await uploadTaskPhoto(detail.id, detail.revision, selectedPhoto));
      setSelectedPhoto(null);
      if (photoInput.current) photoInput.current.value = "";
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (!detail || !window.confirm("确认所有服务事项已完成，并结束本次服务吗？")) return;
    setBusy("complete");
    setError(null);
    try {
      applyDetail(await completeTaskExecution(detail.id, {
        expected_revision: detail.revision,
      }), true);
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function handleException() {
    if (!detail || !exceptionNotes.trim()) {
      setError("请先填写具体异常情况。");
      return;
    }
    if (!window.confirm("确认将本次服务标记为异常并结束执行吗？")) return;
    setBusy("exception");
    setError(null);
    try {
      applyDetail(await markTaskException(detail.id, {
        expected_revision: detail.revision,
        exception_notes: exceptionNotes.trim(),
      }), true);
    } catch (cause) {
      handleMutationError(cause);
    } finally {
      setBusy(null);
    }
  }

  const editing = detail?.status === "in_progress";
  const startable = detail?.status === "confirmed" || detail?.status === "ready";
  const terminal = detail
    ? ["completed", "exception", "cancelled"].includes(detail.status)
    : false;
  const textDirty = detail
    ? optionalText(notes) !== detail.notes || optionalText(catStatus) !== detail.cat_status
    : false;
  const missingRequired = detail?.items.filter((item) => item.required && !item.completed) ?? [];
  const controlsDisabled = Boolean(busy) || stale;

  return (
    <section className="mx-auto max-w-7xl" aria-labelledby="task-execution-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-950" to="/admin/plans">
            <ArrowLeft size={15} />返回订单计划
          </Link>
          <p className="mt-5 text-xs font-semibold tracking-wider text-slate-500 uppercase">P6 · 任务执行</p>
          <h1 id="task-execution-title" className="mt-1 text-2xl font-semibold tracking-tight">单次服务执行</h1>
          <p className="mt-2 text-sm text-slate-600">按实际现场情况逐项记录；完成或异常后将锁定执行历史。</p>
        </div>
        {detail ? (
          <div className="text-right">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusStyle(detail.status)}`}>{planTaskStatusLabels[detail.status]}</span>
            <p className="mt-2 text-xs text-slate-500">订单 #{detail.order_id} · 任务 #{detail.id}</p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{error}</span>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium" onClick={() => void loadTask()} disabled={loading}>
            <RefreshCw size={14} />刷新任务
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-8 flex min-h-80 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
          <LoaderCircle className="mr-2 animate-spin" size={18} />正在加载执行记录…
        </div>
      ) : !detail ? (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">无法显示该任务。</div>
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(300px,0.78fr)_minmax(480px,1.22fr)]">
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{detail.customer.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">服务日期 {detail.service_date} · 计划 {detail.planned_time?.slice(0, 5) || "待设置"}</p>
                </div>
                <PawPrint className="text-slate-400" size={22} />
              </div>
              <dl className="mt-5 space-y-4 border-t border-slate-100 pt-4">
                <div className="flex gap-2"><MapPin className="mt-0.5 shrink-0 text-slate-400" size={16} /><FieldValue label="服务地址" value={addressLine(detail)} /></div>
                <div className="flex gap-2"><Phone className="mt-0.5 shrink-0 text-slate-400" size={16} /><FieldValue label="联系电话" value={detail.customer.phone} /></div>
                <FieldValue label="入户方式" value={[detail.customer.access_method, detail.customer.access_info].filter(Boolean).join(" · ") || null} />
                <div className="flex gap-2"><KeyRound className="mt-0.5 shrink-0 text-slate-400" size={16} /><FieldValue label="钥匙信息" value={[detail.customer.key_status, detail.customer.key_code].filter(Boolean).join(" · ") || null} /></div>
                <FieldValue label="订单备注" value={detail.order_notes} />
              </dl>
              <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">本页包含现场敏感信息，仅限本地后台或可信私网使用。</p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-950">猫咪与服务要求</h2>
              <div className="mt-4 space-y-3">
                {detail.cats.map((cat) => (
                  <article key={cat.id} className="rounded-lg border border-slate-200 p-4">
                    <p className="font-semibold text-slate-900">{cat.name}{cat.is_active ? "" : "（已停用）"}</p>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      <FieldValue label="主粮" value={cat.food} />
                      <FieldValue label="饮食偏好" value={cat.food_preference} />
                      <FieldValue label="猫砂" value={cat.litter_type} />
                      <FieldValue label="用药" value={cat.medication_required ? cat.medication_notes || "需要用药，请核对档案" : "无需用药"} />
                    </dl>
                    {cat.service_notes ? <p className="mt-3 text-sm leading-6 text-slate-700">服务：{cat.service_notes}</p> : null}
                    {cat.special_notes ? <p className="mt-1 text-sm leading-6 text-red-700">注意：{cat.special_notes}</p> : null}
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">执行状态</h2>
                  <p className="mt-1 text-xs text-slate-500">开始：{displayDateTime(detail.started_at)} · 结束：{displayDateTime(detail.completed_at)}</p>
                </div>
                {startable ? (
                  <button type="button" className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handleStart()} disabled={controlsDisabled}>
                    {busy === "start" ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}开始本次服务
                  </button>
                ) : null}
              </div>
              {detail.status === "pending" ? <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">任务仍待确认，请先在订单计划中确认后再开始。</p> : null}
              {terminal ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">该任务已进入终态，执行记录为只读。</p> : null}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-lg font-semibold text-slate-950">服务事项 Checklist</h2><p className="mt-1 text-xs text-slate-500">必做事项全部完成后才能结束服务</p></div>
                <span className="text-sm text-slate-500">{detail.items.filter((item) => item.completed).length}/{detail.items.length}</span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {detail.items.map((item) => {
                  const photoItem = item.item_type === "photo";
                  return (
                    <label key={item.id} className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${item.completed ? "border-emerald-200 bg-emerald-50" : "border-slate-200"} ${editing && !photoItem ? "cursor-pointer" : ""}`}>
                      <input
                        type="checkbox"
                        className="size-4 accent-slate-900"
                        checked={item.completed}
                        onChange={(event) => void handleChecklist(item.id, event.target.checked)}
                        disabled={!editing || photoItem || controlsDisabled}
                        aria-label={`${serviceLabels[item.item_type]}${item.required ? "（必做）" : "（可选）"}`}
                      />
                      <span className="text-sm font-medium text-slate-800">{serviceLabels[item.item_type]}</span>
                      <span className="ml-auto text-xs text-slate-500">{photoItem ? "上传后完成" : item.required ? "必做" : "可选"}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2"><Camera size={18} className="text-slate-500" /><h2 className="text-lg font-semibold text-slate-950">现场照片</h2></div>
              {detail.photos.length ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {detail.photos.map((photo, index) => (
                    <a key={photo.id} href={taskPhotoUrl(photo.url)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      <img className="aspect-square w-full object-cover" src={taskPhotoUrl(photo.url)} alt={`任务照片 ${index + 1}`} />
                      <p className="truncate px-2 py-1.5 text-xs text-slate-500">{displayDateTime(photo.created_at)}</p>
                    </a>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-slate-500">尚未上传现场照片。</p>}
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3">
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择任务照片" disabled={!editing || controlsDisabled} onChange={(event) => setSelectedPhoto(event.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">JPEG / PNG / WebP，单张不超过 10 MiB</p>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handleUpload()} disabled={!editing || !selectedPhoto || controlsDisabled}>
                    {busy === "photo" ? <LoaderCircle className="animate-spin" size={15} /> : <Upload size={15} />}上传图片
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-950">执行记录</h2>
              <div className="mt-4 grid gap-4">
                <label className="text-sm font-medium text-slate-700">猫咪状态
                  <textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" maxLength={4000} value={catStatus} onChange={(event) => setCatStatus(event.target.value)} disabled={!editing || controlsDisabled} placeholder="如：精神良好、正常进食饮水" />
                </label>
                <label className="text-sm font-medium text-slate-700">本次备注
                  <textarea className="mt-2 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!editing || controlsDisabled} placeholder="记录本次喂养、清洁和客户沟通情况" />
                </label>
                <button type="button" className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40" onClick={() => void handleSaveText()} disabled={!editing || !textDirty || controlsDisabled}>
                  {busy === "notes" ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}保存执行记录
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-red-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><AlertTriangle className="text-red-600" size={18} />异常处理</h2>
              <label className="mt-4 block text-sm font-medium text-slate-700">异常情况
                <textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" maxLength={4000} value={exceptionNotes} onChange={(event) => setExceptionNotes(event.target.value)} disabled={!editing || controlsDisabled} placeholder="异常时必须记录现象及已经采取的措施" />
              </label>
              {detail.exception_notes ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-red-50 px-3 py-2 text-sm leading-6 text-red-800">{detail.exception_notes}</p> : null}
              {editing && textDirty ? <p className="mt-3 text-xs text-amber-700">请先保存猫咪状态和本次备注，再结束任务。</p> : null}
              <button type="button" className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40" onClick={() => void handleException()} disabled={!editing || !exceptionNotes.trim() || textDirty || controlsDisabled}>
                {busy === "exception" ? <LoaderCircle className="animate-spin" size={15} /> : <AlertTriangle size={15} />}标记异常并结束
              </button>
            </section>

            {editing ? (
              <section className="rounded-xl border border-slate-300 bg-slate-900 p-5 text-white">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">完成本次服务</h2>
                    <p className="mt-1 text-sm text-slate-300">{textDirty ? "执行记录尚未保存" : missingRequired.length ? `仍有 ${missingRequired.length} 项必做事项未完成` : "必做事项已全部完成，请最后核对记录"}</p>
                  </div>
                  <button type="button" className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-40" onClick={() => void handleComplete()} disabled={missingRequired.length > 0 || textDirty || controlsDisabled}>
                    {busy === "complete" ? <LoaderCircle className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}完成本次服务
                  </button>
                </div>
              </section>
            ) : null}

            {stale ? <p className="flex items-center gap-2 text-sm text-amber-700"><Clock3 size={15} />当前页面已过期，刷新前所有执行按钮已锁定。</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
