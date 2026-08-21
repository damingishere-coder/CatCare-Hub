import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { serviceItemOptions } from "../orders/constants";
import type { ServiceItem } from "../orders/types";
import {
  getDayPlan,
  getPlanDays,
  getPlanRoute,
  getPlanTask,
  previewPlanRoute,
  saveDaySchedule,
  updatePlanTaskStatus,
} from "./api";
import { editablePlanStatuses, planTaskStatusLabels } from "./constants";
import { RouteWorkspace } from "./RouteWorkspace";
import type {
  DayPlan,
  PlanDaySummary,
  PlanRouteWorkspace as PlanRouteWorkspaceData,
  PlanTaskDetail,
  PlanTaskStatus,
  PlanTaskSummary,
} from "./types";

const serviceLabels = Object.fromEntries(
  serviceItemOptions.map((item) => [item.value, item.label]),
) as Record<ServiceItem, string>;

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chooseInitialDate(days: PlanDaySummary[]): string {
  const today = localDateValue();
  if (days.some((day) => day.service_date === today)) return today;
  const future = days.find((day) => day.service_date > today);
  return future?.service_date ?? days.at(-1)?.service_date ?? today;
}

function displayDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function timeValue(value: string | null): string {
  return value?.slice(0, 5) ?? "";
}

function addressLine(detail: PlanTaskDetail): string {
  return [
    detail.customer.community,
    detail.customer.address,
    detail.customer.building,
    detail.customer.unit,
    detail.customer.room,
  ]
    .filter(Boolean)
    .join(" · ") || "未填写地址";
}

