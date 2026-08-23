import { Download, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallChoice {
  outcome: "accepted" | "dismissed";
  platform: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const [shellReady, setShellReady] = useState(
    () => "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller),
  );

  useEffect(() => {
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const handleDisplayMode = (event: MediaQueryListEvent) => setStandalone(event.matches);
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setPromptEvent(null);
      setStandalone(true);
    };
    let active = true;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready.then(() => {
        if (active) setShellReady(true);
      });
    }

    displayMode?.addEventListener("change", handleDisplayMode);
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      active = false;
      displayMode?.removeEventListener("change", handleDisplayMode);
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!promptEvent) return;
    setInstalling(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      setPromptEvent(null);
    } finally {
      setInstalling(false);
    }
  }

  if (standalone) return null;

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm" aria-label="安装到手机">
      <div className="flex items-start gap-2.5">
        <Smartphone className="mt-0.5 shrink-0 text-orange-600" size={17} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">添加到主屏幕</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {!window.isSecureContext
              ? "安装需要 HTTPS；普通局域网 HTTP 仍可作为网页使用。"
              : promptEvent
                ? "安装后可从桌面直接打开手机执行端。"
                : "可在浏览器菜单中选择“安装应用”或“添加到主屏幕”。"}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            {shellReady
              ? "离线应用壳已就绪；任务数据与现场操作仍需联网。"
              : "离线应用壳会在生产版首次联网后启用。"}
          </p>
        </div>
        {promptEvent ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[#FF9500] px-3 text-xs font-semibold text-[#1D1D1F] shadow-sm disabled:opacity-50"
            onClick={() => void handleInstall()}
            disabled={installing}
          >
            <Download size={14} />{installing ? "安装中" : "安装"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
