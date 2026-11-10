import { EXTRA_TYRE_COLORS, TYRE_COLORS } from '../constants'

export function tyreColor(compound: string): string {
  const key = compound.toUpperCase()
  if (TYRE_COLORS[key]) return TYRE_COLORS[key]

  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return EXTRA_TYRE_COLORS[hash % EXTRA_TYRE_COLORS.length]
}

export function formatTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const value = Math.abs(seconds)
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = (value % 60).toFixed(3).padStart(6, '0')

  if (hours > 0) {
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
  }
  return `${sign}${minutes}:${remainder}`
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

export function formatGap(seconds: number): string {
  return Math.abs(seconds) >= 60 ? formatTime(seconds) : `${seconds.toFixed(3)}s`
}

export function formatSigned(seconds: number, digits = 1): string {
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(digits)}s`
}

export function stopLabel(stops: number): string {
  return stops === 0 ? 'No stop' : stops === 1 ? '1 stop' : `${stops} stops`
}
