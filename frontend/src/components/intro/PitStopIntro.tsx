import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { PitEngineArt, RaceCarArt } from '../art/RaceCarArt'

type PitPhase = 'arrive' | 'stop' | 'zoom' | 'engine' | 'reveal' | 'done'

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

// A car rolls into the pit box, we zoom into the engine, then the
// "Your Race Analysis" title appears and the real results take over.
export default function PitStopIntro({
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
      id = window.setTimeout(() => setPhase('stop'), PIT_TIMELINE.arrive)
    } else if (shown === 'stop') {
      id = window.setTimeout(() => setPhase('zoom'), PIT_TIMELINE.stop)
    } else if (shown === 'zoom') {
      id = window.setTimeout(() => setPhase('engine'), PIT_TIMELINE.zoom)
    } else if (shown === 'engine') {
      id = window.setTimeout(() => setEngineMinDone(true), PIT_TIMELINE.engine)
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
      aria-busy={!ready}
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
        <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Your Race Analysis</h2>
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
