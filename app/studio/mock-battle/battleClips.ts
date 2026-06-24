import type { CatalogEntry, StoredAction } from "../studioTypes";
import type { BattleEventRole, CharacterRoleMap } from "@/lib/battle/types";

// =============================================================================
// SECTION > battleClips: frames loader, asset scoping, action resolution
// Seam (Phase 2 -> battleClips.ts): framesForKey, migrateAction, ownedKeys, basePose, flattenAction, clipForRole
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const ROLE_PATTERNS: Record<BattleEventRole, RegExp> = {
  idle: /idle|ready|stand|breath/i,
  move: /move|run|walk|jump|dash|step|advance/i,
  attack: /attack|swing|slash|chop|thrust|stab|spell|cast|bash|shoot|punch|strike/i,
  hit: /\bhit\b|hurt|flinch|stagger|damage|take/i,
  death: /death|defeat|die|dead|\bko\b|fall|collapse/i,
};

type BattleClipsConfig = {
  actions?: Record<string, StoredAction[]>;
  characterAnimations?: Record<string, string[]>;
  characterSeed?: Record<string, { animations: Record<string, unknown> }>;
  roleMaps?: Record<string, CharacterRoleMap>;
};

export type BattleClipsCtx = {
  config: BattleClipsConfig;
  catalog: CatalogEntry[];
  framesByKey: Record<string, any[]>;
};

export function createBattleClips(ctx: BattleClipsCtx) {
  const { config, catalog, framesByKey } = ctx;

  const derivedCache: Record<string, any[]> = {};
  function framesForKey(key: string): any[] {
    if (framesByKey[key]) return framesByKey[key];
    if (derivedCache[key]) return derivedCache[key];
    const c = catalog.find((x) => x.key === key);
    if (c?.deriveFrom) {
      const base = framesByKey[c.deriveFrom] ?? [];
      const f = c.reverse ? [...base].reverse() : base.slice();
      derivedCache[key] = f;
      return f;
    }
    return [];
  }

  // ---- Action resolution (the core binding) ----
  // An Action = { id, name, steps[] }; an animation step references a base
  // animation by key and trims [startFrame..endFrame] (StudioClient:180-189,
  // played exactly like previewAction 1107-1193).
  function migrateAction(raw: any): {
    id: string;
    name: string;
    steps: any[];
  } {
    if (Array.isArray(raw?.steps)) return raw;
    return {
      id: raw?.id,
      name: raw?.name,
      steps: (raw?.animationKeys ?? []).map((k: string) => ({
        type: "animation",
        animationKey: k,
        duration: 1,
      })),
    };
  }
  const actionsFor = (charId: string) =>
    (config.actions?.[charId] ?? []).map(migrateAction);

  function ownedKeys(charId: string): string[] {
    const fromBlob = config.characterAnimations?.[charId];
    const fromSeed = config.characterSeed?.[charId]?.animations
      ? Object.keys(config.characterSeed[charId].animations)
      : [];
    const keys = fromBlob && fromBlob.length ? fromBlob : fromSeed;
    return keys.filter((k) => framesForKey(k).length > 0);
  }
  // First resolvable frame from an explicit role-map value (Action id or raw
  // animation key) — lets a character whose art is reachable only via the
  // role map (e.g. knight) still produce a base pose / count as having art.
  function firstFrameOfMapped(charId: string): any | null {
    const rm = config.roleMaps?.[charId];
    if (!rm) return null;
    for (const role of [
      "idle",
      "attack",
      "hit",
      "death",
    ] as BattleEventRole[]) {
      const v = rm[role];
      if (!v) continue;
      const action = actionsFor(charId).find((a) => a.id === v);
      if (action) {
        const f = flattenAction(action);
        if (f.length) return f[0];
      }
      const all = framesForKey(v);
      if (all.length) return all[0];
    }
    return null;
  }
  const basePoseCache: Record<string, any | null> = {};
  function basePose(charId: string): any | null {
    if (charId in basePoseCache) return basePoseCache[charId];
    const k = ownedKeys(charId)[0];
    let frame = k ? framesForKey(k)[0] ?? null : null;
    if (!frame) frame = firstFrameOfMapped(charId);
    basePoseCache[charId] = frame;
    return frame;
  }

  function flattenAction(action: { steps: any[] }): any[] {
    const out: any[] = [];
    for (const step of action.steps) {
      if (step?.type !== "animation") continue;
      const all = framesForKey(step.animationKey);
      if (!all.length) continue;
      const sf = clamp(step.startFrame ?? 0, 0, all.length - 1);
      const ef = clamp(step.endFrame ?? all.length - 1, sf, all.length - 1);
      for (let i = sf; i <= ef; i++) out.push(all[i]);
    }
    return out;
  }

  const clipCache: Record<string, Partial<Record<BattleEventRole, any[]>>> = {};
  function clipForRole(charId: string, role: BattleEventRole): any[] {
    const cc = (clipCache[charId] ??= {});
    if (cc[role]) return cc[role]!;
    let frames: any[] = [];

    // An explicit role-map value may be an authored Action id OR a raw
    // animation catalog key — honor whichever it is before falling back to
    // inference, then base-pose.
    const mappedId = config.roleMaps?.[charId]?.[role];

    // (a) value -> an authored Action id in actions[charId]
    if (mappedId) {
      const action = actionsFor(charId).find((a) => a.id === mappedId);
      if (action) frames = flattenAction(action);
    }
    // (b) value -> a raw animation catalog key (CMS can map a role straight
    //     to an animation; that explicit choice must be played, not inferred)
    if (!frames.length && mappedId) {
      const all = framesForKey(mappedId);
      if (all.length) frames = all;
    }
    // (c) infer an Action by name/id
    if (!frames.length) {
      const pat = ROLE_PATTERNS[role];
      const action = actionsFor(charId).find(
        (a) => pat.test(a.name ?? "") || pat.test(a.id ?? ""),
      );
      if (action) frames = flattenAction(action);
    }
    // (c cont.) infer a raw animation key for the role
    if (!frames.length) {
      const pat = ROLE_PATTERNS[role];
      const key =
        ownedKeys(charId).find((k) => pat.test(k)) ??
        (role === "idle" || role === "move" || role === "attack"
          ? ownedKeys(charId)[0]
          : undefined);
      if (key) {
        const all = framesForKey(key);
        if (all.length)
          frames = role === "idle" || role === "move" ? [all[0]] : all;
      }
    }
    // (d) base-pose freeze for idle/move
    if (!frames.length && (role === "idle" || role === "move")) {
      const bp = basePose(charId);
      if (bp) frames = [bp];
    }
    cc[role] = frames;
    return frames;
  }

  return { framesForKey, migrateAction, ownedKeys, basePose, flattenAction, clipForRole };
}
