import { useCallback, useEffect } from "react";

/** Drafts stay in memory; never persist customer or access information in the browser. */
export function useUnsavedChanges(dirty: boolean, message = "还有未保存的修改，确定放弃这些修改吗？") {
  const confirmDiscard = useCallback(() => !dirty || window.confirm(message), [dirty, message]);

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function onLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.href === window.location.href || link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onLink, true);
    };
  }, [dirty, message]);

  return confirmDiscard;
}
