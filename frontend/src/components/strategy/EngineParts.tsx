import type { CSSProperties, ReactNode } from 'react'
import { tyreColor } from '../../utils/format'
import { TyreDot } from '../ui/Panel'

// One "cylinder" of the strategy engine: a numbered step
export function EngineBay({
  step,
  title,
  hint,
  children,
}: {
  step: string
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="engine-bay">
      <span className="engine-spark" aria-hidden="true" />

      <div className="mb-5 flex items-center gap-3">
        <span className="engine-piston" aria-hidden="true">
          {step}
        </span>

        <div className="min-w-0">
          <h4 className="text-sm font-bold uppercase tracking-wider">{title}</h4>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>

      <div className="space-y-5">{children}</div>
    </div>
  )
}

export function EngineRange({
  id,
  label,
  valueLabel,
  min,
  max,
  step = 1,
  value,
  onChange,
  hintMin,
  hintMax,
}: {
  id: string
  label: string
  valueLabel: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  hintMin: string
  hintMax: string
}) {
  const span = max - min
  const percent = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-slate-300">
          {label}
        </label>
        <span className="font-mono text-base font-bold" aria-hidden="true">
          {valueLabel}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="engine-range"
        style={{ '--p': `${percent}%` } as CSSProperties}
      />

      <div className="mt-2 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
        <span>{hintMin}</span>
        <span>{hintMax}</span>
      </div>
    </div>
  )
}

export function CompoundSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-2 text-sm text-slate-300">{label}</p>

      <div className={`grid gap-1.5 ${options.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {options.map((compound) => (
          <button
            key={compound}
            type="button"
            aria-pressed={value === compound}
            onClick={() => onChange(compound)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-0.5 py-2.5 text-[11px] font-bold transition ${value === compound
              ? 'border-[#E10600] bg-red-500/10 text-white'
              : 'border-white/10 bg-[#0c1320] text-slate-400 hover:border-white/30'
              }`}
          >
            <TyreDot color={tyreColor(compound)} />
            <span className="truncate">{compound}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
