export const POSITION_FLUSH_INTERVAL_MS = 1500;

export interface WriteThrottle {
  /**
   * Run `write` immediately if the window since the last flush has elapsed
   * (leading edge) or `immediate` is set; otherwise keep only the latest
   * pending write and flush it when the window closes (trailing edge).
   */
  schedule(write: () => void, options?: { immediate?: boolean }): void;
  /** Run the pending write now, if any. Safe to call at any time. */
  flush(): void;
  hasPending(): boolean;
}

export function createWriteThrottle(
  intervalMs: number = POSITION_FLUSH_INTERVAL_MS,
  now: () => number = Date.now
): WriteThrottle {
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let pending: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runNow = (write: () => void): void => {
    clearTimer();
    pending = null;
    lastFlushAt = now();
    write();
  };

  const flush = (): void => {
    clearTimer();
    if (!pending) {
      return;
    }
    const write = pending;
    pending = null;
    lastFlushAt = now();
    write();
  };

  return {
    schedule(write, options) {
      if (options?.immediate || now() - lastFlushAt >= intervalMs) {
        runNow(write);
        return;
      }
      pending = write;
      if (!timer) {
        const delay = Math.max(0, intervalMs - (now() - lastFlushAt));
        timer = setTimeout(flush, delay);
        timer.unref?.();
      }
    },
    flush,
    hasPending: () => pending !== null
  };
}
