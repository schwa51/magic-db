"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/client";

export default function TestPage() {
  const [msg, setMsg] = useState("Running test…");

  useEffect(() => {
    async function run() {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // Show just enough to debug safely
      console.log("SUPABASE_URL:", url);
      console.log("SUPABASE_KEY_PREFIX:", key?.slice(0, 10));

      if (!url || !key) {
        setMsg("Missing env vars. Check .env.local is in the project root and restart dev server.");
        return;
      }

      try {
        const supabase = supabaseBrowser();
        const { data, error } = await supabase.from("cards").select("id").limit(1);

        if (error) setMsg("Supabase error: " + error.message);
        else setMsg(`Success! Read ${data.length} row(s) from cards.`);
      } catch (e: any) {
        setMsg("Supabase error: " + (e?.message ?? String(e)));
      }
    }

    run();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Supabase Test</h1>
      <p>{msg}</p>
      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
        Check the browser console for SUPABASE_URL and KEY_PREFIX.
      </p>
    </main>
  );
}
