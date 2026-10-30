import type { ReactNode } from 'react';
import { clsx } from 'clsx';

// Presentational building blocks shared by the Settings tabs.

export const ghostButton =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 [&>svg]:shrink-0';

export function CubbyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="220" fill="#182127" />
      <g fill="none" stroke="#79DEC2" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round">
        <path d="M248 420V300Q248 248 300 248H420" />
        <path d="M604 248H724Q776 248 776 300V420" />
        <path d="M248 574V724Q248 776 300 776H724Q776 776 776 724V574" />
      </g>
      <rect x="432" y="370" width="226" height="172" rx="28" fill="#79DEC2" opacity="0.45" />
      <rect x="366" y="448" width="240" height="172" rx="28" fill="#F4F4EC" />
    </svg>
  );
}

export function PaneHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
      {children}
    </p>
  );
}

export function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

export function Row({
  title,
  desc,
  control,
  children,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  if (children) {
    return (
      <div className="px-4 py-3.5">
        {(title || desc) && (
          <div className="mb-3">
            {title && <div className="text-sm font-medium">{title}</div>}
            {desc && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</p>}
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <div className="settings-row flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {title && <div className="text-sm font-medium">{title}</div>}
        {desc && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</p>}
      </div>
      {control && (
        <div className="settings-row-control min-w-0 max-w-full flex-shrink-0">{control}</div>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={clsx(
        'relative h-6 w-11 flex-shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-accent',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      <span
        className={clsx(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="settings-segmented inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-accent/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
