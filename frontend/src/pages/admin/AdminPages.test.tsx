import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SettingsPage } from "./AdminPages";

const apiMocks = vi.hoisted(() => ({
  getIntegrationSettings: vi.fn(),
  testIntegration: vi.fn(),
}));

vi.mock("../../features/settings/api", () => apiMocks);
vi.mock("../../features/plans/mapProvider", () => ({
  hasAmapBrowserKey: () => false,
  hasAmapBrowserSecurityCode: () => false,
}));

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getIntegrationSettings.mockResolvedValue({
    amap_backend: {
      name: "amap",
      configured: true,
      status: "configured",
      message: null,
    },
    gpt_recommendation: {
      name: "openai",
      configured: true,
      status: "configured",
      message: null,
    },
  });
  apiMocks.testIntegration.mockImplementation(async (target: "amap" | "openai") => ({
    target,
    connected: true,
    message: target === "amap"
      ? "高德 Web 服务连接测试通过"
      : "OpenAI Responses API 连接测试通过",
  }));
});

it("separates backend maps, browser tiles, and GPT configuration without exposing keys", async () => {
  render(<SettingsPage />);

  const amapCard = screen.getByRole("heading", { name: "高德后端路线服务" }).closest("article");
  const browserCard = screen.getByRole("heading", { name: "浏览器街道底图" }).closest("article");
  const gptCard = screen.getByRole("heading", { name: "GPT 路线建议" }).closest("article");
  expect(amapCard).not.toBeNull();
  expect(browserCard).not.toBeNull();
  expect(gptCard).not.toBeNull();

  await waitFor(() => expect(apiMocks.getIntegrationSettings).toHaveBeenCalledTimes(1));
  expect(within(amapCard!).getByText("已配置（未测试）")).toBeInTheDocument();
  expect(within(browserCard!).getByText("未配置")).toBeInTheDocument();
  expect(within(gptCard!).getByText("已配置（未测试）")).toBeInTheDocument();
  expect(screen.getByText(/修改 Vite 环境变量后必须重启前端/)).toBeInTheDocument();
  expect(screen.getByText(/Codex 登录不能替代独立 OPENAI_API_KEY/)).toBeInTheDocument();
  expect(screen.queryByText("已连接")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/sk-[A-Za-z0-9]/);
});

it("runs each connection test only after an explicit click", async () => {
  render(<SettingsPage />);

  const amapCard = (await screen.findByRole("heading", { name: "高德后端路线服务" })).closest("article");
  const gptCard = screen.getByRole("heading", { name: "GPT 路线建议" }).closest("article");
  expect(apiMocks.testIntegration).not.toHaveBeenCalled();

  fireEvent.click(within(amapCard!).getByRole("button", { name: "测试连接" }));
  expect(await within(amapCard!).findByText("高德 Web 服务连接测试通过")).toBeInTheDocument();

  fireEvent.click(within(gptCard!).getByRole("button", { name: "测试连接" }));
  expect(await within(gptCard!).findByText("OpenAI Responses API 连接测试通过")).toBeInTheDocument();
  expect(apiMocks.testIntegration.mock.calls).toEqual([["amap"], ["openai"]]);
});
