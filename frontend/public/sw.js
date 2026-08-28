const CACHE_PREFIX = "catcare-shell-";
const CACHE_NAME = `${CACHE_PREFIX}p11-v1`;
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/icons/catcare-192.png",
  "/icons/catcare-512.png",
];

function buildAssetUrls(html) {
  return [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
    .map((match) => match[1]);
}

async function refreshShell(indexResponse) {
  const cache = await caches.open(CACHE_NAME);
  const html = await indexResponse.clone().text();
  const buildAssets = [...new Set(buildAssetUrls(html))];
  await cache.put("/index.html", indexResponse);
  await cache.addAll([...CORE_ASSETS, ...buildAssets]);

  const currentAssets = new Set(buildAssets);
  const cachedRequests = await cache.keys();
  await Promise.all(
    cachedRequests.map((request) => {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/assets/") && !currentAssets.has(path)) {
        return cache.delete(request);
      }
      return Promise.resolve(false);
    }),
  );
}

async function installShell() {
  const response = await fetch("/index.html", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("CatCare-Hub 应用壳加载失败");
  }
  await refreshShell(response);
}

function bypassCache(pathname) {
  return pathname === "/f"
    || pathname.startsWith("/f/")
    || pathname === "/fill"
    || pathname.startsWith("/fill/")
    || pathname.startsWith("/api/")
    || pathname.startsWith("/uploads/")
    || pathname.startsWith("/data/");
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.headers.get("Content-Type")?.includes("text/html")) {
      await refreshShell(response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match("/index.html");
    return cached || new Response("CatCare-Hub 暂时无法离线打开", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staticResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || bypassCache(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (
    !url.search
    && (
      url.pathname.startsWith("/assets/")
      || url.pathname.startsWith("/icons/")
      || url.pathname === "/manifest.webmanifest"
    )
  ) {
    event.respondWith(staticResponse(request));
  }
});
