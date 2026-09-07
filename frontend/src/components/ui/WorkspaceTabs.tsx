import { useId } from "react";

interface WorkspaceTabsProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function WorkspaceTabs<T extends string>({ label, value, options, onChange }: WorkspaceTabsProps<T>) {
  const id = useId();
  return <div className="cc-tabs" role="tablist" aria-label={label}>{options.map((option, index) => <button
    key={option.value} id={`${id}-${option.value}`} type="button" role="tab" aria-selected={option.value === value} tabIndex={option.value === value ? 0 : -1}
    onClick={() => onChange(option.value)}
    onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % options.length : event.key === "ArrowLeft" ? (index + options.length - 1) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      onChange(options[next].value);
      document.getElementById(`${id}-${options[next].value}`)?.focus();
    }}
  >{option.label}</button>)}</div>;
}
