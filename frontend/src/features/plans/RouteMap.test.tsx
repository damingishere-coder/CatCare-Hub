import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RouteMap } from "./RouteMap";
import type { MapRenderModel } from "./mapProvider";
import type { PlanRouteMarker } from "./types";

const mapMocks = vi.hoisted(() => ({
  mount: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  hasKey: vi.fn(),
  hasSecurityCode: vi.fn(),
}));

vi.mock("./mapProvider", async () => {
  const actual = await vi.importActual<typeof import("./mapProvider")>("./mapProvider");
  return {
    ...actual,
    hasAmapBrowserKey: mapMocks.hasKey,
    hasAmapBrowserSecurityCode: mapMocks.hasSecurityCode,
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
  order_number: 112,
  sequence: 1,
  customer_name: "虚构定位客户",
  community: "虚构小区",
  address: "虚构地址",
  position: { latitude: 22.55, longitude: 114.06 },
  navigation_url: null,
}];

beforeEach(() => {
  vi.resetAllMocks();
  mapMocks.hasKey.mockReturnValue(true);
  mapMocks.hasSecurityCode.mockReturnValue(true);
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

it("uses the same compact order number and full hover label on the fallback map", () => {
  mapMocks.hasKey.mockReturnValue(false);
  const onSelectTask = vi.fn();
  render(
    <RouteMap
      providerName="amap"
      start={{ label: "家", position: { latitude: 22.54, longitude: 114.05 } }}
      markers={markers}
      route={null}
      selectedTaskId={null}
      onSelectTask={onSelectTask}
    />,
  );

  const marker = screen.getByRole("button", { name: "订单 #112，虚构定位客户，路线第 1 站" });
  expect(marker).toHaveTextContent("#112");
  expect(marker).toHaveAttribute("title", "订单 #112 · 虚构定位客户 · 路线第 1 站");
  expect(screen.queryByText("虚构定位客户")).not.toBeInTheDocument();
  fireEvent.click(marker);
  expect(onSelectTask).toHaveBeenCalledWith(7);
});
