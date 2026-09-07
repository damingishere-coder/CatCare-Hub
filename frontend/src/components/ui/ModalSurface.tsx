import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalSurfaceProps {
  children: ReactNode;
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  busy?: boolean;
  drawer?: boolean;
  className?: string;
  role?: "dialog" | "alertdialog";
}

export function ModalSurface({ children, label, labelledBy, onClose, busy = false, drawer = false, className = "", role = "dialog" }: ModalSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(() => { if (!busy) onClose(); });
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(container));
    const inertStates = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    const focusables = () => [...container.querySelectorAll<HTMLElement>('summary, a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.closest("[hidden], [inert]"));
    (container.querySelector<HTMLElement>("[data-autofocus]") ?? container.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])") ?? focusables()[0] ?? container).focus();
    function keydown(event: KeyboardEvent) {
      const modals = document.querySelectorAll("[data-cc-modal]");
      if (modals[modals.length - 1] !== container) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); container!.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !container!.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container!.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      document.documentElement.style.overflow = rootOverflow;
      siblings.forEach((element, index) => { element.inert = inertStates[index]; });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className={`cc-modal-backdrop ${drawer ? "cc-modal-backdrop--drawer" : ""}`}>
      <div ref={ref} data-cc-modal role={role} aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1} className={`${drawer ? "cc-drawer" : "cc-dialog"} ${className}`}>
        {children}
      </div>
    </div>, document.body,
  );
}
