type ServiceWorkerRegistrar = Pick<ServiceWorkerContainer, "register">;

export async function registerPwa(
  registrar: ServiceWorkerRegistrar | undefined = "serviceWorker" in navigator
    ? navigator.serviceWorker
    : undefined,
): Promise<ServiceWorkerRegistration | null> {
  if (!window.isSecureContext || !registrar) return null;
  try {
    return await registrar.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

export function schedulePwaRegistration(): void {
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return;
  }
  if (document.readyState === "complete") {
    void registerPwa();
    return;
  }
  window.addEventListener("load", () => void registerPwa(), { once: true });
}
