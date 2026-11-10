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
    <div className="engine-card">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#E10600]/60 bg-[#0b1120] text-red-400">
          {icon}
        </span>
        <span className="text-xs font-bold tracking-wider text-slate-400">
          {label}
        </span>
      </div>

      <p className="font-mono text-2xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}

// Red-outlined square that holds an icon (block header glyph)
export function EngineBadge({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border-2 border-[#E10600] bg-[#0b1120] text-red-400">
      {children}
    </span>
  )
}

const CHIP_TONES = {
  default: 'border-white/15 bg-[#0b1120] text-slate-200',
  muted: 'border-white/10 bg-[#0b1120] text-slate-500',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
}

// Small pill used in block headers (live summary, status)
export function EngineChip({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode
  tone?: keyof typeof CHIP_TONES
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold ${CHIP_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// Header of an engine block: glyph, title, subtitle, chips, red rail
export function EngineHeader({
  glyph,
  title,
  subtitle,
  chips,
  chipsLabel,
}: {
  glyph: ReactNode
  title: string
  subtitle: ReactNode
  chips?: ReactNode
  chipsLabel?: string
}) {
  return (
    <div className="engine-head flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex items-center gap-4">
        {glyph}
        <div>
          <h3 className="text-xl font-bold">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>

      {chips && (
        <div className="flex flex-wrap items-center gap-2" aria-label={chipsLabel}>
          {chips}
        </div>
      )}
    </div>
  )
}

// Uppercase sub-heading used inside engine panels
export function PanelHeading({
  children,
  hint,
}: {
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <>
      <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
        {children}
      </h4>
      {hint && <p className="mb-5 mt-1 text-xs text-slate-500">{hint}</p>}
    </>
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
  return <EngineChip>{children}</EngineChip>
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
