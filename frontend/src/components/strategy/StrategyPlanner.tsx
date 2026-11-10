import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock3, Gauge, LoaderCircle, RefreshCw } from 'lucide-react'
import { DEFAULT_COMPOUNDS } from '../../constants'
import { compareStrategies } from '../../services/api'
import type { Analysis, StrategyComparison, StrategyType, TimelineStint } from '../../types'
import { formatGap, formatTime, tyreColor } from '../../utils/format'
import { EngineGears } from '../art/RaceCarArt'
import { Chip, ErrorBanner, SectionHeading, TyreDot } from '../ui/Panel'
import CrankStrategy from './CrankStrategy'
import { CompoundSelector, EngineBay, EngineRange } from './EngineParts'

const MIN_RACE_LAPS = 5

// Orders strategies best-first and works out the gaps between them
function summarizeComparison(comparison: StrategyComparison) {
  const ordered = [...comparison.strategies].sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1
    return (a.rank ?? 999) - (b.rank ?? 999)
  })

  const supported = ordered.filter(
    (s) => s.supported && typeof s.estimated_total_time === 'number'
  )
  const best = supported[0] ?? null
  const runnerUp = supported[1] ?? null
  const gap =
    best && runnerUp
      ? Math.max(0, (runnerUp.estimated_total_time ?? 0) - (best.estimated_total_time ?? 0))
      : null

  const paces = Object.entries(comparison.pace_profiles).sort(
    (a, b) => a[1].average_lap - b[1].average_lap
  )
  return { ordered, best, runnerUp, gap, paces }
}

function compoundOptions(analysis: Analysis): string[] {
  const usable = analysis.compounds.filter((c) => c !== 'UNKNOWN' && c !== 'MIXED')
  return usable.length > 0 ? usable : DEFAULT_COMPOUNDS
}

function pick(options: string[], wanted: string | undefined, fallbackIndex: number): string {
  if (wanted && options.includes(wanted)) return wanted
  return options[Math.min(fallbackIndex, options.length - 1)]
}

