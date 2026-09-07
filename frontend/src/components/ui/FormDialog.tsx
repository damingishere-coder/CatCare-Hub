import { ModalSurface } from "./ModalSurface";
import { useUnsavedChanges } from "./useUnsavedChanges";

import { LoaderCircle, X } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

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
  const [dirty, setDirty] = useState(false);
  const confirmDiscard = useUnsavedChanges(dirty && !saving);
  const close = () => { if (!saving && confirmDiscard()) onCancel(); };

  return (
    <ModalSurface labelledBy={titleId} onClose={close} busy={saving} className={maxWidthClass}>
        <form className="contents" onSubmit={onSubmit} onChangeCapture={() => setDirty(true)}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-7 sm:py-5">
            <div><h2 id={titleId} className="text-xl font-semibold tracking-tight text-[var(--cc-text)]">{title}</h2>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div>
            <button type="button" className="cc-icon-button" onClick={close} aria-label="关闭表单" disabled={saving}><X size={18} /></button>
          </header>
          <div className="cc-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {error ? <p className="cc-alert cc-alert--danger" role="alert">{error}</p> : null}
            {children}
          </div>
          <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
            <button type="button" className="cc-button cc-button--secondary" onClick={close} disabled={saving}>取消</button>
            <button type="submit" className="cc-button cc-button--primary" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : submitIcon}{saving ? savingLabel : submitLabel}</button>
          </footer>
        </form>
    </ModalSurface>
  );
}
