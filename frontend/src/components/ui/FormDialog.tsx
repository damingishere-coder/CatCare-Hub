import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";

interface FormDialogProps {
  title: string;
  description?: string;
  saving: boolean;
  error?: string | null;
  submitLabel?: string;
  savingLabel?: string;
  maxWidthClass?: string;
  submitIcon?: ReactNode;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

export function FormDialog({
  title,
  description,
  saving,
  error,
  submitLabel = "保存",
  savingLabel = "保存中…",
  maxWidthClass = "max-w-3xl",
  submitIcon,
  onCancel,
  onSubmit,
  children,
}: FormDialogProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = containerRef.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
    first?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onCancel();
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = [...containerRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel, saving]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={containerRef} className={`flex max-h-[calc(100dvh-1.5rem)] w-full ${maxWidthClass} flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(15,23,42,0.22)] sm:max-h-[calc(100dvh-3rem)]`}>
        <form className="contents" onSubmit={onSubmit}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-7 sm:py-5">
            <div><h2 id={titleId} className="text-xl font-semibold tracking-tight text-[#1D1D1F]">{title}</h2>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div>
            <button type="button" className="cc-icon-button" onClick={onCancel} aria-label="关闭表单" disabled={saving}><X size={18} /></button>
          </header>
          <div className="cc-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {error ? <p className="cc-alert cc-alert--danger" role="alert">{error}</p> : null}
            {children}
          </div>
          <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
            <button type="button" className="cc-button cc-button--secondary" onClick={onCancel} disabled={saving}>取消</button>
            <button type="submit" className="cc-button cc-button--primary" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : submitIcon}{saving ? savingLabel : submitLabel}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
