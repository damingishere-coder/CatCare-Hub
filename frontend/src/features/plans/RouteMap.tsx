import { useEffect, useMemo, useRef, useState } from "react";

import {
  AmapMapProvider,
  hasAmapBrowserKey,
  hasAmapBrowserSecurityCode,
  markerDisplayOffset,
} from "./mapProvider";
import type {
  PlanGeoPoint,
  PlanRouteMarker,
  PlanRoutePath,
  PlanRouteStart,
} from "./types";

interface RouteMapProps {
  providerName: string;
  start: PlanRouteStart | null;
  markers: PlanRouteMarker[];
  route: PlanRoutePath | null;
  selectedTaskId: number | null;
  onSelectTask: (taskId: number) => void;
}

interface ProjectedPoint {
  left: number;
  top: number;
}

function projectPoints(points: PlanGeoPoint[]): (point: PlanGeoPoint) => ProjectedPoint {
  const meanLatitude = points.reduce((total, point) => total + point.latitude, 0) / points.length;
  const longitudeScale = Math.cos((meanLatitude * Math.PI) / 180);
  const horizontalValues = points.map((point) => point.longitude * longitudeScale);
  const latitudes = points.map((point) => point.latitude);
  const minimumHorizontal = Math.min(...horizontalValues);
  const maximumHorizontal = Math.max(...horizontalValues);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const horizontalRange = maximumHorizontal - minimumHorizontal;
  const latitudeRange = maximumLatitude - minimumLatitude;
  const largestRange = Math.max(horizontalRange, latitudeRange);
  const horizontalCenter = (minimumHorizontal + maximumHorizontal) / 2;
  const latitudeCenter = (minimumLatitude + maximumLatitude) / 2;
  return (point) => ({
    left: largestRange
      ? 50 + ((point.longitude * longitudeScale - horizontalCenter) / largestRange) * 84
      : 50,
    top: largestRange
      ? 50 - ((point.latitude - latitudeCenter) / largestRange) * 84
      : 50,
  });
}

function CoordinateCanvas({
  start,
  markers,
  route,
  selectedTaskId,
  onSelectTask,
}: Omit<RouteMapProps, "providerName">) {
  const points = [
    ...(start ? [start.position] : []),
    ...markers.map((marker) => marker.position),
    ...(route?.polyline ?? []),
  ];
  if (!points.length) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
        暂无可显示坐标；请先补充客户地址并生成路线。
      </div>
    );
  }
  const project = projectPoints(points);
  const polyline = route?.polyline.map((point) => {
    const projected = project(point);
    return `${projected.left},${projected.top}`;
  }).join(" ");

  return (
    <div className="relative h-full overflow-hidden bg-slate-100">
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" role="img" aria-label="按真实坐标绘制的路线">
        <defs>
          <pattern id="route-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#cbd5e1" strokeWidth="0.25" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#route-grid)" />
        {polyline ? <polyline points={polyline} fill="none" stroke="#0f172a" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" /> : null}
      </svg>
      {start ? (() => {
        const projected = project(start.position);
        return <span className="absolute flex -translate-1/2 items-center gap-1 rounded-full border-2 border-white bg-emerald-700 px-2 py-1 text-xs font-bold whitespace-nowrap text-white shadow-md" style={{ left: `${projected.left}%`, top: `${projected.top}%` }} title={`${start.label}（起点与终点）`}>家 · 起终点</span>;
      })() : null}
      {markers.map((marker, index) => {
        const projected = project(marker.position);
        const offset = markerDisplayOffset(markers, index);
        return (
          <button
            key={marker.task_id}
            type="button"
            className={`absolute flex max-w-36 -translate-1/2 items-center gap-1 rounded-full border-2 border-white px-2 py-1 text-xs font-bold whitespace-nowrap text-white shadow-md ${selectedTaskId === marker.task_id ? "bg-orange-700 ring-2 ring-orange-300" : "bg-[#FF9500]"}`}
            style={{
              left: `${projected.left}%`,
              top: `${projected.top}%`,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
            aria-label={`地图任务 ${marker.sequence}：${marker.customer_name}`}
            title={marker.address || marker.community || marker.customer_name}
            onClick={() => onSelectTask(marker.task_id)}
          >
            <span>{marker.sequence}</span>
            <span className="hidden max-w-24 truncate md:inline">{marker.customer_name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RouteMap(props: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const selectTask = useRef(props.onSelectTask);
  const [amapFailed, setAmapFailed] = useState(false);
  const canUseAmap = props.providerName === "amap" && hasAmapBrowserKey() && hasAmapBrowserSecurityCode() && !amapFailed;
  const modelKey = useMemo(
    () => JSON.stringify({
      start: props.start,
      markers: props.markers,
      route: props.route,
      selectedTaskId: props.selectedTaskId,
    }),
    [props.markers, props.route, props.selectedTaskId, props.start],
  );

  useEffect(() => {
    selectTask.current = props.onSelectTask;
  }, [props.onSelectTask]);

  useEffect(() => {
    if (!canUseAmap || !container.current) return;
    let cleanup: (() => void) | undefined;
    let active = true;
    const provider = new AmapMapProvider();
    provider
      .mount(
        container.current,
        {
          start: props.start,
          markers: props.markers,
          polyline: props.route?.polyline ?? [],
          selectedTaskId: props.selectedTaskId,
        },
        (taskId) => selectTask.current(taskId),
      )
      .then((dispose) => {
        if (active) cleanup = dispose;
        else dispose();
      })
      .catch(() => {
        if (active) setAmapFailed(true);
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [canUseAmap, modelKey, props.markers, props.route, props.selectedTaskId, props.start]);

  return (
    <div className="relative h-[390px] overflow-hidden rounded-[10px] border border-slate-200/80 bg-slate-100 shadow-inner">
      {canUseAmap ? <div ref={container} className="size-full" aria-label="高德路线地图" /> : (
        <CoordinateCanvas
          start={props.start}
          markers={props.markers}
          route={props.route}
          selectedTaskId={props.selectedTaskId}
          onSelectTask={props.onSelectTask}
        />
      )}
      {!canUseAmap ? (
        <p className="absolute right-2 bottom-2 rounded bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow-sm">
          {amapFailed ? "街道底图加载失败，已切换坐标画布" : "未配置街道底图，按真实坐标展示"}
        </p>
      ) : null}
    </div>
  );
}
