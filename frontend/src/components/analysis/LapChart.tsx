import { memo, useMemo } from 'react'
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
import type { LapResult } from '../../types'
import { formatTime } from '../../utils/format'

// Tilts the car slightly to follow the slope of the lap-time line
function lapTilt(laps: LapResult[], index: number) {
  if (index < 0) return 0
  const prev = laps[Math.max(index - 1, 0)].lap_time
  const next = laps[Math.min(index + 1, laps.length - 1)].lap_time
  // Slower next lap = line climbs = nose up (negative rotation)
  return Math.max(-22, Math.min(22, -(next - prev) * 15))
}

// Replaces the round hover dot on the lap-time chart
function LapCarMarker({ cx, cy, tilt }: { cx?: number; cy?: number; tilt: number }) {
  if (cx == null || cy == null) return null

  const width = 48
  const height = (width * 58) / 250

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${tilt})`} pointerEvents="none">
      <svg
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        viewBox="0 8 250 58"
        overflow="visible"
        fill="#f8fafc"
        stroke="none"
        style={{ filter: 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.35))' }}
      >
        <rect x="12" y="11" width="34" height="6" rx="3" />
        <path d="M26 15 L36 15 L42 40 L33 40 Z" />
        <path d="M30 52 L44 36 L74 27 L80 20 L90 21 L94 32 Q102 36 114 36 L150 43 L224 52 L224 57 L66 57 L30 57 Z" />
        <circle cx="111" cy="31" r="6" />
        <rect x="200" y="57" width="48" height="6" rx="3" />
        <rect x="212" y="52" width="6" height="8" />
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

type DotProps = { cx?: number; cy?: number; index?: number }

function LapChart({ laps, pitLaps }: { laps: LapResult[]; pitLaps: number[] }) {
  // Index lookup avoids an O(n) search on every hover frame.
  const indexByLap = useMemo(
    () => new Map(laps.map((lap, index) => [lap.lap, index])),
    [laps]
  )
  // Only show dots for short sessions; long races stay readable.
  const showDots = laps.length <= 80

  const fastest = laps.reduce((a, b) => (b.lap_time < a.lap_time ? b : a), laps[0])
  const slowest = laps.reduce((a, b) => (b.lap_time > a.lap_time ? b : a), laps[0])

  return (
    <div
      className="h-80 w-full"
      role="img"
      aria-label={`Lap time chart for ${laps.length} laps. Fastest lap ${fastest.lap} at ${formatTime(fastest.lap_time)}, slowest lap ${slowest.lap} at ${formatTime(slowest.lap_time)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={laps} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
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
            width={64}
            tickFormatter={(value: number) => formatTime(value).replace(/\.\d+$/, '')}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
            labelFormatter={(lap) => `Lap ${lap}`}
            formatter={(value, _name, item) => {
              const lap = item?.payload as LapResult | undefined
              const tag = lap?.exclusion ? ` · ${lap.exclusion}` : ''
              return [`${formatTime(Number(value))}${tag}`, 'Lap Time']
            }}
          />

          {pitLaps.map((lap) => (
            <ReferenceLine key={lap} x={lap} stroke="#f59e0b" strokeDasharray="5 5" />
          ))}

          <Line
            type="monotone"
            dataKey="lap_time"
            stroke="#E10600"
            strokeWidth={3}
            isAnimationActive={laps.length <= 150}
            dot={
              showDots
                ? (props: DotProps) => {
                  const lap = props.index != null ? laps[props.index] : undefined
                  if (props.cx == null || props.cy == null || !lap) return <g key={props.index} />
                  const excluded = !lap.is_clean
                  return (
                    <circle
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={excluded ? 3.5 : 3}
                      fill={excluded ? '#0b1120' : '#E10600'}
                      stroke={lap.is_outlier || !lap.valid ? '#f59e0b' : '#E10600'}
                      strokeWidth={excluded ? 1.5 : 1}
                    />
                  )
                }
                : false
            }
            activeDot={(props: DotProps & { payload?: LapResult }) => (
              <LapCarMarker
                cx={props.cx}
                cy={props.cy}
                tilt={lapTilt(laps, indexByLap.get(props.payload?.lap ?? -1) ?? -1)}
              />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(LapChart)
