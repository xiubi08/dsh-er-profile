/** Typed plugin errors so tools can tell "player not found" from "the API broke". */

export type ErErrorCode =
  | 'invalid_argument'
  | 'player_not_found'
  | 'character_not_found'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'aborted'
  | 'render_failed'
  | 'qq_send_failed'
  | 'qq_target_not_allowed'
  | 'qq_image_too_large'

export interface ErErrorOptions {
  /** HTTP status, when the error came from an HTTP response. */
  status?: number
  /** Extra machine-readable context surfaced to the model. */
  details?: Record<string, unknown>
  cause?: unknown
}

/** One plugin failure with a stable code, so callers never parse message text. */
export class ErError extends Error {
  readonly code: ErErrorCode
  readonly status: number | undefined
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErErrorCode, message: string, options: ErErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ErError'
    this.code = code
    this.status = options.status
    this.details = options.details
  }
}

/** Narrowing helper that also works across the worker boundary (no instanceof trust). */
export function isErError(value: unknown): value is ErError {
  return value instanceof ErError
    || (typeof value === 'object' && value !== null
      && (value as { name?: unknown }).name === 'ErError'
      && typeof (value as { code?: unknown }).code === 'string')
}

export function errorCodeOf(value: unknown): ErErrorCode | undefined {
  return isErError(value) ? value.code : undefined
}

export function errorMessageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
