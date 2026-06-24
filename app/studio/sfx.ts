// SSR-safe Web Audio polyphonic SFX mixer.
//
// API
//   playSfx(url: string, gain?: number): void
//     Fire-and-forget. Creates a fresh AudioBufferSourceNode per call so
//     multiple calls to the same URL overlap seamlessly (true polyphony).
//     If the buffer hasn't been fetched+decoded yet, it loads in the
//     background and plays as soon as it's ready.
//
// Decode cache
//   A Map<url, AudioBuffer> holds every successfully-decoded buffer so
//   subsequent plays skip the fetch + decode step. An in-flight
//   Map<url, Promise<AudioBuffer>> prevents concurrent first-plays of
//   the same URL from double-fetching.
//
// Autoplay-unlock
//   Browsers suspend AudioContext until a user gesture. On first context
//   creation we install one-time window listeners for pointerdown, keydown,
//   and touchstart. Whichever fires first resumes the context and removes
//   all three listeners. playSfx also calls ctx.resume() itself so that
//   if a gesture has already unlocked the context the resume is a no-op.
//
// Fallback
//   If AudioContext is unavailable (server-side, old browser, privacy
//   mode), or if fetch/decode throws, playSfx falls back to creating a
//   fresh HTMLAudioElement per call so audio still plays. The function
//   never throws.

// ---------------------------------------------------------------------------
// Module-level state — never touches the browser at import time.
// ---------------------------------------------------------------------------
let _ctx: AudioContext | null = null;
let _unlocked = false;
const _bufferCache = new Map<string, AudioBuffer>();
const _inflight = new Map<string, Promise<AudioBuffer>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Lazily create the shared AudioContext. Returns null outside the browser. */
function _getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    _ctx = new Ctor();
    _setupAutoplayUnlock();
  }
  return _ctx;
}

/**
 * Install one-time gesture listeners so the AudioContext can be resumed
 * (browsers block audio until a user interaction).
 */
function _setupAutoplayUnlock(): void {
  if (typeof window === "undefined") return;
  const handler = () => {
    if (_unlocked) return;
    _unlocked = true;
    if (_ctx && _ctx.state === "suspended") {
      _ctx.resume().catch(() => {
        /* autoplay still blocked — playback will degrade */
      });
    }
    // Remove all three listeners (each may or may not have fired).
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
  };
  window.addEventListener("pointerdown", handler);
  window.addEventListener("keydown", handler);
  window.addEventListener("touchstart", handler);
}

/**
 * Wrap decodeAudioData so it works with both the callback-based and
 * Promise-based implementations.
 */
function _decodeAudioData(
  ctx: AudioContext,
  arrayBuffer: ArrayBuffer,
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

/**
 * Create a fresh source node and play the buffer immediately.
 * Each call produces its own source node → true polyphony.
 */
function _playBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  gain: number,
): void {
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
  } catch {
    /* node creation failed (e.g. context closed) — silently ignore */
  }
}

/**
 * HTML Audio fallback used when Web Audio is unavailable or a load fails.
 * Each call creates its own element so multiple calls overlap.
 */
function _fallbackPlay(url: string, gain: number): void {
  try {
    const el = new Audio(url);
    el.volume = gain;
    void el.play().catch(() => {});
  } catch {
    /* Audio unavailable — ignore */
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Play a sound effect at the given URL (or path) with an optional gain
 * multiplier (0–1). Fire-and-forget: overlapping calls produce simultaneous
 * playback. Never throws.
 */
export function playSfx(url: string, gain = 1): void {
  const g = clamp01(gain);

  // First, try the Web Audio path.
  try {
    const ctx = _getCtx();
    if (!ctx) {
      // AudioContext not available — straight to fallback.
      _fallbackPlay(url, g);
      return;
    }

    // Attempt to resume a suspended context (autoplay policy).  If it was
    // already unlocked by the gesture listener this is a no-op.
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    // --- Cache hit ---
    const cached = _bufferCache.get(url);
    if (cached) {
      _playBuffer(ctx, cached, g);
      return;
    }

    // --- In-flight request (prevents concurrent duplicate loads) ---
    const inflight = _inflight.get(url);
    if (inflight) {
      inflight
        .then((buf) => _playBuffer(ctx, buf, g))
        .catch(() => _fallbackPlay(url, g));
      return;
    }

    // --- First request for this URL — fetch + decode ---
    const load: Promise<AudioBuffer> = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        return res.arrayBuffer();
      })
      .then((ab) => _decodeAudioData(ctx, ab));

    _inflight.set(url, load);

    // Centralised cache-and-cleanup (runs once regardless of how many
    // concurrent calls are waiting on this load).
    load
      .then((buf) => {
        _bufferCache.set(url, buf);
        _inflight.delete(url);
      })
      .catch(() => {
        _inflight.delete(url);
      });

    // Schedule playback for *this* call when the buffer is ready.
    load
      .then((buf) => _playBuffer(ctx, buf, g))
      .catch(() => _fallbackPlay(url, g));
  } catch {
    // Catastrophic failure (e.g. fetch thrown synchronously) — fallback.
    _fallbackPlay(url, g);
  }
}
