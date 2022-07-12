import { RetryableError, QuotaError } from '@superblocksteam/shared';

export class BusyError extends RetryableError {
  constructor(msg: string) {
    super(msg);
    this.name = 'BusyError';
    this.message = msg;
  }
}

export class NoScheduleError extends RetryableError {
  constructor(msg?: string) {
    super(msg);
    this.name = 'NoScheduleError';
  }
}

export class AuthenticationError extends Error {
  constructor(msg: string) {
    super(`UNAUTHORIZED: ${msg}`);
  }
}

// extend to all of our plugin error types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unmarshal(err: any): Error {
  if (!(err instanceof Object) || !('name' in err)) {
    return new Error();
  }

  const msg = 'message' in err ? err.message : '';

  switch (err.name) {
    case BusyError.name:
      return new BusyError(msg);
    case QuotaError.name:
      return new QuotaError(msg);
    case NoScheduleError.name:
      return new NoScheduleError(msg);
    default:
      return new Error(msg);
  }
}

export type MaybeError = Error | void;
