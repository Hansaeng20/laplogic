import { memo } from 'react'
import type { TimelineStint } from '../../types'
import { tyreColor } from '../../utils/format'
import { TyreDot } from '../ui/Panel'

// The "crankshaft": stints as a tyre timeline with a crank pin at each stop
function CrankStrategy({
  stints,
  label = 'Tyre strategy timeline',
}: {
  stints: TimelineStint[]
  label?: string
}) {
  const lengths = stints.map((stint) => Math.max(0, stint.end_lap - stint.start_lap + 1))
  const total = lengths.reduce((sum, length) => sum + length, 0)

  if (total === 0) return null

  const pits = stints.slice(0, -1).map((stint, index) => {
    const covered = lengths.slice(0, index + 1).reduce((sum, length) => sum + length, 0)
    return { lap: stint.end_lap, left: (covered / total) * 100 }
  })

  const summary = stints
    .map((s) => `${s.compound} laps ${s.start_lap} to ${s.end_lap}`)
    .join(', then ')

  return (
    <figure aria-label={`${label}: ${summary}`}>
      <div className="relative pt-9" aria-hidden="true">
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
                borderRight: index < stints.length - 1 ? '2px solid #0b1120' : undefined,
              }}
            />
          ))}
        </div>

        {pits.map((pit) => (
          <span key={pit.lap} className="engine-pin" style={{ left: `${pit.left}%` }} />
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
        <span>Lap {stints[0].start_lap}</span>
        <span>Lap {stints[stints.length - 1].end_lap}</span>
      </div>

      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
        {stints.map((stint, index) => (
          <span key={index} className="flex items-center gap-2 text-xs text-slate-300">
            <TyreDot color={tyreColor(stint.compound)} size="h-3 w-3" />
            {stint.compound} · Laps {stint.start_lap}–{stint.end_lap}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export default memo(CrankStrategy)
