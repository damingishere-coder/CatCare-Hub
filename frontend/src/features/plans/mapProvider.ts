import type { PlanGeoPoint, PlanRouteMarker, PlanRouteStart } from "./types";

export interface MapRenderModel {
  start: PlanRouteStart | null;
  markers: PlanRouteMarker[];
  polyline: PlanGeoPoint[];
  selectedTaskId: number | null;
}

export interface MapProvider {
  mount(
    container: HTMLElement,
    model: MapRenderModel,
    onSelectTask: (taskId: number) => void,
  ): Promise<() => void>;
}

export interface MarkerDisplayOffset {
  x: number;
  y: number;
}

export function markerDisplayOffset(
  markers: PlanRouteMarker[],
  markerIndex: number,
): MarkerDisplayOffset {
  const marker = markers[markerIndex];
  const matchingIndexes = markers
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => (
      candidate.position.latitude === marker.position.latitude
      && candidate.position.longitude === marker.position.longitude
    ))
    .map(({ index }) => index);
  if (matchingIndexes.length === 1) return { x: 0, y: 0 };
  const groupIndex = matchingIndexes.indexOf(markerIndex);
  const angle = -Math.PI / 2 + (groupIndex * Math.PI * 2) / matchingIndexes.length;
  const radius = matchingIndexes.length > 4 ? 24 : 18;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

interface AMapOverlay {
  on?: (event: string, handler: () => void) => void;
}

interface AMapMap {
  add: (overlays: AMapOverlay[]) => void;
  setFitView: (overlays?: AMapOverlay[]) => void;
  destroy: () => void;
}

interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapOverlay;
  Polyline: new (options: Record<string, unknown>) => AMapOverlay;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let amapLoader: Promise<AMapNamespace> | null = null;

function loadAmap(): Promise<AMapNamespace> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  const key = import.meta.env.VITE_AMAP_JS_API_KEY?.trim();
  if (!key) return Promise.reject(new Error("未配置高德 JS API Key"));
  const securityCode = import.meta.env.VITE_AMAP_JS_API_SECURITY_CODE?.trim();
  if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };

  amapLoader = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.catcareAmap = "true";
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("高德地图脚本未正确加载"));
    };
    script.onerror = () => reject(new Error("高德地图脚本加载失败"));
    document.head.append(script);
  }).catch((cause: unknown) => {
    amapLoader = null;
    throw cause;
  });
  return amapLoader;
}

function position(point: PlanGeoPoint): [number, number] {
  return [point.longitude, point.latitude];
}

function markerContent(
  label: string,
  selected = false,
  offset: MarkerDisplayOffset = { x: 0, y: 0 },
): HTMLDivElement {
  const content = document.createElement("div");
  content.className = [
    "flex size-8 items-center justify-center rounded-full border-2 border-white",
    "text-xs font-bold text-white shadow-md",
    selected ? "bg-amber-600 ring-2 ring-amber-300" : "bg-slate-900",
  ].join(" ");
  content.textContent = label;
  content.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  return content;
}

export class AmapMapProvider implements MapProvider {
  async mount(
    container: HTMLElement,
    model: MapRenderModel,
    onSelectTask: (taskId: number) => void,
  ): Promise<() => void> {
    const AMap = await loadAmap();
    const center = model.start?.position ?? model.markers[0]?.position;
    const map = new AMap.Map(container, {
      center: center ? position(center) : [116.397428, 39.90923],
      zoom: center ? 13 : 4,
      viewMode: "2D",
      resizeEnable: true,
    });
    const overlays: AMapOverlay[] = [];

    if (model.start) {
      overlays.push(
        new AMap.Marker({
          position: position(model.start.position),
          title: model.start.label,
          anchor: "center",
          content: markerContent("起"),
        }),
      );
    }
    for (const [index, item] of model.markers.entries()) {
      const marker = new AMap.Marker({
        position: position(item.position),
        title: item.community || item.customer_name,
        anchor: "center",
        content: markerContent(
          String(item.sequence),
          item.task_id === model.selectedTaskId,
          markerDisplayOffset(model.markers, index),
        ),
      });
      marker.on?.("click", () => onSelectTask(item.task_id));
      overlays.push(marker);
    }
    if (model.polyline.length > 1) {
      overlays.push(
        new AMap.Polyline({
          path: model.polyline.map(position),
          strokeColor: "#0f172a",
          strokeWeight: 5,
          strokeOpacity: 0.82,
          lineJoin: "round",
          showDir: true,
        }),
      );
    }

    if (overlays.length) {
      map.add(overlays);
      map.setFitView(overlays);
    }
    return () => map.destroy();
  }
}

export function hasAmapBrowserKey(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_JS_API_KEY?.trim());
}
