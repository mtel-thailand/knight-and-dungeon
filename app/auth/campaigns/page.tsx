"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthGuard";

type Campaign = {
  id: string;
  name: string;
  waveCount: number;
  monsterPool: string[];
  isActive: boolean;
};

export default function CampaignListPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const list: Campaign[] = data.campaigns ?? [];
        setCampaigns(list);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function startCampaign(c: Campaign) {
    router.push(`/g/camp`);
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0d14", color: "#c8d6e5",
      fontFamily: "system-ui, sans-serif", padding: 40,
    }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, color: "#e8edf5", margin: 0 }}>Campaigns</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "#8899aa" }}>{user?.email}</span>
            <button onClick={signOut} style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid #3a4555",
              background: "transparent", color: "#8899aa", cursor: "pointer", fontSize: 13,
            }}>Sign out</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#556677" }}>Loading…</div>
        ) : campaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#556677" }}>
            No campaigns found.{/* <br/><span style={{fontSize:13}}>Create one in the studio.</span> */}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {campaigns.map((c) => (
              <div key={c.id} onClick={() => startCampaign(c)} style={{
                background: "#141822", borderRadius: 10, padding: "16px 20px", cursor: "pointer",
                border: c.isActive ? "1px solid #3b82f6" : "1px solid #1e2535",
                transition: "border-color 0.15s",
              }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#e8edf5", marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "#667788" }}>
                  {c.waveCount} waves · {c.monsterPool.length} monster types
                  {c.isActive ? <span style={{ color: "#3b82f6", marginLeft: 8 }}>● Active</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
