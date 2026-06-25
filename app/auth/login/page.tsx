"use client";

import { useState, useEffect, FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "@/lib/firebase-client";
import { Jersey_25 } from "next/font/google";

const fontTitle = Jersey_25({ weight: "400", subsets: ["latin"], display: "swap" });

// ─── static styles injected once ──────────────────────────────────────────────
const ANIMATION_STYLES = `
@keyframes login-float {
  0%, 100% { transform: translateY(0) scale(1); opacity: 0; }
  10% { opacity: 0.8; }
  90% { opacity: 0.4; }
  50% { transform: translateY(-60px) scale(1.1); opacity: 0.9; }
}
@keyframes login-float-slow {
  0%, 100% { transform: translateY(0) translateX(0); opacity: 0; }
  15% { opacity: 0.5; }
  85% { opacity: 0.3; }
  50% { transform: translateY(-80px) translateX(10px); opacity: 0.6; }
}
@keyframes login-pulse-glow {
  0%, 100% { box-shadow: 0 0 18px rgba(59,130,246,0.25), 0 0 40px rgba(59,130,246,0.08); }
  50% { box-shadow: 0 0 28px rgba(59,130,246,0.45), 0 0 60px rgba(59,130,246,0.15); }
}
@keyframes login-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes login-draw {
  to { stroke-dashoffset: 0; }
}
.lp-particle { position: absolute; border-radius: 50%; pointer-events: none; }
.lp-err-shake { animation: login-shake 0.3s ease; }
@keyframes login-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
`;

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  // Inject animation keyframes once
  useEffect(() => {
    const id = "login-anim-style";
    if (!document.getElementById(id)) {
      const s = document.createElement("style");
      s.id = id;
      s.textContent = ANIMATION_STYLES;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/auth/campaigns");
    });
    return unsub;
  }, [router]);

  // Shake error box on new error
  useEffect(() => {
    if (error && errRef.current) {
      errRef.current.classList.remove("lp-err-shake");
      // force reflow
      void errRef.current.offsetWidth;
      errRef.current.classList.add("lp-err-shake");
    }
  }, [error]);

  async function initUser() {
    const idToken = await auth.currentUser?.getIdToken();
    if (idToken) {
      const decoded = JSON.parse(atob(idToken.split(".")[1]));
      await fetch("/api/user/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: decoded.sub }),
      });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      await initUser();
      router.replace("/auth/campaigns");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse at 20% 30%, #0f1a2e 0%, #080b12 60%, #05070a 100%)",
        color: "#c8d6e5",
        fontFamily: "system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
        padding: 16,
      }}
    >
      {/* ── floating particles (CSS only) ── */}
      <div
        className="lp-particle"
        style={{
          width: 3,
          height: 3,
          background: "#3b82f6",
          top: "22%",
          left: "12%",
          animation: "login-float 6s ease-in-out infinite",
          animationDelay: "0s",
          opacity: 0,
        }}
      />
      <div
        className="lp-particle"
        style={{
          width: 2,
          height: 2,
          background: "#60a5fa",
          top: "65%",
          left: "8%",
          animation: "login-float-slow 8s ease-in-out infinite",
          animationDelay: "1.2s",
          opacity: 0,
        }}
      />
      <div
        className="lp-particle"
        style={{
          width: 4,
          height: 4,
          background: "#93c5fd",
          top: "35%",
          right: "14%",
          animation: "login-float 7s ease-in-out infinite",
          animationDelay: "0.6s",
          opacity: 0,
        }}
      />
      <div
        className="lp-particle"
        style={{
          width: 2,
          height: 2,
          background: "#3b82f6",
          top: "75%",
          right: "10%",
          animation: "login-float-slow 9s ease-in-out infinite",
          animationDelay: "2.4s",
          opacity: 0,
        }}
      />
      <div
        className="lp-particle"
        style={{
          width: 3,
          height: 3,
          background: "#60a5fa",
          top: "50%",
          left: "5%",
          animation: "login-float 10s ease-in-out infinite",
          animationDelay: "3s",
          opacity: 0,
        }}
      />
      <div
        className="lp-particle"
        style={{
          width: 1.5,
          height: 1.5,
          background: "#93c5fd",
          top: "18%",
          right: "22%",
          animation: "login-float 5.5s ease-in-out infinite",
          animationDelay: "0.3s",
          opacity: 0,
        }}
      />

      {/* ── subtle radial glow orbs ── */}
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
          top: "10%",
          left: "5%",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(147,197,253,0.04) 0%, transparent 70%)",
          bottom: "5%",
          right: "0%",
          pointerEvents: "none",
        }}
      />

      {/* ── main card ── */}
      <form
        onSubmit={handleSubmit}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 380,
          background:
            "linear-gradient(160deg, rgba(20,24,34,0.92) 0%, rgba(14,17,26,0.96) 100%)",
          borderRadius: 18,
          padding: "40px 28px 32px",
          border: "1px solid rgba(59,130,246,0.15)",
          animation: "login-pulse-glow 4s ease-in-out infinite",
          backdropFilter: "blur(4px)",
        }}
      >
        {/* ── decorative top accent line ── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "20%",
            right: "20%",
            height: 2,
            background:
              "linear-gradient(90deg, transparent 0%, #3b82f6 40%, #93c5fd 60%, transparent 100%)",
            borderRadius: "0 0 2px 2px",
          }}
        />

        {/* ── brand header ── */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 34,
              lineHeight: 1,
              letterSpacing: "0.04em",
              color: "#e8edf5",
              fontFamily: fontTitle.style.fontFamily,
              textShadow: "0 0 20px rgba(59,130,246,0.3)",
            }}
          >
            KNIGHT &amp; DUNGEON
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              marginTop: 8,
              fontSize: 12,
              color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ opacity: 0.5 }}>✦</span>
            <span style={{ letterSpacing: "0.16em" }}>Hex &amp; Blade</span>
            <span style={{ opacity: 0.5 }}>✦</span>
          </div>
        </div>

        {/* ── decorative dividers with icon ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 1,
              background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.25))",
            }}
          />
          <span style={{ fontSize: 16, color: "rgba(59,130,246,0.4)" }}>⚔</span>
          <div
            style={{
              flex: 1,
              height: 1,
              background: "linear-gradient(90deg, rgba(59,130,246,0.25), transparent)",
            }}
          />
        </div>

        {/* ── form title ── */}
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 20,
            fontWeight: 700,
            color: "#e8edf5",
            textAlign: "center",
            letterSpacing: "0.01em",
          }}
        >
          {isSignUp ? "Create Account" : "Sign In"}
        </h2>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13,
            color: "rgba(255,255,255,0.35)",
            textAlign: "center",
          }}
        >
          {isSignUp
            ? "Forge your path in the dark"
            : "Return to the battlefield"}
        </p>

        {/* ── error display ── */}
        {error && (
          <div
            ref={errRef}
            style={{
              background: "rgba(180,40,40,0.15)",
              border: "1px solid rgba(255,80,80,0.35)",
              boxShadow: "0 0 12px rgba(255,80,80,0.1), inset 0 0 12px rgba(255,80,80,0.04)",
              color: "#ff8a8a",
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 20,
              fontSize: 13,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}

        {/* ── email ── */}
        <label
          style={{
            display: "block",
            marginBottom: 6,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          ✦ Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="adventurer@realm.com"
          style={{
            width: "100%",
            padding: "12px 14px",
            marginBottom: 18,
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.12)",
            background: "rgba(0,0,0,0.35)",
            color: "#c8d6e5",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "rgba(59,130,246,0.5)";
            e.target.style.boxShadow = "0 0 14px rgba(59,130,246,0.1), inset 0 0 10px rgba(59,130,246,0.04)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "rgba(59,130,246,0.12)";
            e.target.style.boxShadow = "none";
          }}
        />

        {/* ── password ── */}
        <label
          style={{
            display: "block",
            marginBottom: 6,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          ✦ Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="············"
          style={{
            width: "100%",
            padding: "12px 14px",
            marginBottom: 24,
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.12)",
            background: "rgba(0,0,0,0.35)",
            color: "#c8d6e5",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "rgba(59,130,246,0.5)";
            e.target.style.boxShadow = "0 0 14px rgba(59,130,246,0.1), inset 0 0 10px rgba(59,130,246,0.04)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "rgba(59,130,246,0.12)";
            e.target.style.boxShadow = "none";
          }}
        />

        {/* ── submit button ── */}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: 10,
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            background:
              "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #60a5fa 100%)",
            backgroundSize: "200% auto",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "0.03em",
            position: "relative",
            overflow: "hidden",
            transition: "transform 0.12s, box-shadow 0.2s",
            boxShadow:
              "0 4px 20px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
            animation: busy ? "none" : "login-shimmer 3s linear infinite",
            opacity: busy ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!busy) {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow =
                "0 6px 28px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.2)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow =
              "0 4px 20px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.15)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "translateY(1px)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
        >
          {busy ? (
            <span style={{ opacity: 0.8 }}>Preparing…</span>
          ) : isSignUp ? (
            "✦  Create Account"
          ) : (
            "⚔  Enter the Realm"
          )}
        </button>

        {/* ── toggle ── */}
        <div
          style={{
            textAlign: "center",
            marginTop: 22,
            fontSize: 13,
            color: "rgba(255,255,255,0.35)",
          }}
        >
          {isSignUp ? (
            <>
              Already sworn your oath?{" "}
              <span
                onClick={() => {
                  setIsSignUp(false);
                  setError("");
                }}
                style={{
                  color: "#60a5fa",
                  cursor: "pointer",
                  fontWeight: 600,
                  transition: "color 0.15s",
                  borderBottom: "1px solid transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#93c5fd";
                  e.currentTarget.style.borderBottomColor = "rgba(147,197,253,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#60a5fa";
                  e.currentTarget.style.borderBottomColor = "transparent";
                }}
              >
                Sign in
              </span>
            </>
          ) : (
            <>
              No oath yet?{" "}
              <span
                onClick={() => {
                  setIsSignUp(true);
                  setError("");
                }}
                style={{
                  color: "#60a5fa",
                  cursor: "pointer",
                  fontWeight: 600,
                  transition: "color 0.15s",
                  borderBottom: "1px solid transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#93c5fd";
                  e.currentTarget.style.borderBottomColor = "rgba(147,197,253,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#60a5fa";
                  e.currentTarget.style.borderBottomColor = "transparent";
                }}
              >
                Swear an oath
              </span>
            </>
          )}
        </div>

        {/* ── bottom decorative rune line ── */}
        <div
          style={{
            marginTop: 28,
            textAlign: "center",
            fontSize: 10,
            letterSpacing: "0.2em",
            color: "rgba(255,255,255,0.1)",
          }}
        >
          ◆  ◇  ◆  ◇  ◆
        </div>
      </form>
    </div>
  );
}
