import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  LoaderCircle,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { optimizeStrategy } from '../../services/api'
import type { AdvisorPlan, AdvisorResult, AdvisorSettings, VerdictCode } from '../../types'
import { formatSigned, formatTime, stopLabel, tyreColor } from '../../utils/format'
import { EngineGears } from '../art/RaceCarArt'
import { Chip, EngineChip, EngineHeader, ErrorBanner, SectionHeading, TyreDot } from '../ui/Panel'
import CrankStrategy from './CrankStrategy'

const DEFAULT_SETTINGS: AdvisorSettings = {
  pitLoss: '',
  fuelEffect: '',
  maxStops: '',
  compoundRule: 'auto',
}

const VERDICT_STYLE: Record<VerdictCode, { box: string; accent: string; icon: typeof Info }> = {
  recommended: { box: 'border-emerald-400/40 from-emerald-500/10', accent: 'text-emerald-400', icon: TrendingUp },
  likely: { box: 'border-emerald-400/30 from-emerald-500/5', accent: 'text-emerald-300', icon: TrendingUp },
  keep: { box: 'border-sky-400/35 from-sky-500/10', accent: 'text-sky-300', icon: CheckCircle2 },
  inconclusive: { box: 'border-amber-400/35 from-amber-500/10', accent: 'text-amber-300', icon: HelpCircle },
  best_available: { box: 'border-sky-400/35 from-sky-500/10', accent: 'text-sky-300', icon: Info },
  unsupported: { box: 'border-amber-400/35 from-amber-500/10', accent: 'text-amber-300', icon: AlertTriangle },
}

const CONFIDENCE_LABEL = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
  'n/a': '',
}

const PIT_SOURCE_LABEL = {
  measured: 'measured from your stops',
  user: 'your setting',
  assumed: 'typical value (assumed)',
}

// ------------------------------------------------------------------

function GainRange({ low, high, value }: { low: number; high: number; value: number }) {
  // Scale symmetric around zero so "slower" and "faster" read naturally.
  const extent = Math.max(Math.abs(low), Math.abs(high), 1) * 1.1
  const toPct = (x: number) => ((x + extent) / (2 * extent)) * 100

  return (
    <div aria-hidden="true" className="mt-4">
      <div className="relative h-2 rounded-full bg-slate-800">
        <span className="absolute inset-y-[-4px] left-1/2 w-px bg-white/40" />
        <span
          className="absolute inset-y-0 rounded-full bg-emerald-400/40"
          style={{ left: `${toPct(low)}%`, width: `${toPct(high) - toPct(low)}%` }}
        />
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b1120] bg-emerald-300"
          style={{ left: `${toPct(value)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>Slower</span>
        <span>Your race</span>
        <span>Faster</span>
      </div>
    </div>
  )
}

function PlanCard({
  title,
  plan,
  highlight,
  badge,
}: {
  title: string
  plan: AdvisorPlan
  highlight?: boolean
  badge?: ReactNode
}) {
  return (
    <div className={`engine-card ${highlight ? 'is-best' : ''}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h4 className="min-w-0 flex-1 text-lg font-bold">{title}</h4>
        {badge}
        <Chip>{stopLabel(plan.stops)}</Chip>
      </div>

      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estimated race time</p>
      <p className="mt-1 font-mono text-2xl font-bold sm:text-3xl">{formatTime(plan.total_time)}</p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-white/10 bg-[#0c1320] p-3">
          <dt className="text-xs text-slate-500">Lost to tyre wear</dt>
          <dd className="mt-1 font-mono font-semibold">{plan.degradation_time.toFixed(1)}s</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#0c1320] p-3">
          <dt className="text-xs text-slate-500">Pit lane time</dt>
          <dd className="mt-1 font-mono font-semibold">{plan.pit_time.toFixed(1)}s</dd>
        </div>
      </dl>

      <div className="mt-5">
        <CrankStrategy stints={plan.stints} label={title} />
      </div>

      {plan.pit_windows.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-slate-400">
          {plan.pit_windows.map((w) => (
            <li key={w.pit}>
              Stop {w.pit}:{' '}
              <span className="font-mono text-slate-200">
                {w.earliest === w.latest ? `lap ${w.lap}` : `laps ${w.earliest}–${w.latest}`}
              </span>
              {w.earliest !== w.latest && ' (within 0.5s of the best lap)'}
            </li>
          ))}
        </ul>
      )}

      {plan.stints.some((s) => s.extrapolated) && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          A stint runs longer than your longest recorded run on that tyre.
        </p>
      )}
    </div>
  )
}

