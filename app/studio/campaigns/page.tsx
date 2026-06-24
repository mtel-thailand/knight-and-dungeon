"use client";

// /studio/campaigns — LIST page for the campaign CMS.
// Reads everything from GET /api/config (returns `campaigns` + `characters`).
// Create is inline (name → slugify → unique id → POST /api/config/campaign
// with defaults). Per-row Set Active toggles the single active campaign;
// Delete removes it via DELETE /api/config/campaign. Mutations re-fetch to
// reconcile with the server.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CampaignDef } from "@/lib/battle/types";
import { slugify } from "../studioHelpers";
import type { BootstrapPayload } from "../studioTypes";
import { CAMPAIGNS_PAGE_CSS } from "./campaignsStyles";

export default function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<CampaignDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data: BootstrapPayload = await res.json();
        setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
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

  function uniqueId(base: string): string {
    if (!campaigns.some((c) => c.id === base)) return base;
    let n = 2;
    while (campaigns.some((c) => c.id === `${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async function createCampaign() {
    const name = newName.trim();
    if (!name || busy) return;
    const campaign: CampaignDef = {
      id: uniqueId(slugify(name, "campaign")),
      name,
      waveCount: 1,
      monsterPool: [],
      isActive: false,
    };
    setBusy(true);
    setCampaigns((prev) => [...prev, campaign]); // optimistic
    setNewName("");
    try {
      await fetch("/api/config/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign }),
      });
    } catch {
      /* reconciled by load() below */
    } finally {
      setBusy(false);
      load();
    }
  }

  async function setActive(id: string) {
    try {
      await fetch("/api/config/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeId: id }),
      });
    } catch {
      /* reconciled by load() below */
    } finally {
      load();
    }
  }

  async function removeCampaign(id: string) {
    setCampaigns((prev) => prev.filter((c) => c.id !== id)); // optimistic
    try {
      await fetch(`/api/config/campaign?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* reconciled by load() below */
    } finally {
      load();
    }
  }

  return (
    <div className="campaigns-page">
      <style>{CAMPAIGNS_PAGE_CSS}</style>

      <nav className="menu-bar">
        <Link className="menu-bar-item" href="/studio">
          Studio
        </Link>
        <Link className="menu-bar-item" href="/studio/spells">
          Spells
        </Link>
        <span className="menu-bar-item is-current" aria-current="page">
          Campaigns
        </span>
        <Link className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
        </Link>
        <Link className="menu-bar-item" href="/g/camp">
          Play
        </Link>
      </nav>

      <div className="campaigns-wrap">
        <header className="campaigns-head">
          <h1 className="campaigns-title">Campaigns</h1>
          <p className="campaigns-sub">
            Wave-based campaign definitions — configure monster pools and wave
            counts for the battle mode.
          </p>
        </header>

        <form
          className="campaign-create"
          onSubmit={(e) => {
            e.preventDefault();
            createCampaign();
          }}
        >
          <input
            className="campaign-input"
            placeholder="New campaign name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="New campaign name"
          />
          <button
            className="campaign-btn primary"
            type="submit"
            disabled={!newName.trim() || busy}
          >
            New campaign
          </button>
        </form>

        {loading ? (
          <div className="campaigns-empty">Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div className="campaigns-empty">
            No campaigns yet. Name one above and hit &ldquo;New campaign&rdquo;
            to get started.
          </div>
        ) : (
          <ul className="campaign-list">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className={
                  "campaign-card" + (c.isActive ? " active" : "")
                }
              >
                <Link
                  className="campaign-card-main"
                  href={`/studio/campaigns/${encodeURIComponent(c.id)}`}
                >
                  <span className="campaign-card-name">
                    {c.name || c.id}
                  </span>
                  <span className="campaign-card-meta">
                    {c.isActive ? (
                      <span className="campaign-tag active-tag">Active</span>
                    ) : null}
                    <span className="campaign-tag">
                      {c.waveCount} wave{c.waveCount !== 1 ? "s" : ""}
                    </span>
                    <span className="campaign-stat">
                      {c.monsterPool.length} monster
                      {c.monsterPool.length !== 1 ? "s" : ""}
                    </span>
                  </span>
                </Link>
                <button
                  className="campaign-btn"
                  onClick={() => setActive(c.id)}
                  disabled={c.isActive}
                  aria-label={
                    c.isActive
                      ? `${c.name || c.id} is active`
                      : `Set ${c.name || c.id} as active`
                  }
                >
                  {c.isActive ? "Active" : "Set active"}
                </button>
                {c.isActive ? (
                  <Link className="campaign-btn" href="/g/camp">
                    ▶ Play
                  </Link>
                ) : null}
                <button
                  className="campaign-btn danger"
                  onClick={() => removeCampaign(c.id)}
                  aria-label={`Delete ${c.name || c.id}`}
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
