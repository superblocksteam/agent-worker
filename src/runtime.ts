import { MaybeError } from './errors';

export interface Closer {
  close(reason?: string): Promise<MaybeError>;
}

export async function shutdown(reason: string, ...closers: Closer[]): Promise<void> {
  const routines: Promise<MaybeError>[] = [];
  closers.forEach((closer) => {
    if (closer) {
      routines.push(closer.close(reason));
    }
  });

  let firstError: Error;

  // NOTE(frank): Do not use `forEach`: https://blog.devgenius.io/using-async-await-in-a-foreach-loop-you-cant-c174b31999bd
  for (const routine of routines) {
    const maybeError: MaybeError = await routine;
    if (!firstError && maybeError) {
      firstError = maybeError;
    }
  }

  if (firstError) {
    throw firstError;
  }
}

export function shutdownHandler(signal: string, ...closers: Closer[]) {
  process.on(signal, async (signal: string): Promise<void> => {
    try {
      await shutdown(signal, ...closers);
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  });
}

export function shutdownHandlers(signals: string[], ...closers: Closer[]) {
  signals.forEach((signal) => shutdownHandler(signal, ...closers));
}