function SettingsForm({
  initial,
  result,
  busy,
  onApply,
}: {
  initial: AdvisorSettings
  result: AdvisorResult | null
  busy: boolean
  onApply: (settings: AdvisorSettings) => void
}) {
  const [draft, setDraft] = useState(initial)
  const field =
    'w-full rounded-lg border border-white/15 bg-[#0c1320] px-3 py-2.5 text-sm outline-none focus:border-red-500'

  function submit(event: FormEvent) {
    event.preventDefault()
    onApply(draft)
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label htmlFor="adv-pit" className="mb-1.5 block text-xs text-slate-400">Pit loss per stop (s)</label>
        <input
          id="adv-pit"
          type="number"
          inputMode="decimal"
          min={0}
          max={300}
          step={0.5}
          placeholder={result ? `Auto (${result.pit_loss.seconds.toFixed(1)})` : 'Auto'}
          value={draft.pitLoss}
          onChange={(e) => setDraft({ ...draft, pitLoss: e.target.value })}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="adv-fuel" className="mb-1.5 block text-xs text-slate-400">Fuel effect (s per lap, optional)</label>
        <input
          id="adv-fuel"
          type="number"
          inputMode="decimal"
          min={0}
          max={0.3}
          step={0.005}
          placeholder={result?.model?.fuel_mode === 'estimated' ? 'Measured' : 'e.g. 0.04'}
          value={draft.fuelEffect}
          onChange={(e) => setDraft({ ...draft, fuelEffect: e.target.value })}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="adv-stops" className="mb-1.5 block text-xs text-slate-400">Maximum stops</label>
        <select
          id="adv-stops"
          value={draft.maxStops}
          onChange={(e) => setDraft({ ...draft, maxStops: e.target.value })}
          className={field}
        >
          <option value="">Auto ({result?.simulator.max_stops ?? 3})</option>
          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="adv-rule" className="mb-1.5 block text-xs text-slate-400">Two-compound rule</label>
        <select
          id="adv-rule"
          value={draft.compoundRule}
          onChange={(e) => setDraft({ ...draft, compoundRule: e.target.value as AdvisorSettings['compoundRule'] })}
          className={field}
        >
          <option value="auto">
            Simulator default ({result?.simulator.require_compound_change ? 'on' : 'off'})
          </option>
          <option value="on">Required</option>
          <option value="off">Not required</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#E10600] px-4 py-2.5 text-sm font-bold hover:bg-red-700 disabled:opacity-50"
        >
          <RefreshCw size={15} aria-hidden="true" /> Re-run advisor
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(DEFAULT_SETTINGS)
            onApply(DEFAULT_SETTINGS)
          }}
          className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-300 hover:border-white/40 disabled:opacity-50"
        >
          Reset to automatic
        </button>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------

