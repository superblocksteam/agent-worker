import { RetryableError } from '@superblocksteam/shared';
import { BusyError, MaybeError, NoScheduleError } from './errors';
import { busyCount } from './metrics';

export interface Interceptor {
  before(): MaybeError;
  after(): MaybeError;
}

export class Scheduler implements Interceptor {
  private _isScheduleable: boolean;

  constructor() {
    this._isScheduleable = true;
  }

  public before(): MaybeError {
    if (!this._isScheduleable) {
      return new NoScheduleError();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public after(): MaybeError {}

  public cordon(): void {
    this._isScheduleable = false;
  }
}

export class RateLimiter implements Interceptor {
  private _max: number;
  private _active: number;

  constructor(max: number) {
    this._max = max > 0 ? max : Infinity;
    this._active = 0;
  }

  public before(): MaybeError {
    // NOTE(frank): I'm assuing that Node.js will lock the post increment
    //              in the same critical section as the evaluation.
    if (this._active++ == this._max) {
      // NOTE(frank): We post increment above because the inuitiive spot to do it would be here.
      //              If we put it here, a current call to `.run()` could occur between the evaluation
      //              and the increment. We cannot have this and need to guard against it.
      this._active--;
      // TODO(frank): Find a clean way to take this in as a class field instead of globally.
      //              As is, this class isn't reuseable.
      busyCount.inc();
      return new BusyError(`This worker has reached its limit of ${this._active} active tasks.`);
    }
  }

  public after(): MaybeError {
    this._active--;
  }

  public check(): void {
    const active = this._active;
    if (active > 0) {
      throw new RetryableError(`There are ${active} steps being executed on this worker.`);
    }
  }
}
