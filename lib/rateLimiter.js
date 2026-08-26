// Minimal in-memory sliding-window limiter. This app runs as a single
// Railway instance backed by a local better-sqlite3 file (see lib/db.js) —
// no shared cache/queue infra exists to coordinate across replicas, so an
// in-memory map is consistent with how the rest of the app already keeps
// state, not a shortcut taken only here.
const WINDOW_MS = 60_000;

const hitsByKey = new Map(); // key -> timestamps (ms) within the current window

// Generous enough for one person's own legitimate burst (multiple AED
// units, several photos each, fired off quickly) while still bounding how
// much load a single client can put on the Gemini call budget per minute.
const DEFAULT_LIMIT = 30;

/**
 * @param {string} key identifies the caller (e.g. an IP address)
 * @param {number} limit max requests allowed within the rolling window
 * @returns {boolean} true if this call is allowed, false if the caller
 *   should be rejected (429)
 */
export function checkRateLimit(key, limit = DEFAULT_LIMIT) {
  const now = Date.now();
  const timestamps = (hitsByKey.get(key) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hitsByKey.set(key, timestamps);

  // Opportunistic cleanup on the rare request that trips a large map,
  // rather than a separate timer — this module only needs to stay small,
  // not be pruned on a schedule.
  if (hitsByKey.size > 5000) {
    for (const [k, v] of hitsByKey) {
      if (!v.some((t) => now - t < WINDOW_MS)) hitsByKey.delete(k);
    }
  }

  return timestamps.length <= limit;
}
