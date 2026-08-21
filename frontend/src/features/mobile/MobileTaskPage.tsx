import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  MapPin,
  Navigation,
  PawPrint,
  Phone,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { serviceItemOptions } from "../orders/constants";
import type { ServiceItem, TaskStatus } from "../orders/types";
import { planTaskStatusLabels } from "../plans/constants";
import {
  completeMobileTask,
  getMobileTask,
  MobileApiError,
  mobilePhotoUrl,
  saveMobileTaskText,
  startMobileTask,
  updateMobileChecklist,
  uploadMobileTaskPhoto,
} from "./api";
import type { MobileTaskExecutionDetail, NavigationState } from "./types";

const serviceLabels = Object.fromEntries(
  serviceItemOptions.map((item) => [item.value, item.label]),
) as Record<ServiceItem, string>;

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function statusStyle(status: TaskStatus): string {
  return {
    pending: "bg-amber-100 text-amber-800",
    confirmed: "bg-blue-100 text-blue-800",
    ready: "bg-cyan-100 text-cyan-800",
    in_progress: "bg-violet-100 text-violet-800",
    completed: "bg-emerald-100 text-emerald-800",
    exception: "bg-red-100 text-red-800",
    cancelled: "bg-slate-200 text-slate-600",
  }[status];
}

function addressLine(detail: MobileTaskExecutionDetail): string {
  return [
    detail.customer.community,
    detail.customer.address,
    detail.customer.building,
    detail.customer.unit,
    detail.customer.room,
  ].filter(Boolean).join(" · ") || "未填写地址";
}

function navigationMessage(state: NavigationState): string {
  return state === "missing_coordinates"
    ? "地址坐标尚未在电脑计划页解析，暂不能一键导航。"
    : "地图服务尚未配置，请按文字地址前往。";
}

function FieldValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value || "未填写"}</dd>
    </div>
  );
}

