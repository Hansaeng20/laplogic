export const CATEGORIES = [
  'Formula Racing',
  'GT & Endurance',
  'Touring & Road',
  'Rally & Off-Road',
  'Oval Racing',
  'Other / Custom',
]

// Labels are sent to the API, which maps them to rule presets.
export const SIMULATORS = [
  'F1 Series',
  'Assetto Corsa',
  'Assetto Corsa Competizione',
  'iRacing',
  'Le Mans Ultimate',
  'Automobilista 2',
  'RaceRoom',
  'Other / Custom',
]

// Used only when an upload has no usable compound labels.
export const DEFAULT_COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD']

export const TYRE_COLORS: Record<string, string> = {
  SOFT: '#ef4444',
  SUPERSOFT: '#ec4899',
  MEDIUM: '#eab308',
  HARD: '#e2e8f0',
  INTERMEDIATE: '#22c55e',
  WET: '#38bdf8',
  DRY: '#f97316',
  UNKNOWN: '#64748b',
  MIXED: '#a78bfa',
}

// Fallback palette for simulator-specific names (C1-C5, custom sets...)
export const EXTRA_TYRE_COLORS = ['#f97316', '#14b8a6', '#c084fc', '#facc15', '#60a5fa']

// Vercel rejects request bodies above 4.5 MB; the backend enforces 4 MB.
export const MAX_FILE_SIZE = 4 * 1024 * 1024
export const MAX_FILE_LABEL = '4 MB'
