// Tiny framework-agnostic store for player audio settings (BGM/SFX volume + mute),
// persisted to localStorage. Consumed by playSound (SFX), the GameScreenShell BGM
// <audio>, and the SoundSettings modal. ALL localStorage/window access is client-
// guarded and lazy, so importing this in server scope (e.g. transitively via
// studioHelpers, which API routes import for slugify) is safe — module load never
// touches the browser. Designed to back React's useSyncExternalStore: getAudioSettings
// returns a stable reference until setAudioSettings replaces it.

export type AudioSettings = {
  /** 0..1 — looping battle background music. Default 0.2 (20%). */
  bgmVolume: number;
  /** 0..1 — per-action sound effects (multiplies into each playSound call). */
  sfxVolume: number;
  /** Master mute — forces both effective volumes to 0 without losing the slider values. */
  muted: boolean;
};

const STORAGE_KEY = "vts.audioSettings";
const DEFAULTS: AudioSettings = { bgmVolume: 0.2, sfxVolume: 1, muted: false };

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

let state: AudioSettings = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<() => void>();

/** Hydrate from localStorage once, on the client. No-op on the server / before access. */
function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    state = {
      bgmVolume: typeof p.bgmVolume === "number" ? clamp01(p.bgmVolume) : DEFAULTS.bgmVolume,
      sfxVolume: typeof p.sfxVolume === "number" ? clamp01(p.sfxVolume) : DEFAULTS.sfxVolume,
      muted: typeof p.muted === "boolean" ? p.muted : DEFAULTS.muted,
    };
  } catch {
    /* corrupt or blocked storage — keep defaults */
  }
}

/** Current settings (stable reference between writes — safe for useSyncExternalStore). */
export function getAudioSettings(): AudioSettings {
  load();
  return state;
}

/** Merge a partial patch, persist, and notify subscribers. */
export function setAudioSettings(patch: Partial<AudioSettings>): void {
  load();
  state = {
    bgmVolume: patch.bgmVolume !== undefined ? clamp01(patch.bgmVolume) : state.bgmVolume,
    sfxVolume: patch.sfxVolume !== undefined ? clamp01(patch.sfxVolume) : state.sfxVolume,
    muted: patch.muted !== undefined ? patch.muted : state.muted,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full/blocked — settings still apply for this session */
    }
  }
  for (const fn of listeners) fn();
}

/** Subscribe to changes; returns an unsubscribe fn. (For useSyncExternalStore.) */
export function subscribeAudioSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Effective BGM volume after the master mute. */
export function effectiveBgmVolume(): number {
  const s = getAudioSettings();
  return s.muted ? 0 : s.bgmVolume;
}

/** Effective SFX volume after the master mute. */
export function effectiveSfxVolume(): number {
  const s = getAudioSettings();
  return s.muted ? 0 : s.sfxVolume;
}
