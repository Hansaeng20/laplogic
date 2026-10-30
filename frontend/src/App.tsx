
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import StrategyAdvisor from "./components/StrategyAdvisor";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileSpreadsheet,
  FileText,
  Flag,
  Gauge,
  LoaderCircle,
  MapPin,
  Menu,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trophy,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// ==========================================
// TYPES
// ==========================================

type UploadMode = 'csv' | 'pdf'
type StrategyType = 'one_stop' | 'two_stop'
type Compound = 'SOFT' | 'MEDIUM' | 'HARD'

type LapResult = {
  lap: number
  lap_time: number
  compound: string
  is_pit_stop: boolean
  pit_duration: number | null
  delta_to_best: number
  delta_to_average: number
  cumulative_time: number
}

type PitStop = {
  lap: number
  compound_before: string
  duration: number | null
}

type RecordedStint = {
  stint_number: number
  start_lap: number
  end_lap: number
  recorded_laps: number
  compound: string
  average_lap: number
}

type Analysis = {
  status: string
  filename: string
  circuit: string
  total_laps: number
  statistics: {
    fastest_lap: number
    slowest_lap: number
    average_lap: number
    median_lap: number
    consistency_std: number
    best_lap_number: number
    total_recorded_time: number
  }
  pit_analysis: {
    available: boolean
    total_pit_stops: number
    stops: PitStop[]
    recorded_duration_count: number
    total_recorded_pit_duration: number | null
    duration_is_additional_to_lap_time: boolean
  }
  stints: RecordedStint[]
  laps: LapResult[]
  notes: string[]
}

type StrategyStint = {
  start_lap: number
  end_lap: number
  compound: string
  laps: number
  estimated_time: number
  estimated_average_lap: number
}

type StrategyResult = {
  strategy: string
  supported: boolean
  reason?: string
  pit_stops?: number
  stints?: StrategyStint[]
  estimated_racing_time?: number
  pit_loss_total?: number
  estimated_total_time?: number
  warnings?: string[]
  rank?: number
}

type PaceProfile = {
  average_lap: number
  sample_laps: number
  max_observed_age: number
}

type StrategyComparison = {
  status: string
  race_laps: number
  observed_laps: number
  pit_loss_assumption: number
  pace_profiles: Record<string, PaceProfile>
  strategies: StrategyResult[]
  recommended: string | null
  experimental: boolean
  method: string
  limitations: string[]
}

type TimelineStint = {
  start_lap: number
  end_lap: number
  compound: string
}

// ==========================================
// CONFIGURATION
// ==========================================

const CATEGORIES = [
  'Formula Racing',
  'GT & Endurance',
  'Touring & Road',
  'Rally & Off-Road',
  'Oval Racing',
  'Other / Custom',
]

const SIMULATORS = [
  'F1 Series',
  'Assetto Corsa',
  'Assetto Corsa Competizione',
  'iRacing',
  'Le Mans Ultimate',
  'Automobilista 2',
  'RaceRoom',
  'Other / Custom',
]

const COMPOUNDS: Compound[] = [
  'SOFT',
  'MEDIUM',
  'HARD',
]

const TYRE_COLORS: Record<string, string> = {
  SOFT: '#ef4444',
  MEDIUM: '#eab308',
  HARD: '#e2e8f0',
  INTERMEDIATE: '#22c55e',
  WET: '#38bdf8',
  UNKNOWN: '#64748b',
  MIXED: '#a78bfa',
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

// ==========================================
// HELPERS
// ==========================================

function tyreColor(compound: string): string {
  return TYRE_COLORS[compound.toUpperCase()] ?? '#a78bfa'
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = (seconds % 60)
    .toFixed(3)
    .padStart(6, '0')

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
  }

  return `${minutes}:${remainder}`
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

function getErrorMessage(
  payload: unknown,
  fallback: string
): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'detail' in payload
  ) {
    const detail = payload.detail

    if (typeof detail === 'string') {
      return detail
    }

    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          typeof item?.msg === 'string'
            ? item.msg
            : 'Invalid input'
        )
        .join(', ')
    }
  }

  return fallback
}

// ==========================================
// REUSABLE COMPONENTS
// ==========================================

function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#111827] p-6 ${className}`}
    >
      {children}
    </div>
  )
}

function Metric({
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

      <p className="font-mono text-2xl font-bold">
        {value}
      </p>

      <p className="mt-2 text-xs text-slate-500">
        {subtitle}
      </p>
    </Panel>
  )
}

