import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../utils/motion'
import { RaceCarArt } from '../art/RaceCarArt'

type RacePhase = 'idle' | 'loading' | 'parked'

// Keep in sync with the progress-fill duration in index.css
const RACE_LOADING_MS = 1300

// Loading screen for the analyze section: the car "drives" in place at
// the center, then pulls forward and parks while the form fades in.
export default function RaceCarDivider({
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
