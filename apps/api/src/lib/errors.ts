/** Amplop error seragam (FRD §11). */
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INCOMPLETE'
  | 'INVALID_ANSWER_TYPE' | 'QUESTION_NOT_VISIBLE' | 'INVITATION_INVALID'
  | 'RATE_LIMITED' | 'INTERNAL'

export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
    trace_id?: string
  }
}

export function err(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      trace_id: crypto.randomUUID(),
    },
  }
}
