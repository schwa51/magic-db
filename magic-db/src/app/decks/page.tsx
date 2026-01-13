"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/client";
import Link from "next/link";

type Deck = {
  id: string;
  name: string;
  format: string | null;
  is_template: boolean;
  created_at: string;
};

export default function DecksPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("");
  const [isTemplate, setIsTemplate] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from("decks")
      .select("id, name, format, is_template, created_at")
      .order("created_at", { ascending: false });

    setLoading(false);

    if (error) setMsg("Load error: " + error.message);
    else setDecks((data ?? []) as any);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDeck(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setMsg("Not logged in.");
      return;
    }

    const deckName = name.trim();
    if (!deckName) {
      setMsg("Deck name required.");
      return;
    }

    const { error } = await supabase.from("decks").insert({
      user_id: user.id,
      name: deckName,
      format: format.trim() || null,
      is_template: isTemplate,
    });

    if (error) setMsg("Create error: " + error.message);
    else {
      setName("");
      setFormat("");
      setIsTemplate(false);
      await refresh();
    }
  }

  return (
    <main className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Decks</h1>

      <form onSubmit={createDeck} className="mt-4 border rounded p-4 space-y-3">
        <div className="font-semibold">Create a deck</div>

        <div className="grid gap-2">
          <input
            className="border rounded px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Deck name"
          />
          <input
            className="border rounded px-3 py-2"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="Format (optional: Commander, Modern, etc.)"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isTemplate}
              onChange={(e) => setIsTemplate(e.target.checked)}
            />
            Template decklist (not necessarily built)
          </label>
        </div>

        <button className="border rounded px-3 py-2" type="submit">
          Create
        </button>

        {msg && <p>{msg}</p>}
      </form>

      <div className="mt-6">
        <h2 className="text-xl font-semibold">Your decks</h2>

        {loading ? (
          <p className="mt-2">Loading…</p>
        ) : decks.length === 0 ? (
          <p className="mt-2">No decks yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {decks.map((d) => (
              <li key={d.id} className="border rounded p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    <Link className="underline" href={`/decks/${d.id}`}>
                      {d.name}
                    </Link>
                    {d.is_template ? <span className="ml-2 text-sm opacity-70">(template)</span> : null}
                  </div>
                  {d.format ? <div className="text-sm opacity-70">{d.format}</div> : null}
                </div>
                <Link className="border rounded px-3 py-2" href={`/decks/${d.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