function statusStyle(status: PlanTaskStatus): string {
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

interface DailyPlansPageProps {
  onDirtyChange: (dirty: boolean) => void;
}

export function DailyPlansPage({ onDirtyChange }: DailyPlansPageProps) {
  const [days, setDays] = useState<PlanDaySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [draftTasks, setDraftTasks] = useState<PlanTaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<PlanTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [routeWorkspace, setRouteWorkspace] = useState<PlanRouteWorkspaceData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routePreviewing, setRoutePreviewing] = useState(false);
  const [routeAdopting, setRouteAdopting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dayRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const routeRequestId = useRef(0);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const refreshDays = useCallback(async () => {
    const response = await getPlanDays();
    setDays(response.items);
    return response.items;
  }, []);

  const loadRoute = useCallback(async (serviceDate: string, hasTasks = true) => {
    const requestId = ++routeRequestId.current;
    setRouteError(null);
    if (!hasTasks) {
      setRouteWorkspace(null);
      setRouteLoading(false);
      return;
    }
    setRouteLoading(true);
    try {
      const response = await getPlanRoute(serviceDate);
      if (requestId === routeRequestId.current) setRouteWorkspace(response);
    } catch (cause) {
      if (requestId === routeRequestId.current) {
        setRouteWorkspace(null);
        setRouteError(cause instanceof Error ? cause.message : "路线数据加载失败，请重试。");
      }
    } finally {
      if (requestId === routeRequestId.current) setRouteLoading(false);
    }
  }, []);

  const loadDay = useCallback(async (serviceDate: string, preferredTaskId?: number) => {
    const requestId = ++dayRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getDayPlan(serviceDate);
      if (requestId !== dayRequestId.current) return;
      setPlan(response);
      setDraftTasks(response.tasks);
      setDirty(false);
      void loadRoute(serviceDate, response.tasks.length > 0);
      setSelectedTaskId((current) => {
        const desired = preferredTaskId ?? current;
        if (desired && response.tasks.some((task) => task.id === desired)) return desired;
        return response.tasks[0]?.id ?? null;
      });
      if (response.tasks.length === 0) setTaskDetail(null);
    } catch (cause) {
      if (requestId === dayRequestId.current) {
        setPlan(null);
        setDraftTasks([]);
        setSelectedTaskId(null);
        setTaskDetail(null);
        setRouteWorkspace(null);
        setError(cause instanceof Error ? cause.message : "当日计划加载失败，请重试。");
      }
    } finally {
      if (requestId === dayRequestId.current) setLoading(false);
    }
  }, [loadRoute]);

  useEffect(() => {
    let active = true;
    getPlanDays()
      .then((response) => {
        if (!active) return;
        const items = response.items;
        setDays(items);
        const initialDate = chooseInitialDate(items);
        setSelectedDate(initialDate);
        void loadDay(initialDate);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "计划日期加载失败，请重试。");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadDay]);

  useEffect(() => {
    if (selectedTaskId === null) return;
    const requestId = ++detailRequestId.current;
    getPlanTask(selectedTaskId)
      .then((detail) => {
        if (requestId === detailRequestId.current) setTaskDetail(detail);
      })
      .catch((cause: unknown) => {
        if (requestId === detailRequestId.current) {
          setTaskDetail(null);
          setError(cause instanceof Error ? cause.message : "任务详情加载失败，请重试。");
        }
      })
      .finally(() => {
        if (requestId === detailRequestId.current) setDetailLoading(false);
      });
  }, [selectedTaskId]);

  function selectDate(nextDate: string) {
    setSelectedDate(nextDate);
    setTaskDetail(null);
    void loadDay(nextDate);
  }

  function selectTask(taskId: number) {
    if (taskId === selectedTaskId) return;
    setDetailLoading(true);
    setSelectedTaskId(taskId);
  }

  function updateDraft(next: PlanTaskSummary[]) {
    setDraftTasks(next);
    setDirty(true);
  }

  function moveTask(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draftTasks.length || plan?.schedule_locked || routeBusy) return;
    const next = [...draftTasks];
    [next[index], next[destination]] = [next[destination], next[index]];
    setRouteWorkspace((current) => current ? {
      ...current,
      current_route: null,
      recommended_route: null,
      recommended_task_ids: [],
      can_adopt_recommendation: false,
    } : current);
    updateDraft(next);
  }

  function updateTime(taskId: number, value: string) {
    if (routeBusy) return;
    updateDraft(
      draftTasks.map((task) =>
        task.id === taskId ? { ...task, planned_time: value || null } : task,
      ),
    );
  }

  function discardChanges() {
    if (!plan) return;
    setDraftTasks(plan.tasks);
    setDirty(false);
    void loadRoute(selectedDate, plan.tasks.length > 0);
  }

  async function handleSave() {
    if (!plan || !dirty || routeBusy) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveDaySchedule(selectedDate, {
        expected_revision: plan.revision,
        tasks: draftTasks.map((task) => ({
          task_id: task.id,
          planned_time: task.planned_time ? timeValue(task.planned_time) : null,
        })),
      });
      setPlan(saved);
      setDraftTasks(saved.tasks);
      setDirty(false);
      await loadRoute(selectedDate, saved.tasks.length > 0);
      await refreshDays();
      if (selectedTaskId) setTaskDetail(await getPlanTask(selectedTaskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "排程保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(taskStatus: PlanTaskStatus) {
    if (!plan || !taskDetail || dirty || routeBusy || taskStatus === taskDetail.task.status) return;
    setStatusSaving(true);
    setError(null);
    try {
      const detail = await updatePlanTaskStatus(taskDetail.task.id, {
        expected_revision: plan.revision,
        task_status: taskStatus,
      });
      setTaskDetail(detail);
      await loadDay(selectedDate, detail.task.id);
      await refreshDays();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务状态更新失败，请重试。");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleRoutePreview() {
    if (!plan || dirty || routePreviewing) return;
    setRoutePreviewing(true);
    setRouteError(null);
    try {
      const workspace = await previewPlanRoute(selectedDate, {
        expected_revision: plan.revision,
        geocode_missing: true,
      });
      setRouteWorkspace(workspace);
      if (workspace.revision !== plan.revision) {
        setPlan({ ...plan, revision: workspace.revision });
      }
    } catch (cause) {
      setRouteError(cause instanceof Error ? cause.message : "路线生成失败，请重试。");
    } finally {
      setRoutePreviewing(false);
    }
  }

  async function handleAdoptRecommendation() {
    if (!plan || !routeWorkspace?.can_adopt_recommendation || dirty) return;
    const tasksById = new Map(draftTasks.map((task) => [task.id, task]));
    const recommendedTasks = routeWorkspace.recommended_task_ids.map((taskId) => tasksById.get(taskId));
    if (recommendedTasks.some((task) => !task)) {
      setRouteError("推荐路线已过期，请重新生成后再采用。");
      return;
    }

    setRouteAdopting(true);
    setRouteError(null);
    try {
      const saved = await saveDaySchedule(selectedDate, {
        expected_revision: routeWorkspace.revision,
        tasks: recommendedTasks.map((task) => ({
          task_id: task!.id,
          planned_time: task!.planned_time ? timeValue(task!.planned_time) : null,
        })),
      });
      setPlan(saved);
      setDraftTasks(saved.tasks);
      setDirty(false);
      setRouteWorkspace({
        ...routeWorkspace,
        revision: saved.revision,
        current_route: routeWorkspace.recommended_route,
        recommended_route: null,
        recommended_task_ids: [],
        can_adopt_recommendation: false,
        markers: routeWorkspace.markers.map((marker) => ({
          ...marker,
          sequence: saved.tasks.findIndex((task) => task.id === marker.task_id) + 1,
        })),
      });
      await refreshDays();
      if (selectedTaskId) setTaskDetail(await getPlanTask(selectedTaskId));
    } catch (cause) {
      setRouteError(cause instanceof Error ? cause.message : "推荐路线采用失败，请重试。");
    } finally {
      setRouteAdopting(false);
    }
  }

  const currentDay = days.find((day) => day.service_date === selectedDate);
  const detailStatusEditable =
    taskDetail &&
    !taskDetail.task.has_execution_history &&
    !["cancelled", "completed"].includes(taskDetail.order_status);
  const selectedRouteMarker = routeWorkspace?.markers.find(
    (marker) => marker.task_id === selectedTaskId,
  );
  const routeBusy = routePreviewing || routeAdopting;

  return (
    <>
      {error ? (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 shrink-0" size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid min-h-[720px] overflow-hidden rounded-xl border border-slate-200 bg-white xl:grid-cols-[340px_minmax(360px,1fr)_340px]">
        <aside className="border-b border-slate-200 xl:border-r xl:border-b-0" aria-label="按天计划">
          <div className="border-b border-slate-200 p-4">
            <label className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              跳转日期
              <input
                type="date"
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={selectedDate}
                onChange={(event) => selectDate(event.target.value)}
                disabled={dirty || routeBusy}
              />
            </label>
            <div className="mt-3 max-h-36 space-y-1 overflow-y-auto" aria-label="有任务的日期">
              {days.map((day) => (
                <button
                  key={day.service_date}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedDate === day.service_date ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
                  onClick={() => selectDate(day.service_date)}
                  disabled={dirty || routeBusy}
                >
                  <span className="font-medium">{displayDate(day.service_date)}</span>
                  <span className={selectedDate === day.service_date ? "text-slate-300" : "text-slate-500"}>
                    {day.order_count} 单 / {day.cat_count} 只猫
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selectedDate ? displayDate(selectedDate) : "当日任务"}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {currentDay ? `${currentDay.task_count} 个任务 · ${currentDay.order_count} 笔订单` : "当天暂无任务"}
              </p>
            </div>
            {dirty ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">未保存</span> : null}
          </div>

          <div className="max-h-[520px] overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载…</div>
            ) : draftTasks.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                <CalendarDays className="mx-auto mb-3 text-slate-300" size={32} />
                这一天没有任务
              </div>
            ) : (
              <ol className="space-y-2">
                {draftTasks.map((task, index) => (
                  <li key={task.id} className={`rounded-lg border p-3 ${selectedTaskId === task.id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                    <div className="flex items-start gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectTask(task.id)}>
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{index + 1}</span>
                          <span className="truncate text-sm font-semibold text-slate-900">{task.customer.name}</span>
                        </div>
                        <p className="mt-1.5 truncate text-xs text-slate-500">{task.customer.community || "未填写小区"} · {task.cats.length} 只猫</p>
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(task.status)}`}>{planTaskStatusLabels[task.status]}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
                      <label className="text-xs text-slate-500">
                        计划时间
                        <input
                          type="time"
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                          aria-label={`任务 #${task.id} 计划时间`}
                          value={timeValue(task.planned_time)}
                          onChange={(event) => updateTime(task.id, event.target.value)}
                          disabled={plan?.schedule_locked || saving || routeBusy}
                        />
                      </label>
                      <div className="flex gap-1">
                        <button type="button" className="rounded-md border border-slate-300 p-2 text-slate-600 disabled:opacity-30" aria-label={`上移 ${task.customer.name} 任务`} onClick={() => moveTask(index, -1)} disabled={index === 0 || plan?.schedule_locked || saving || routeBusy}><ArrowUp size={14} /></button>
                        <button type="button" className="rounded-md border border-slate-300 p-2 text-slate-600 disabled:opacity-30" aria-label={`下移 ${task.customer.name} 任务`} onClick={() => moveTask(index, 1)} disabled={index === draftTasks.length - 1 || plan?.schedule_locked || saving || routeBusy}><ArrowDown size={14} /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-slate-200 p-3">
            {plan?.schedule_locked ? <p className="mb-2 text-xs leading-5 text-amber-700">当天已有执行记录，时间与顺序已锁定。</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40" onClick={discardChanges} disabled={!dirty || saving || routeBusy}><RotateCcw size={15} />撤销</button>
              <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void handleSave()} disabled={!dirty || saving || routeBusy || plan?.schedule_locked}>{saving ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}保存排程</button>
            </div>
          </div>
        </aside>

        <RouteWorkspace
          workspace={routeWorkspace}
          tasks={draftTasks}
          selectedTaskId={selectedTaskId}
          loading={routeLoading}
          previewing={routePreviewing}
          adopting={routeAdopting}
          dirty={dirty}
          error={routeError}
          onSelectTask={selectTask}
          onPreview={() => void handleRoutePreview()}
          onAdopt={() => void handleAdoptRecommendation()}
        />

        <aside className="bg-white" aria-label="任务详情">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">任务 / 客户信息</p>
            <p className="mt-0.5 text-xs text-slate-500">仅在选中单个任务后读取现场所需摘要</p>
          </div>
          <div className="max-h-[760px] overflow-y-auto p-4">
            {detailLoading || (selectedTaskId && taskDetail?.task.id !== selectedTaskId) ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载详情…</div>
            ) : !taskDetail ? (
              <div className="py-12 text-center text-sm text-slate-500"><Check className="mx-auto mb-3 text-slate-300" size={32} />请选择一个任务</div>
            ) : (
              <div className="space-y-5">
                <section>
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-lg font-semibold text-slate-950">{taskDetail.customer.name}</p><p className="mt-1 text-xs text-slate-500">订单 #{taskDetail.task.order_id} · 任务 #{taskDetail.task.id}</p></div>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle(taskDetail.task.status)}`}>{planTaskStatusLabels[taskDetail.task.status]}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{addressLine(taskDetail)}</p>
                  {selectedRouteMarker?.navigation_url ? (
                    <a
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      href={selectedRouteMarker.navigation_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />打开高德导航
                    </a>
                  ) : null}
                </section>

                <section className="rounded-lg bg-slate-50 p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Clock3 size={14} />计划到达</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{timeValue(taskDetail.task.planned_time) || "待设置"}</p>
                  {taskDetail.estimated_arrival ? <p className="mt-1 text-xs text-slate-500">路线预计：{new Date(taskDetail.estimated_arrival).toLocaleString("zh-CN")}</p> : null}
                </section>

                <section>
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">猫咪</h3>
                  <div className="mt-2 space-y-2">
                    {taskDetail.cats.map((cat) => (
                      <article key={cat.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-semibold text-slate-900">{cat.name}{cat.is_active ? "" : "（已停用）"}</p>
                        {cat.medication_required ? <p className="mt-1 text-xs leading-5 text-red-700">用药：{cat.medication_notes || "需要用药，请核对档案"}</p> : null}
                        {cat.service_notes ? <p className="mt-1 text-xs leading-5 text-slate-600">服务：{cat.service_notes}</p> : null}
                        {cat.special_notes ? <p className="mt-1 text-xs leading-5 text-slate-600">注意：{cat.special_notes}</p> : null}
                      </article>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">本次服务</h3>
                  <ul className="mt-2 space-y-1.5">
                    {taskDetail.task.items.map((item) => (
                      <li key={item.item_type} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{serviceLabels[item.item_type]}</span><span className="text-xs text-slate-500">{item.completed ? "已完成" : item.required ? "必做" : "可选"}</span></li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">备注</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{[taskDetail.order_notes, taskDetail.task_notes].filter(Boolean).join("\n") || "未填写"}</p>
                  <p className="mt-2 text-xs text-slate-500">已有照片：{taskDetail.photo_count} 张（P6 再提供上传与查看）</p>
                </section>

                <section className="border-t border-slate-200 pt-4">
                  <label className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    计划状态
                    <select
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                      aria-label="任务状态"
                      value={taskDetail.task.status}
                      onChange={(event) => void handleStatusChange(event.target.value as PlanTaskStatus)}
                      disabled={!detailStatusEditable || dirty || statusSaving || routeBusy}
                    >
                      {!editablePlanStatuses.includes(taskDetail.task.status) ? <option value={taskDetail.task.status}>{planTaskStatusLabels[taskDetail.task.status]}</option> : null}
                      {editablePlanStatuses.map((status) => <option key={status} value={status}>{planTaskStatusLabels[status]}</option>)}
                    </select>
                  </label>
                  {dirty ? <p className="mt-2 text-xs leading-5 text-amber-700">请先保存或撤销排程，再修改状态。</p> : null}
                  {!detailStatusEditable ? <p className="mt-2 text-xs leading-5 text-slate-500">执行历史或订单状态已锁定该任务；进行中、完成和异常由 P6 执行流程维护。</p> : null}
                </section>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
