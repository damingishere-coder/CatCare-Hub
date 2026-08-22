import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  headingId?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  headingId,
  actions,
}: PageHeaderProps) {
  return (
    <div className="cc-page-header">
      <div>
        {eyebrow ? <p className="cc-eyebrow">{eyebrow}</p> : null}
        <h1 id={headingId} className="cc-page-title">{title}</h1>
        <div className="cc-page-description">{description}</div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
