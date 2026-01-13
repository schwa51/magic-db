"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/collection";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) setMsg(error.message);
    else router.push(next);
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Login</h1>
      <form onSubmit={signIn} style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          autoComplete="current-password"
        />
        <button disabled={loading} type="submit">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
