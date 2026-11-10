import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`panel p-6 ${className}`}>{children}</div>
}

// Numbered panel heading (same piston badge as the strategy steps)
export function PanelTitle({
  step,
  title,
  hint,
}: {
  step: string
  title: string
  hint: string
}) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="engine-piston" aria-hidden="true">
        {step}
      </span>

      <div className="min-w-0">
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
    </div>
  )
}

export function Metric({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: ReactNode
  label: string
  value: string
  subtitle: string
}) {
  return (
    <Panel>
      <div className="mb-4 flex items-center gap-2 text-red-400">
        {icon}
        <span className="text-xs font-bold tracking-wider text-slate-400">
          {label}
        </span>
      </div>

      <p className="font-mono text-2xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </Panel>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: ReactNode
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-red-400">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold">{title}</h2>
      {description && (
        <p className="mt-2 text-sm text-slate-400">{description}</p>
      )}
      <div className="section-rule" />
    </div>
  )
}

export function ErrorBanner({
  message,
  className = '',
}: {
  message: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 ${className}`}
    >
      <AlertTriangle size={20} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
      {children}
    </span>
  )
}

export function TyreDot({ color, size = 'h-2.5 w-2.5' }: { color: string; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${size} shrink-0 rounded-full`}
      style={{ backgroundColor: color }}
    />
  )
}
