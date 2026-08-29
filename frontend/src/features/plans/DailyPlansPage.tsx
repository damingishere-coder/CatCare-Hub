import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Save,
  GripVertical,
  LocateFixed,
} from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { arrayMove } from "@dnd-kit/helpers";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { serviceItemOptions } from "../orders/constants";
import { customerAddress } from "../../lib/customerDisplay";
import type { ServiceItem } from "../orders/types";
import {
  getDayPlan,
  getPlanDays,
  getPlanRoute,
  getPlanTask,
  previewPlanRoute,
  saveDaySchedule,
  updatePlanTaskStatus,
  updateTaskLocation,
  restoreTaskAutomaticLocation,
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
  PlanGeoPoint,
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

function chooseInitialDate(days: PlanDaySummary[], requested?: string | null): string {
  if (requested && days.some((day) => day.service_date === requested)) return requested;
  const today = localDateValue();
  if (days.some((day) => day.service_date === today)) return today;
  const future = days.find((day) => day.service_date > today);
  return future?.service_date ?? days.at(-1)?.service_date ?? today;
}

function displayDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function dayCustomerLabel(customerNames: string[]): string {
  if (!customerNames.length) return "客户待确认";
  const visibleNames = customerNames.slice(0, 2).join("、");
  const hiddenCount = customerNames.length - 2;
  return hiddenCount > 0 ? `${visibleNames} · 另 ${hiddenCount} 位` : visibleNames;
}

function timeValue(value: string | null): string {
  return value?.slice(0, 5) ?? "";
}

function addressLine(detail: PlanTaskDetail): string {
  return customerAddress(detail.customer) || "未填写地址";
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

function SortableTaskItem({ taskId, index, disabled, selected, children }: {
  taskId: number;
  index: number;
  disabled: boolean;
  selected: boolean;
  children: React.ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: taskId, index, disabled });
  return (
    <li ref={ref} className={`relative rounded-xl border p-3 transition-all ${selected ? "border-orange-200 bg-orange-50/70 shadow-sm" : "border-transparent bg-slate-50/70 hover:border-slate-200 hover:bg-white"} ${isDragging ? "z-10 opacity-70 shadow-lg" : ""}`}>
      <button ref={handleRef} type="button" className="absolute top-2 right-2 cursor-grab rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 active:cursor-grabbing disabled:cursor-not-allowed" aria-label={`拖动任务 #${taskId} 排序`} disabled={disabled}><GripVertical size={16} /></button>
      {children}
    </li>
  );
}

interface DailyPlansPageProps {
  onDirtyChange: (dirty: boolean) => void;
}

export function DailyPlansPage({ onDirtyChange }: DailyPlansPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDate = searchParams.get("date");
  const requestedTaskValue = Number(searchParams.get("task_id"));
  const requestedTaskId = Number.isInteger(requestedTaskValue) && requestedTaskValue > 0
    ? requestedTaskValue
    : undefined;
  const initialRequest = useRef({ date: requestedDate, taskId: requestedTaskId });
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
  const [locationEditing, setLocationEditing] = useState(false);
  const [draftLocation, setDraftLocation] = useState<PlanGeoPoint | null>(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [amapReady, setAmapReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dayRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const routeRequestId = useRef(0);

  useEffect(() => onDirtyChange(dirty || locationEditing), [dirty, locationEditing, onDirtyChange]);

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
        const initialDate = chooseInitialDate(items, initialRequest.current.date);
        setSelectedDate(initialDate);
        void loadDay(initialDate, initialRequest.current.taskId);
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
    if (locationEditing) return;
    setSelectedDate(nextDate);
    setTaskDetail(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("date", nextDate);
      next.delete("task_id");
      return next;
    });
    void loadDay(nextDate);
  }

  function selectTask(taskId: number) {
    if (locationEditing) return;
    if (taskId === selectedTaskId) return;
    setDetailLoading(true);
    setSelectedTaskId(taskId);
    if (selectedDate) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("date", selectedDate);
        next.set("task_id", String(taskId));
        return next;
      });
    }
  }

  function updateDraft(next: PlanTaskSummary[]) {
    setDraftTasks(next);
    setDirty(true);
  }

  function invalidateRouteWorkspace() {
    setRouteWorkspace((current) => current ? {
      ...current,
      optimization: null,
      road_route: {
        status: "not_generated",
        path: null,
        message: null,
      },
      can_adopt_recommendation: false,
    } : current);
  }

  function moveTask(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draftTasks.length || plan?.schedule_locked || routeBusy) return;
    const next = [...draftTasks];
    [next[index], next[destination]] = [next[destination], next[index]];
    invalidateRouteWorkspace();
    updateDraft(next);
  }

  function handleDragEnd(event: { canceled: boolean; operation: { source: { id: string | number } | null; target: { id: string | number } | null } }) {
    if (event.canceled || plan?.schedule_locked || routeBusy) return;
    const sourceId = Number(event.operation.source?.id);
    const targetId = Number(event.operation.target?.id);
    const sourceIndex = draftTasks.findIndex((task) => task.id === sourceId);
    const targetIndex = draftTasks.findIndex((task) => task.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    invalidateRouteWorkspace();
    updateDraft(arrayMove(draftTasks, sourceIndex, targetIndex));
  }

  function updateTime(taskId: number, value: string) {
    if (routeBusy) return;
    invalidateRouteWorkspace();
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
    const optimizedTaskIds = routeWorkspace?.optimization?.optimized_task_ids;
    if (!plan || !routeWorkspace?.can_adopt_recommendation || !optimizedTaskIds || dirty) return;
    const tasksById = new Map(draftTasks.map((task) => [task.id, task]));
    const recommendedTasks = optimizedTaskIds.map((taskId) => tasksById.get(taskId));
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
      await loadRoute(selectedDate, saved.tasks.length > 0);
      await refreshDays();
      if (selectedTaskId) setTaskDetail(await getPlanTask(selectedTaskId));
    } catch (cause) {
      setRouteError(cause instanceof Error ? cause.message : "推荐路线采用失败，请重试。");
    } finally {
      setRouteAdopting(false);
    }
  }

  function beginLocationEdit() {
    if (!taskDetail || !amapReady || dirty || routeBusy) return;
    setDraftLocation(taskDetail.current_position ?? selectedRouteMarker?.position ?? null);
    setLocationMessage(null);
    setLocationEditing(true);
    invalidateRouteWorkspace();
  }

  function cancelLocationEdit() {
    if (locationSaving) return;
    setLocationEditing(false);
    setDraftLocation(null);
    void loadRoute(selectedDate, draftTasks.length > 0);
  }

  async function saveLocation() {
    if (!taskDetail || !plan || !draftLocation || locationSaving) return;
    const scope = taskDetail.location_scope === "customer"
      ? `将同步 ${taskDetail.location_sync_order_count ?? 0} 笔同地址订单、${taskDetail.location_sync_task_count ?? 0} 个未执行任务`
      : `未关联客户档案，仅修改订单 #${taskDetail.task.order_id} 及其未执行任务`;
    if (!window.confirm(`确认保存 ${taskDetail.customer.name} 的新定位？\n${scope}\n地址文字不会改变。`)) return;
    setLocationSaving(true);
    setError(null);
    try {
      const result = await updateTaskLocation(taskDetail, draftLocation, {
        serviceDate: selectedDate,
        dayRevision: plan.revision,
      });
      setLocationMessage(`定位已保存：同步 ${result.affected_orders} 笔订单、${result.affected_tasks} 个未执行任务。请重新规划当天路线。`);
      setLocationEditing(false);
      setDraftLocation(null);
      await loadDay(selectedDate, taskDetail.task.id);
      await refreshDays();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "客户定位保存失败，请刷新后重试。");
    } finally {
      setLocationSaving(false);
    }
  }

  async function restoreAutomaticLocation() {
    if (!taskDetail || !plan || dirty || routeBusy || locationEditing) return;
    if (!window.confirm("确认按当前地址重新进行高德自动定位？解析失败会保留现有手动锚点。")) return;
    setLocationSaving(true);
    setError(null);
    try {
      const result = await restoreTaskAutomaticLocation(taskDetail, {
        serviceDate: selectedDate,
        dayRevision: plan.revision,
      });
      setLocationMessage(`已恢复地址自动定位，并同步 ${result.affected_orders} 笔订单、${result.affected_tasks} 个未执行任务。`);
      await loadDay(selectedDate, taskDetail.task.id);
      await refreshDays();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地址自动定位失败，已保留原手动锚点。");
    } finally {
      setLocationSaving(false);
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
  const routeBusy = routePreviewing || routeAdopting || locationSaving;

  return (
    <>
      {error ? (
        <ConnectionErrorAlert
          className="mb-4"
          message={error}
          onRetry={() => void loadDay(selectedDate || localDateValue())}
        />
      ) : null}

      <div className="cc-surface grid min-h-[720px] overflow-hidden xl:grid-cols-[minmax(280px,0.82fr)_minmax(360px,1.35fr)_minmax(300px,0.9fr)] 2xl:grid-cols-[320px_minmax(420px,1fr)_360px]">
        <aside className="border-b border-[#e4e8ef] bg-white xl:border-r xl:border-b-0" aria-label="按天计划">
          <div className="border-b border-[#e4e8ef] p-4">
            <label className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              跳转日期
              <input
                type="date"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                value={selectedDate}
                onChange={(event) => selectDate(event.target.value)}
                disabled={dirty || routeBusy}
              />
            </label>
            <div className="cc-scrollbar mt-3 max-h-36 space-y-1 overflow-y-auto" aria-label="有任务的日期">
              {days.map((day) => (
                <button
                  key={day.service_date}
                  type="button"
                  className={`flex min-h-14 w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm ${selectedDate === day.service_date ? "bg-[#FF9500] text-[#1D1D1F] shadow-sm" : "text-slate-700 hover:bg-slate-50"}`}
                  onClick={() => selectDate(day.service_date)}
                  disabled={dirty || routeBusy}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{displayDate(day.service_date)}</span>
                    <span className={`mt-0.5 block truncate text-xs ${selectedDate === day.service_date ? "text-orange-950/75" : "text-slate-500"}`} title={day.customer_names.join("、")}>
                      {dayCustomerLabel(day.customer_names)}
                    </span>
                  </span>
                  <span className={`shrink-0 pt-0.5 text-xs ${selectedDate === day.service_date ? "text-orange-950/70" : "text-slate-500"}`}>
                    {day.order_count} 单 / {day.cat_count} 只猫
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-[#e4e8ef] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selectedDate ? displayDate(selectedDate) : "当日任务"}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {currentDay ? `${currentDay.task_count} 个任务 · ${currentDay.order_count} 笔订单` : "当天暂无任务"}
              </p>
            </div>
            {dirty ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">未保存</span> : null}
          </div>

          <div className="cc-scrollbar max-h-[520px] overflow-y-auto p-2.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={17} />正在加载…</div>
            ) : draftTasks.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                <CalendarDays className="mx-auto mb-3 text-slate-300" size={32} />
                这一天没有任务
              </div>
            ) : (
              <DragDropProvider onDragEnd={handleDragEnd}>
              <ol className="space-y-2">
                {draftTasks.map((task, index) => (
                  <SortableTaskItem key={task.id} taskId={task.id} index={index} disabled={Boolean(plan?.schedule_locked || saving || routeBusy)} selected={selectedTaskId === task.id}>
                    <div className="flex items-start gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectTask(task.id)}>
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#FF9500] text-xs font-semibold text-[#1D1D1F]">{index + 1}</span>
                          <span className="truncate text-sm font-semibold text-slate-900">{task.customer.name}</span>
                        </div>
                        <p className="mt-1.5 truncate text-xs text-slate-500">{task.customer.address || "地址待查看"} · {task.cat_count} 只猫</p>
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(task.status)}`}>{planTaskStatusLabels[task.status]}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
                      <label className="text-xs text-slate-500">
                        计划时间
                        <input
                          type="time"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-100"
                          aria-label={`任务 #${task.id} 计划时间`}
                          value={timeValue(task.planned_time)}
                          onChange={(event) => updateTime(task.id, event.target.value)}
                          disabled={plan?.schedule_locked || saving || routeBusy}
                        />
                      </label>
                      <div className="flex gap-1">
                        <button type="button" className="cc-icon-button min-h-9 min-w-9 p-2" aria-label={`上移 ${task.customer.name} 任务`} onClick={() => moveTask(index, -1)} disabled={index === 0 || plan?.schedule_locked || saving || routeBusy}><ArrowUp size={14} /></button>
                        <button type="button" className="cc-icon-button min-h-9 min-w-9 p-2" aria-label={`下移 ${task.customer.name} 任务`} onClick={() => moveTask(index, 1)} disabled={index === draftTasks.length - 1 || plan?.schedule_locked || saving || routeBusy}><ArrowDown size={14} /></button>
                      </div>
                    </div>
                  </SortableTaskItem>
                ))}
              </ol>
              </DragDropProvider>
            )}
          </div>

          <div className="border-t border-[#e4e8ef] bg-white p-3">
            {plan?.schedule_locked ? <p className="mb-2 text-xs leading-5 text-amber-700">当天已有执行记录，时间与顺序已锁定。</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="cc-button cc-button--secondary" onClick={discardChanges} disabled={!dirty || saving || routeBusy}><RotateCcw size={15} />撤销</button>
              <button type="button" className="cc-button cc-button--primary" onClick={() => void handleSave()} disabled={!dirty || saving || routeBusy || plan?.schedule_locked}>{saving ? <LoaderCircle className="animate-spin" size={15} /> : <Save size={15} />}保存排程</button>
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
          dirty={dirty || locationEditing}
          error={routeError}
          onSelectTask={selectTask}
          onPreview={() => void handleRoutePreview()}
          onRetry={() => void loadRoute(selectedDate, draftTasks.length > 0)}
          onAdopt={() => void handleAdoptRecommendation()}
          locationEditing={locationEditing}
          draftPosition={draftLocation}
          onDraftPositionChange={setDraftLocation}
          onAmapReadyChange={setAmapReady}
        />

        <aside className="bg-white" aria-label="任务详情">
          <div className="border-b border-[#e4e8ef] px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">任务 / 客户信息</p>
            <p className="mt-0.5 text-xs text-slate-500">仅在选中单个任务后读取现场所需摘要</p>
          </div>
          <div className="cc-scrollbar max-h-[760px] overflow-y-auto p-4">
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
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-slate-800">客户地图锚点</span><span>{taskDetail.location_scope === "customer" ? "同步客户档案" : "仅此订单"}</span></div>
                    <p className="mt-1">当前：{taskDetail.current_position ? `${taskDetail.current_position.longitude.toFixed(6)}, ${taskDetail.current_position.latitude.toFixed(6)}` : "尚无可信坐标"}</p>
                    {!amapReady ? <p className="mt-1 font-medium text-amber-700">高德街道底图未成功加载，只能查看，不能修改定位。</p> : null}
                    {locationMessage ? <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-800">{locationMessage}</p> : null}
                    {locationEditing ? <div className="mt-3 space-y-2 rounded-md bg-white p-2"><p><strong>原地址：</strong>{addressLine(taskDetail)}</p><p><strong>原定位：</strong>{taskDetail.current_position ? `${taskDetail.current_position.longitude.toFixed(6)}, ${taskDetail.current_position.latitude.toFixed(6)}` : "无"}</p><p><strong>新定位：</strong>{draftLocation ? `${draftLocation.longitude.toFixed(6)}, ${draftLocation.latitude.toFixed(6)}` : "请点击地图选择"}</p><p><strong>同步范围：</strong>{taskDetail.location_scope === "customer" ? `${taskDetail.location_sync_order_count ?? 0} 笔同地址订单、${taskDetail.location_sync_task_count ?? 0} 个未执行任务` : `订单 #${taskDetail.task.order_id} 的未执行任务`}</p><div className="flex gap-2"><button type="button" className="cc-button cc-button--secondary min-h-9 flex-1 px-2 text-xs" onClick={cancelLocationEdit} disabled={locationSaving}>取消</button><button type="button" className="cc-button cc-button--primary min-h-9 flex-1 px-2 text-xs" onClick={() => void saveLocation()} disabled={!draftLocation || locationSaving}>{locationSaving ? <LoaderCircle className="animate-spin" size={13} /> : null}确认定位</button></div></div> : <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="cc-button cc-button--secondary min-h-9 px-2.5 text-xs" onClick={beginLocationEdit} disabled={!amapReady || dirty || routeBusy || taskDetail.task.has_execution_history}><LocateFixed size={14} />修改客户定位</button>{taskDetail.route_geocode_status === "manual" ? <button type="button" className="cc-button cc-button--secondary min-h-9 px-2.5 text-xs" onClick={() => void restoreAutomaticLocation()} disabled={dirty || routeBusy}><RotateCcw size={14} />恢复地址自动定位</button> : null}</div>}
                  </div>
                  {selectedRouteMarker?.navigation_url ? (
                    <a
                      className="cc-button cc-button--secondary mt-3"
                      href={selectedRouteMarker.navigation_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />打开高德导航
                    </a>
                  ) : null}
                  <Link
                    className={`cc-button cc-button--primary mt-2 ${(dirty || saving || routeBusy) ? "pointer-events-none opacity-40" : ""}`}
                    to={`/admin/tasks/${taskDetail.task.id}`}
                    aria-disabled={dirty || saving || routeBusy}
                    tabIndex={dirty || saving || routeBusy ? -1 : undefined}
                    onClick={(event) => {
                      if (dirty || saving || routeBusy) event.preventDefault();
                    }}
                  >
                    <ClipboardCheck size={14} />{taskDetail.task.has_execution_history ? "查看执行记录" : "进入任务执行"}
                  </Link>
                </section>

                <section className="cc-surface-muted p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Clock3 size={14} />计划到达</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{timeValue(taskDetail.task.planned_time) || "待设置"}</p>
                  {taskDetail.estimated_arrival ? <p className="mt-1 text-xs text-slate-500">路线预计：{new Date(taskDetail.estimated_arrival).toLocaleString("zh-CN")}</p> : null}
                </section>

                <section>
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">猫咪</h3>
                  <div className="mt-2 space-y-2">
                    {taskDetail.cats.map((cat, index) => (
                      <article key={cat.id ?? `${cat.name}-${index}`} className="rounded-lg bg-slate-50/80 p-3">
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
                      <li key={item.item_type} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{serviceLabels[item.item_type]}</span><span className="text-xs text-slate-500">{item.completed ? "已完成" : item.required ? "必做" : "可选"}</span></li>
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
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-100"
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
