import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PwaInstallPrompt } from "./PwaInstallPrompt";

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value,
  });
}

function setStandalone(value: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: value,
      media: "(display-mode: standalone)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  setSecureContext(true);
  setStandalone(false);
});

it("shows browser-menu guidance until an install prompt is available", () => {
  render(<PwaInstallPrompt />);

  expect(screen.getByText(/浏览器菜单中选择/)).toBeInTheDocument();
  expect(screen.getByText(/生产版首次联网后启用/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "安装" })).not.toBeInTheDocument();
});

it("offers and triggers the browser install prompt", async () => {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted", platform: "test" }),
  });
  render(<PwaInstallPrompt />);

  fireEvent(window, event);
  fireEvent.click(await screen.findByRole("button", { name: "安装" }));

  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("button", { name: "安装" })).not.toBeInTheDocument());
});

it("explains the HTTPS requirement on an insecure origin", () => {
  setSecureContext(false);
  render(<PwaInstallPrompt />);

  expect(screen.getByText(/安装需要 HTTPS/)).toBeInTheDocument();
});

it("stays hidden when already running in standalone mode", () => {
  setStandalone(true);
  render(<PwaInstallPrompt />);

  expect(screen.queryByLabelText("安装到手机")).not.toBeInTheDocument();
});
