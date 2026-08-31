import type { PlanGeoPoint, PlanRouteMarker, PlanRouteStart } from "./types";

export interface MapRenderModel {
  start: PlanRouteStart | null;
  markers: PlanRouteMarker[];
  polyline: PlanGeoPoint[];
  selectedTaskId: number | null;
  locationEditing?: boolean;
  draftPosition?: PlanGeoPoint | null;
}

export interface MapInteractionCallbacks {
  onSelectTask: (taskId: number) => void;
  onDraftPositionChange?: (position: PlanGeoPoint) => void;
}

export interface MapController {
  update(model: MapRenderModel): void;
  dispose(): void;
}

export interface MapProvider {
  mount(
    container: HTMLElement,
    model: MapRenderModel,
    callbacks: MapInteractionCallbacks,
  ): Promise<MapController>;
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

interface AMapLngLat {
  getLat: () => number;
  getLng: () => number;
}

interface AMapEvent {
  lnglat?: AMapLngLat;
  target?: { getPosition?: () => AMapLngLat };
}

interface AMapOverlay {
  on?: (event: string, handler: (event: AMapEvent) => void) => void;
  setPosition?: (position: [number, number]) => void;
}

interface AMapMap {
  add: (overlays: AMapOverlay[]) => void;
  remove: (overlays: AMapOverlay[]) => void;
  setFitView: (
    overlays?: AMapOverlay[],
    immediately?: boolean,
    avoid?: [number, number, number, number],
    maxZoom?: number,
  ) => void;
  destroy: () => void;
  on?: (event: string, handler: (event: AMapEvent) => void) => void;
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
  name: string | null = null,
  selected = false,
  offset: MarkerDisplayOffset = { x: 0, y: 0 },
  muted = false,
): HTMLDivElement {
  const content = document.createElement("div");
  content.className = [
    "flex items-center gap-1 rounded-full border-2 border-white px-2 py-1",
    "max-w-36 text-xs font-bold whitespace-nowrap text-white shadow-md",
    selected ? "bg-amber-600 ring-2 ring-amber-300" : muted ? "bg-slate-400" : "bg-slate-900",
  ].join(" ");
  const sequence = document.createElement("span");
  sequence.textContent = label;
  content.append(sequence);
  if (name) {
    const customerName = document.createElement("span");
    customerName.className = "max-w-24 truncate";
    customerName.textContent = name;
    content.append(customerName);
  }
  content.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  return content;
}

function customerMarkerContent(
  orderId: number | undefined,
  tooltip: string,
  selected = false,
  offset: MarkerDisplayOffset = { x: 0, y: 0 },
  muted = false,
): HTMLDivElement {
  const content = document.createElement("div");
  content.className = [
    "flex size-9 items-center justify-center rounded-full border-2 border-white",
    "text-[11px] font-bold whitespace-nowrap text-white shadow-md",
    selected ? "bg-amber-600 ring-2 ring-amber-300" : muted ? "bg-slate-400" : "bg-slate-900",
  ].join(" ");
  content.textContent = orderId === undefined ? "#?" : `#${orderId}`;
  content.title = tooltip;
  content.setAttribute("aria-label", tooltip);
  content.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  return content;
}

function draftMarkerContent(): HTMLDivElement {
  const content = document.createElement("div");
  content.className = "relative flex size-12 cursor-move items-center justify-center";
  content.dataset.mapDraftCrosshair = "true";
  content.setAttribute("aria-label", "新客户定位准星");

  const ring = document.createElement("span");
  ring.className = "absolute size-8 rounded-full border-2 border-orange-600 bg-white/35 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]";
  const horizontal = document.createElement("span");
  horizontal.className = "absolute h-0.5 w-11 bg-orange-700 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]";
  const vertical = document.createElement("span");
  vertical.className = "absolute h-11 w-0.5 bg-orange-700 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]";
  const center = document.createElement("span");
  center.className = "absolute size-2 rounded-full border-2 border-white bg-red-600 shadow-md";
  center.dataset.mapDraftCenter = "true";
  const label = document.createElement("span");
  label.className = "absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full bg-orange-600 px-2 py-1 text-[11px] font-bold whitespace-nowrap text-white shadow-md";
  label.textContent = "新客户定位";

  content.append(ring, horizontal, vertical, center, label);
  return content;
}

function staticModelKey(model: MapRenderModel): string {
  return JSON.stringify({ start: model.start, markers: model.markers, polyline: model.polyline });
}

function appearanceModelKey(model: MapRenderModel): string {
  return JSON.stringify({ selectedTaskId: model.selectedTaskId, locationEditing: model.locationEditing });
}

function samePoint(left: PlanGeoPoint | null | undefined, right: PlanGeoPoint | null | undefined): boolean {
  if (!left || !right) return left === right;
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

export class AmapMapProvider implements MapProvider {
  async mount(
    container: HTMLElement,
    initialModel: MapRenderModel,
    callbacks: MapInteractionCallbacks,
  ): Promise<MapController> {
    const AMap = await loadAmap();
    const center = initialModel.start?.position ?? initialModel.markers[0]?.position;
    const map = new AMap.Map(container, {
      center: center ? position(center) : [116.397428, 39.90923],
      zoom: center ? 13 : 4,
      viewMode: "2D",
      resizeEnable: true,
    });
    let currentModel = initialModel;
    let overlays: AMapOverlay[] = [];
    let draftMarker: AMapOverlay | null = null;
    let renderedStaticKey = "";
    let renderedAppearanceKey = "";
    let disposed = false;

    const emitDraftPosition = (point: PlanGeoPoint) => {
      callbacks.onDraftPositionChange?.(point);
    };

    const createDraftMarker = (point: PlanGeoPoint): AMapOverlay => {
      const marker = new AMap.Marker({
        position: position(point),
        title: "新客户定位",
        anchor: "center",
        draggable: true,
        raiseOnDrag: true,
        zIndex: 500,
        content: draftMarkerContent(),
      });
      marker.on?.("dragend", (event) => {
        const next = event.target?.getPosition?.();
        if (next) emitDraftPosition({ latitude: next.getLat(), longitude: next.getLng() });
      });
      return marker;
    };

    const moveDraftMarker = (point: PlanGeoPoint) => {
      if (!draftMarker) {
        draftMarker = createDraftMarker(point);
        overlays.push(draftMarker);
        map.add([draftMarker]);
        return;
      }
      draftMarker.setPosition?.(position(point));
    };

    const renderOverlays = (model: MapRenderModel, fitView: boolean) => {
      if (overlays.length) map.remove(overlays);
      overlays = [];
      draftMarker = null;

      if (model.start) {
        overlays.push(
          new AMap.Marker({
            position: position(model.start.position),
            title: model.start.label,
            anchor: "center",
            content: markerContent("家", "起终点"),
          }),
        );
      }
      for (const [index, item] of model.markers.entries()) {
        const tooltip = `订单 #${item.order_id ?? "?"} · ${item.customer_name} · 路线第 ${item.sequence} 站`;
        const marker = new AMap.Marker({
          position: position(item.position),
          title: tooltip,
          anchor: "center",
          content: customerMarkerContent(
            item.order_id,
            tooltip,
            item.task_id === model.selectedTaskId && !model.locationEditing,
            markerDisplayOffset(model.markers, index),
            model.locationEditing && item.task_id === model.selectedTaskId,
          ),
        });
        marker.on?.("click", () => callbacks.onSelectTask(item.task_id));
        overlays.push(marker);
      }
      if (model.locationEditing && model.draftPosition) {
        draftMarker = createDraftMarker(model.draftPosition);
        overlays.push(draftMarker);
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
        if (fitView) map.setFitView(overlays, false, [60, 60, 60, 60], 15);
      }
      renderedStaticKey = staticModelKey(model);
      renderedAppearanceKey = appearanceModelKey(model);
    };

    map.on?.("click", (event) => {
      if (!currentModel.locationEditing || !event.lnglat) return;
      const point = { latitude: event.lnglat.getLat(), longitude: event.lnglat.getLng() };
      moveDraftMarker(point);
      emitDraftPosition(point);
    });

    renderOverlays(initialModel, true);

    return {
      update(nextModel) {
        if (disposed) return;
        const nextStaticKey = staticModelKey(nextModel);
        const nextAppearanceKey = appearanceModelKey(nextModel);
        const staticChanged = nextStaticKey !== renderedStaticKey;
        const appearanceChanged = nextAppearanceKey !== renderedAppearanceKey;
        const draftPresenceChanged = Boolean(nextModel.draftPosition) !== Boolean(currentModel.draftPosition);
        const draftChanged = !samePoint(nextModel.draftPosition, currentModel.draftPosition);
        currentModel = nextModel;

        if (staticChanged || appearanceChanged || draftPresenceChanged) {
          renderOverlays(nextModel, staticChanged);
        } else if (nextModel.locationEditing && nextModel.draftPosition && draftChanged) {
          moveDraftMarker(nextModel.draftPosition);
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        map.destroy();
      },
    };
  }
}

export function hasAmapBrowserKey(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_JS_API_KEY?.trim());
}

export function hasAmapBrowserSecurityCode(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_JS_API_SECURITY_CODE?.trim());
}
