// Outline race car, shared by the loading strip and the pit-stop intro.
export function RaceCarArt({ className }: { className?: string }) {
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
      <path d="M100 38 L132 44 L132 52 L96 52" stroke="#f8fafc" strokeWidth="1.2" />

      {/* halo + helmet */}
      <path d="M100 35 Q112 24 126 40" stroke="#f8fafc" strokeWidth="1.3" />
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
      <circle className="car-light" cx="29" cy="50" r="2" fill="#E10600" stroke="none" />
      <circle className="car-light" cx="220" cy="54.5" r="1.8" fill="#E10600" stroke="none" />
    </svg>
  )
}

// Two small meshing gears for the planner header
export function EngineGears({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 80"
      className={`engine-gears ${className}`}
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(42 46)">
        <g className="pit-gear pit-gear-a">
          <circle r="24" stroke="#f8fafc" strokeWidth="6" strokeDasharray="4.71 4.71" />
          <circle r="17" stroke="#f8fafc" strokeWidth="1.5" />
          <circle r="5" stroke="#E10600" strokeWidth="1.5" />
          <path d="M0 -12 V12 M-12 0 H12" stroke="#f8fafc" strokeOpacity="0.5" />
        </g>
      </g>

      <g transform="translate(78 29)">
        <g className="pit-gear pit-gear-b">
          <circle r="14" stroke="#f8fafc" strokeWidth="5" strokeDasharray="4.4 4.4" />
          <circle r="9" stroke="#f8fafc" strokeWidth="1.5" />
          <circle r="3" stroke="#E10600" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  )
}

export function PitEngineArt() {
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
      <rect x="24" y="30" width="318" height="210" rx="14" stroke="#f8fafc" />
      <path d="M24 62 H342" stroke="#E10600" />

      {/* cylinders, pistons and combustion sparks */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${52 + i * 74} 0)`}>
          <rect x="0" y="76" width="54" height="136" rx="6" stroke="#f8fafc" strokeOpacity="0.5" />

          <circle
            className="pit-spark"
            cx="27"
            cy="84"
            r="6"
            fill="#E10600"
            stroke="none"
            style={{ animationDelay: `${i * 0.18}s` }}
          />

          <g className="pit-piston" style={{ animationDelay: `${i * 0.18}s` }}>
            <rect x="6" y="92" width="42" height="26" rx="4" stroke="#E10600" fill="#0b1120" />
            <path d="M27 118 V150" stroke="#f8fafc" />
            <circle cx="27" cy="154" r="6" stroke="#f8fafc" fill="#0b1120" />
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
          <circle r="62" stroke="#f8fafc" strokeWidth="12" strokeDasharray="9.74 9.74" strokeLinecap="butt" />
          <circle r="46" stroke="#f8fafc" />
          <circle r="14" stroke="#E10600" />
          <path d="M0 -40 V40 M-40 0 H40" stroke="#f8fafc" strokeOpacity="0.5" />
        </g>
      </g>

      {/* small gear */}
      <g transform="translate(526 126)">
        <g className="pit-gear pit-gear-b">
          <circle r="36" stroke="#f8fafc" strokeWidth="10" strokeDasharray="7.07 7.07" strokeLinecap="butt" />
          <circle r="26" stroke="#f8fafc" />
          <circle r="8" stroke="#E10600" />
          <path d="M0 -22 V22 M-22 0 H22" stroke="#f8fafc" strokeOpacity="0.5" />
        </g>
      </g>
    </svg>
  )
}
