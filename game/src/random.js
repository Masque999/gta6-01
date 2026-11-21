// random.js — Deterministic seeded RNG (mulberry32).
// Original code written for this project. No dependencies.

/**
 * Create a deterministic random number generator from an integer seed.
 * Every call sequence for a given seed is identical across runs and
 * machines, so city layout, traffic and missions can be replayed.
 *
 * @param {number} seed - any integer (non-integers are coerced)
 * @returns {{ next: () => number, range: (a: number, b: number) => number,
 *   int: (a: number, b: number) => number, pick: <T>(arr: T[]) => T }}
 */
export function createRandom(seed) {
  let state = (seed | 0) >>> 0;

  function next() {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(a, b) {
    return a + next() * (b - a);
  }

  function int(a, b) {
    // Inclusive on both ends, matching pick() style usage.
    return Math.floor(range(a, b + 1));
  }

  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  return { next, range, int, pick };
}
