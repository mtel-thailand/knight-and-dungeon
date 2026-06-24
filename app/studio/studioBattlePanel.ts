import type { BattleEventRole, CharacterRoleMap, SpellDef, UnitStats } from "@/lib/battle/types";
import { STAT_BOUNDS } from "@/lib/battle/types";
import type { AnimationRow, ServerConfig } from "./studioTypes";

// =============================================================================
// SECTION > studioBattlePanel: Battle Data CMS (stats / roles / spells) -> writes /api/config/battle
// Seam (Phase 2 -> studioBattlePanel.ts): getStats, getRoles, getActionsForChar, getAnimationsForChar, saveBattle, renderBattlePanel
// Owner: studio-cms (E) - see app/studio/AGENTS.md
// =============================================================================

const BATTLE_ROLES: BattleEventRole[] = ["idle", "move", "attack", "hit", "death"];

const KNOWN_SKILLS: Array<{ id: string; name: string }> = [
  { id: "shield_bash", name: "Shield Bash" },
];

export type StudioBattlePanelCtx = {
  battleContent: HTMLElement;
  serverConfig: ServerConfig;
  animations: AnimationRow[];
  resolveCharAnimKeys: (id: string) => string[] | null;
  battleStatsState: Record<string, UnitStats>;
  roleMapsState: Record<string, CharacterRoleMap>;
  spellsState: SpellDef[];
  characterSpellsState: Record<string, string[]>;
  flashSaved: (btn: HTMLButtonElement) => void;
  saveBattle: (body: {
    characterId: string;
    stats?: UnitStats;
    roles?: CharacterRoleMap;
    spells?: string[];
  }) => void;
};

