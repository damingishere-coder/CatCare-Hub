import { AmapMapProvider } from "./mapProvider";

interface FakeEventTarget {
  getPosition: () => { getLat: () => number; getLng: () => number };
}

type EventHandler = (event: {
  lnglat?: { getLat: () => number; getLng: () => number };
  target?: FakeEventTarget;
}) => void;

const markerInstances: FakeMarker[] = [];
const mapInstances: FakeMap[] = [];

class FakeMarker {
  handlers = new Map<string, EventHandler>();
  positions: Array<[number, number]> = [];

  constructor(public options: Record<string, unknown>) {
    markerInstances.push(this);
  }

  on(event: string, handler: EventHandler) {
    this.handlers.set(event, handler);
  }

  setPosition(position: [number, number]) {
    this.positions.push(position);
  }
}

class FakePolyline extends FakeMarker {}

class FakeMap {
  handlers = new Map<string, EventHandler>();
  overlays: FakeMarker[] = [];
  destroyed = false;
  fitViewCalls = 0;

  constructor(_container: HTMLElement, public options: Record<string, unknown>) {
    mapInstances.push(this);
  }

  add(overlays: FakeMarker[]) {
    this.overlays.push(...overlays);
  }

  remove(overlays: FakeMarker[]) {
    const removed = new Set(overlays);
    this.overlays = this.overlays.filter((overlay) => !removed.has(overlay));
  }

  setFitView() {
    this.fitViewCalls += 1;
  }

  destroy() {
    this.destroyed = true;
  }

  on(event: string, handler: EventHandler) {
    this.handlers.set(event, handler);
  }
}

beforeEach(() => {
  markerInstances.length = 0;
  mapInstances.length = 0;
  window.AMap = {
    Map: FakeMap,
    Marker: FakeMarker,
    Polyline: FakePolyline,
  } as never;
});

afterEach(() => {
  delete window.AMap;
});

it("places a GCJ-02 draft pin on map click and updates it after dragging", async () => {
  const onDraftPositionChange = vi.fn();
  const provider = new AmapMapProvider();
  const controller = await provider.mount(document.createElement("div"), {
    start: { label: "家", position: { latitude: 22.54, longitude: 114.05 } },
    markers: [{
      task_id: 7,
      sequence: 1,
      customer_name: "虚构定位客户",
      community: "虚构小区",
      address: "虚构地址",
      position: { latitude: 22.55, longitude: 114.06 },
      navigation_url: null,
    }],
    polyline: [],
    selectedTaskId: 7,
    locationEditing: true,
    draftPosition: { latitude: 22.56, longitude: 114.07 },
  }, {
    onSelectTask: vi.fn(),
    onDraftPositionChange,
  });

  mapInstances[0].handlers.get("click")?.({
    lnglat: { getLat: () => 22.57, getLng: () => 114.08 },
  });
  expect(onDraftPositionChange).toHaveBeenLastCalledWith({ latitude: 22.57, longitude: 114.08 });

  const draftMarker = markerInstances.find((marker) => marker.options.draggable === true);
  expect(draftMarker).toBeDefined();
  expect(draftMarker?.positions).toContainEqual([114.08, 22.57]);
  const crosshair = draftMarker?.options.content as HTMLDivElement;
  expect(crosshair.dataset.mapDraftCrosshair).toBe("true");
  expect(crosshair.querySelector("[data-map-draft-center='true']")).not.toBeNull();
  draftMarker?.handlers.get("dragend")?.({
    target: { getPosition: () => ({ getLat: () => 22.58, getLng: () => 114.09 }) },
  });
  expect(onDraftPositionChange).toHaveBeenLastCalledWith({ latitude: 22.58, longitude: 114.09 });

  controller.update({
    start: { label: "家", position: { latitude: 22.54, longitude: 114.05 } },
    markers: [{
      task_id: 7,
      sequence: 1,
      customer_name: "虚构定位客户",
      community: "虚构小区",
      address: "虚构地址",
      position: { latitude: 22.55, longitude: 114.06 },
      navigation_url: null,
    }],
    polyline: [],
    selectedTaskId: 7,
    locationEditing: true,
    draftPosition: { latitude: 22.58, longitude: 114.09 },
  });
  expect(mapInstances).toHaveLength(1);
  expect(mapInstances[0].destroyed).toBe(false);
  expect(mapInstances[0].fitViewCalls).toBe(1);
  expect(draftMarker?.positions).toContainEqual([114.09, 22.58]);

  const previousMarker = markerInstances.find((marker) => marker.options.title === "虚构地址");
  expect((previousMarker?.options.content as HTMLDivElement).className).toContain("bg-slate-400");
  controller.dispose();
  expect(mapInstances[0].destroyed).toBe(true);
});
