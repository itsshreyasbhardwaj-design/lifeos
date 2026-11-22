/** Errors with a stable code the HTTP layer maps to a status. Messages are user-safe. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Record') => new AppError('not_found', 404, `${what} not found.`);
export const forbidden = (message = 'You do not have access to this.') => new AppError('forbidden', 403, message);
export const unauthorized = (message = 'Please sign in.') => new AppError('unauthorized', 401, message);
export const invalid = (message: string, details?: unknown) => new AppError('invalid', 422, message, details);
export const conflict = (message: string, details?: unknown) => new AppError('conflict', 409, message, details);
export const rateLimited = (retryAfterSeconds: number) => new AppError('rate_limited', 429, `Too many attempts. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds });
export const planRequired = (feature: string, plan: string) => new AppError('plan_required', 402, `This needs LifeOS ${plan}.`, { feature, plan });
export const quotaExceeded = (metric: string, limit: number) => new AppError('quota_exceeded', 402, `You have reached this month's limit (${limit}) for ${metric.replace(/_/g, ' ')}.`, { metric, limit });
