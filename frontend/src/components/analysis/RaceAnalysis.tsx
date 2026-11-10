import { lazy, memo, Suspense } from 'react'
import type { Ref } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Info,
  LoaderCircle,
  MapPin,
  Timer,
  Trophy,
  Wrench,
} from 'lucide-react'
import type { Analysis, Insight } from '../../types'
import { formatTime, tyreColor } from '../../utils/format'
import CrankStrategy from '../strategy/CrankStrategy'
import {
  EngineBadge,
  EngineChip,
  EngineHeader,
  Metric,
  PanelHeading,
  SectionHeading,
  TyreDot,
} from '../ui/Panel'

// Recharts is the heaviest dependency; load it only once results exist.
const LapChart = lazy(() => import('./LapChart'))

const INSIGHT_STYLE: Record<Insight['level'], { icon: typeof Info; className: string }> = {
  positive: { icon: CheckCircle2, className: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300' },
  info: { icon: Info, className: 'border-sky-500/25 bg-sky-500/5 text-sky-300' },
  warning: { icon: AlertTriangle, className: 'border-amber-500/25 bg-amber-500/5 text-amber-300' },
}

function InsightsPanel({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null
  return (
    <div className="engine-panel">
      <PanelHeading hint="What your data says, in plain language">Key insights</PanelHeading>
      <ul className="grid gap-3 md:grid-cols-2">
        {insights.map((insight) => {
          const { icon: Icon, className } = INSIGHT_STYLE[insight.level]
          return (
            <li key={insight.title} className={`rounded-lg border p-4 ${className}`}>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={16} aria-hidden="true" className="shrink-0" />
                {insight.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{insight.detail}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function lapStatus(lap: Analysis['laps'][number]): string {
  if (lap.is_pit_stop) return 'PIT'
  return lap.exclusion ?? '—'
}

function RaceAnalysis({
  analysis,
  category,
  simulator,
  sectionRef,
}: {
  analysis: Analysis
  category: string
  simulator: string
  sectionRef?: Ref<HTMLElement>
}) {
  const { statistics: stats, pit_analysis: pits, data_quality: quality } = analysis
  const pitLaps = pits.stops.map((stop) => stop.lap)
  const consistency = stats.clean_consistency_std ?? stats.consistency_std

  return (
    <section ref={sectionRef} className="results-in mt-16 scroll-mt-28 space-y-7">
      <SectionHeading
        eyebrow="Race Performance"
        title="Your Race Analysis"
        description={`${analysis.filename} · ${category} · ${simulator}`}
      />

      <div className="engine-block">
      <EngineHeader
        glyph={<EngineBadge><Gauge size={24} aria-hidden="true" /></EngineBadge>}
        title="Session Results"
        subtitle="Pace, tyres and pit stops from your upload."
        chips={
          <>
            <EngineChip>
              <MapPin size={13} className="text-red-400" aria-hidden="true" />
              <span className="sr-only">Circuit:</span>
              {analysis.circuit}
            </EngineChip>
            <EngineChip>{analysis.laps.length} laps</EngineChip>
          </>
        }
      />

      <div className="space-y-6">

      {/* METRICS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={<Trophy size={20} aria-hidden="true" />}
          label="FASTEST LAP"
          value={formatTime(stats.fastest_lap)}
          subtitle={`Lap ${stats.best_lap_number}`}
        />
        <Metric
          icon={<Timer size={20} aria-hidden="true" />}
          label="RACE PACE"
          value={formatTime(stats.clean_average_lap ?? stats.average_lap)}
          subtitle={
            stats.clean_average_lap !== null
              ? `Average of ${stats.clean_laps} clean laps`
              : 'Across recorded laps'
          }
        />
        <Metric
          icon={<Activity size={20} aria-hidden="true" />}
          label="CONSISTENCY"
          value={`±${consistency.toFixed(3)}s`}
          subtitle={
            stats.consistency_label
              ? `Lap-to-lap spread · ${stats.consistency_label}`
              : 'Standard deviation'
          }
        />
        <Metric
          icon={<Wrench size={20} aria-hidden="true" />}
          label="PIT STOPS"
          value={pits.available ? String(pits.total_pit_stops) : 'N/A'}
          subtitle={
            pits.average_time_loss !== null
              ? `~${pits.average_time_loss.toFixed(1)}s lost per stop`
              : 'Recorded pit events'
          }
        />
      </div>

      <InsightsPanel insights={analysis.insights} />

      {/* TYRE STINTS */}
      <div className="engine-panel">
        <PanelHeading hint="Tyre usage from your uploaded session">Recorded tyre strategy</PanelHeading>

        <CrankStrategy stints={analysis.stints} label="Recorded tyre strategy" />

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {analysis.stints.map((stint) => (
            <div key={stint.stint_number} className="rounded-lg border border-white/10 bg-[#0c1320] p-4">
              <h4 className="font-bold">Stint {stint.stint_number}</h4>

              <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                <TyreDot color={tyreColor(stint.compound)} />
                {stint.compound} · Laps {stint.start_lap}–{stint.end_lap}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">Clean average</dt>
                <dd className="text-right font-mono text-slate-300">
                  {formatTime(stint.clean_average_lap ?? stint.average_lap)}
                </dd>
                <dt className="text-slate-500">Best lap</dt>
                <dd className="text-right font-mono text-slate-300">{formatTime(stint.best_lap)}</dd>
                <dt className="text-slate-500" title="Seconds lost per lap of tyre age">Tyre wear</dt>
                <dd className="text-right font-mono text-slate-300">
                  {stint.degradation_per_lap !== null
                    ? `+${stint.degradation_per_lap.toFixed(3)}s/lap`
                    : 'not enough laps'}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </div>

      {/* RECORDED PIT STOPS */}
      <div className="engine-panel">
        <PanelHeading>
          <Wrench size={17} className="text-red-400" aria-hidden="true" />
          Recorded pit stops
        </PanelHeading>
        {pits.source_label && (
          <p className="mt-1 text-xs text-slate-500">Detected from {pits.source_label}</p>
        )}

        {!pits.available ? (
          <p className="mt-4 text-sm text-amber-300">
            No pit-stop information was found. Add a pit_stop column (yes/no) for pit analysis.
          </p>
        ) : pitLaps.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No recorded pit stops.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {pits.stops.map((stop, index) => (
              <div key={`${stop.lap}-${index}`} className="rounded-lg border border-white/10 bg-[#0c1320] p-5">
                <p className="text-xs font-bold text-red-400">PIT STOP {index + 1}</p>
                <h4 className="mt-2 text-xl font-bold">Lap {stop.lap}</h4>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                  <TyreDot color={tyreColor(stop.compound_before)} />
                  {stop.compound_before}
                  {stop.compound_after && (
                    <>
                      <span aria-label="to">→</span>
                      <TyreDot color={tyreColor(stop.compound_after)} />
                      {stop.compound_after}
                    </>
                  )}
                </p>
                <p className="mt-2 font-mono text-sm">
                  {stop.time_loss !== null
                    ? `${stop.time_loss.toFixed(1)}s total time lost`
                    : 'Time loss not measurable'}
                </p>
                {stop.duration !== null && (
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {stop.duration.toFixed(3)}s recorded pit duration
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LAP TIME CHART */}
      <div className="engine-panel">
        <PanelHeading hint="Red: lap time · Hollow dot: not used for pace (start, pit, outlier) · Yellow line: pit stop">
          Lap-time performance
        </PanelHeading>
        <Suspense
          fallback={
            <div className="grid h-80 place-items-center text-sm text-slate-500" role="status">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading chart</span>
            </div>
          }
        >
          <LapChart laps={analysis.laps} pitLaps={pitLaps} />
        </Suspense>
      </div>

      {/* LAP TABLE */}
      <div className="engine-panel engine-panel-flush overflow-hidden">
        <div className="border-b border-white/10 p-5">
          <PanelHeading>Lap-by-lap breakdown</PanelHeading>
        </div>

        <div className="max-h-96 overflow-auto" tabIndex={0} aria-label="Lap-by-lap table">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="sticky top-0 bg-[#0e1626] text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-3">Lap</th>
                <th scope="col" className="px-5 py-3">Time</th>
                <th scope="col" className="px-5 py-3">Compound</th>
                <th scope="col" className="px-5 py-3">Tyre age</th>
                <th scope="col" className="px-5 py-3">Gap to Best</th>
                <th scope="col" className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {analysis.laps.map((lap) => (
                <tr
                  key={lap.lap}
                  className={`border-t border-white/10 ${lap.is_pit_stop
                    ? 'bg-amber-500/5'
                    : lap.is_outlier || !lap.valid ? 'bg-red-500/5' : ''
                    }`}
                >
                  <td className="px-5 py-3">{lap.lap}</td>
                  <td className="px-5 py-3 font-mono">{formatTime(lap.lap_time)}</td>
                  <td className="px-5 py-3">{lap.compound}</td>
                  <td className="px-5 py-3 font-mono text-slate-400">{lap.tyre_age}</td>
                  <td className="px-5 py-3 font-mono text-slate-400">+{lap.delta_to_best.toFixed(3)}s</td>
                  <td className="px-5 py-3 text-slate-400">{lapStatus(lap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DATA QUALITY */}
      <details className="engine-panel group text-sm">
        <summary className="cursor-pointer font-semibold text-slate-300">
          Data quality & detected columns
          {quality.warnings.length > 0 && (
            <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
              {quality.warnings.length} note{quality.warnings.length > 1 ? 's' : ''}
            </span>
          )}
        </summary>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Column mapping</p>
            <dl className="space-y-1 text-xs">
              {Object.entries(quality.detected_columns).map(([canonical, original]) => (
                <div key={canonical} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{canonical}</dt>
                  <dd className="font-mono text-slate-300">{original}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">lap time unit</dt>
                <dd className="font-mono text-slate-300">{quality.lap_time_unit}</dd>
              </div>
            </dl>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Laps not used for pace</p>
            {Object.keys(quality.excluded_laps).length === 0 ? (
              <p className="text-xs text-slate-400">None</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-300">
                {Object.entries(quality.excluded_laps).map(([reason, count]) => (
                  <li key={reason}>{reason}: {count}</li>
                ))}
              </ul>
            )}
            {quality.warnings.length > 0 && (
              <ul className="mt-4 list-disc space-y-1 pl-4 text-xs text-amber-200">
                {quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </div>
        </div>
      </details>
      </div>
      </div>
    </section>
  )
}

export default memo(RaceAnalysis)