export function createStudioBattlePanel(ctx: StudioBattlePanelCtx) {
  const {
    battleContent,
    serverConfig,
    animations,
    resolveCharAnimKeys,
    battleStatsState,
    roleMapsState,
    spellsState,
    characterSpellsState,
    flashSaved,
    saveBattle,
  } = ctx;

  // Normalize + store the live stats/roles object for a character (created
  // on first view so Save always has a complete object to send). Called
  // once per render; row handlers then mutate the returned object directly.
  function getStats(id: string): UnitStats {
    const s = battleStatsState[id];
    const stats: UnitStats = {
      hp: s?.hp ?? 100,
      attack: s?.attack ?? 10,
      defense: s?.defense ?? 0,
      actionSpeed: s?.actionSpeed ?? 100,
      range: s?.range ?? 1,
      skills: Array.isArray(s?.skills) ? [...s!.skills] : [],
    };
    battleStatsState[id] = stats;
    return stats;
  }

  function getRoles(id: string): CharacterRoleMap {
    const roles: CharacterRoleMap = { ...(roleMapsState[id] ?? {}) };
    roleMapsState[id] = roles;
    return roles;
  }

  // The role→Action dropdowns offer THIS character's authored Actions — the
  // same per-character actions array the studio Action editor edits
  // (serverConfig.actions[charId]; cf. getCharacterActions()).
  function getActionsForChar(
    id: string,
  ): Array<{ id: string; name: string }> {
    const raw = serverConfig.actions?.[id] ?? [];
    return raw
      .filter((a) => a && typeof a.id === "string")
      .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) }));
  }

  // Raw Animation catalog keys available to a character — same source the
  // studio's Action editor uses (resolveCharAnimKeys: the character's own
  // kit, or the full catalog when none is defined), intersected with catalog
  // rows that actually loaded frames so each key resolves to a label.
  function getAnimationsForChar(
    id: string,
  ): Array<{ key: string; label: string }> {
    const keys =
      resolveCharAnimKeys(id) ?? animations.map((a) => a.configKey);
    const out: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    keys.forEach((key) => {
      if (seen.has(key)) return;
      const def = animations.find((a) => a.configKey === key);
      if (!def) return;
      seen.add(key);
      out.push({ key, label: def.label });
    });
    return out;
  }

  function addBattleSectionTitle(text: string) {
    const t = document.createElement("div");
    t.className = "config-section-title";
    t.textContent = text;
    battleContent.appendChild(t);
  }

  function makeBattleNumRow(
    label: string,
    val: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    parent: HTMLElement = battleContent,
  ) {
    const row = document.createElement("div");
    row.className = "battle-row";
    const lbl = document.createElement("span");
    lbl.className = "battle-row-label";
    lbl.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "battle-input";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(val);
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(inp);
    parent.appendChild(row);
  }

  function makeBattleSaveBtn(
    text: string,
    onSave: () => void,
    parent: HTMLElement = battleContent,
  ) {
    const btn = document.createElement("button");
    btn.className = "battle-save-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      onSave();
      flashSaved(btn);
    });
    parent.appendChild(btn);
    return btn;
  }

  function renderBattlePanel(id: string) {
    battleContent.innerHTML = "";
    if (!id) {
      const empty = document.createElement("div");
      empty.className = "ae-empty";
      empty.textContent = "No character selected.";
      battleContent.appendChild(empty);
      return;
    }

    // Live objects the row handlers mutate; Save closes over these.
    const stats = getStats(id);
    const roles = getRoles(id);

    // 1) Battle stats — bounds from STAT_BOUNDS (the route clamps too).
    addBattleSectionTitle("Battle Stats");
    makeBattleNumRow("HP", stats.hp, STAT_BOUNDS.hp.min, STAT_BOUNDS.hp.max, 1, (v) => {
      stats.hp = v;
    });
    makeBattleNumRow("Attack", stats.attack, STAT_BOUNDS.attack.min, STAT_BOUNDS.attack.max, 1, (v) => {
      stats.attack = v;
    });
    makeBattleNumRow("Defense", stats.defense, STAT_BOUNDS.defense.min, STAT_BOUNDS.defense.max, 1, (v) => {
      stats.defense = v;
    });
    makeBattleNumRow("Action Speed", stats.actionSpeed, STAT_BOUNDS.actionSpeed.min, STAT_BOUNDS.actionSpeed.max, 1, (v) => {
      stats.actionSpeed = v;
    });
    makeBattleNumRow("Range", stats.range, STAT_BOUNDS.range.min, STAT_BOUNDS.range.max, 1, (v) => {
      stats.range = v;
    });
    makeBattleSaveBtn("Save Stats", () =>
      saveBattle({ characterId: id, stats }),
    );

    // 2) Event role → Action / Animation mapping. Each dropdown offers the
    //    character's authored Actions AND the raw Animation catalog keys
    //    available to it (grouped in optgroups). The stored value is a
    //    plain id/key string the replayer resolves (Action-id →
    //    animation-key → inference → base-pose), so no encoding is needed.
    addBattleSectionTitle("Event Roles → Actions");
    const charActions = getActionsForChar(id);
    const charAnims = getAnimationsForChar(id);
    BATTLE_ROLES.forEach((role) => {
      const row = document.createElement("div");
      row.className = "battle-row";
      const lbl = document.createElement("span");
      lbl.className = "battle-row-label";
      lbl.textContent = role;
      const sel = document.createElement("select");
      sel.className = "battle-select";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(none → fallback)";
      sel.appendChild(noneOpt);
      if (charActions.length > 0) {
        const grp = document.createElement("optgroup");
        grp.label = "Actions";
        charActions.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name;
          grp.appendChild(opt);
        });
        sel.appendChild(grp);
      }
      if (charAnims.length > 0) {
        const grp = document.createElement("optgroup");
        grp.label = "Animations";
        charAnims.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.key;
          opt.textContent = a.label;
          grp.appendChild(opt);
        });
        sel.appendChild(grp);
      }
      sel.value = roles[role] ?? "";
      sel.addEventListener("change", () => {
        if (sel.value) roles[role] = sel.value;
        else delete roles[role];
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      battleContent.appendChild(row);
    });
    if (charActions.length === 0 && charAnims.length === 0) {
      const hint = document.createElement("div");
      hint.className = "battle-hint";
      hint.textContent =
        "No Actions or Animations available for this character; roles fall back until some exist.";
      battleContent.appendChild(hint);
    }
    makeBattleSaveBtn("Save Roles", () =>
      saveBattle({ characterId: id, roles }),
    );

    // 3) Skill assignment — persisted inside stats.skills.
    addBattleSectionTitle("Skills");
    KNOWN_SKILLS.forEach((skill) => {
      const row = document.createElement("div");
      row.className = "battle-row";
      const lbl = document.createElement("span");
      lbl.className = "battle-row-label";
      lbl.textContent = skill.name;
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "toggle-switch";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = stats.skills.includes(skill.id);
      const track = document.createElement("span");
      track.className = "toggle-track";
      toggleLabel.appendChild(inp);
      toggleLabel.appendChild(track);
      inp.addEventListener("change", () => {
        const has = stats.skills.includes(skill.id);
        if (inp.checked && !has) stats.skills.push(skill.id);
        else if (!inp.checked && has)
          stats.skills = stats.skills.filter((s) => s !== skill.id);
      });
      row.appendChild(lbl);
      row.appendChild(toggleLabel);
      battleContent.appendChild(row);
    });
    makeBattleSaveBtn("Save Skills", () =>
      saveBattle({ characterId: id, stats }),
    );

    // 4) Spell ownership — which GLOBAL spells (from the Spells panel) this
    //    character can cast. The list is DYNAMIC from spellsState (not
    //    hardcoded like skills); persisted via POST /api/config/battle
    //    { characterId, spells }.
    addBattleSectionTitle("Spells");
    if (!characterSpellsState[id]) characterSpellsState[id] = [];
    if (spellsState.length === 0) {
      const hint = document.createElement("div");
      hint.className = "battle-hint";
      hint.textContent =
        "No spells defined yet — create them in the Spells panel.";
      battleContent.appendChild(hint);
    } else {
      spellsState.forEach((spell) => {
        const row = document.createElement("div");
        row.className = "battle-row";
        const lbl = document.createElement("span");
        lbl.className = "battle-row-label";
        lbl.textContent = spell.name;
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "toggle-switch";
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = (characterSpellsState[id] ?? []).includes(spell.id);
        const track = document.createElement("span");
        track.className = "toggle-track";
        toggleLabel.appendChild(inp);
        toggleLabel.appendChild(track);
        inp.addEventListener("change", () => {
          const cur = characterSpellsState[id] ?? [];
          const has = cur.includes(spell.id);
          if (inp.checked && !has)
            characterSpellsState[id] = [...cur, spell.id];
          else if (!inp.checked && has)
            characterSpellsState[id] = cur.filter((s) => s !== spell.id);
        });
        row.appendChild(lbl);
        row.appendChild(toggleLabel);
        battleContent.appendChild(row);
      });
    }
    makeBattleSaveBtn("Save Spells", () =>
      saveBattle({
        characterId: id,
        spells: characterSpellsState[id] ?? [],
      }),
    );
  }

  return { renderBattlePanel };
}