export function MobileTaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const validTaskId = Number.isInteger(taskId) && taskId > 0;
  const [detail, setDetail] = useState<MobileTaskExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [notes, setNotes] = useState("");
  const [catStatus, setCatStatus] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const applyDetail = useCallback((next: MobileTaskExecutionDetail, syncText = false) => {
    setDetail(next);
    if (syncText) {
      setNotes(next.notes ?? "");
      setCatStatus(next.cat_status ?? "");
    }
  }, []);

  const loadTask = useCallback(async () => {
    if (!validTaskId) {
      setError("任务编号无效，请从今日任务重新进入。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      applyDetail(await getMobileTask(taskId), true);
      setStale(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [applyDetail, taskId, validTaskId]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!validTaskId) throw new Error("任务编号无效，请从今日任务重新进入。");
        return getMobileTask(taskId);
      })
      .then((response) => {
        if (!active) return;
        applyDetail(response, true);
        setStale(false);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "任务加载失败，请重试。");
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
    if (cause instanceof MobileApiError && cause.status === 409) {
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
      applyDetail(await startMobileTask(detail.id, { expected_revision: detail.revision }), true);
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
      applyDetail(await updateMobileChecklist(detail.id, itemId, {
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
      applyDetail(await saveMobileTaskText(detail.id, {
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
      applyDetail(await uploadMobileTaskPhoto(detail.id, detail.revision, selectedPhoto));
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
      applyDetail(await completeMobileTask(detail.id, {
        expected_revision: detail.revision,
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
    <main className="min-h-dvh bg-slate-100 text-slate-950">
      <div className="mx-auto max-w-xl px-4 py-5 sm:px-5">
        <header>
          <div className="flex items-center justify-between gap-3">
            <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-700" to="/mobile">
              <ArrowLeft size={17} />今日任务
            </Link>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 disabled:opacity-50"
              aria-label="刷新任务"
              onClick={() => void loadTask()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} size={18} />
            </button>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">现场执行</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">单次喂猫任务</h1>
            </div>
            {detail ? (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(detail.status)}`}>
                {planTaskStatusLabels[detail.status]}
              </span>
            ) : null}
          </div>
        </header>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
          <ShieldAlert className="mt-0.5 shrink-0" size={16} />
          本页含地址、电话和门禁信息，仅限本机或可信局域网使用，禁止暴露到公网。
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{error}</span>
          </div>
        ) : null}

        {loading && !detail ? (
          <div className="mt-5 flex min-h-52 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />正在加载任务…
          </div>
        ) : !detail ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">无法显示该任务。</div>
        ) : (
          <div className="mt-5 space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold">{detail.customer.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">{detail.service_date} · 计划 {detail.planned_time?.slice(0, 5) || "待设置"} · 任务 #{detail.id}</p>
                </div>
                <PawPrint className="shrink-0 text-slate-400" size={23} />
              </div>

              <dl className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                <div className="flex gap-2"><MapPin className="mt-0.5 shrink-0 text-slate-400" size={17} /><FieldValue label="完整地址" value={addressLine(detail)} /></div>
                <div className="flex gap-2"><Phone className="mt-0.5 shrink-0 text-slate-400" size={17} /><FieldValue label="联系电话" value={detail.customer.phone} /></div>
                <FieldValue label="入户与门禁" value={[detail.customer.access_method, detail.customer.access_info].filter(Boolean).join(" · ") || null} />
                <div className="flex gap-2"><KeyRound className="mt-0.5 shrink-0 text-slate-400" size={17} /><FieldValue label="钥匙信息" value={[detail.customer.key_status, detail.customer.key_code].filter(Boolean).join(" · ") || null} /></div>
                <FieldValue label="订单服务备注" value={detail.order_notes} />
              </dl>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {detail.customer.phone ? (
                  <a className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-sm font-semibold" href={`tel:${detail.customer.phone}`}>
                    <Phone size={16} />联系客户
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500">未填写电话</span>
                )}
                {detail.navigation_url ? (
                  <a className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-sm font-semibold text-white" href={detail.navigation_url} target="_blank" rel="noreferrer">
                    <Navigation size={16} />一键导航
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-2 text-center text-xs leading-4 text-slate-500">暂不可导航</span>
                )}
              </div>
              {!detail.navigation_url ? <p className="mt-2 text-xs leading-5 text-amber-700">{navigationMessage(detail.navigation_state)}</p> : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">猫咪与服务要求</h2>
              <div className="mt-3 space-y-3">
                {detail.cats.map((cat) => (
                  <article key={cat.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-bold">{cat.name}{cat.is_active ? "" : "（已停用）"}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <FieldValue label="主粮" value={cat.food} />
                      <FieldValue label="饮食偏好" value={cat.food_preference} />
                      <FieldValue label="猫砂" value={cat.litter_type} />
                      <FieldValue label="用药" value={cat.medication_required ? cat.medication_notes || "需要用药，请核对档案" : "无需用药"} />
                    </dl>
                    {cat.service_notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">服务：{cat.service_notes}</p> : null}
                    {cat.special_notes ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-red-700">注意：{cat.special_notes}</p> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">执行状态</h2>
                  <p className="mt-1 text-xs text-slate-500">先开始任务，再记录现场情况。</p>
                </div>
                {startable ? (
                  <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void handleStart()} disabled={controlsDisabled}>
                    {busy === "start" ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}开始任务
                  </button>
                ) : null}
              </div>
              {detail.status === "pending" ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">任务尚未确认，请先在电脑后台确认。</p> : null}
              {terminal ? <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">任务已结束，现场记录现为只读。</p> : null}
              {detail.exception_notes ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">异常：{detail.exception_notes}</p> : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-bold">服务 Checklist</h2><p className="mt-1 text-xs text-slate-500">必做事项完成后才能结束任务</p></div>
                <span className="text-sm font-semibold text-slate-600">{detail.items.filter((item) => item.completed).length}/{detail.items.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {detail.items.map((item) => {
                  const photoItem = item.item_type === "photo";
                  return (
                    <label key={item.id} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 ${item.completed ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                      <input
                        type="checkbox"
                        className="size-5 accent-slate-900"
                        checked={item.completed}
                        onChange={(event) => void handleChecklist(item.id, event.target.checked)}
                        disabled={!editing || photoItem || controlsDisabled}
                        aria-label={`${serviceLabels[item.item_type]}${item.required ? "（必做）" : "（可选）"}`}
                      />
                      <span className="text-sm font-semibold">{serviceLabels[item.item_type]}</span>
                      <span className="ml-auto text-xs text-slate-500">{photoItem ? "上传后完成" : item.required ? "必做" : "可选"}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="flex items-center gap-2 font-bold"><Camera size={18} />现场照片</h2>
              {detail.photos.length ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {detail.photos.map((photo, index) => (
                    <a key={photo.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50" href={mobilePhotoUrl(photo.url)} target="_blank" rel="noreferrer">
                      <img className="aspect-square w-full object-cover" src={mobilePhotoUrl(photo.url)} alt={`现场照片 ${index + 1}`} />
                    </a>
                  ))}
                </div>
              ) : <p className="mt-3 text-sm text-slate-500">尚未上传现场照片。</p>}
              <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3">
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  aria-label="拍摄或选择现场照片"
                  disabled={!editing || controlsDisabled}
                  onChange={(event) => setSelectedPhoto(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold"
                />
                <button type="button" className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void handleUpload()} disabled={!editing || !selectedPhoto || controlsDisabled}>
                  {busy === "photo" ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}上传图片
                </button>
                <p className="mt-2 text-xs text-slate-500">JPEG / PNG / WebP，单张不超过 10 MiB</p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">现场记录</h2>
              <label className="mt-3 block text-sm font-semibold text-slate-700">猫咪状态
                <textarea className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-100" maxLength={4000} value={catStatus} onChange={(event) => setCatStatus(event.target.value)} disabled={!editing || controlsDisabled} placeholder="如：精神良好、正常进食饮水" />
              </label>
              <label className="mt-3 block text-sm font-semibold text-slate-700">本次备注
                <textarea className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-100" maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!editing || controlsDisabled} placeholder="记录喂养、清洁和客户沟通情况" />
              </label>
              <button type="button" className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-sm font-semibold disabled:opacity-40" onClick={() => void handleSaveText()} disabled={!editing || !textDirty || controlsDisabled}>
                {busy === "notes" ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存现场记录
              </button>
            </section>

            {editing ? (
              <section className="rounded-2xl bg-slate-900 p-4 text-white">
                <h2 className="font-bold">完成本次服务</h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">{textDirty ? "现场记录尚未保存" : missingRequired.length ? `仍有 ${missingRequired.length} 项必做事项未完成` : "必做事项已完成，请最后核对现场记录"}</p>
                <button type="button" className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-slate-900 disabled:opacity-40" onClick={() => void handleComplete()} disabled={missingRequired.length > 0 || textDirty || controlsDisabled}>
                  {busy === "complete" ? <LoaderCircle className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}完成本次服务
                </button>
              </section>
            ) : null}

            {stale ? <p className="text-sm leading-6 text-amber-700">当前页面已过期，刷新前所有执行按钮已锁定。</p> : null}
          </div>
        )}
      </div>
    </main>
  );
}