function TyreTimeline({
  stints,
}: {
  stints: TimelineStint[]
}) {
  const total = stints.reduce(
    (sum, stint) =>
      sum + Math.max(0, stint.end_lap - stint.start_lap + 1),
    0
  )

  if (total === 0) {
    return null
  }

  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded-full bg-slate-800">
        {stints.map((stint, index) => {
          const length =
            Math.max(0, stint.end_lap - stint.start_lap + 1)

          return (
            <div
              key={index}
              title={`${stint.compound}: Laps ${stint.start_lap}-${stint.end_lap}`}
              style={{
                width: `${(length / total) * 100}%`,
                backgroundColor: tyreColor(stint.compound),
                borderRight:
                  index < stints.length - 1
                    ? '2px solid #111827'
                    : undefined,
              }}
            />
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
        {stints.map((stint, index) => (
          <div
            key={index}
            className="flex items-center gap-2 text-xs text-slate-300"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: tyreColor(stint.compound),
              }}
            />

            <span>
              {stint.compound} · Laps {stint.start_lap}–
              {stint.end_lap}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompoundSelector({
  label,
  value,
  onChange,
}: {
  label: string
  value: Compound
  onChange: (value: Compound) => void
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-slate-300">{label}</p>

      <div className="grid grid-cols-3 gap-1.5">
        {COMPOUNDS.map((compound) => (
          <button
            key={compound}
            type="button"
            aria-pressed={value === compound}
            onClick={() => onChange(compound)}
<<<<<<< HEAD
            className={`flex flex-wrap items-center justify-center gap-2 rounded-xl border px-2 py-3 text-xs font-bold transition ${value === compound
              ? 'border-[#E10600] bg-red-500/10 text-white'
              : 'border-slate-700 bg-[#0c1320] text-slate-400 hover:border-slate-500'
              }`}
=======
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-0.5 py-2.5 text-[11px] font-bold transition ${
              value === compound
                ? 'border-[#E10600] bg-red-500/10 text-white'
                : 'border-white/10 bg-[#0c1320] text-slate-400 hover:border-white/30'
            }`}
>>>>>>> 182d4bd2d9abd144436b0f3c7a2d0ddf18728e23
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tyreColor(compound) }}
            />
            {compound}
          </button>
        ))}
      </div>
    </div>
  )
}

// ==========================================
// ENGINE-STYLE STRATEGY PLANNER PIECES
// ==========================================

// One "cylinder" of the strategy engine: a numbered step
function EngineBay({
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
          <h4 className="text-sm font-bold uppercase tracking-wider">
            {title}
          </h4>

          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>

      <div className="space-y-5">{children}</div>
    </div>
  )
}

function EngineRange({
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

  const percent =
    span > 0
      ? Math.min(100, Math.max(0, ((value - min) / span) * 100))
      : 0

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-slate-300">
          {label}
        </label>

        <span className="font-mono text-base font-bold">
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="engine-range"
        style={{ '--p': `${percent}%` } as CSSProperties}
      />

      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
        <span>{hintMin}</span>
        <span>{hintMax}</span>
      </div>
    </div>
  )
}

// Two small meshing gears for the planner header
function EngineGears({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 80"
      className={`engine-gears ${className}`}
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(42 46)">
        <g className="pit-gear pit-gear-a">
          <circle
            r="24"
            stroke="#f8fafc"
            strokeWidth="6"
            strokeDasharray="4.71 4.71"
          />
          <circle r="17" stroke="#f8fafc" strokeWidth="1.5" />
          <circle r="5" stroke="#E10600" strokeWidth="1.5" />
          <path
            d="M0 -12 V12 M-12 0 H12"
            stroke="#f8fafc"
            strokeOpacity="0.5"
          />
        </g>
      </g>

      <g transform="translate(78 29)">
        <g className="pit-gear pit-gear-b">
          <circle
            r="14"
            stroke="#f8fafc"
            strokeWidth="5"
            strokeDasharray="4.4 4.4"
          />
          <circle r="9" stroke="#f8fafc" strokeWidth="1.5" />
          <circle r="3" stroke="#E10600" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  )
}

// The "crankshaft": the planned stints with a crank pin at each pit stop
function CrankStrategy({ stints }: { stints: TimelineStint[] }) {
  const lengths = stints.map((stint) =>
    Math.max(0, stint.end_lap - stint.start_lap + 1)
  )

  const total = lengths.reduce((sum, length) => sum + length, 0)

  if (total === 0) {
    return null
  }

  const pits = stints.slice(0, -1).map((stint, index) => {
    const covered = lengths
      .slice(0, index + 1)
      .reduce((sum, length) => sum + length, 0)

    return {
      lap: stint.end_lap,
      left: (covered / total) * 100,
    }
  })

  return (
    <div>
      <div className="relative pt-9">
        {pits.map((pit) => (
          <div
            key={pit.lap}
            className="absolute top-0 -translate-x-1/2 text-center"
            style={{ left: `${pit.left}%` }}
          >
            <span className="block whitespace-nowrap font-mono text-xs font-bold text-white">
              PIT L{pit.lap}
            </span>

            <span className="mx-auto mt-1 block h-3 w-px bg-white/40" />
          </div>
        ))}

        <div className="flex h-6 overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/10">
          {stints.map((stint, index) => (
            <div
              key={index}
              title={`${stint.compound}: Laps ${stint.start_lap}-${stint.end_lap}`}
              style={{
                width: `${(lengths[index] / total) * 100}%`,
                backgroundColor: tyreColor(stint.compound),
                borderRight:
                  index < stints.length - 1
                    ? '2px solid #0b1120'
                    : undefined,
              }}
            />
          ))}
        </div>

        {pits.map((pit) => (
          <span
            key={pit.lap}
            className="engine-pin"
            style={{ left: `${pit.left}%` }}
          />
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
        <span>Lap 1</span>
        <span>Lap {stints[stints.length - 1].end_lap}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
        {stints.map((stint, index) => (
          <div
            key={index}
            className="flex items-center gap-2 text-xs text-slate-300"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tyreColor(stint.compound) }}
            />

            <span>
              {stint.compound} · Laps {stint.start_lap}–{stint.end_lap}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ==========================================
// HERO MEDIA
// ==========================================

// Drop your video (or gif / image) into frontend/public and
// point this at it. Videos should be muted, no audio needed.
const HERO_MEDIA_SRC = '/hero.mp4'
const HERO_POSTER_SRC = '' // optional still frame, e.g. '/hero-poster.jpg'

const HERO_IS_IMAGE = /\.(gif|webp|png|jpe?g|avif|svg)$/i.test(
  HERO_MEDIA_SRC
)

function HeroPlaceholder() {
  // Shown only while no hero media file exists yet.
  return (
    <div className="absolute inset-0">
      <div className="hero-glow absolute -right-24 top-1/2 h-[30rem] w-[30rem] -translate-y-1/2 rounded-full bg-[#E10600]/30 blur-3xl" />
      <div className="hero-stripes absolute inset-0" />
    </div>
  )
}

function HeroMedia() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  const [reduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches
  )

  const mediaClass = `absolute inset-0 h-full w-full object-cover transition-opacity duration-[2500ms] ease-out ${ready ? 'opacity-100' : 'opacity-0'
    }`

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 lg:left-auto lg:w-[68%]"
    >
      {failed ? (
        <HeroPlaceholder />
      ) : HERO_IS_IMAGE ? (
        <img
          src={HERO_MEDIA_SRC}
          alt=""
          className={mediaClass}
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <video
          src={HERO_MEDIA_SRC}
          poster={HERO_POSTER_SRC || undefined}
          className={mediaClass}
          autoPlay={!reduceMotion}
          loop={!reduceMotion}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}

      {/* Phones: dim the whole clip so the text stays readable */}
      <div className="absolute inset-0 bg-[#080c14]/70 lg:hidden" />

      {/* Left edge: the slow fade from page background into the clip */}
      <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-[#080c14] via-[#080c14]/60 to-transparent lg:w-3/5" />

      {/* Bottom and top edges melt into the page */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080c14] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#080c14] to-transparent" />
    </div>
  )
}

// ==========================================
// RACE CAR ART (outline, shared)
// ==========================================

function RaceCarArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 8 250 58"
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {/* rear wing */}
      <path d="M14 14 H44" stroke="#E10600" strokeWidth="2.2" />
      <path d="M18 10 V22 M40 10 V22" stroke="#f8fafc" />
      <path d="M30 14 L39 40" stroke="#f8fafc" />

      {/* body */}
      <path
        d="M30 52 L44 36 L74 27 L92 33 Q100 36 114 36 L150 43 L222 53 L222 56 L150 56 L66 56 Z"
        stroke="#f8fafc"
      />
      <path d="M74 27 L80 21 L88 22 L92 33" stroke="#f8fafc" />
      <path d="M98 47 L176 52" stroke="#E10600" strokeWidth="2" />
      <path
        d="M100 38 L132 44 L132 52 L96 52"
        stroke="#f8fafc"
        strokeWidth="1.2"
      />

      {/* halo + helmet */}
      <path
        d="M100 35 Q112 24 126 40"
        stroke="#f8fafc"
        strokeWidth="1.3"
      />
      <circle cx="111" cy="31" r="5" stroke="#E10600" />

      {/* front wing */}
      <path d="M204 60 H246" stroke="#E10600" strokeWidth="2.2" />
      <path d="M246 54 V61" stroke="#f8fafc" />
      <path d="M214 56 V60" stroke="#f8fafc" />

      {/* rear wheel */}
      <g transform="translate(58 47)">
        <circle r="15" fill="#080c14" stroke="#f8fafc" />
        <circle r="9" stroke="#f8fafc" strokeWidth="1" />
        <g className="car-spin" stroke="#E10600" strokeWidth="1.4">
          <path d="M-6 0H6M0 -6V6M-4.2 -4.2L4.2 4.2M-4.2 4.2L4.2 -4.2" />
        </g>
      </g>

      {/* front wheel */}
      <g transform="translate(194 50)">
        <circle r="12" fill="#080c14" stroke="#f8fafc" />
        <circle r="7" stroke="#f8fafc" strokeWidth="1" />
        <g className="car-spin" stroke="#E10600" strokeWidth="1.4">
          <path d="M-5 0H5M0 -5V5M-3.5 -3.5L3.5 3.5M-3.5 3.5L3.5 -3.5" />
        </g>
      </g>

      {/* hazard lights (blink while parked) */}
      <circle
        className="car-light"
        cx="29"
        cy="50"
        r="2"
        fill="#E10600"
        stroke="none"
      />
      <circle
        className="car-light"
        cx="220"
        cy="54.5"
        r="1.8"
        fill="#E10600"
        stroke="none"
      />
    </svg>
  )
}

// ==========================================
// RACE CAR DIVIDER
// ==========================================

type RacePhase = 'idle' | 'loading' | 'parked'

// Keep in sync with the progress-fill duration in index.css
const RACE_LOADING_MS = 1300

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Loading screen for the analyze section: the car "drives" in place at
// the center, then pulls forward and parks while the form fades in.
function RaceCarDivider({
  onReveal,
}: {
  onReveal: (value: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const [phase, setPhase] = useState<RacePhase>(() =>
    prefersReducedMotion() ? 'parked' : 'idle'
  )

  useEffect(() => {
    const node = ref.current
    if (!node || prefersReducedMotion()) return

    let timer: number | undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect()
          setPhase('loading')

          timer = window.setTimeout(() => {
            setPhase('parked')
            onReveal(true)
          }, RACE_LOADING_MS)
        } else if (entry.boundingClientRect.top < 0) {
          // Already scrolled past: skip the intro
          observer.disconnect()
          setPhase('parked')
          onReveal(true)
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [onReveal])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`race-strip relative mb-8 overflow-hidden is-${phase}`}
    >
      <div className="race-rig">
        <div className="race-track" />

        <div className="race-car">
          <span className="car-glow" />

          <span
            className="speed-line top-[34%] w-24 bg-gradient-to-l from-white/70 to-transparent"
            style={{ animationDelay: '0s' }}
          />
          <span
            className="speed-line top-[52%] w-44 bg-gradient-to-l from-[#E10600] to-transparent"
            style={{ animationDelay: '0.15s' }}
          />
          <span
            className="speed-line top-[70%] w-16 bg-gradient-to-l from-white/50 to-transparent"
            style={{ animationDelay: '0.3s' }}
          />

          <RaceCarArt className="car-body block w-full overflow-visible drop-shadow-[0_0_8px_rgba(225,6,0,0.35)]" />
        </div>
      </div>

      <div className="race-progress">
        <span />
      </div>
    </div>
  )
}

// ==========================================
// LAP CHART CAR MARKER
// ==========================================

// Tilts the car slightly to follow the slope of the lap-time line
function lapTilt(laps: LapResult[], lap?: number) {
  const i = laps.findIndex((l) => l.lap === lap)
  if (i < 0) return 0

  const prev = laps[Math.max(i - 1, 0)].lap_time
  const next = laps[Math.min(i + 1, laps.length - 1)].lap_time

  // Slower next lap = line climbs = nose up (negative rotation)
  return Math.max(-22, Math.min(22, -(next - prev) * 15))
}

// Replaces the round hover dot on the lap-time chart
function LapCarMarker({
  cx,
  cy,
  tilt,
}: {
  cx?: number
  cy?: number
  tilt: number
}) {
  if (cx == null || cy == null) return null

  const width = 48
  const height = (width * 58) / 250

  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${tilt})`}
      pointerEvents="none"
    >
      <svg
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        viewBox="0 8 250 58"
        overflow="visible"
        fill="#f8fafc"
        stroke="none"
        style={{
          filter: 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.35))',
        }}
      >
        {/* rear wing */}
        <rect x="12" y="11" width="34" height="6" rx="3" />
        <path d="M26 15 L36 15 L42 40 L33 40 Z" />

        {/* body + helmet */}
        <path d="M30 52 L44 36 L74 27 L80 20 L90 21 L94 32 Q102 36 114 36 L150 43 L224 52 L224 57 L66 57 L30 57 Z" />
        <circle cx="111" cy="31" r="6" />

        {/* front wing */}
        <rect x="200" y="57" width="48" height="6" rx="3" />
        <rect x="212" y="52" width="6" height="8" />

        {/* wheels (dark ring separates them from the body) */}
        <g transform="translate(58 47)">
          <circle r="16" stroke="#111827" strokeWidth="3" />
          <circle r="6" fill="#111827" />
        </g>
        <g transform="translate(194 50)">
          <circle r="13" stroke="#111827" strokeWidth="3" />
          <circle r="5" fill="#111827" />
        </g>
      </svg>
    </g>
  )
}

// ==========================================
// PIT STOP INTRO (plays while the CSV is analyzed)
// ==========================================

type PitPhase =
  | 'arrive'
  | 'stop'
  | 'zoom'
  | 'engine'
  | 'reveal'
  | 'done'

// Durations in milliseconds. The CSS reads these same values
// through variables, so this is the only place to change them.
const PIT_TIMELINE = {
  arrive: 1200,
  stop: 400,
  zoom: 1000,
  engine: 1000, // minimum; holds here until the data is ready
  reveal: 900,
}

const PIT_CAPTIONS: Record<PitPhase, string> = {
  arrive: 'Pit entry',
  stop: 'Box, box',
  zoom: 'Engine check',
  engine: 'Analyzing your laps',
  reveal: 'Analysis ready',
  done: '',
}

function PitEngineArt() {
  return (
    <svg
      viewBox="0 0 600 300"
      className="block w-full overflow-visible"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      {/* engine block */}
      <rect
        x="24"
        y="30"
        width="318"
        height="210"
        rx="14"
        stroke="#f8fafc"
      />
      <path d="M24 62 H342" stroke="#E10600" />

      {/* cylinders, pistons and combustion sparks */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${52 + i * 74} 0)`}>
          <rect
            x="0"
            y="76"
            width="54"
            height="136"
            rx="6"
            stroke="#f8fafc"
            strokeOpacity="0.5"
          />

          <circle
            className="pit-spark"
            cx="27"
            cy="84"
            r="6"
            fill="#E10600"
            stroke="none"
            style={{ animationDelay: `${i * 0.18}s` }}
          />

          <g
            className="pit-piston"
            style={{ animationDelay: `${i * 0.18}s` }}
          >
            <rect
              x="6"
              y="92"
              width="42"
              height="26"
              rx="4"
              stroke="#E10600"
              fill="#0b1120"
            />
            <path d="M27 118 V150" stroke="#f8fafc" />
            <circle
              cx="27"
              cy="154"
              r="6"
              stroke="#f8fafc"
              fill="#0b1120"
            />
          </g>
        </g>
      ))}

      {/* crankshaft */}
      <path d="M50 226 H316" stroke="#f8fafc" strokeOpacity="0.5" />

      {/* drive shaft into the gears */}
      <path d="M342 190 H388" stroke="#f8fafc" />

      {/* large gear */}
      <g transform="translate(450 190)">
        <g className="pit-gear pit-gear-a">
          <circle
            r="62"
            stroke="#f8fafc"
            strokeWidth="12"
            strokeDasharray="9.74 9.74"
            strokeLinecap="butt"
          />
          <circle r="46" stroke="#f8fafc" />
          <circle r="14" stroke="#E10600" />
          <path
            d="M0 -40 V40 M-40 0 H40"
            stroke="#f8fafc"
            strokeOpacity="0.5"
          />
        </g>
      </g>

      {/* small gear */}
      <g transform="translate(526 126)">
        <g className="pit-gear pit-gear-b">
          <circle
            r="36"
            stroke="#f8fafc"
            strokeWidth="10"
            strokeDasharray="7.07 7.07"
            strokeLinecap="butt"
          />
          <circle r="26" stroke="#f8fafc" />
          <circle r="8" stroke="#E10600" />
          <path
            d="M0 -22 V22 M-22 0 H22"
            stroke="#f8fafc"
            strokeOpacity="0.5"
          />
        </g>
      </g>
    </svg>
  )
}

// A car rolls into the pit box, we zoom into the engine, then the
// "Your Race Analysis" title appears and the real results take over.
function PitStopIntro({
  ready,
  onDone,
}: {
  ready: boolean
  onDone: () => void
}) {
  const [phase, setPhase] = useState<PitPhase>('arrive')
  const [engineMinDone, setEngineMinDone] = useState(false)
  const [skipped, setSkipped] = useState(false)

  // The phase on screen. The engine view holds until the data has
  // arrived, so the animation doubles as the loading state.
  let shown: PitPhase = phase

  if (skipped) {
    shown = ready ? 'done' : 'engine'
  } else if (phase === 'engine' && engineMinDone && ready) {
    shown = 'reveal'
  }

  useEffect(() => {
    let id: number | undefined

    if (shown === 'arrive') {
      id = window.setTimeout(
        () => setPhase('stop'),
        PIT_TIMELINE.arrive
      )
    } else if (shown === 'stop') {
      id = window.setTimeout(
        () => setPhase('zoom'),
        PIT_TIMELINE.stop
      )
    } else if (shown === 'zoom') {
      id = window.setTimeout(
        () => setPhase('engine'),
        PIT_TIMELINE.zoom
      )
    } else if (shown === 'engine') {
      id = window.setTimeout(
        () => setEngineMinDone(true),
        PIT_TIMELINE.engine
      )
    } else if (shown === 'reveal') {
      id = window.setTimeout(onDone, PIT_TIMELINE.reveal)
    } else {
      id = window.setTimeout(onDone, 0)
    }

    return () => window.clearTimeout(id)
  }, [shown, onDone])

  const timelineVars = {
    '--pit-arrive': `${PIT_TIMELINE.arrive}ms`,
    '--pit-stop': `${PIT_TIMELINE.stop}ms`,
    '--pit-zoom': `${PIT_TIMELINE.zoom}ms`,
    '--pit-reveal': `${PIT_TIMELINE.reveal}ms`,
  } as CSSProperties

  return (
    <section
      aria-label="Preparing your race analysis"
      className={`pit-intro relative overflow-hidden rounded-2xl border border-white/10 is-${shown}`}
      style={timelineVars}
    >
      <div className="pit-stage">
        <div className="pit-env">
          <div className="pit-ground" />
          <div className="pit-box" />
        </div>

        <div className="pit-car-pos">
          <div className="pit-car-zoom">
            <RaceCarArt className="block w-full overflow-visible drop-shadow-[0_0_8px_rgba(225,6,0,0.35)]" />
          </div>
        </div>
      </div>

      <div className="pit-engine">
        <PitEngineArt />
      </div>

      <div className="pit-title">
        <p className="text-xs font-bold uppercase tracking-widest text-red-400">
          Race Performance
        </p>

        <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
          Your Race Analysis
        </h2>

        <div className="pit-title-rule mt-4" />
      </div>

      <p key={shown} className="pit-caption" aria-live="polite">
        {PIT_CAPTIONS[shown]}
      </p>

      <button
        type="button"
        onClick={() => setSkipped(true)}
        className="absolute bottom-3 right-4 z-20 text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-white"
      >
        Skip
      </button>
    </section>
  )
}

// ==========================================
// MAIN APP
// ==========================================

function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const introRef = useRef<HTMLDivElement>(null)

  // The analyze form fades in after the race car intro
  const [analyzeRevealed, setAnalyzeRevealed] = useState(
    prefersReducedMotion
  )

  // Session configuration
  const [category, setCategory] =
    useState('Formula Racing')

  const [simulator, setSimulator] =
    useState('F1 Series')

  // Upload
  const [uploadMode, setUploadMode] =
    useState<UploadMode>('csv')

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null)

  const [fileError, setFileError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Race analysis
  const [analysis, setAnalysis] =
    useState<Analysis | null>(null)

  const [analysisError, setAnalysisError] = useState('')
  const [loading, setLoading] = useState(false)

  // Pit stop intro that takes over the results area
  const [intro, setIntro] = useState(false)
  const finishIntro = useCallback(() => setIntro(false), [])

  // Strategy settings
  const [strategyType, setStrategyType] =
    useState<StrategyType>('two_stop')

  const [raceLaps, setRaceLaps] = useState(15)
  const [firstPitLap, setFirstPitLap] = useState(6)
  const [secondPitLap, setSecondPitLap] = useState(11)

  const [firstCompound, setFirstCompound] =
    useState<Compound>('MEDIUM')

  const [secondCompound, setSecondCompound] =
    useState<Compound>('HARD')

  const [thirdCompound, setThirdCompound] =
    useState<Compound>('SOFT')

  const [pitLoss, setPitLoss] = useState(25)

  // Strategy results
  const [comparison, setComparison] =
    useState<StrategyComparison | null>(null)

  const [strategyLoading, setStrategyLoading] =
    useState(false)

  const [strategyError, setStrategyError] = useState('')

  // ==========================================
  // FILE HANDLING
  // ==========================================

  function clearStrategy() {
    setComparison(null)
    setStrategyError('')
  }

  function clearResults() {
    setAnalysis(null)
    setAnalysisError('')
    clearStrategy()
  }

  function chooseFile(file: File) {
    clearResults()

    if (!file.name.toLowerCase().endsWith(`.${uploadMode}`)) {
      setSelectedFile(null)
      setFileError(
        `Please select a ${uploadMode.toUpperCase()} file.`
      )
      return
    }

    if (
      file.size === 0 ||
      file.size > MAX_FILE_SIZE
    ) {
      setSelectedFile(null)
      setFileError(
        'File must be larger than 0 bytes and at most 5 MB.'
      )
      return
    }

    setSelectedFile(file)
    setFileError('')
  }

  function handleInput(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]

    if (file) {
      chooseFile(file)
    }
  }

  function changeMode(mode: UploadMode) {
    setUploadMode(mode)
    setSelectedFile(null)
    setFileError('')
    clearResults()

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  function removeFile() {
    setSelectedFile(null)
    setFileError('')
    clearResults()

    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  // ==========================================
  // CSV ANALYSIS API
  // ==========================================

  async function analyzeRace() {
    if (
      !selectedFile ||
      uploadMode !== 'csv' ||
      loading ||
      intro
    ) {
      return
    }

    const playIntro = !prefersReducedMotion()

    setLoading(true)
    setAnalysisError('')
    setAnalysis(null)
    setIntro(playIntro)
    clearStrategy()

    if (playIntro) {
      requestAnimationFrame(() => {
        introRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    }

    const body = new FormData()
    body.append('file', selectedFile)

    try {
      const response = await fetch('/api/analyze/csv', {
        method: 'POST',
        body,
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            'Unable to analyze your racing data.'
          )
        )
      }

      const result = payload as Analysis
      setAnalysis(result)

      // Use the uploaded race length as an initial
      // scenario. The user may increase it later.
      const laps = Math.max(5, result.total_laps)

      const actualPitLaps = result.pit_analysis.stops
        .map((stop) => stop.lap)
        .filter((lap) => lap >= 2 && lap <= laps - 2)

      setRaceLaps(laps)

      const defaultFirst = Math.min(
        Math.max(2, actualPitLaps[0] ?? Math.floor(laps / 3)),
        laps - 2
      )

      const defaultSecond = Math.min(
        Math.max(
          defaultFirst + 2,
          actualPitLaps[1] ?? Math.floor((laps * 2) / 3)
        ),
        laps - 2
      )

      setFirstPitLap(defaultFirst)
      setSecondPitLap(defaultSecond)

      setStrategyType(
        actualPitLaps.length >= 2 ? 'two_stop' : 'one_stop'
      )

      // Infer opening and subsequent compounds from
      // recorded stints when supported by the planner.
      const recorded = result.stints.map(
        (stint) => stint.compound
      )

      if (COMPOUNDS.includes(recorded[0] as Compound)) {
        setFirstCompound(recorded[0] as Compound)
      }

      if (COMPOUNDS.includes(recorded[1] as Compound)) {
        setSecondCompound(recorded[1] as Compound)
      }

      if (COMPOUNDS.includes(recorded[2] as Compound)) {
        setThirdCompound(recorded[2] as Compound)
      }

      if (!playIntro) {
        requestAnimationFrame(() => {
          resultsRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        })
      }
    } catch (error) {
      setIntro(false)
      setAnalysisError(
        error instanceof Error
          ? error.message
          : 'Unable to connect to Laplogic.'
      )
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // STRATEGY SETTINGS
  // ==========================================

  function changeRaceLaps(value: number) {
    const next = Math.min(500, Math.max(5, value))

    setRaceLaps(next)

    const first = Math.min(
      firstPitLap,
      strategyType === 'two_stop'
        ? Math.max(2, next - 4)
        : next - 2
    )

    setFirstPitLap(first)

    setSecondPitLap(
      Math.min(
        next - 2,
        Math.max(first + 2, secondPitLap)
      )
    )

    clearStrategy()
  }

  function changeStrategyType(type: StrategyType) {
    setStrategyType(type)

    if (type === 'two_stop') {
      const first = Math.min(
        firstPitLap,
        Math.max(2, raceLaps - 4)
      )

      setFirstPitLap(first)

      setSecondPitLap(
        Math.min(
          raceLaps - 2,
          Math.max(first + 2, secondPitLap)
        )
      )
    }

    clearStrategy()
  }

  function changeFirstPitLap(value: number) {
    setFirstPitLap(value)

    if (
      strategyType === 'two_stop' &&
      secondPitLap < value + 2
    ) {
      setSecondPitLap(value + 2)
    }

    clearStrategy()
  }

  // ==========================================
  // STRATEGY COMPARISON API
  // ==========================================

  async function compareStrategies() {
    if (!selectedFile || !analysis || strategyLoading) {
      return
    }

    setStrategyLoading(true)
    setStrategyError('')
    setComparison(null)

    const body = new FormData()

    body.append('file', selectedFile)
    body.append('race_laps', String(raceLaps))
    body.append('strategy_type', strategyType)
    body.append('first_pit_lap', String(firstPitLap))

    if (strategyType === 'two_stop') {
      body.append(
        'second_pit_lap',
        String(secondPitLap)
      )
    }

    body.append('first_compound', firstCompound)
    body.append('second_compound', secondCompound)
    body.append('third_compound', thirdCompound)
    body.append('pit_loss', String(pitLoss))

    try {
      const response = await fetch(
        '/api/strategy/compare',
        {
          method: 'POST',
          body,
        }
      )

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            'Unable to compare the strategies.'
          )
        )
      }

      setComparison(payload as StrategyComparison)
    } catch (error) {
      setStrategyError(
        error instanceof Error
          ? error.message
          : 'Strategy comparison failed.'
      )
    } finally {
      setStrategyLoading(false)
    }
  }

  // ==========================================
  // DERIVED DATA
  // ==========================================

  const minRaceLaps = 5
  const maxRaceLaps = analysis
    ? Math.min(500, Math.max(5, analysis.total_laps * 2))
    : 500

  const firstPitMax =
    strategyType === 'two_stop'
      ? Math.max(2, raceLaps - 4)
      : raceLaps - 2

  const secondPitMin = firstPitLap + 2
  const secondPitMax = raceLaps - 2

  const validPitWindows =
    firstPitLap >= 2 &&
    firstPitLap <= firstPitMax &&
    (
      strategyType === 'one_stop' ||
      (
        secondPitLap >= secondPitMin &&
        secondPitLap <= secondPitMax
      )
    )

  const previewStints: TimelineStint[] =
    strategyType === 'one_stop'
      ? [
        {
          start_lap: 1,
          end_lap: firstPitLap,
          compound: firstCompound,
        },
        {
          start_lap: firstPitLap + 1,
          end_lap: raceLaps,
          compound: secondCompound,
        },
      ]
      : [
        {
          start_lap: 1,
          end_lap: firstPitLap,
          compound: firstCompound,
        },
        {
          start_lap: firstPitLap + 1,
          end_lap: secondPitLap,
          compound: secondCompound,
        },
        {
          start_lap: secondPitLap + 1,
          end_lap: raceLaps,
          compound: thirdCompound,
        },
      ]

  const pitLaps =
    analysis?.pit_analysis.stops.map(
      (stop) => stop.lap
    ) ?? []

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="min-h-screen bg-[#080c14] text-white">

      {/* NAVIGATION */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d1320]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">

          <a
            href="#dashboard"
            className="flex items-center gap-3"
          >
            <div className="rounded-xl bg-[#E10600] p-3">
              <Gauge size={24} />
            </div>

            <div>
              <h1 className="text-xl font-black tracking-widest">
                LAP
                <span className="text-[#E10600]">
                  LOGIC
                </span>
              </h1>

              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Race Smarter. Lap Faster.
              </p>
            </div>
          </a>

          <nav className="hidden gap-8 text-sm text-slate-400 md:flex">
            <a href="#dashboard" className="text-white">
              Dashboard
            </a>
            <a href="#analyze" className="hover:text-white">
              Analyze
            </a>
            <a href="#strategy" className="hover:text-white">
              Strategy
            </a>
            <a href="#features" className="hover:text-white">
              Features
            </a>
          </nav>

          <span className="hidden items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400 md:flex">
            <ShieldCheck size={15} className="mr-2" />
            Free to Use
          </span>

          <button
            type="button"
            className="md:hidden"
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {menuOpen && (
          <nav className="flex flex-col gap-4 border-t border-white/10 p-5 text-sm md:hidden">
            {[
              'dashboard',
              'analyze',
              'strategy',
              'features',
            ].map((name) => (
              <a
                key={name}
                href={`#${name}`}
                className="capitalize"
                onClick={() => setMenuOpen(false)}
              >
                {name}
              </a>
            ))}
          </nav>
        )}
      </header>

      {/* HERO */}
      <section
        id="dashboard"
        className="relative isolate overflow-hidden"
      >
        <HeroMedia />

        <div className="relative z-10 mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-400">
              <Activity size={14} />
              Universal Sim Racing Intelligence
            </p>

            <h2 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              EVERY LAP
              <span className="block text-[#E10600]">
                TELLS A STORY.
              </span>
            </h2>

            <p className="mt-6 max-w-2xl leading-8 text-slate-400">
              Analyze your race data, review your pit stops,
              and compare personalized one-stop and two-stop
              strategies using your recorded driving pace.
            </p>

            <a
              href="#analyze"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#E10600] px-6 py-4 text-sm font-bold hover:bg-red-700"
            >
              Analyze Your Race
              <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">

        {/* FEATURE HIGHLIGHTS */}
        <section className="mb-12 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: <Flag size={21} />,
              title: 'MULTI-CATEGORY',
              description: 'Built for different racing disciplines',
            },
            {
              icon: <BarChart3 size={21} />,
              title: 'DATA-DRIVEN',
              description: 'Analyze your recorded lap performance',
            },
            {
              icon: <Sparkles size={21} />,
              title: 'STRATEGY PLANNER',
              description: 'Compare one-stop and two-stop plans',
            },
          ].map((item) => (
            <Panel key={item.title}>
              <div className="mb-4 text-red-400">
                {item.icon}
              </div>

              <h3 className="text-sm font-bold tracking-wider">
                {item.title}
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                {item.description}
              </p>
            </Panel>
          ))}
        </section>

        {/* RACE DATA UPLOAD */}
        <section id="analyze" className="scroll-mt-28">
          <RaceCarDivider onReveal={setAnalyzeRevealed} />

          <div
            className={`analyze-reveal ${analyzeRevealed ? 'is-revealed' : ''
              }`}
          >
            <p className="text-xs font-bold uppercase tracking-widest text-red-400">
              Start Here
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              New Race Analysis
            </h2>

            <p className="mb-7 mt-2 text-sm text-slate-400">
              Select your racing category and upload your session data.
            </p>

            <div className="grid gap-6 lg:grid-cols-2">

              {/* CONFIGURATION */}
              <Panel>
                <h3 className="mb-7 flex items-center gap-3 font-bold">
                  <Flag size={20} className="text-red-400" />
                  Session Configuration
                </h3>

                <label
                  htmlFor="category"
                  className="mb-2 block text-sm text-slate-300"
                >
                  Racing Category
                </label>

                <div className="relative mb-6">
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value)
                      clearResults()
                    }}
                    className="w-full appearance-none rounded-xl border border-slate-700 bg-[#0c1320] px-4 py-3.5 pr-10 text-sm outline-none focus:border-red-500"
                  >
                    {CATEGORIES.map((item) => (
                      <option key={item}>
                        {item}
                      </option>
                    ))}
                  </select>

                  <ChevronDown
                    size={18}
                    className="pointer-events-none absolute right-4 top-4 text-slate-400"
                  />
                </div>

                <label
                  htmlFor="simulator"
                  className="mb-2 block text-sm text-slate-300"
                >
                  Simulator / Game
                </label>

                <div className="relative">
                  <select
                    id="simulator"
                    value={simulator}
                    onChange={(e) => {
                      setSimulator(e.target.value)
                      clearResults()
                    }}
                    className="w-full appearance-none rounded-xl border border-slate-700 bg-[#0c1320] px-4 py-3.5 pr-10 text-sm outline-none focus:border-red-500"
                  >
                    {SIMULATORS.map((game) => (
                      <option key={game}>
                        {game}
                      </option>
                    ))}
                  </select>

                  <ChevronDown
                    size={18}
                    className="pointer-events-none absolute right-4 top-4 text-slate-400"
                  />
                </div>

                <div className="mt-7 rounded-xl border border-slate-800 bg-[#0c1320] p-4 text-sm">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Current Session
                  </p>

                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">
                      Category
                    </span>
                    <span className="text-right font-semibold">
                      {category}
                    </span>
                  </div>

                  <div className="mt-3 flex justify-between gap-4">
                    <span className="text-slate-400">
                      Simulator
                    </span>
                    <span className="text-right font-semibold">
                      {simulator}
                    </span>
                  </div>

                  <div className="mt-3 flex justify-between gap-4">
                    <span className="text-slate-400">
                      Circuit
                    </span>
                    <span className="text-right font-semibold text-sky-400">
                      {analysis?.circuit ?? 'Read from CSV'}
                    </span>
                  </div>
                </div>
              </Panel>

              {/* FILE UPLOAD */}
              <Panel>
                <h3 className="mb-7 flex items-center gap-3 font-bold">
                  <UploadCloud size={20} className="text-red-400" />
                  Upload Race Data
                </h3>

                <div className="mb-5 grid grid-cols-2 gap-3">
                  {([
                    {
                      mode: 'csv',
                      label: 'CSV Data',
                      icon: <FileSpreadsheet size={18} />,
                    },
                    {
                      mode: 'pdf',
                      label: 'PDF Report',
                      icon: <FileText size={18} />,
                    },
                  ] as const).map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      aria-pressed={uploadMode === item.mode}
                      onClick={() => changeMode(item.mode)}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold ${uploadMode === item.mode
                        ? 'border-red-600 bg-red-500/10'
                        : 'border-slate-700 text-slate-400'
                        }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' ||
                      e.key === ' '
                    ) {
                      e.preventDefault()
                      fileRef.current?.click()
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setDragging(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)

                    const file = e.dataTransfer.files[0]

                    if (file) {
                      chooseFile(file)
                    }
                  }}
                  className={`flex min-h-60 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${dragging
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-slate-700 bg-[#0c1320] hover:border-slate-500'
                    }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept={
                      uploadMode === 'csv'
                        ? '.csv'
                        : '.pdf'
                    }
                    onChange={handleInput}
                    className="hidden"
                    aria-label="Choose race file"
                  />

                  <UploadCloud
                    size={36}
                    className="mb-4 text-red-400"
                  />

                  <p className="font-semibold">
                    Drag & drop your{' '}
                    {uploadMode.toUpperCase()} file
                  </p>

                  <p className="mt-2 text-sm text-slate-500">
                    or click to browse
                  </p>

                  <p className="mt-4 text-xs text-slate-600">
                    Maximum size: 5 MB
                  </p>
                </div>

                {selectedFile && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <CheckCircle2
                        size={19}
                        className="shrink-0 text-emerald-400"
                      />

                      <span className="min-w-0 truncate text-sm">
                        {selectedFile.name}
                        <span className="ml-2 text-slate-500">
                          ({formatSize(selectedFile.size)})
                        </span>
                      </span>
                    </div>

                    <button
                      type="button"
                      aria-label="Remove file"
                      onClick={removeFile}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}

                {fileError && (
                  <p className="mt-4 text-sm text-red-400">
                    {fileError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={
                    !selectedFile ||
                    uploadMode !== 'csv' ||
                    loading ||
                    intro
                  }
                  onClick={analyzeRace}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E10600] px-6 py-4 font-semibold hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading || intro ? (
                    <LoaderCircle
                      size={18}
                      className="animate-spin"
                    />
                  ) : (
                    <ArrowRight size={18} />
                  )}

                  {loading || intro
                    ? 'Analyzing...'
                    : 'Analyze Race'}
                </button>

                {uploadMode === 'pdf' && (
                  <p className="mt-3 text-center text-xs text-amber-400">
                    PDF analysis will be added later.
                  </p>
                )}
              </Panel>
            </div>
          </div>
        </section>

        {/* ANALYSIS ERRORS */}
        {analysisError && (
          <div className="mt-8 flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <AlertTriangle
              size={20}
              className="shrink-0"
            />
            {analysisError}
          </div>
        )}

        {/* PIT STOP INTRO */}
        {intro && (
          <div ref={introRef} className="mt-16 scroll-mt-28">
            <PitStopIntro
              ready={analysis !== null}
              onDone={finishIntro}
            />
          </div>
        )}

        {/* RACE ANALYSIS RESULTS */}
        {analysis && !intro && (
          <section
            ref={resultsRef}
            className="results-in mt-16 scroll-mt-28 space-y-7"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-400">
                Race Performance
              </p>

              <h2 className="mt-2 text-3xl font-bold">
                Your Race Analysis
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                {analysis.filename} · {category} · {simulator}
              </p>
            </div>

            {/* CIRCUIT */}
            <Panel>
              <div className="flex items-center gap-3">
                <MapPin size={23} className="text-red-400" />

                <div>
                  <p className="text-xs font-bold tracking-wider text-slate-400">
                    CIRCUIT FROM CSV
                  </p>

                  <h3 className="mt-1 text-2xl font-bold">
                    {analysis.circuit}
                  </h3>
                </div>
              </div>
            </Panel>

            {/* METRICS */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                icon={<Trophy size={20} />}
                label="FASTEST LAP"
                value={formatTime(
                  analysis.statistics.fastest_lap
                )}
                subtitle={`Lap ${analysis.statistics.best_lap_number}`}
              />

              <Metric
                icon={<Timer size={20} />}
                label="AVERAGE LAP"
                value={formatTime(
                  analysis.statistics.average_lap
                )}
                subtitle="Across recorded laps"
              />

              <Metric
                icon={<Activity size={20} />}
                label="CONSISTENCY"
                value={`${analysis.statistics.consistency_std.toFixed(3)}s`}
                subtitle="Standard deviation"
              />

              <Metric
                icon={<Wrench size={20} />}
                label="PIT STOPS"
                value={
                  analysis.pit_analysis.available
                    ? String(
                      analysis.pit_analysis.total_pit_stops
                    )
                    : 'N/A'
                }
                subtitle="Recorded pit events"
              />
            </div>

            {/* TYRE STINTS */}
            <Panel>
              <h3 className="text-xl font-bold">
                Recorded Tyre Strategy
              </h3>

              <p className="mb-6 mt-2 text-sm text-slate-400">
                Tyre usage from your uploaded session
              </p>

              <TyreTimeline
                stints={analysis.stints.map((stint) => ({
                  start_lap: stint.start_lap,
                  end_lap: stint.end_lap,
                  compound: stint.compound,
                }))}
              />

              <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {analysis.stints.map((stint) => (
                  <div
                    key={stint.stint_number}
                    className="rounded-xl border border-slate-700 bg-[#0c1320] p-4"
                  >
                    <h4 className="font-bold">
                      Stint {stint.stint_number}
                    </h4>

                    <p className="mt-2 text-sm text-slate-300">
                      {stint.compound} · Laps{' '}
                      {stint.start_lap}–{stint.end_lap}
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      Average: {formatTime(stint.average_lap)}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>

            {/* RECORDED PIT STOPS */}
            <Panel>
              <h3 className="mb-5 flex items-center gap-2 text-xl font-bold">
                <Wrench className="text-red-400" />
                Recorded Pit Stops
              </h3>

              {!analysis.pit_analysis.available ? (
                <p className="text-sm text-amber-300">
                  No pit-stop column was supplied.
                </p>
              ) : pitLaps.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No recorded pit stops.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {analysis.pit_analysis.stops.map(
                    (stop, index) => (
                      <div
                        key={`${stop.lap}-${index}`}
                        className="rounded-xl border border-slate-700 bg-[#0c1320] p-5"
                      >
                        <p className="text-xs font-bold text-red-400">
                          PIT STOP {index + 1}
                        </p>

                        <h4 className="mt-2 text-xl font-bold">
                          Lap {stop.lap}
                        </h4>

                        <p className="mt-2 text-sm text-slate-400">
                          Previous tyre: {stop.compound_before}
                        </p>

                        <p className="mt-2 font-mono text-sm">
                          {stop.duration === null
                            ? 'Duration unavailable'
                            : `${stop.duration.toFixed(3)}s recorded`}
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}
            </Panel>

            {/* LAP TIME CHART */}
            <Panel>
              <h3 className="text-xl font-bold">
                Lap-Time Performance
              </h3>

              <p className="mb-6 mt-2 text-sm text-slate-400">
                Red: lap time · Yellow: recorded pit lap
              </p>

              <div className="h-80 w-full">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <LineChart data={analysis.laps}>
                    <CartesianGrid
                      stroke="#334155"
                      strokeDasharray="3 3"
                    />

                    <XAxis
                      dataKey="lap"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      stroke="#94a3b8"
                      allowDecimals={false}
                    />

                    <YAxis
                      stroke="#94a3b8"
                      domain={['auto', 'auto']}
                      width={60}
                    />

                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #475569',
                        borderRadius: 8,
                      }}
                      labelFormatter={(lap) => `Lap ${lap}`}
                      formatter={(value) => [
                        formatTime(Number(value)),
                        'Lap Time',
                      ]}
                    />

                    {pitLaps.map((lap) => (
                      <ReferenceLine
                        key={lap}
                        x={lap}
                        stroke="#f59e0b"
                        strokeDasharray="5 5"
                      />
                    ))}

                    <Line
                      type="monotone"
                      dataKey="lap_time"
                      stroke="#E10600"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      activeDot={(props) => (
                        <LapCarMarker
                          cx={props.cx}
                          cy={props.cy}
                          tilt={lapTilt(
                            analysis.laps,
                            props.payload?.lap
                          )}
                        />
                      )}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            {/* LAP TABLE */}
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
              <div className="border-b border-slate-800 p-5">
                <h3 className="text-xl font-bold">
                  Lap-by-Lap Breakdown
                </h3>
              </div>

              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="sticky top-0 bg-[#1e293b] text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Lap</th>
                      <th className="px-5 py-3">Time</th>
                      <th className="px-5 py-3">Compound</th>
                      <th className="px-5 py-3">Gap to Best</th>
                      <th className="px-5 py-3">Pit</th>
                    </tr>
                  </thead>

                  <tbody>
                    {analysis.laps.map((lap) => (
                      <tr
                        key={lap.lap}
                        className={`border-t border-slate-800 ${lap.is_pit_stop
                          ? 'bg-amber-500/5'
                          : ''
                          }`}
                      >
                        <td className="px-5 py-3">
                          {lap.lap}
                        </td>

                        <td className="px-5 py-3 font-mono">
                          {formatTime(lap.lap_time)}
                        </td>

                        <td className="px-5 py-3">
                          {lap.compound}
                        </td>

                        <td className="px-5 py-3 font-mono text-slate-400">
                          +{lap.delta_to_best.toFixed(3)}s
                        </td>

                        <td className="px-5 py-3">
                          {lap.is_pit_stop
                            ? 'PIT'
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* AUTOMATIC STRATEGY ADVISOR */}
        {analysis && selectedFile && uploadMode === 'csv' && (
          <section className="mt-16 scroll-mt-28">
            <StrategyAdvisor file={selectedFile} />
          </section>
        )}

        {/* ==================================
            STRATEGY PLANNER
        ================================== */}

        {analysis && !intro && (
          <section
            id="strategy"
            className="mt-16 scroll-mt-28 space-y-7"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-400">
                Personalized Strategy
              </p>

              <h2 className="mt-2 text-3xl font-bold">
                Race Strategy Planner
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Compare one-stop and two-stop plans using
                estimated pace from your uploaded racing data.
              </p>
            </div>

            <div
              className={`engine-block ${strategyLoading ? 'is-comparing' : ''
                }`}
            >
              {/* HEADER + LIVE PLAN SUMMARY */}
              <div className="engine-head flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                <div className="flex items-center gap-4">
                  <EngineGears className="h-12 w-[4.5rem] shrink-0" />

                  <div>
                    <h3 className="text-xl font-bold">
                      Strategy Configuration
                    </h3>

                    <p className="mt-0.5 text-xs text-slate-500">
                      Set up your plan in four steps, then compare.
                    </p>
                  </div>
                </div>

                <div
                  className="flex flex-wrap items-center gap-2"
                  aria-label="Current plan"
                >
                  <span className="rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
                    {raceLaps} laps
                  </span>

                  <span className="rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
                    {strategyType === 'one_stop'
                      ? '1 stop'
                      : '2 stops'}
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
                    {previewStints.map((stint, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1.5"
                      >
                        {index > 0 && (
                          <span className="text-slate-600">→</span>
                        )}

                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: tyreColor(stint.compound),
                          }}
                        />

                        {stint.compound.charAt(0)}
                      </span>
                    ))}
                  </span>

                  <span className="rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
                    {pitLoss.toFixed(1)}s pit loss
                  </span>
                </div>
              </div>

              {/* FOUR "CYLINDERS" */}
              <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {/* 01 STOPS */}
                <EngineBay
                  step="01"
                  title="Stops"
                  hint="How many pit stops"
                >
                  <div className="space-y-2">
                    {([
                      'one_stop',
                      'two_stop',
                    ] as StrategyType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => changeStrategyType(type)}
                        aria-pressed={strategyType === type}
                        className={`w-full rounded-lg border px-4 py-3 text-left transition ${strategyType === type
                            ? 'border-[#E10600] bg-red-500/10'
                            : 'border-white/10 bg-[#0c1320] text-slate-400 hover:border-white/30'
                          }`}
                      >
                        <span className="block font-semibold">
                          {type === 'one_stop'
                            ? 'One Stop'
                            : 'Two Stops'}
                        </span>

                        <span className="block text-xs text-slate-500">
                          {type === 'one_stop'
                            ? '1 pit · 2 stints'
                            : '2 pits · 3 stints'}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="text-[11px] text-slate-500">
                    {strategyType === 'one_stop'
                      ? 'Fewer stops, longer tyre stints.'
                      : 'More stops, fresher tyres.'}
                  </p>
                </EngineBay>

                {/* 02 RACE */}
                <EngineBay
                  step="02"
                  title="Race"
                  hint="Length and pit cost"
                >
                  <div>
                    <label
                      htmlFor="race-laps"
                      className="mb-3 block text-sm text-slate-300"
                    >
                      Planned race length
                    </label>

                    <div className="flex items-stretch gap-2">
                      <button
                        type="button"
                        aria-label="Decrease race length"
                        disabled={raceLaps <= minRaceLaps}
                        onClick={() =>
                          changeRaceLaps(raceLaps - 1)
                        }
                        className="grid w-11 place-items-center rounded-lg border border-white/15 bg-[#0c1320] text-xl text-slate-300 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        −
                      </button>

                      <input
                        id="race-laps"
                        type="number"
                        min={minRaceLaps}
                        max={maxRaceLaps}
                        value={raceLaps}
                        onChange={(e) =>
                          changeRaceLaps(Number(e.target.value))
                        }
                        className="engine-number min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0c1320] py-2.5 text-center font-mono text-xl font-bold text-white outline-none focus:border-red-500"
                      />

                      <button
                        type="button"
                        aria-label="Increase race length"
                        disabled={raceLaps >= maxRaceLaps}
                        onClick={() =>
                          changeRaceLaps(raceLaps + 1)
                        }
                        className="grid w-11 place-items-center rounded-lg border border-white/15 bg-[#0c1320] text-xl text-slate-300 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-500">
                      Max {maxRaceLaps} laps with this upload.
                    </p>
                  </div>

                  <EngineRange
                    id="pit-loss"
                    label="Additional pit loss"
                    valueLabel={`${pitLoss.toFixed(1)}s`}
                    min={0}
                    max={60}
                    step={0.5}
                    value={pitLoss}
                    onChange={(value) => {
                      setPitLoss(value)
                      clearStrategy()
                    }}
                    hintMin="0s"
                    hintMax="60s"
                  />
                </EngineBay>

                {/* 03 PIT LAPS */}
                <EngineBay
                  step="03"
                  title="Pit laps"
                  hint="When you box"
                >
                  <EngineRange
                    id="first-pit"
                    label="First pit stop"
                    valueLabel={`Lap ${firstPitLap}`}
                    min={2}
                    max={firstPitMax}
                    value={firstPitLap}
                    onChange={changeFirstPitLap}
                    hintMin="Lap 2"
                    hintMax={`Lap ${firstPitMax}`}
                  />

                  {strategyType === 'two_stop' && (
                    <EngineRange
                      id="second-pit"
                      label="Second pit stop"
                      valueLabel={`Lap ${secondPitLap}`}
                      min={secondPitMin}
                      max={secondPitMax}
                      value={secondPitLap}
                      onChange={(value) => {
                        setSecondPitLap(value)
                        clearStrategy()
                      }}
                      hintMin={`Lap ${secondPitMin}`}
                      hintMax={`Lap ${secondPitMax}`}
                    />
                  )}
                </EngineBay>

                {/* 04 TYRES */}
                <EngineBay
                  step="04"
                  title="Tyres"
                  hint="Compound per stint"
                >
                  <CompoundSelector
                    label="First stint"
                    value={firstCompound}
                    onChange={(value) => {
                      setFirstCompound(value)
                      clearStrategy()
                    }}
                  />

                  <CompoundSelector
                    label="Second stint"
                    value={secondCompound}
                    onChange={(value) => {
                      setSecondCompound(value)
                      clearStrategy()
                    }}
                  />

                  {strategyType === 'two_stop' && (
                    <CompoundSelector
                      label="Third stint"
                      value={thirdCompound}
                      onChange={(value) => {
                        setThirdCompound(value)
                        clearStrategy()
                      }}
                    />
                  )}
                </EngineBay>
              </div>

              {/* CRANKSHAFT: LIVE PLAN PREVIEW */}
              <div className="engine-crank">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold uppercase tracking-wider">
                    Planned tyre strategy
                  </h4>

                  <span className="text-xs text-slate-500">
                    Pit stops happen at the end of the selected laps.
                  </span>
                </div>

                {validPitWindows ? (
                  <CrankStrategy stints={previewStints} />
                ) : (
                  <p className="text-sm text-amber-300">
                    Adjust the pit laps to see your plan.
                  </p>
                )}
              </div>

              {!validPitWindows && (
                <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                  The selected pit-stop windows are invalid.
                </div>
              )}

              {/* IGNITION */}
              <button
                type="button"
                onClick={compareStrategies}
                disabled={
                  strategyLoading ||
                  !validPitWindows ||
                  raceLaps > maxRaceLaps ||
                  raceLaps < minRaceLaps
                }
                className="ignition group mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-[#E10600] px-6 py-4 font-bold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {strategyLoading ? (
                  <LoaderCircle
                    size={18}
                    className="animate-spin"
                  />
                ) : (
                  <RefreshCw
                    size={18}
                    className="transition-transform duration-500 group-hover:rotate-180"
                  />
                )}

                {strategyLoading
                  ? 'Comparing Strategies...'
                  : 'Compare Strategies'}
              </button>
            </div>

            {/* STRATEGY ERRORS */}
            {strategyError && (
              <div className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
                <AlertTriangle
                  size={20}
                  className="shrink-0"
                />
                {strategyError}
              </div>
            )}

            {/* STRATEGY RESULTS */}
            {comparison && (
              <div className="space-y-7">

                <div>
                  <h3 className="text-2xl font-bold">
                    Strategy Comparison
                  </h3>

                  <p className="mt-2 text-sm text-slate-400">
                    Estimated results for a{' '}
                    {comparison.race_laps}-lap race.
                    The alternative uses a different
                    number of pit stops.
                  </p>
                </div>

                {/* STRATEGY CARDS */}
                <div className="grid gap-5 lg:grid-cols-2">
                  {comparison.strategies.map((strategy) => (
                    <Panel key={strategy.strategy}>
                      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <h4 className="text-lg font-bold">
                          {strategy.strategy}
                        </h4>

                        {strategy.supported && (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                            Rank #{strategy.rank}
                          </span>
                        )}
                      </div>

                      {!strategy.supported ? (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                            <AlertTriangle size={17} />
                            Insufficient Data
                          </div>

                          <p className="text-sm leading-6 text-amber-100/80">
                            {strategy.reason}
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Estimated Total Time
                          </p>

                          <p className="mt-2 font-mono text-3xl font-bold">
                            {formatTime(
                              strategy.estimated_total_time ?? 0
                            )}
                          </p>

                          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-slate-500">
                                Racing Time
                              </p>

                              <p className="mt-1 font-mono font-semibold">
                                {formatTime(
                                  strategy.estimated_racing_time ?? 0
                                )}
                              </p>
                            </div>

                            <div>
                              <p className="text-slate-500">
                                Additional Pit Loss
                              </p>

                              <p className="mt-1 font-mono font-semibold">
                                {(strategy.pit_loss_total ?? 0).toFixed(3)}s
                              </p>
                            </div>
                          </div>

                          <div className="mt-6">
                            <TyreTimeline
                              stints={
                                strategy.stints ?? []
                              }
                            />
                          </div>

                          {strategy.warnings &&
                            strategy.warnings.length > 0 && (
                              <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                                {strategy.warnings.map(
                                  (warning, index) => (
                                    <p key={index}>
                                      {warning}
                                    </p>
                                  )
                                )}
                              </div>
                            )}
                        </>
                      )}
                    </Panel>
                  ))}
                </div>

                {/* PACE PROFILES */}
                <Panel>
                  <h3 className="mb-2 flex items-center gap-2 text-xl font-bold">
                    <Clock3 className="text-red-400" />
                    Recorded Tyre Pace
                  </h3>

                  <p className="mb-6 text-sm text-slate-400">
                    Observed clean mean lap time
                    for each available compound.
                  </p>

                  <div className="grid gap-4 sm:grid-cols-3">
                    {Object.entries(
                      comparison.pace_profiles
                    ).map(([compound, profile]) => (
                      <div
                        key={compound}
                        className="rounded-xl border border-slate-700 bg-[#0c1320] p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor:
                                tyreColor(compound),
                            }}
                          />

                          <span className="font-bold">
                            {compound}
                          </span>
                        </div>

                        <p className="mt-4 font-mono text-xl font-bold">
                          {formatTime(profile.average_lap)}
                        </p>

                        <p className="mt-2 text-xs text-slate-400">
                          {profile.sample_laps} clean laps
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          Max observed tyre age:{' '}
                          {profile.max_observed_age}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>

                {/* EXPERIMENTAL DISCLAIMER */}
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={19}
                      className="mt-0.5 shrink-0"
                    />

                    <div>
                      <p className="font-bold">
                        Experimental Strategy Estimates
                      </p>

                      <p className="mt-2 leading-6">
                        These comparisons use average
                        recorded non-pit lap pace per tyre
                        compound and a configured additional
                        pit-loss assumption. The current model
                        does not predict tyre degradation,
                        fuel load, traffic, weather or
                        safety-car effects.
                      </p>

                      <p className="mt-3 leading-6">
                        Rank #1 means the lowest estimated
                        time among supported candidates,
                        not a proven optimal race strategy.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* FEATURES */}
        <section
          id="features"
          className="scroll-mt-28 pt-20"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-red-400">
            The Platform
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            Built for Every Racer
          </h2>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: <Activity size={24} />,
                title: 'Lap Performance',
                description:
                  'Understand lap-time trends and consistency.',
              },
              {
                icon: <Gauge size={24} />,
                title: 'Race Strategy',
                description:
                  'Compare pit stops and tyre strategies.',
              },
              {
                icon: <Sparkles size={24} />,
                title: 'AI Race Engineer',
                description:
                  'Personalized AI racing insights coming later.',
              },
            ].map((feature) => (
              <Panel key={feature.title}>
                <div className="mb-5 text-red-400">
                  {feature.icon}
                </div>

                <h3 className="font-bold">
                  {feature.title}
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {feature.description}
                </p>
              </Panel>
            ))}
          </div>
        </section>

        {/* FOOTER */}
        <footer className="mt-20 flex flex-wrap justify-between gap-4 border-t border-white/10 pt-8 text-xs text-slate-500">
          <span>
            © {new Date().getFullYear()} Laplogic
          </span>

          <span>
            Race Smarter. Lap Faster.
          </span>
        </footer>
      </main>
    </div>
  )
}

export default App
