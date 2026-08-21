import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  MapPinned,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { RouteMap } from "./RouteMap";
import type {
  PlanRouteIssueReason,
  PlanRoutePath,
  PlanRouteWorkspace as PlanRouteWorkspaceData,
  PlanTaskSummary,
} from "./types";

const issueLabels: Record<PlanRouteIssueReason, string> = {
  missing_address: "缺少可解析地址",
  not_geocoded: "地址尚未解析",
  geocode_failed: "地图未找到该地址",
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

function MetricCard({ label, route }: { label: string; route: PlanRoutePath }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">
        {distanceLabel(route.distance_meters)} · {durationLabel(route.duration_seconds)}
      </p>
    </div>
  );
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
  onAdopt: () => void;
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
  onAdopt,
}: RouteWorkspaceProps) {
  const [routeSelection, setRouteSelection] = useState<{
    revision: string | undefined;
    view: "current" | "recommended";
  }>({ revision: workspace?.revision, view: "current" });
  const routeView = routeSelection.revision === workspace?.revision
    ? routeSelection.view
    : "current";
  const selectRouteView = (view: "current" | "recommended") => {
    setRouteSelection({ revision: workspace?.revision, view });
  };

  const selectedRoute = routeView === "recommended"
    ? workspace?.recommended_route ?? workspace?.current_route ?? null
    : workspace?.current_route ?? null;
  const markers = useMemo(() => {
    if (!workspace) return [];
    const order = selectedRoute?.task_ids ?? tasks
      .filter((task) => task.status !== "cancelled")
      .map((task) => task.id);
    const sequence = new Map(order.map((taskId, index) => [taskId, index + 1]));
    return workspace.markers
      .map((marker) => ({ ...marker, sequence: sequence.get(marker.task_id) ?? marker.sequence }))
      .sort((left, right) => left.sequence - right.sequence);
  }, [selectedRoute?.task_ids, tasks, workspace]);
  const activeTaskCount = tasks.filter((task) => task.status !== "cancelled").length;
  const canPreview = Boolean(
    workspace?.provider.configured
    && activeTaskCount
    && !dirty
    && !previewing
    && !adopting,
  );

  return (
    <section className="min-h-[620px] border-b border-slate-200 bg-slate-50 xl:border-r xl:border-b-0" aria-labelledby="route-map-title">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <MapPinned size={18} />
            <h2 id="route-map-title" className="text-sm font-semibold text-slate-950">路线地图</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workspace?.provider.configured ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {workspace?.provider.configured ? `${workspace.provider.name} 已连接` : "地图未配置"}
            </span>
            {dirty ? <span className="ml-auto text-xs font-medium text-amber-700">顺序待保存</span> : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            只有点击生成路线后，才会把小区、地址、楼栋和路线坐标发送给地图服务；不会发送姓名、房号、电话、门禁或钥匙信息。
          </p>
          {!workspace?.provider.configured && workspace?.provider.message ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{workspace.provider.message}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              onClick={onPreview}
              disabled={!canPreview}
            >
              {previewing ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              {workspace?.current_route ? "刷新路线" : "生成路线"}
            </button>
            {workspace?.recommended_route ? (
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" aria-label="路线视图">
                <button type="button" className={`rounded px-2.5 py-1.5 text-xs ${routeView === "current" ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => selectRouteView("current")}>当前</button>
                <button type="button" className={`rounded px-2.5 py-1.5 text-xs ${routeView === "recommended" ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => selectRouteView("recommended")}>推荐</button>
              </div>
            ) : null}
            {workspace?.recommended_route ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-white px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-40"
                onClick={onAdopt}
                disabled={!workspace.can_adopt_recommendation || dirty || adopting || previewing}
              >
                {adopting ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />}
                一键采用推荐
              </button>
            ) : null}
          </div>
          {dirty ? <p className="mt-2 text-xs text-amber-700">请先保存或撤销人工排程，再生成路线。</p> : null}
          {workspace?.recommended_route && !workspace.can_adopt_recommendation ? (
            <p className="mt-2 text-xs text-slate-500">
              {workspace.schedule_locked ? "已有执行历史，路线只能查看，不能改变顺序。" : "当前顺序已经与推荐顺序一致。"}
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" role="alert">
            <AlertTriangle className="mt-0.5 shrink-0" size={15} />{error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[390px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-500">
            <LoaderCircle className="animate-spin" size={17} />正在加载路线数据…
          </div>
        ) : activeTaskCount === 0 ? (
          <div className="flex min-h-[390px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">当天没有需要规划路线的任务</div>
        ) : (
          <RouteMap
            providerName={workspace?.provider.name ?? "disabled"}
            start={workspace?.start ?? null}
            markers={markers}
            route={selectedRoute}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
          />
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {workspace?.current_route ? <MetricCard label="当前路线" route={workspace.current_route} /> : null}
          {workspace?.recommended_route ? <MetricCard label="推荐路线" route={workspace.recommended_route} /> : null}
        </div>

        {workspace?.unresolved_tasks.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><AlertTriangle size={14} />{workspace.unresolved_tasks.length} 个任务暂未进入路线</p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800">
              {workspace.unresolved_tasks.map((issue) => <li key={issue.task_id}>任务 #{issue.task_id} · {issue.customer_name}：{issueLabels[issue.reason]}</li>)}
            </ul>
          </div>
        ) : workspace?.current_route ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} />所有未取消任务均已进入路线</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Route size={14} />路线指标尚未生成，人工顺序仍可正常使用。</p>
        )}
      </div>
    </section>
  );
}
