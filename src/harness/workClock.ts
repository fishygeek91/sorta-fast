/**
 * Headless work clock for race playback (issue #7, design.md §4.3).
 *
 * Playback time is measured in billed op units from the trace cost table, not
 * wall-clock milliseconds. Callers inject `dtSeconds` each animation frame; this
 * module has no DOM, `Date.now()`, or `Math.random()`.
 */

/** Default play rate: ops advanced per second at speed 1 (design: rAF advances speed × dt ops). */
export const BASE_OPS_PER_SECOND = 20_000;

/**
 * Advances a cumulative op cursor for trace playback.
 *
 * At speed 1, a one-second `advance(1)` step bills `BASE_OPS_PER_SECOND` ops.
 * Playback layers clamp the cursor to total lane work; this class does not.
 */
export class WorkClock {
  /** Cumulative billed ops (cursor T). */
  cursor: number;
  playing: boolean;
  /** Dimensionless multiplier; 1 = BASE_OPS_PER_SECOND. */
  speed: number;

  /** Start at T = 0, paused, with speed 1. */
  constructor() {
    this.cursor = 0;
    this.playing = false;
    this.speed = 1;
  }

  /** Begin advancing the cursor on each `advance` call. */
  play(): void {
    this.playing = true;
  }

  /** Stop advancing the cursor; `advance` returns the cursor unchanged. */
  pause(): void {
    this.playing = false;
  }

  /**
   * Set the dimensionless speed multiplier.
   *
   * @param speed - Must be finite and >= 0.
   * @throws If `speed` is not finite or is negative.
   */
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) {
      throw new Error(`speed must be finite, got ${String(speed)}`);
    }
    if (speed < 0) {
      throw new Error(`speed must be >= 0, got ${String(speed)}`);
    }
    this.speed = speed;
  }

  /**
   * If playing, add `speed * BASE_OPS_PER_SECOND * dtSeconds` to the cursor.
   *
   * @param dtSeconds - Elapsed seconds since the last frame; must be finite and >= 0.
   * @returns The new cursor (not clamped; playback clamps to total work).
   * @throws If `dtSeconds` is not finite or is negative.
   */
  advance(dtSeconds: number): number {
    if (!Number.isFinite(dtSeconds)) {
      throw new Error(`dtSeconds must be finite, got ${String(dtSeconds)}`);
    }
    if (dtSeconds < 0) {
      throw new Error(`dtSeconds must be >= 0, got ${String(dtSeconds)}`);
    }
    if (!this.playing) {
      return this.cursor;
    }
    this.cursor += this.speed * BASE_OPS_PER_SECOND * dtSeconds;
    return this.cursor;
  }

  /**
   * Set the cursor to `t` without changing the playing state.
   *
   * @param t - Target op position; must be finite and >= 0.
   * @throws If `t` is not finite or is negative.
   */
  seek(t: number): void {
    if (!Number.isFinite(t)) {
      throw new Error(`t must be finite, got ${String(t)}`);
    }
    if (t < 0) {
      throw new Error(`t must be >= 0, got ${String(t)}`);
    }
    this.cursor = t;
  }
}
