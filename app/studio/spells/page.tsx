"use client";

// /studio/spells — LIST page for the global spell CMS.
// Reads everything from GET /api/config (returns `spells` + the `animations`
// catalog). Create is inline (name → slugify → unique id → POST /api/config/spell
// with defaults). Per-row Delete → DELETE /api/config/spell?id=. Each row links to
// the edit page at /studio/spells/[id]. Mutations update optimistically, then
// re-fetch to reconcile with the server.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SpellDef } from "@/lib/battle/types";
import { DEFAULT_SPELL_TYPE } from "@/lib/battle/types";
import { slugify } from "../studioHelpers";
import type { BootstrapPayload, CatalogEntry } from "../studioTypes";
import { SPELLS_PAGE_CSS } from "./spellsStyles";

export default function SpellsListPage() {
  const [spells, setSpells] = useState<SpellDef[]>([]);
  const [animations, setAnimations] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data: BootstrapPayload = await res.json();
        setSpells(Array.isArray(data.spells) ? data.spells : []);
        setAnimations(Array.isArray(data.animations) ? data.animations : []);
      }
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const animLabel = (key: string) => {
    if (!key) return "No animation";
    const hit = animations.find((a) => a.key === key);
    return hit ? hit.label : `${key} (missing)`;
  };

  function uniqueId(base: string): string {
    if (!spells.some((s) => s.id === base)) return base;
    let n = 2;
    while (spells.some((s) => s.id === `${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async function createSpell() {
    const name = newName.trim();
    if (!name || busy) return;
    const spell: SpellDef = {
      id: uniqueId(slugify(name, "spell")),
      name,
      animationKey: animations[0]?.key ?? "",
      type: DEFAULT_SPELL_TYPE,
      power: 1,
      cooldown: 0,
    };
    setBusy(true);
    setSpells((prev) => [...prev, spell]); // optimistic
    setNewName("");
    try {
      await fetch("/api/config/spell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spell }),
      });
    } catch {
      /* reconciled by load() below */
    } finally {
      setBusy(false);
      load();
    }
  }

  async function removeSpell(id: string) {
    setSpells((prev) => prev.filter((s) => s.id !== id)); // optimistic
    try {
      await fetch(`/api/config/spell?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* reconciled by load() below */
    } finally {
      load();
    }
  }

  return (
    <div className="spells-page">
      <style>{SPELLS_PAGE_CSS}</style>

      <nav className="menu-bar">
        <Link className="menu-bar-item" href="/studio">
          Studio
        </Link>
        <span className="menu-bar-item is-current" aria-current="page">
          Spells
        </span>
        <Link className="menu-bar-item" href="/studio/campaigns">
          Campaigns
        </Link>
        <Link className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
        </Link>
      </nav>

      <div className="spells-wrap">
        <header className="spells-head">
          <h1 className="spells-title">Spells</h1>
          <p className="spells-sub">
            Global spell definitions — assign them to characters in the studio&apos;s
            Battle Data panel.
          </p>
        </header>

        <form
          className="spell-create"
          onSubmit={(e) => {
            e.preventDefault();
            createSpell();
          }}
        >
          <input
            className="spell-input"
            placeholder="New spell name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="New spell name"
          />
          <button
            className="spell-btn primary"
            type="submit"
            disabled={!newName.trim() || busy}
          >
            New spell
          </button>
        </form>

        {loading ? (
          <div className="spells-empty">Loading spells…</div>
        ) : spells.length === 0 ? (
          <div className="spells-empty">
            No spells yet. Name one above and hit “New spell” to get started.
          </div>
        ) : (
          <ul className="spell-list">
            {spells.map((s) => (
              <li key={s.id} className="spell-card">
                <Link
                  className="spell-card-main"
                  href={`/studio/spells/${encodeURIComponent(s.id)}`}
                >
                  <span className="spell-card-name">{s.name || s.id}</span>
                  <span className="spell-card-meta">
                    <span className="spell-tag">{animLabel(s.animationKey)}</span>
                    <span className="spell-stat">PWR {s.power}</span>
                    <span className="spell-stat">CD {s.cooldown}s</span>
                  </span>
                </Link>
                <button
                  className="spell-btn danger"
                  onClick={() => removeSpell(s.id)}
                  aria-label={`Delete ${s.name || s.id}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
