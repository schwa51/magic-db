"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/client";

type ScryfallCard = {
  id: string; // scryfall_id
  name: string;
  oracle_id?: string;
  scryfall_uri?: string;
};

type CollectionRow = {
  id: string; // collection.id
  qty: number;
  cards: {
    id: string; // cards.id (uuid)
    name: string;
    scryfall_uri: string | null;
  } | null;
};

export default function CollectionPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [userId, setUserId] = useState<string | null>(null);

  // Scryfall search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);

  // Collection list
  const [collection, setCollection] = useState<CollectionRow[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);

  const canSearch = query.trim().length >= 2;

  useEffect(() => {
    async function init() {
      // get user
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);

      // load collection
      await refreshCollection();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCollection() {
    setMsg(null);
    setLoadingCollection(true);

    const { data, error } = await supabase
      .from("collection")
      .select("id, qty, cards:card_id ( id, name, scryfall_uri )")
      .order("updated_at", { ascending: false });

    setLoadingCollection(false);

    if (error) {
      setMsg("Load error: " + error.message);
      return;
    }
    setCollection((data ?? []) as any);
  }

  async function runSearch() {
    setMsg(null);
    if (!canSearch) return;

    setSearching(true);
    try {
      const r = await fetch(`/api/scryfall/search?q=${encodeURIComponent(query.trim())}`);
      const data = await r.json();

      if (!r.ok) throw new Error(data?.details || data?.error || "Search failed");

      const cards = (data.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        oracle_id: c.oracle_id,
        scryfall_uri: c.scryfall_uri,
      })) as ScryfallCard[];

      setResults(cards.slice(0, 25));
    } catch (e: any) {
      setMsg(e?.message ?? "Search error");
    } finally {
      setSearching(false);
    }
  }

  async function addToCollection(card: ScryfallCard, qtyToAdd: number) {
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setMsg("Not logged in.");
      return;
    }

    // 1) upsert card reference into cards table
    const { data: cardRow, error: cardErr } = await supabase
      .from("cards")
      .upsert(
        {
          scryfall_id: card.id,
          name: card.name,
          oracle_id: card.oracle_id ?? null,
          scryfall_uri: card.scryfall_uri ?? null,
        },
        { onConflict: "scryfall_id" }
      )
      .select("id")
      .single();

    if (cardErr) {
      setMsg("DB error (cards): " + cardErr.message);
      return;
    }

    const card_id = cardRow.id;

    // 2) read existing collection row (RLS will ensure it's only yours)
    const { data: existing, error: readErr } = await supabase
      .from("collection")
      .select("id, qty")
      .eq("user_id", user.id)
      .eq("card_id", card_id)
      .maybeSingle();

    if (readErr) {
      setMsg("DB error (collection read): " + readErr.message);
      return;
    }

    if (!existing) {
      const { error: insErr } = await supabase
        .from("collection")
        .insert({ user_id: user.id, card_id, qty: qtyToAdd });

      if (insErr) setMsg("DB error (collection insert): " + insErr.message);
      else setMsg(`Added ${qtyToAdd} × ${card.name}`);
    } else {
      const { error: updErr } = await supabase
        .from("collection")
        .update({ qty: existing.qty + qtyToAdd })
        .eq("id", existing.id);

      if (updErr) setMsg("DB error (collection update): " + updErr.message);
      else setMsg(`Updated ${card.name} (+${qtyToAdd})`);
    }

    await refreshCollection();
  }

  async function setQty(rowId: string, newQty: number) {
    setMsg(null);
    if (newQty < 0) return;

    if (newQty === 0) {
      // delete row
      const { error } = await supabase.from("collection").delete().eq("id", rowId);
      if (error) setMsg("Delete error: " + error.message);
      else setMsg("Removed from collection.");
      await refreshCollection();
      return;
    }

    const { error } = await supabase.from("collection").update({ qty: newQty }).eq("id", rowId);
    if (error) setMsg("Update error: " + error.message);
    else setMsg("Quantity updated.");
    await refreshCollection();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Collection</h1>
        <button className="border px-3 py-1 rounded" onClick={logout}>
          Log out
        </button>
      </div>

      <div className="mt-4 border rounded p-4">
        <div className="font-semibold">Add cards (Scryfall search)</div>
        <div className="mt-2 flex gap-2">
          <input
            className="border rounded px-3 py-2 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search (e.g., Lightning Bolt)"
          />
          <button
            className="border rounded px-3 py-2"
            onClick={runSearch}
            disabled={!canSearch || searching}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <ul className="mt-3 space-y-2">
            {results.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {c.scryfall_uri ? (
                    <a className="underline" href={c.scryfall_uri} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <div className="flex gap-2 shrink-0">
                  <button className="border rounded px-2 py-1" onClick={() => addToCollection(c, 1)}>
                    +1
                  </button>
                  <button className="border rounded px-2 py-1" onClick={() => addToCollection(c, 4)}>
                    +4
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p className="mt-4">{msg}</p>}

      <div className="mt-6">
        <h2 className="text-xl font-semibold">Your collection</h2>

        {loadingCollection ? (
          <p className="mt-2">Loading…</p>
        ) : collection.length === 0 ? (
          <p className="mt-2">No cards yet. Add something above.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Card</th>
                  <th className="text-left p-2 w-32">Qty</th>
                  <th className="text-left p-2 w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {collection.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">
                      {row.cards?.scryfall_uri ? (
                        <a className="underline" href={row.cards.scryfall_uri} target="_blank" rel="noreferrer">
                          {row.cards.name}
                        </a>
                      ) : (
                        row.cards?.name ?? "(missing card ref)"
                      )}
                    </td>
                    <td className="p-2">{row.qty}</td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <button className="border rounded px-2 py-1" onClick={() => setQty(row.id, row.qty + 1)}>
                          +1
                        </button>
                        <button
                          className="border rounded px-2 py-1"
                          onClick={() => setQty(row.id, Math.max(0, row.qty - 1))}
                        >
                          -1
                        </button>
                        <button className="border rounded px-2 py-1" onClick={() => setQty(row.id, 0)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-6 text-sm opacity-70">User: {userId ?? "(unknown)"}</p>
    </main>
  );
}
