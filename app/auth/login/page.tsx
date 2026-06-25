"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { auth, signInWithEmailAndPassword, onAuthStateChanged } from "@/lib/firebase-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/auth/campaigns");
    });
    return unsub;
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/auth/campaigns");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0a0d14", color: "#c8d6e5", fontFamily: "system-ui, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "#141822", padding: 40, borderRadius: 12, width: 360,
        boxShadow: "0 0 40px rgba(0,0,0,0.5)",
      }}>
        <h1 style={{ margin: "0 0 24px", fontSize: 24, color: "#e8edf5" }}>Sign in</h1>

        {error && (
          <div style={{ background: "#2a1515", color: "#ff6b6b", padding: "8px 12px", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}

        <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#8899aa" }}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          style={{ width: "100%", padding: "10px 12px", marginBottom: 16, borderRadius: 6, border: "1px solid #2a3040",
            background: "#0d1018", color: "#c8d6e5", fontSize: 15, outline: "none", boxSizing: "border-box" }} />

        <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#8899aa" }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", padding: "10px 12px", marginBottom: 24, borderRadius: 6, border: "1px solid #2a3040",
            background: "#0d1018", color: "#c8d6e5", fontSize: 15, outline: "none", boxSizing: "border-box" }} />

        <button type="submit" disabled={busy} style={{
          width: "100%", padding: "12px", borderRadius: 6, border: "none", cursor: busy ? "not-allowed" : "pointer",
          background: busy ? "#2a5a8a" : "#3b82f6", color: "#fff", fontSize: 16, fontWeight: 600,
        }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
