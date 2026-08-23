import { AlertCircle, RefreshCw } from "lucide-react";

interface ConnectionErrorAlertProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

function canonicalUrl(): string {
  const { pathname, search, hash } = window.location;
  return `http://127.0.0.1:5180${pathname}${search}${hash}`;
}

export function ConnectionErrorAlert({
  message,
  onRetry,
  className = "",
}: ConnectionErrorAlertProps) {
  return (
    <div className={`cc-alert cc-alert--danger ${className}`.trim()} role="alert">
      <AlertCircle className="mt-0.5 shrink-0" size={16} />
      <div className="min-w-0 flex-1">
        <p>{message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {onRetry ? (
            <button type="button" className="cc-button cc-button--secondary" onClick={onRetry}>
              <RefreshCw size={14} />重试
            </button>
          ) : null}
          <a className="cc-button cc-button--secondary" href={canonicalUrl()}>
            使用 127.0.0.1 重新打开
          </a>
        </div>
      </div>
    </div>
  );
}
