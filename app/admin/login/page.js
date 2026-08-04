"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Incorrect password.");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1 style={{ fontSize: "1.3rem", marginBottom: 6 }}>Admin sign in</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: ".88rem", marginBottom: 18 }}>
          AED Readiness Campaign submissions
        </p>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && (
          <p style={{ color: "var(--notready)", fontSize: ".85rem", marginTop: 10 }}>{error}</p>
        )}
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
