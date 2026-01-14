"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/client";

type ScryfallCard = {
  id: string; // scryfall_id
  name: string;
  oracle_id?: string;
  scryfall_uri?: string;
};

type Allocation = {
  id: string;
  qty: number;
  deck_id: string | null;
  decks: { id: string; name: string } | null;
};

type CollectionRow = {
  id: string;
  card_id: string;
  qty: number;
  cards: {
    id: string;
    name: string;
    scryfall_uri: string | null;
  } | null;
  allocations?: Allocation[];
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

  // Allocation UI state
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([]);
  const [allocDeckByRow, setAllocDeckByRow] = useState<Record<string, string>>({});
  const [allocQtyByRow, setAllocQtyByRow] = useState<Record<string, number>>({});

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);

      // decks for dropdown
      const { data: deckData, error: deckErr } = await supabase
        .from("decks")
        .select("id, name")
        .order("name", { ascending: true });

      if (!deckErr) setDecks(deckData ?? []);

      await refreshCollection();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCollection() {
  setMsg(null);
  setLoadingCollection(true);

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    setLoadingCollection(false);
    setMsg("Not logged in.");
    return;
  }

  // 1) Load collection (with card info)
  const { data: colData, error: colErr } = await supabase
    .from("collection")
    .select("id, card_id, qty, cards:card_id ( id, name, scryfall_uri )")
    .order("updated_at", { ascending: false });

  if (colErr) {
    setLoadingCollection(false);
    setMsg("Load error: " + colErr.message);
    return;
  }

  const cardIds = (colData ?? []).map((r) => r.card_id).filter(Boolean);

  // 2) Load allocations for JUST those cards (with deck name)
  // Note: if cardIds is empty, skip the second query.
  let allocData: any[] = [];
  if (cardIds.length > 0) {
    const { data: aData, error: aErr } = await supabase
      .from("allocations")
      .select("id, qty, card_id, deck_id, decks:deck_id ( id, name )")
      .eq("user_id", user.id)
      .in("card_id", cardIds);

    if (aErr) {
      setLoadingCollection(false);
      setMsg("Load allocations error: " + aErr.message);
      return;
    }
    allocData = aData ?? [];
  }

  // 3) Group allocations by card_id
  const allocByCardId = new Map<string, Allocation[]>();
  for (const a of allocData) {
    const arr = allocByCardId.get(a.card_id) ?? [];
    arr.push({
      id: a.id,
      qty: a.qty,
      deck_id: a.deck_id,
      decks: a.decks ?? null,
    });
    allocByCardId.set(a.card_id, arr);
  }

  // 4) Merge into collection rows
  const merged = (colData ?? []).map((r: any) => ({
    ...r,
    allocations: allocByCardId.get(r.card_id) ?? [],
  }));

  setCollection(merged as any);
  setLoadingCollection(false);
}


  function exportCollectionCSV() {
    const lines = ["qty,name"];
    for (const row of collection) {
      const name = row.cards?.name ?? "";
      const qty = row.qty ?? 0;
      lines.push(`${qty},"${name.replace(/"/g, '""')}"`);
    }
    const csv = lines.join("\n") + "\n";

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collection.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
async function removeAllocation(allocationId: string) {
  setMsg(null);

  const { error } = await supabase.from("allocations").delete().eq("id", allocationId);

  if (error) {
    setMsg("Unassign error: " + error.message);
    return;
  }

  setMsg("Unassigned.");
  await refreshCollection();
}
function allocatedTotal(row: CollectionRow) {
  return (row.allocations ?? []).reduce((sum, a) => sum + a.qty, 0);
}

async function setCollectionQty(
  supabase: ReturnType<typeof supabaseBrowser>,
  row: CollectionRow,
  nextQty: number
) {
  const minQty = allocatedTotal(row);

  // clamp + validate
  if (!Number.isFinite(nextQty)) return;
  nextQty = Math.max(0, Math.floor(nextQty));

  if (nextQty < minQty) {
    throw new Error(`You have ${minQty} allocated to decks.`);
  }

  if (nextQty === 0) {
    const { error } = await supabase.from("collection").delete().eq("id", row.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("collection")
    .update({ qty: nextQty })
    .eq("id", row.id);

  if (error) throw error;
}

  async function upsertAllocation(row: CollectionRow) {
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return;

    const deck_id = allocDeckByRow[row.id];
    const qtyToAllocate = Number(allocQtyByRow[row.id] ?? 0);

    if (!deck_id) {
      setMsg("Choose a deck first.");
      return;
    }
    if (!Number.isFinite(qtyToAllocate) || qtyToAllocate <= 0) {
      setMsg("Enter a quantity > 0.");
      return;
    }

    const allocated = (row.allocations ?? []).reduce((a, x) => a + (x.qty ?? 0), 0);
    const available = row.qty - allocated;

    if (qtyToAllocate > available) {
      setMsg(`Not enough available. Available: ${available}.`);
      return;
    }

    const existing = (row.allocations ?? []).find((a) => a.deck_id === deck_id);

    if (!existing) {
      const { error } = await supabase.from("allocations").insert({
        user_id: user.id,
        card_id: row.card_id,
        deck_id,
        qty: qtyToAllocate,
      });
      if (error) {
        setMsg("Allocation insert error: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("allocations")
        .update({ qty: existing.qty + qtyToAllocate })
        .eq("id", existing.id);

      if (error) {
        setMsg("Allocation update error: " + error.message);
        return;
      }
    }

    setMsg("Allocated.");
    await refreshCollection();
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

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
function QtyCell({ row }: { row: CollectionRow }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [draft, setDraft] = useState<number>(row.qty);

  useEffect(() => setDraft(row.qty), [row.qty]);

  const minQty = allocatedTotal(row);

  return (
    <input
      type="number"
      min={minQty}          // prevents typing below allocations in most browsers
      step={1}
      value={draft}
      onChange={(e) => setDraft(Number(e.target.value))}
      onBlur={async () => {
        try {
          await setCollectionQty(supabase, row, draft);
        } catch (e: any) {
          alert(e?.message ?? "Could not update quantity.");
          setDraft(row.qty); // revert UI
        }
      }}
    />
  );
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
          <button className="border rounded px-3 py-2" onClick={runSearch} disabled={!canSearch || searching}>
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

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your collection</h2>
        <button className="border rounded px-3 py-2" onClick={exportCollectionCSV}>
          Export collection (CSV)
        </button>
      </div>

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
                <th className="text-left p-2 w-24">Owned</th>
                <th className="text-left p-2 w-28">Allocated</th>
                <th className="text-left p-2 w-28">Available</th>
                <th className="text-left p-2 w-80">Locations</th>
                <th className="text-left p-2 w-56">Allocate</th>
              </tr>
            </thead>

            <tbody>
              {collection.map((row) => {
                const allocated = (row.allocations ?? []).reduce((a, x) => a + (x.qty ?? 0), 0);
                const available = Math.max(0, row.qty - allocated);

                return (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">
                      {row.cards?.scryfall_uri ? (
                        <a className="underline" href={row.cards.scryfall_uri} target="_blank" rel="noreferrer">
                          {row.cards.name}
                        </a>
                      ) : (
                        row.cards?.name ?? "(unknown)"
                      )}
                    </td>

                    <td className="p-2">{row.qty}</td>
                    <td className="p-2">{allocated}</td>
                    <td className="p-2 font-semibold">{available}</td>

                    <td className="p-2">
                      {(row.allocations ?? []).length === 0 ? (
                        <span className="opacity-70">Unassigned</span>
                      ) : (
                        <ul className="space-y-1">
                          {(row.allocations ?? []).map((a) => (
  <li key={a.id} className="text-sm flex items-center justify-between gap-2">
    <span>
      {a.qty} in <strong>{a.decks?.name ?? "(unknown deck)"}</strong>
    </span>
    <button
      className="border rounded px-2 py-0.5 text-xs"
      onClick={() => removeAllocation(a.id)}
      title="Remove this allocation (makes those copies available again)"
    >
      Unassign
    </button>
  </li>
))}

                        </ul>
                      )}
                    </td>

                    <td className="p-2">
                      <div className="flex gap-2 items-center">
                        <select
                          className="border rounded px-2 py-1"
                          value={allocDeckByRow[row.id] ?? ""}
                          onChange={(e) =>
                            setAllocDeckByRow((p) => ({ ...p, [row.id]: e.target.value }))
                          }
                        >
                          <option value="">Choose deck…</option>
                          {decks.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>

                        <input
                          className="border rounded px-2 py-1 w-20"
                          type="number"
                          min={1}
                          value={allocQtyByRow[row.id] ?? 1}
                          onChange={(e) =>
                            setAllocQtyByRow((p) => ({ ...p, [row.id]: Number(e.target.value) }))
                          }
                        />

                        <button className="border rounded px-2 py-1" onClick={() => upsertAllocation(row)}>
                          Allocate
                        </button>
                                              </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
      )}

      <p className="mt-6 text-sm opacity-70">User: {userId ?? "(unknown)"}</p>
    </main>
  );
}
