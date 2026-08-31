import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  MapPinned,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react";
import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { RouteMap } from "./RouteMap";
import { hasAmapBrowserKey, hasAmapBrowserSecurityCode } from "./mapProvider";
import type {
  PlanRouteIssueReason,
  PlanRoutePath,
  PlanRouteWorkspace as PlanRouteWorkspaceData,
  PlanTaskSummary,
  PlanGeoPoint,
} from "./types";

const issueLabels: Record<PlanRouteIssueReason, string> = {
  missing_address: "缺少可解析地址",
  not_geocoded: "地址尚未解析",
  geocode_failed: "地图未找到该地址",
  stale_geocode: "旧坐标待重新验证",
  geocode_mismatch: "地图结果与填写地区不一致",
  execution_location_missing: "执行任务缺少地点快照",
};

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function durationLabel(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function methodLabel(method: "exact" | "two_opt" | "none"): string {
  return {
    exact: "精确全局优化",
    two_opt: "多起点最近邻 + 2-opt",
    none: "单地点闭环",
  }[method];
}

interface RouteWorkspaceProps {
  workspace: PlanRouteWorkspaceData | null;
  tasks: PlanTaskSummary[];
  selectedTaskId: number | null;
  loading: boolean;
  previewing: boolean;
  adopting: boolean;
  dirty: boolean;
  error: string | null;
  onSelectTask: (taskId: number) => void;
  onPreview: () => void;
  onRetry: () => void;
  onAdopt: () => void;
  locationEditing?: boolean;
  draftPosition?: PlanGeoPoint | null;
  onDraftPositionChange?: (position: PlanGeoPoint) => void;
  onAmapReadyChange?: (ready: boolean) => void;
}

export function RouteWorkspace({
  workspace,
  tasks,
  selectedTaskId,
  loading,
  previewing,
  adopting,
  dirty,
  error,
  onSelectTask,
  onPreview,
  onRetry,
  onAdopt,
  locationEditing = false,
  draftPosition = null,
  onDraftPositionChange,
  onAmapReadyChange,
}: RouteWorkspaceProps) {
  const optimization = workspace?.optimization ?? null;
  const roadRoute = workspace?.road_route ?? null;
  const optimizedTaskIds = optimization?.optimized_task_ids ?? [];
  const markers = (() => {
    if (!workspace) return [];
    const orderByTask = new Map(tasks.map((task) => [task.id, task.order_id]));
    const markerIds = new Set(workspace.markers.map((marker) => marker.task_id));
    const taskOrder = optimizedTaskIds.length
      ? optimizedTaskIds.filter((taskId) => markerIds.has(taskId))
      : tasks.filter((task) => task.status !== "cancelled").map((task) => task.id);
    const sequence = new Map(taskOrder.map((taskId, index) => [taskId, index + 1]));
    return workspace.markers
      .map((marker) => ({
        ...marker,
        order_id: orderByTask.get(marker.task_id),
        sequence: sequence.get(marker.task_id) ?? marker.sequence,
      }))
      .sort((left, right) => left.sequence - right.sequence);
  })();
  let mapRoute: PlanRoutePath | null = roadRoute?.path ?? null;
  if (!mapRoute && workspace?.start && optimization && markers.length) {
    mapRoute = {
      task_ids: optimization.optimized_task_ids,
      distance_meters: 0,
      duration_seconds: 0,
      polyline: [
        workspace.start.position,
        ...markers.map((marker) => marker.position),
        workspace.start.position,
      ],
    };
  }
  const activeTaskCount = tasks.filter((task) => task.status !== "cancelled").length;
  const browserMapConfigured = hasAmapBrowserKey() && hasAmapBrowserSecurityCode();
  const canPreview = Boolean(
    workspace?.provider.configured
    && activeTaskCount
    && !dirty
    && !previewing
    && !adopting
    && !locationEditing,
  );
  const closedRouteLabel = optimization && workspace?.start
    ? [workspace.start.label, ...markers.map((marker) => marker.customer_name), workspace.start.label].join(" → ")
    : null;

  return (
    <section className="min-h-[620px] border-b border-[#e4e8ef] bg-[#f7f8fb] xl:border-r xl:border-b-0" aria-labelledby="route-map-title">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="cc-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <MapPinned size={18} />
            <h2 id="route-map-title" className="text-sm font-semibold text-slate-950">路线地图</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workspace?.provider.configured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>高德后端：{workspace ? (workspace.provider.configured ? "已配置" : "未配置") : "状态未知"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${browserMapConfigured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>街道底图：{browserMapConfigured ? "已配置" : "未配置"}</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">闭环：家 → 客户 → 家</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">任务：{activeTaskCount} 个</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workspace?.unresolved_tasks.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>地址：{workspace ? (workspace.unresolved_tasks.length ? `${workspace.unresolved_tasks.length} 个待处理` : "已验证") : "状态未知"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${roadRoute?.status === "ready" ? "bg-emerald-50 text-emerald-700" : roadRoute?.status === "degraded" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>真实道路：{roadRoute?.status === "ready" ? "已生成" : roadRoute?.status === "degraded" ? "暂不可用" : "待规划"}</span>
            {dirty ? <span className="ml-auto text-xs font-medium text-amber-700">顺序待保存</span> : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            先用当天全部已验证地址做闭环全局优化，再只向高德请求最终顺序的电动车道路路线。姓名、电话、微信、门禁、钥匙和备注不会发送给地图服务。
          </p>
          {!workspace?.provider.configured && workspace?.provider.message ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{workspace.provider.message}</p>
          ) : null}
          {!browserMapConfigured ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">街道底图缺少 JS API Key 或安全密钥；补充 Vite 环境变量后必须重启前端。</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="cc-button cc-button--primary" onClick={onPreview} disabled={!canPreview}>
              {previewing ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              规划当天路线
            </button>
            {optimization ? (
              <button
                type="button"
                className="cc-button cc-button--secondary border-orange-200 text-orange-700"
                onClick={onAdopt}
                disabled={!workspace?.can_adopt_recommendation || dirty || adopting || previewing}
              >
                {adopting ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />}
                采用优化顺序
              </button>
            ) : null}
          </div>
          {dirty ? <p className="mt-2 text-xs text-amber-700">请先保存或撤销人工排程，再规划路线。</p> : null}
          {locationEditing ? <p className="mt-2 text-xs font-medium text-orange-700">正在修改客户定位：请点击地图放置新锚点，或拖动橙色锚点微调；此时不能规划路线。</p> : null}
          {optimization && !workspace?.can_adopt_recommendation ? (
            <p className="mt-2 text-xs text-slate-500">
              {workspace?.schedule_locked ? "已有执行历史，路线只能查看，不能改变顺序。" : "当前排程已经采用这个优化顺序。"}
            </p>
          ) : null}
        </div>

        {error ? <ConnectionErrorAlert className="text-xs" message={error} onRetry={onRetry} /> : null}

        {loading ? (
          <div className="cc-surface flex min-h-[390px] items-center justify-center gap-2 text-sm text-slate-500">
            <LoaderCircle className="animate-spin" size={17} />正在加载路线数据…
          </div>
        ) : activeTaskCount === 0 ? (
          <div className="cc-empty min-h-[390px] rounded-lg border border-dashed border-slate-300 bg-white">当天没有需要规划路线的任务</div>
        ) : (
          <RouteMap
            providerName={workspace?.provider.name ?? "disabled"}
            start={workspace?.start ?? null}
            markers={markers}
            route={mapRoute}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            locationEditing={locationEditing}
            draftPosition={draftPosition}
            onDraftPositionChange={onDraftPositionChange}
            onAmapReadyChange={onAmapReadyChange}
          />
        )}

        {optimization ? (
          <div className="cc-surface grid gap-3 p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">闭环顺序</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{closedRouteLabel}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">本地优化</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{methodLabel(optimization.method)}</p>
              <p className="mt-1 text-xs text-slate-500">计划时间只约束客户先后，未定时任务可插入合适位置。</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">空间估算</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {distanceLabel(optimization.baseline_estimated_distance_meters)} → {distanceLabel(optimization.optimized_estimated_distance_meters)}
              </p>
              <p className="mt-1 text-xs text-emerald-700">预计改善 {optimization.estimated_savings_percent.toFixed(1)}%</p>
            </div>
            {roadRoute?.status === "ready" && roadRoute.path ? (
              <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase">高德实际电动车路线</p>
                <p className="mt-1 text-sm font-semibold text-emerald-950">{distanceLabel(roadRoute.path.distance_meters)} · {durationLabel(roadRoute.path.duration_seconds)}</p>
              </div>
            ) : null}
            {roadRoute?.status === "degraded" ? (
              <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><AlertTriangle size={14} />真实道路路线暂不可用</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">{roadRoute.message || "已保留本地优化顺序；不会显示推测的道路里程和耗时。"}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {workspace?.unresolved_tasks.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><AlertTriangle size={14} />{workspace.unresolved_tasks.length} 个任务未通过地址验证，暂不生成不完整路线</p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800">
              {workspace.unresolved_tasks.map((issue) => <li key={issue.task_id}>任务 #{issue.task_id} · {issue.customer_name}：{issueLabels[issue.reason]}</li>)}
            </ul>
          </div>
        ) : optimization ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} />所有未取消任务均已进入闭环路线</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Route size={14} />点击“规划当天路线”后显示优化顺序与真实电动车路线。</p>
        )}
      </div>
    </section>
  );
}
