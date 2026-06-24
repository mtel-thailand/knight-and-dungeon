'use client';

import type { Team, UnitStats } from "@/lib/battle/types";
import { BOARD } from "@/lib/battle/types";
import type { BuildUnit, RosterChar } from "./MockBattleClient";

// =============================================================================
// SECTION > PartyColumn (React subcomponent)
// Seam (Phase 1 -> PartyColumn.tsx): PartyColumn
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

const STAT_FIELDS: { key: keyof UnitStats; label: string; title: string }[] = [
  { key: "hp", label: "HP", title: "Health" },
  { key: "attack", label: "ATK", title: "Attack" },
  { key: "defense", label: "DEF", title: "Defense" },
  { key: "actionSpeed", label: "SPD", title: "Action speed (higher acts more often)" },
  { key: "range", label: "RNG", title: "Range in hexes" },
];

const KNOWN_SKILLS: { id: string; name: string }[] = [
  { id: "shield_bash", name: "Shield Bash" },
];

export function PartyColumn({
  team,
  title,
  list,
  roster,
  nameOf,
  onAdd,
  onRemove,
  onSlot,
  onStat,
  onSkill,
  onAttackType,
}: {
  team: Team;
  title: string;
  list: BuildUnit[];
  roster: RosterChar[];
  nameOf: (id: string) => string;
  onAdd: (charId: string) => void;
  onRemove: (uid: string) => void;
  onSlot: (uid: string, slot: number) => void;
  onStat: (uid: string, key: keyof UnitStats, value: number) => void;
  onSkill: (uid: string, skillId: string) => void;
  onAttackType: (uid: string, attackType: "melee" | "ranged") => void;
}) {
  const full = list.length >= BOARD.maxPerSide;
  return (
    <section className={`mb-party ${team}`}>
      <div className="mb-party-head">
        <h2>{title}</h2>
        <span className="mb-count">
          {list.length}/{BOARD.maxPerSide}
        </span>
      </div>

      <div className="mb-add-row">
        <select
          className="mb-select"
          value=""
          disabled={full}
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">{full ? "Party full" : "Add fighter…"}</option>
          {roster.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-unit-list">
        {list.length === 0 && <div className="mb-empty">No fighters yet.</div>}
        {list.map((u) => (
          <div key={u.uid} className="mb-unit-card">
            <div className="mb-unit-top">
              <span className="mb-unit-avatar">
                {nameOf(u.characterId).charAt(0).toUpperCase()}
              </span>
              <span className="mb-unit-name">{nameOf(u.characterId)}</span>
              <button
                className="mb-unit-del"
                onClick={() => onRemove(u.uid)}
                aria-label="Remove fighter"
              >
                ×
              </button>
            </div>

            <div className="mb-slot-row">
              <span className="mb-slot-label">Hex</span>
              {Array.from({ length: BOARD.maxPerSide }).map((_, q) => (
                <button
                  key={q}
                  className={`mb-slot-pill ${u.slot === q ? "on" : ""}`}
                  onClick={() => onSlot(u.uid, q)}
                >
                  {q + 1}
                </button>
              ))}
            </div>

            <div className="mb-slot-row">
              <span
                className="mb-slot-label"
                title="Melee can't hit an enemy in the same row; ranged can."
              >
                Attack
              </span>
              {(["melee", "ranged"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mb-atk-pill ${u.attackType === t ? "on" : ""}`}
                  onClick={() => onAttackType(u.uid, t)}
                >
                  {t === "melee" ? "Melee" : "Ranged"}
                </button>
              ))}
            </div>

            <div className="mb-stat-grid">
              {STAT_FIELDS.map((f) => (
                <label key={f.key} className="mb-stat" title={f.title}>
                  <span>{f.label}</span>
                  <input
                    type="number"
                    value={u.stats[f.key] as number}
                    onChange={(e) =>
                      onStat(u.uid, f.key, Number(e.target.value) || 0)
                    }
                  />
                </label>
              ))}
            </div>

            <div className="mb-skill-row">
              {KNOWN_SKILLS.map((s) => (
                <label key={s.id} className="mb-skill">
                  <input
                    type="checkbox"
                    checked={u.stats.skills.includes(s.id)}
                    onChange={() => onSkill(u.uid, s.id)}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