export default function StrategyPlanner({
  analysis,
  file,
  simulator,
}: {
  analysis: Analysis
  file: File
  simulator: string
}) {
  const options = useMemo(() => compoundOptions(analysis), [analysis])

  // Seed the planner from the uploaded race. The parent remounts this
  // component (via key) whenever a new analysis arrives.
  const initial = useMemo(() => {
    const laps = Math.max(MIN_RACE_LAPS, analysis.race_laps)
    const actual = analysis.pit_analysis.stops
      .map((stop) => stop.lap)
      .filter((lap) => lap >= 2 && lap <= laps - 2)
    const first = Math.min(Math.max(2, actual[0] ?? Math.floor(laps / 3)), laps - 2)
    const second = Math.min(
      Math.max(first + 2, actual[1] ?? Math.floor((laps * 2) / 3)),
      laps - 2
    )
    const recorded = analysis.stints.map((s) => s.compound)
    return {
      laps,
      first,
      second,
      type: (actual.length >= 2 ? 'two_stop' : 'one_stop') as StrategyType,
      compounds: [
        pick(options, recorded[0], 0),
        pick(options, recorded[1], 1),
        pick(options, recorded[2], 2),
      ],
      pitLoss: Math.round((analysis.pit_analysis.average_time_loss ?? 25) * 2) / 2,
    }
  }, [analysis, options])

  const [strategyType, setStrategyType] = useState<StrategyType>(initial.type)
  const [raceLaps, setRaceLaps] = useState(initial.laps)
  const [firstPitLap, setFirstPitLap] = useState(initial.first)
  const [secondPitLap, setSecondPitLap] = useState(initial.second)
  const [compounds, setCompounds] = useState(initial.compounds)
  const [pitLoss, setPitLoss] = useState(Math.min(60, initial.pitLoss))

  const [comparison, setComparison] = useState<StrategyComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  function clear() {
    controllerRef.current?.abort()
    setComparison(null)
    setError('')
  }

  const maxRaceLaps = Math.min(500, Math.max(MIN_RACE_LAPS, analysis.race_laps * 2))
  const firstPitMax = strategyType === 'two_stop' ? Math.max(2, raceLaps - 4) : raceLaps - 2
  const secondPitMin = firstPitLap + 2
  const secondPitMax = raceLaps - 2

  const validPitWindows =
    firstPitLap >= 2 &&
    firstPitLap <= firstPitMax &&
    (strategyType === 'one_stop' || (secondPitLap >= secondPitMin && secondPitLap <= secondPitMax))

  function changeRaceLaps(value: number) {
    if (!Number.isFinite(value)) return
    const next = Math.min(maxRaceLaps, Math.max(MIN_RACE_LAPS, Math.round(value)))
    setRaceLaps(next)
    const first = Math.min(firstPitLap, strategyType === 'two_stop' ? Math.max(2, next - 4) : next - 2)
    setFirstPitLap(first)
    setSecondPitLap(Math.min(next - 2, Math.max(first + 2, secondPitLap)))
    clear()
  }

  function changeStrategyType(type: StrategyType) {
    setStrategyType(type)
    if (type === 'two_stop') {
      const first = Math.min(firstPitLap, Math.max(2, raceLaps - 4))
      setFirstPitLap(first)
      setSecondPitLap(Math.min(raceLaps - 2, Math.max(first + 2, secondPitLap)))
    }
    clear()
  }

  function changeFirstPitLap(value: number) {
    setFirstPitLap(value)
    if (strategyType === 'two_stop' && secondPitLap < value + 2) setSecondPitLap(value + 2)
    clear()
  }

  function changeCompound(index: number, value: string) {
    setCompounds((current) => current.map((c, i) => (i === index ? value : c)))
    clear()
  }

  async function runComparison() {
    if (loading) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')
    setComparison(null)

    try {
      const result = await compareStrategies(
        file,
        {
          raceLaps,
          strategyType,
          firstPitLap,
          secondPitLap,
          compounds: [compounds[0], compounds[1], compounds[2]],
          pitLoss,
          simulator,
        },
        controller.signal
      )
      if (!controller.signal.aborted) setComparison(result)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Strategy comparison failed.')
      }
    } finally {
      if (controllerRef.current === controller) setLoading(false)
    }
  }

  const previewStints: TimelineStint[] =
    strategyType === 'one_stop'
      ? [
        { start_lap: 1, end_lap: firstPitLap, compound: compounds[0] },
        { start_lap: firstPitLap + 1, end_lap: raceLaps, compound: compounds[1] },
      ]
      : [
        { start_lap: 1, end_lap: firstPitLap, compound: compounds[0] },
        { start_lap: firstPitLap + 1, end_lap: secondPitLap, compound: compounds[1] },
        { start_lap: secondPitLap + 1, end_lap: raceLaps, compound: compounds[2] },
      ]

  const view = comparison ? summarizeComparison(comparison) : null

  return (
    <section id="strategy" className="mt-16 scroll-mt-28 space-y-7">
      <SectionHeading
        eyebrow="Personalized Strategy"
        title="Race Strategy Planner"
        description="Build your own plan and see how it compares with Laplogic's best alternative, using tyre pace and wear measured from your data."
      />

      <div className={`engine-block ${loading ? 'is-comparing' : ''}`}>
        {/* HEADER + LIVE PLAN SUMMARY */}
        <div className="engine-head flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-4">
            <EngineGears className="h-12 w-[4.5rem] shrink-0" />
            <div>
              <h3 className="text-xl font-bold">Strategy Configuration</h3>
              <p className="mt-0.5 text-xs text-slate-500">Set up your plan in four steps, then compare.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-label="Current plan">
            <Chip>{raceLaps} laps</Chip>
            <Chip>{strategyType === 'one_stop' ? '1 stop' : '2 stops'}</Chip>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#0b1120] px-3 py-1 font-mono text-xs font-semibold text-slate-200">
              {previewStints.map((stint, index) => (
                <span key={index} className="inline-flex items-center gap-1.5">
                  {index > 0 && <span className="text-slate-600" aria-hidden="true">→</span>}
                  <TyreDot color={tyreColor(stint.compound)} size="h-2 w-2" />
                  {stint.compound.charAt(0)}
                </span>
              ))}
            </span>
            <Chip>{pitLoss.toFixed(1)}s pit loss</Chip>
          </div>
        </div>

        {/* FOUR "CYLINDERS" */}
        <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <EngineBay step="01" title="Stops" hint="How many pit stops">
            <div className="space-y-2">
              {(['one_stop', 'two_stop'] as StrategyType[]).map((type) => (
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
                  <span className="block font-semibold">{type === 'one_stop' ? 'One Stop' : 'Two Stops'}</span>
                  <span className="block text-xs text-slate-500">
                    {type === 'one_stop' ? '1 pit · 2 stints' : '2 pits · 3 stints'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {strategyType === 'one_stop' ? 'Fewer stops, longer tyre stints.' : 'More stops, fresher tyres.'}
            </p>
          </EngineBay>

          <EngineBay step="02" title="Race" hint="Length and pit cost">
            <div>
              <label htmlFor="race-laps" className="mb-3 block text-sm text-slate-300">
                Planned race length
              </label>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  aria-label="Decrease race length"
                  disabled={raceLaps <= MIN_RACE_LAPS}
                  onClick={() => changeRaceLaps(raceLaps - 1)}
                  className="grid w-11 place-items-center rounded-lg border border-white/15 bg-[#0c1320] text-xl text-slate-300 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <input
                  id="race-laps"
                  type="number"
                  inputMode="numeric"
                  min={MIN_RACE_LAPS}
                  max={maxRaceLaps}
                  value={raceLaps}
                  onChange={(e) => changeRaceLaps(Number(e.target.value))}
                  className="engine-number min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0c1320] py-2.5 text-center font-mono text-xl font-bold text-white outline-none focus:border-red-500"
                />
                <button
                  type="button"
                  aria-label="Increase race length"
                  disabled={raceLaps >= maxRaceLaps}
                  onClick={() => changeRaceLaps(raceLaps + 1)}
                  className="grid w-11 place-items-center rounded-lg border border-white/15 bg-[#0c1320] text-xl text-slate-300 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Max {maxRaceLaps} laps with this upload.</p>
            </div>

            <EngineRange
              id="pit-loss"
              label="Pit loss per stop"
              valueLabel={`${pitLoss.toFixed(1)}s`}
              min={0}
              max={60}
              step={0.5}
              value={pitLoss}
              onChange={(value) => {
                setPitLoss(value)
                clear()
              }}
              hintMin="0s"
              hintMax="60s"
            />
            <p className="-mt-3 text-[11px] text-slate-500">
              Time lost driving through the pit lane, including the stop.
              {analysis.pit_analysis.average_time_loss !== null && ' Pre-filled from your recorded stops.'}
            </p>
          </EngineBay>

          <EngineBay step="03" title="Pit laps" hint="When you box">
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
                  clear()
                }}
                hintMin={`Lap ${secondPitMin}`}
                hintMax={`Lap ${secondPitMax}`}
              />
            )}
          </EngineBay>

          <EngineBay step="04" title="Tyres" hint="Compounds from your upload">
            <CompoundSelector label="First stint" value={compounds[0]} options={options} onChange={(v) => changeCompound(0, v)} />
            <CompoundSelector label="Second stint" value={compounds[1]} options={options} onChange={(v) => changeCompound(1, v)} />
            {strategyType === 'two_stop' && (
              <CompoundSelector label="Third stint" value={compounds[2]} options={options} onChange={(v) => changeCompound(2, v)} />
            )}
          </EngineBay>
        </div>

        {/* CRANKSHAFT: LIVE PLAN PREVIEW */}
        <div className="engine-crank">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold uppercase tracking-wider">Planned tyre strategy</h4>
            <span className="text-xs text-slate-500">Pit stops happen at the end of the selected laps.</span>
          </div>
          {validPitWindows ? (
            <CrankStrategy stints={previewStints} label="Planned tyre strategy" />
          ) : (
            <p className="text-sm text-amber-300">Adjust the pit laps to see your plan.</p>
          )}
        </div>

        {!validPitWindows && (
          <div role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            The selected pit-stop windows are invalid.
          </div>
        )}

        {/* IGNITION */}
        <button
          type="button"
          onClick={runComparison}
          disabled={loading || !validPitWindows}
          className="ignition group mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-[#E10600] px-6 py-4 font-bold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={18} className="transition-transform duration-500 group-hover:rotate-180" aria-hidden="true" />
          )}
          {loading ? 'Comparing Strategies...' : 'Compare Strategies'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* STRATEGY RESULTS */}
      {comparison && view && (
        <div className="engine-block results-in" aria-live="polite">
          <div className="engine-head flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border-2 border-[#E10600] bg-[#0b1120] text-red-400">
                <Gauge size={24} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-xl font-bold">Strategy Comparison</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Estimated results for a {comparison.race_laps}-lap race. The alternative is
                  Laplogic&apos;s best plan with a different number of stops.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{comparison.race_laps} laps</Chip>
              <Chip>{comparison.pit_loss_assumption.toFixed(1)}s pit loss</Chip>
              {comparison.experimental && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                  Estimate
                </span>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {view.best && (
              <div className="engine-verdict">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Lowest estimated time</p>
                  <p className="mt-1 text-2xl font-bold">{view.best.strategy}</p>
                </div>
                <div className="sm:text-right">
                  {view.runnerUp && view.gap !== null ? (
                    view.gap > 0 ? (
                      <>
                        <p className="font-mono text-2xl font-bold text-emerald-300">{formatGap(view.gap)}</p>
                        <p className="text-xs text-slate-400">faster than {view.runnerUp.strategy}</p>
                        {view.ordered.some((s) => s.uncertainty_vs_yours !== undefined) && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            ± {view.ordered.find((s) => s.uncertainty_vs_yours !== undefined)?.uncertainty_vs_yours?.toFixed(1)}s model uncertainty
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-slate-300">Both plans have the same estimate.</p>
                    )
                  ) : (
                    <p className="max-w-[16rem] text-xs text-slate-400">The other plan could not be estimated from this upload.</p>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {view.ordered.map((strategy) => {
                const isBest = strategy.supported && strategy === view.best
                const behind =
                  strategy.supported && !isBest && view.best
                    ? Math.max(0, (strategy.estimated_total_time ?? 0) - (view.best.estimated_total_time ?? 0))
                    : null

                return (
                  <div key={strategy.strategy} className={`engine-card ${isBest ? 'is-best' : ''}`}>
                    <div className="mb-5 flex flex-wrap items-center gap-3">
                      <span className="engine-piston" aria-hidden="true">
                        {strategy.supported ? `#${strategy.rank}` : '—'}
                      </span>
                      <h4 className="min-w-0 flex-1 text-lg font-bold">{strategy.strategy}</h4>
                      {isBest && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                          Rank #{strategy.rank}
                        </span>
                      )}
                      {behind !== null && behind > 0 && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs font-semibold text-amber-300">
                          +{formatGap(behind)}
                        </span>
                      )}
                    </div>

                    {!strategy.supported ? (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                          <AlertTriangle size={17} aria-hidden="true" />
                          Insufficient Data
                        </div>
                        <p className="text-sm leading-6 text-amber-100/80">{strategy.reason}</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estimated total time</p>
                        <p className="mt-1 font-mono text-3xl font-bold">{formatTime(strategy.estimated_total_time ?? 0)}</p>

                        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-lg border border-white/10 bg-[#0c1320] p-3">
                            <p className="text-xs text-slate-500">Racing time</p>
                            <p className="mt-1 font-mono font-semibold">{formatTime(strategy.estimated_racing_time ?? 0)}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-[#0c1320] p-3">
                            <p className="text-xs text-slate-500">Pit lane time</p>
                            <p className="mt-1 font-mono font-semibold">{(strategy.pit_loss_total ?? 0).toFixed(1)}s</p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <CrankStrategy stints={strategy.stints ?? []} label={strategy.strategy} />
                        </div>

                        {strategy.warnings && strategy.warnings.length > 0 && (
                          <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                            {strategy.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {/* PACE PROFILES */}
            <div className="engine-crank">
              <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                <Clock3 size={17} className="text-red-400" aria-hidden="true" />
                Recorded tyre pace
              </h4>
              <p className="mb-5 mt-1 text-xs text-slate-500">
                Average clean lap and measured wear per compound.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {view.paces.map(([compound, profile], index) => (
                  <div key={compound} className="rounded-lg border border-white/10 bg-[#0c1320] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <TyreDot color={tyreColor(compound)} size="h-3 w-3" />
                        <span className="font-bold">{compound}</span>
                      </div>
                      {index === 0 && view.paces.length > 1 && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                          Quickest
                        </span>
                      )}
                    </div>
                    <p className="mt-4 font-mono text-xl font-bold">{formatTime(profile.average_lap)}</p>
                    {index > 0 && (
                      <p className="mt-1 font-mono text-xs text-amber-300">
                        +{(profile.average_lap - view.paces[0][1].average_lap).toFixed(3)}s per lap
                      </p>
                    )}
                    <p className="mt-3 text-xs text-slate-400">
                      Wear: +{profile.degradation_per_lap.toFixed(3)}s per lap of tyre age
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {profile.sample_laps} clean laps · longest run {profile.max_observed_age} laps
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 border-l-4 border-l-amber-400 bg-amber-500/5 p-5 text-sm text-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle size={19} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">How these estimates work</p>
                  <p className="mt-2 leading-6">{comparison.method}</p>
                  <ul className="mt-3 list-disc space-y-1 pl-4 leading-6">
                    {comparison.limitations.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