export default function StrategyAdvisor({
  file,
  simulator,
}: {
  file: File
  simulator: string
}) {
  const [result, setResult] = useState<AdvisorResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<AdvisorSettings>(DEFAULT_SETTINGS)
  // Bumped to re-run the advisor even when the settings are unchanged.
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    optimizeStrategy(file, simulator, settings, controller.signal)
      .then((data) => {
        setResult(data)
        setError('')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Strategy analysis failed.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [file, simulator, settings, runId])

  function rerun(next: AdvisorSettings) {
    setSettings(next)
    setRunId((id) => id + 1)
    setLoading(true)
    setError('')
  }

  const style = result ? VERDICT_STYLE[result.verdict.code] : null
  const VerdictIcon = style?.icon ?? Info
  const recorded = result?.recorded ?? null
  const recommended = result?.recommended ?? null
  const sameAsRecorded =
    result?.verdict.code === 'keep' &&
    recorded !== null &&
    recommended !== null &&
    (result.gain?.seconds ?? 0) < 0.05

  return (
    <section id="advisor" className="mt-16 scroll-mt-28 space-y-7">
      <SectionHeading
        eyebrow="Strategy Advisor"
        title="Automatic Race Strategy Optimization"
        description="Laplogic tests every pit lap and tyre combination your data supports, then tells you whether a different plan would really have been faster, and how sure it is."
      />

      <div className={`engine-block ${loading ? 'is-comparing' : ''}`}>
        <EngineHeader
          glyph={<EngineGears className="h-12 w-[4.5rem] shrink-0" />}
          title="Laplogic Strategy Advisor"
          subtitle="Deterministic optimization from your own lap data, no guesswork."
          chips={
            result ? (
              <>
                <EngineChip>{result.simulator.label}</EngineChip>
                <EngineChip>{result.race_laps} laps</EngineChip>
                <EngineChip tone={result.pit_loss.source === 'assumed' ? 'amber' : 'default'}>
                  {result.pit_loss.seconds.toFixed(1)}s pit loss · {result.pit_loss.source}
                </EngineChip>
              </>
            ) : undefined
          }
        />

        {loading && (
          <div role="status" className="flex items-center gap-3 py-10 text-slate-300">
            <LoaderCircle className="animate-spin text-red-400" aria-hidden="true" />
            Measuring tyre wear and searching every pit window…
          </div>
        )}

        {!loading && error && (
          <div className="space-y-4">
            <ErrorBanner message={error} />
            <button
              type="button"
              onClick={() => rerun(settings)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm hover:border-white/40"
            >
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          </div>
        )}

        {!loading && !error && result && style && (
          <div className="results-in space-y-6" aria-live="polite">
            {/* VERDICT */}
            <div className={`flex flex-wrap items-start justify-between gap-5 rounded-xl border border-l-4 bg-gradient-to-r to-transparent p-5 ${style.box}`}>
              <div className="min-w-0 max-w-2xl flex-1">
                <p className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest ${style.accent}`}>
                  <VerdictIcon size={15} aria-hidden="true" />
                  Laplogic recommendation
                  {CONFIDENCE_LABEL[result.verdict.confidence] && (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-300">
                      {CONFIDENCE_LABEL[result.verdict.confidence]}
                    </span>
                  )}
                </p>
                <h4 className="mt-2 text-2xl font-bold">{result.verdict.title}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-300">{result.verdict.summary}</p>
              </div>

              {result.gain && (
                <div className="w-full sm:w-64">
                  <p className="text-xs text-slate-400">
                    {result.gain.seconds >= 0 ? 'Estimated time saved' : 'Estimated time lost'}
                  </p>
                  <p className={`font-mono text-3xl font-bold ${result.gain.seconds > 0.5 ? 'text-emerald-300' : 'text-slate-200'}`}>
                    {Math.abs(result.gain.seconds).toFixed(1)}s
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    ±{result.gain.uncertainty_seconds.toFixed(1)}s · 95% range {formatSigned(result.gain.low)} to {formatSigned(result.gain.high)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Chance the change is faster:{' '}
                    <span className="font-semibold text-slate-200">
                      {Math.round(result.gain.probability_faster * 100)}%
                    </span>
                  </p>
                  <GainRange low={result.gain.low} high={result.gain.high} value={result.gain.seconds} />
                </div>
              )}
            </div>

            {/* PLANS */}
            {(recorded || recommended) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {recorded && (
                  <PlanCard
                    title="Your recorded race"
                    plan={recorded}
                    highlight={sameAsRecorded}
                    badge={sameAsRecorded ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">Optimal</span>
                    ) : undefined}
                  />
                )}
                {recommended && !sameAsRecorded && (
                  <PlanCard
                    title={recorded ? 'Recommended plan' : 'Fastest supported plan'}
                    plan={recommended}
                    highlight={result.verdict.code === 'recommended' || result.verdict.code === 'likely'}
                    badge={
                      recommended.delta_to_recorded !== null ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-xs font-semibold text-emerald-400">
                          {formatSigned(recommended.delta_to_recorded)}
                        </span>
                      ) : undefined
                    }
                  />
                )}
              </div>
            )}

            {result.recorded_reason && (
              <p className="flex items-start gap-2 text-sm text-amber-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                {result.recorded_reason}
              </p>
            )}

            {/* WHY */}
            {result.explanation.length > 0 && (
              <div className="engine-crank">
                <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                  <Sparkles size={16} className="text-red-400" aria-hidden="true" />
                  Why this recommendation
                </h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {result.explanation.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
                {result.order_note && <p className="mt-3 text-xs text-slate-500">{result.order_note}</p>}
              </div>
            )}

            {/* ALTERNATIVES */}
            {result.alternatives.length > 0 && (
              <div className="engine-crank">
                <h4 className="text-sm font-bold uppercase tracking-wider">Best plan for each number of stops</h4>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Stints</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Pit laps</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Est. time</th>
                        <th scope="col" className="py-2 font-medium">vs your race</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.alternatives.map((plan) => (
                        <tr key={plan.label} className="border-t border-white/10">
                          <td className="py-2.5 pr-4 font-semibold">
                            {stopLabel(plan.stops)}
                            {plan.is_recommended && <span className="ml-2 text-xs text-emerald-400">best</span>}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                              {plan.stints.map((s) => (
                                <span key={s.stint} className="inline-flex items-center gap-1">
                                  <TyreDot color={tyreColor(s.compound)} size="h-2 w-2" />
                                  {s.compound} {s.laps}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-slate-400">
                            {plan.pit_laps.length ? plan.pit_laps.join(', ') : '—'}
                          </td>
                          <td className="py-2.5 pr-4 font-mono">{formatTime(plan.total_time)}</td>
                          <td className="py-2.5 font-mono text-xs">
                            {plan.delta_to_recorded === null ? (
                              '—'
                            ) : (
                              <span className={plan.delta_to_recorded < -0.5 ? 'text-emerald-300' : plan.delta_to_recorded > 0.5 ? 'text-amber-300' : 'text-slate-300'}>
                                {formatSigned(plan.delta_to_recorded)}
                                {plan.delta_uncertainty !== null && plan.delta_uncertainty > 0 && (
                                  <span className="text-slate-500"> ±{plan.delta_uncertainty.toFixed(1)}</span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Searched {result.search.feasible_strategies.toLocaleString()} pit-lap combinations
                  across {result.search.tyre_combinations} tyre combinations.
                </p>
              </div>
            )}

            {/* TYRE MODEL */}
            {result.model && (
              <div className="engine-crank">
                <h4 className="text-sm font-bold uppercase tracking-wider">Measured tyre model</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Tyre wear = how much slower each lap gets as the tyre ages. Fitted from{' '}
                  {result.model.clean_laps} clean laps; typical lap-to-lap noise ±
                  {result.model.residual_std.toFixed(2)}s.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {result.model.compounds.map((c) => (
                    <div key={c.compound} className="rounded-lg border border-white/10 bg-[#0c1320] p-4">
                      <p className="flex items-center gap-2 font-bold">
                        <TyreDot color={tyreColor(c.compound)} size="h-3 w-3" />
                        {c.compound}
                        {c.wet && <span className="text-xs font-normal text-sky-300">wet</span>}
                      </p>
                      <p className="mt-3 font-mono text-lg font-bold">
                        +{c.degradation_per_lap.toFixed(3)}s
                        <span className="text-xs font-normal text-slate-500"> / lap of wear</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.degradation_constrained
                          ? 'No measurable wear in this data'
                          : c.degradation_se !== null
                            ? `±${c.degradation_se.toFixed(3)}s uncertainty`
                            : ''}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {c.clean_laps} clean laps · longest run {c.max_observed_age} · max stint {c.max_stint_laps}
                      </p>
                    </div>
                  ))}
                </div>
                {result.model.excluded.length > 0 && (
                  <ul className="mt-4 space-y-1 text-xs text-amber-200">
                    {result.model.excluded.map((e) => (
                      <li key={e.compound}>{e.compound} not modelled: {e.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* SETTINGS (available after the first run, also on error) */}
        {(result || error) && (
          <details className="mt-6 rounded-xl border border-white/10 bg-[#0b1120] p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-300">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Adjust assumptions
              {result && (
                <span className="text-xs font-normal text-slate-500">
                  · pit loss {PIT_SOURCE_LABEL[result.pit_loss.source]}
                </span>
              )}
            </summary>
            {result?.pit_loss.note && <p className="mt-3 text-xs text-slate-500">{result.pit_loss.note}</p>}
            <SettingsForm initial={settings} result={result} busy={loading} onApply={rerun} />
          </details>
        )}

        {result && (
          <details className="mt-4 rounded-xl border border-white/10 bg-[#0b1120] p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-300">
              Assumptions, limitations & glossary
            </summary>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Assumptions</p>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-400">
                  {result.assumptions.map((a) => <li key={a}>{a}</li>)}
                </ul>
                <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Limitations</p>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-400">
                  {result.limitations.map((l) => <li key={l}>{l}</li>)}
                  {result.simulator.note && <li>{result.simulator.note}</li>}
                </ul>
              </div>
              <dl className="space-y-3 text-xs leading-5">
                <div>
                  <dt className="font-semibold text-slate-300">Pit loss</dt>
                  <dd className="text-slate-400">Total time lost by stopping: slowing for the pit lane, the stop itself and rejoining.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-300">Clean lap</dt>
                  <dd className="text-slate-400">A normal racing lap, so not lap 1, a pit in/out lap, an invalid lap or an incident.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-300">Uncertainty (±)</dt>
                  <dd className="text-slate-400">How much the estimate could reasonably be off, given lap-to-lap noise and unknowns like fuel burn.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-300">Pit window</dt>
                  <dd className="text-slate-400">The laps where you can stop and stay within 0.5s of the best possible timing.</dd>
                </div>
              </dl>
            </div>
          </details>
        )}
      </div>
    </section>
  )
}
