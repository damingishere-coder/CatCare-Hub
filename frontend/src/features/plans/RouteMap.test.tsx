import { render, waitFor } from "@testing-library/react";

import { RouteMap } from "./RouteMap";
import type { MapRenderModel } from "./mapProvider";
import type { PlanRouteMarker } from "./types";

const mapMocks = vi.hoisted(() => ({
  mount: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("./mapProvider", async () => {
  const actual = await vi.importActual<typeof import("./mapProvider")>("./mapProvider");
  return {
    ...actual,
    hasAmapBrowserKey: () => true,
    hasAmapBrowserSecurityCode: () => true,
    AmapMapProvider: class {
      mount(container: HTMLElement, model: MapRenderModel) {
        mapMocks.mount(container, model);
        return Promise.resolve({ update: mapMocks.update, dispose: mapMocks.dispose });
      }
    },
  };
});

const markers: PlanRouteMarker[] = [{
  task_id: 7,
  sequence: 1,
  customer_name: "虚构定位客户",
  community: "虚构小区",
  address: "虚构地址",
  position: { latitude: 22.55, longitude: 114.06 },
  navigation_url: null,
}];

beforeEach(() => {
  vi.resetAllMocks();
});

it("keeps one map controller while draft coordinates and selection change", async () => {
  const onAmapReadyChange = vi.fn();
  const view = render(
    <RouteMap
      providerName="amap"
      start={{ label: "家", position: { latitude: 22.54, longitude: 114.05 } }}
      markers={markers}
      route={null}
      selectedTaskId={7}
      onSelectTask={vi.fn()}
      locationEditing
      draftPosition={{ latitude: 22.56, longitude: 114.07 }}
      onDraftPositionChange={vi.fn()}
      onAmapReadyChange={onAmapReadyChange}
    />,
  );

  await waitFor(() => expect(mapMocks.mount).toHaveBeenCalledTimes(1));
  expect(onAmapReadyChange).toHaveBeenCalledWith(true);

  view.rerender(
    <RouteMap
      providerName="amap"
      start={{ label: "家", position: { latitude: 22.54, longitude: 114.05 } }}
      markers={markers}
      route={null}
      selectedTaskId={7}
      onSelectTask={vi.fn()}
      locationEditing
      draftPosition={{ latitude: 22.58, longitude: 114.09 }}
      onDraftPositionChange={vi.fn()}
      onAmapReadyChange={onAmapReadyChange}
    />,
  );

  await waitFor(() => expect(mapMocks.update).toHaveBeenCalledWith(expect.objectContaining({
    draftPosition: { latitude: 22.58, longitude: 114.09 },
  })));
  expect(mapMocks.mount).toHaveBeenCalledTimes(1);
  expect(mapMocks.dispose).not.toHaveBeenCalled();

  view.rerender(
    <RouteMap
      providerName="amap"
      start={{ label: "家", position: { latitude: 22.54, longitude: 114.05 } }}
      markers={markers}
      route={null}
      selectedTaskId={null}
      onSelectTask={vi.fn()}
      locationEditing
      draftPosition={{ latitude: 22.58, longitude: 114.09 }}
      onDraftPositionChange={vi.fn()}
      onAmapReadyChange={onAmapReadyChange}
    />,
  );

  await waitFor(() => expect(mapMocks.update).toHaveBeenCalledWith(expect.objectContaining({ selectedTaskId: null })));
  expect(mapMocks.mount).toHaveBeenCalledTimes(1);
  expect(mapMocks.dispose).not.toHaveBeenCalled();

  view.unmount();
  expect(mapMocks.dispose).toHaveBeenCalledTimes(1);
});
