import type {
  AdvisorResult,
  AdvisorSettings,
  Analysis,
  StrategyComparison,
} from '../types'

const REQUEST_TIMEOUT_MS = 45_000

/** Parse FastAPI responses, including Vercel HTML errors and validation errors. */
export async function parseApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.toLowerCase().includes('application/json')) {
    if (response.status === 413) {
      throw new Error('The file is too large for the server (maximum 4 MB).')
    }
    if (response.status === 504) {
      throw new Error('The analysis timed out. Try a smaller file.')
    }
    throw new Error(
      `The Laplogic API returned HTTP ${response.status}. ` +
      'The backend may be offline; please try again shortly.'
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('The server returned an invalid response.')
  }

  if (!response.ok) {
    let detail: unknown
    if (typeof data === 'object' && data !== null && 'detail' in data) {
      detail = data.detail
    }
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
            .map((item: unknown) =>
              typeof item === 'object' && item !== null && 'msg' in item && typeof item.msg === 'string'
                ? item.msg
                : 'Invalid input'
            )
            .join(', ')
          : `API request failed (HTTP ${response.status})`
    throw new Error(message)
  }

  return data as T
}

async function postForm<T>(
  path: string,
  body: FormData,
  signal?: AbortSignal
): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  // AbortSignal.any is recent; older browsers fall back to the caller's signal.
  const combined = signal
    ? typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeout])
      : signal
    : timeout

  let response: Response
  try {
    response = await fetch(path, { method: 'POST', body, signal: combined })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) {
      throw new Error('The Laplogic API took too long to respond. Please try again.', { cause: error })
    }
    throw new Error('Unable to reach Laplogic. Check your connection and try again.', { cause: error })
  }
  return parseApiResponse<T>(response)
}

export function analyzeCsv(file: File, signal?: AbortSignal) {
  const body = new FormData()
  body.append('file', file)
  return postForm<Analysis>('/api/analyze/csv', body, signal)
}

export type ComparePayload = {
  raceLaps: number
  strategyType: 'one_stop' | 'two_stop'
  firstPitLap: number
  secondPitLap: number
  compounds: [string, string, string]
  pitLoss: number
  simulator: string
}

export function compareStrategies(file: File, plan: ComparePayload, signal?: AbortSignal) {
  const body = new FormData()
  body.append('file', file)
  body.append('race_laps', String(plan.raceLaps))
  body.append('strategy_type', plan.strategyType)
  body.append('first_pit_lap', String(plan.firstPitLap))
  if (plan.strategyType === 'two_stop') {
    body.append('second_pit_lap', String(plan.secondPitLap))
    body.append('third_compound', plan.compounds[2])
  }
  body.append('first_compound', plan.compounds[0])
  body.append('second_compound', plan.compounds[1])
  body.append('pit_loss', String(plan.pitLoss))
  body.append('simulator', plan.simulator)
  return postForm<StrategyComparison>('/api/strategy/compare', body, signal)
}

export function optimizeStrategy(
  file: File,
  simulator: string,
  settings: AdvisorSettings,
  signal?: AbortSignal
) {
  const body = new FormData()
  body.append('file', file)
  body.append('simulator', simulator)
  if (settings.pitLoss.trim()) body.append('pit_loss', settings.pitLoss.trim())
  if (settings.fuelEffect.trim()) body.append('fuel_effect', settings.fuelEffect.trim())
  if (settings.maxStops) body.append('max_stops', settings.maxStops)
  if (settings.compoundRule !== 'auto') {
    body.append('require_compound_change', String(settings.compoundRule === 'on'))
  }
  return postForm<AdvisorResult>('/api/strategy/optimize', body, signal)
}
