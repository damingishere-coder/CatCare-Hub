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

import { ConnectionErrorAlert } from "../../components/ui/ConnectionErrorAlert";
import { RouteMap } from "./RouteMap";
import { hasAmapBrowserKey, hasAmapBrowserSecurityCode } from "./mapProvider";
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
    <div className="rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200/70">
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
  onRetry: () => void;
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
  onRetry,
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
  const browserMapConfigured = hasAmapBrowserKey() && hasAmapBrowserSecurityCode();
  const canPreview = Boolean(
    workspace?.provider.configured
    && activeTaskCount
    && !dirty
    && !previewing
    && !adopting,
  );

  return (
    <section className="min-h-[620px] border-b border-[#e4e8ef] bg-[#f7f8fb] xl:border-r xl:border-b-0" aria-labelledby="route-map-title">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="cc-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <MapPinned size={18} />
            <h2 id="route-map-title" className="text-sm font-semibold text-slate-950">路线地图</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workspace?.provider.configured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>高德后端：{workspace ? (workspace.provider.configured ? "已配置" : "未配置") : "状态未知"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${browserMapConfigured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>街道底图：{browserMapConfigured ? "已配置" : "未配置"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workspace?.recommendation_provider?.configured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>GPT 建议：{workspace ? (workspace.recommendation_provider?.configured ? "已配置" : "未配置") : "状态未知"}</span>
            {dirty ? <span className="ml-auto text-xs font-medium text-amber-700">顺序待保存</span> : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            只有点击生成路线后，才会把用于导航的完整地址和路线坐标发送给地图服务；不会发送姓名、电话、门禁、钥匙或备注信息。
          </p>
          {!workspace?.provider.configured && workspace?.provider.message ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{workspace.provider.message}</p>
          ) : null}
          {!browserMapConfigured ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">街道底图缺少 JS API Key 或安全密钥；补充 Vite 环境变量后必须重启前端。</p> : null}
          {workspace?.recommendation_message ? <p className={`mt-2 rounded-md px-3 py-2 text-xs leading-5 ${workspace.recommendation_source === "openai" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{workspace.recommendation_message}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="cc-button cc-button--primary"
              onClick={onPreview}
              disabled={!canPreview}
            >
              {previewing ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              {workspace?.current_route ? "刷新路线" : "生成路线"}
            </button>
            {workspace?.recommended_route ? (
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" aria-label="路线视图">
                <button type="button" className={`min-h-10 rounded-xl px-2.5 py-1.5 text-xs font-medium ${routeView === "current" ? "bg-[#FF9500] text-[#1D1D1F]" : "text-slate-600"}`} onClick={() => selectRouteView("current")}>当前</button>
                <button type="button" className={`min-h-10 rounded-xl px-2.5 py-1.5 text-xs font-medium ${routeView === "recommended" ? "bg-[#FF9500] text-[#1D1D1F]" : "text-slate-600"}`} onClick={() => selectRouteView("recommended")}>推荐</button>
              </div>
            ) : null}
            {workspace?.recommended_route ? (
              <button
                type="button"
                className="cc-button cc-button--secondary border-orange-200 text-orange-700"
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
          <ConnectionErrorAlert className="text-xs" message={error} onRetry={onRetry} />
        ) : null}

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
