// Shapes returned by the Laplogic API. Keep in sync with backend/core.

export type UploadMode = 'csv' | 'pdf'
export type StrategyType = 'one_stop' | 'two_stop'

export type LapResult = {
  lap: number
  lap_time: number
  compound: string
  is_pit_stop: boolean
  pit_duration: number | null
  delta_to_best: number
  delta_to_average: number
  cumulative_time: number
  stint: number
  tyre_age: number
  valid: boolean
  is_out_lap: boolean
  is_outlier: boolean
  is_clean: boolean
  exclusion: string | null
}

export type PitStop = {
  lap: number
  compound_before: string
  compound_after: string | null
  duration: number | null
  time_loss: number | null
}

export type RecordedStint = {
  stint_number: number
  start_lap: number
  end_lap: number
  recorded_laps: number
  compound: string
  average_lap: number
  clean_average_lap: number | null
  best_lap: number
  clean_laps: number
  pace_trend_per_lap: number | null
  degradation_per_lap: number | null
}

export type Insight = {
  level: 'positive' | 'info' | 'warning'
  title: string
  detail: string
}

export type Analysis = {
  status: string
  filename: string
  circuit: string
  total_laps: number
  race_laps: number
  compounds: string[]
  statistics: {
    fastest_lap: number
    slowest_lap: number
    average_lap: number
    median_lap: number
    consistency_std: number
    best_lap_number: number
    total_recorded_time: number
    clean_laps: number
    clean_average_lap: number | null
    clean_consistency_std: number | null
    consistency_label: string | null
  }
  pit_analysis: {
    available: boolean
    source: string | null
    source_label: string | null
    total_pit_stops: number
    stops: PitStop[]
    recorded_duration_count: number
    total_recorded_pit_duration: number | null
    average_time_loss: number | null
    duration_is_additional_to_lap_time: boolean
  }
  stints: RecordedStint[]
  laps: LapResult[]
  data_quality: {
    detected_columns: Record<string, string>
    lap_time_unit: string
    dropped_rows: number
    excluded_laps: Record<string, number>
    warnings: string[]
  }
  insights: Insight[]
  notes: string[]
}

// ---------- Strategy planner (/api/strategy/compare) ----------

export type StrategyStint = {
  start_lap: number
  end_lap: number
  compound: string
  laps: number
  estimated_time: number
  estimated_average_lap: number
}

export type StrategyResult = {
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
  uncertainty_vs_yours?: number
}

export type PaceProfile = {
  average_lap: number
  sample_laps: number
  max_observed_age: number
  degradation_per_lap: number
}

export type StrategyComparison = {
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

export type TimelineStint = {
  start_lap: number
  end_lap: number
  compound: string
}

// ---------- Strategy advisor (/api/strategy/optimize) ----------

export type AdvisorStint = TimelineStint & {
  stint: number
  laps: number
  extrapolated: boolean
  estimated_time: number
  estimated_average_lap: number
  degradation_time: number
  degradation_per_lap: number
}

export type PitWindow = {
  pit: number
  lap: number
  earliest: number
  latest: number
}

export type AdvisorPlan = {
  label: string
  stops: number
  pit_laps: number[]
  stints: AdvisorStint[]
  racing_time: number
  degradation_time: number
  pit_time: number
  total_time: number
  delta_to_recorded: number | null
  delta_uncertainty: number | null
  pit_windows: PitWindow[]
  extrapolated: boolean
  is_recommended?: boolean
}

export type VerdictCode =
  | 'keep'
  | 'inconclusive'
  | 'likely'
  | 'recommended'
  | 'best_available'
  | 'unsupported'

export type AdvisorResult = {
  status: string
  advisor: string
  race_laps: number
  simulator: {
    key: string
    label: string
    require_compound_change: boolean
    max_stops: number
    min_stint_laps: number
    note: string
  }
  verdict: {
    code: VerdictCode
    title: string
    summary: string
    confidence: 'high' | 'moderate' | 'low' | 'n/a'
  }
  recorded: AdvisorPlan | null
  recorded_reason: string | null
  recommended: AdvisorPlan | null
  alternatives: AdvisorPlan[]
  gain: {
    seconds: number
    uncertainty_seconds: number
    statistical_uncertainty: number
    fuel_uncertainty: number
    low: number
    high: number
    probability_faster: number
  } | null
  explanation: string[]
  pit_loss: {
    seconds: number
    uncertainty: number
    source: 'measured' | 'user' | 'assumed'
    samples: number[]
    note: string
  }
  model: {
    fuel_mode: 'estimated' | 'assumed' | 'none'
    fuel_per_lap: number
    residual_std: number
    clean_laps: number
    compounds: {
      compound: string
      base_lap: number
      degradation_per_lap: number
      degradation_se: number | null
      clean_laps: number
      max_observed_age: number
      max_stint_laps: number
      degradation_constrained: boolean
      wet: boolean
    }[]
    excluded: { compound: string; reason: string }[]
  } | null
  search: { tyre_combinations: number; feasible_strategies: number }
  assumptions: string[]
  limitations: string[]
  warnings: string[]
  order_note?: string
}

export type AdvisorSettings = {
  pitLoss: string
  fuelEffect: string
  maxStops: string
  compoundRule: 'auto' | 'on' | 'off'
}
