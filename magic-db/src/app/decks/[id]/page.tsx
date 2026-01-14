"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "../../../lib/supabase/client";

type ScryfallCard = {
  id: string; // scryfall_id
  name: string;
  oracle_id?: string;
  scryfall_uri?: string;
};

type Deck = {
  id: string;
  name: string;
  format: string | null;
  is_template: boolean;
};

type DeckCardRow = {
  id: string; // deck_cards.id
  qty: number;
  board: string;
  cards: {
    id: string; // cards.id (uuid)
    name: string;
    scryfall_uri: string | null;
  } | null;
};

type NeededRow = {
  cardName: string;
  scryfallUri: string | null;
  needed: number;
  owned: number;
  missing: number;
};

export default function DeckDetailPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const params = useParams();
  const deckId = String(params.id);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [rows, setRows] = useState<DeckCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const canSearch = query.trim().length >= 2;

  const mainRows = rows.filter((r) => r.board === "main");
  const sideRows = rows.filter((r) => r.board === "side");

  const mainTotal = mainRows.reduce((a, r) => a + r.qty, 0);
  const sideTotal = sideRows.reduce((a, r) => a + r.qty, 0);

  const [needed, setNeeded] = useState<NeededRow[]>([]);
  const [buildSummary, setBuildSummary] = useState<{ ok: boolean; missingTotal: number } | null>(null);

  const [importText, setImportText] = useState("");
  const [importBoardDefault, setImportBoardDefault] = useState<"main" | "side">("main");

  async function computeBuildability(currentRows: DeckCardRow[]) {
  setMsg(null);

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return;

  // Map deck needs by card_id (main+side combined for now)
  const needByCardId = new Map<string, { needed: number; name: string; uri: string | null }>();

  for (const r of currentRows) {
    const cardId = r.cards?.id;
    if (!cardId) continue;

    const prev = needByCardId.get(cardId);
    needByCardId.set(cardId, {
      needed: (prev?.needed ?? 0) + r.qty,
      name: r.cards?.name ?? "(unknown)",
      uri: r.cards?.scryfall_uri ?? null,
    });
  }

  const cardIds = Array.from(needByCardId.keys());

  if (cardIds.length === 0) {
    setNeeded([]);
    setBuildSummary({ ok: true, missingTotal: 0 });
    return;
  }

  // Get owned qty for just these cards
  const { data: ownedRows, error } = await supabase
    .from("collection")
    .select("card_id, qty")
    .eq("user_id", user.id)
    .in("card_id", cardIds);

  if (error) {
    setMsg("Build check error (collection read): " + error.message);
    return;
  }

  const ownedByCardId = new Map<string, number>();
  for (const o of ownedRows ?? []) {
    ownedByCardId.set(o.card_id, o.qty);
  }

  const neededList: NeededRow[] = cardIds
    .map((cid) => {
      const n = needByCardId.get(cid)!;
      const owned = ownedByCardId.get(cid) ?? 0;
      const missing = Math.max(0, n.needed - owned);

      return {
        cardName: n.name,
        scryfallUri: n.uri,
        needed: n.needed,
        owned,
        missing,
      };
    })
    .filter((x) => x.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.cardName.localeCompare(b.cardName));

  const missingTotal = neededList.reduce((a, x) => a + x.missing, 0);
  setNeeded(neededList);
  setBuildSummary({ ok: missingTotal === 0, missingTotal });
}

  async function refresh() {
    setLoading(true);
    setMsg(null);

    const { data: deckData, error: deckErr } = await supabase
      .from("decks")
      .select("id, name, format, is_template")
      .eq("id", deckId)
      .single();

    if (deckErr) {
      setLoading(false);
      setMsg("Deck load error: " + deckErr.message);
      return;
    }
    setDeck(deckData as any);

    const { data: rowData, error: rowsErr } = await supabase
      .from("deck_cards")
      .select("id, qty, board, cards:card_id ( id, name, scryfall_uri )")
      .eq("deck_id", deckId)
      .order("board", { ascending: true })
      .order("qty", { ascending: false });

    setLoading(false);

    if (rowsErr) {
      setMsg("Deck cards load error: " + rowsErr.message);
      return;
    }
    setRows((rowData ?? []) as any);
    await computeBuildability((rowData ?? []) as any);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

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
async function handleDeckFile(file: File) {
  setMsg(null);

  const text = await file.text();

  // Optional: normalize common MTGO "Sideboard" formats already handled by parseDecklist
  setImportText(text);
  setMsg(`Loaded file: ${file.name} (${Math.round(file.size / 1024)} KB). Review, then import.`);
}

  async function addToDeck(card: ScryfallCard, qtyToAdd: number, board: "main" | "side") {
    setMsg(null);

    // 1) upsert into cards
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

    // 2) update/insert deck_cards
    const { data: existing, error: readErr } = await supabase
      .from("deck_cards")
      .select("id, qty")
      .eq("deck_id", deckId)
      .eq("card_id", card_id)
      .eq("board", board)
      .maybeSingle();

    if (readErr) {
      setMsg("DB error (deck_cards read): " + readErr.message);
      return;
    }

    if (!existing) {
      const { error: insErr } = await supabase
        .from("deck_cards")
        .insert({ deck_id: deckId, card_id, qty: qtyToAdd, board });

      if (insErr) setMsg("DB error (deck_cards insert): " + insErr.message);
      else setMsg(`Added ${qtyToAdd} × ${card.name} (${board})`);
    } else {
      const { error: updErr } = await supabase
        .from("deck_cards")
        .update({ qty: existing.qty + qtyToAdd })
        .eq("id", existing.id);

      if (updErr) setMsg("DB error (deck_cards update): " + updErr.message);
      else setMsg(`Updated ${card.name} (+${qtyToAdd})`);
    }

    await refresh();
  }

  async function setQty(rowId: string, newQty: number) {
    setMsg(null);
    if (newQty < 0) return;

    if (newQty === 0) {
      const { error } = await supabase.from("deck_cards").delete().eq("id", rowId);
      if (error) setMsg("Delete error: " + error.message);
      else setMsg("Removed from deck.");
      await refresh();
      return;
    }

    const { error } = await supabase.from("deck_cards").update({ qty: newQty }).eq("id", rowId);
    if (error) setMsg("Update error: " + error.message);
    else setMsg("Quantity updated.");
    await refresh();
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Loading…</p>
      </main>
    );
  }
async function importDecklist(replaceExisting: boolean) {
  setMsg(null);

  const items = parseDecklist(importText);
  if (items.length === 0) {
    setMsg("No parsable lines found. Expect lines like: '4 Lightning Bolt'.");
    return;
  }

  // Optional: wipe deck_cards first
  if (replaceExisting) {
    const { error } = await supabase.from("deck_cards").delete().eq("deck_id", deckId);
    if (error) {
      setMsg("Could not clear deck: " + error.message);
      return;
    }
  }

  // Resolve each name -> scryfall exact
  // (Simple version: sequential; later we can optimize)
  for (const it of items) {
    const r = await fetch(`/api/scryfall/named?name=${encodeURIComponent(it.name)}`);
    const data = await r.json();
    if (!r.ok) {
      setMsg(`Scryfall couldn't find: ${it.name}`);
      return;
    }

    const scry: ScryfallCard = {
      id: data.id,
      name: data.name,
      oracle_id: data.oracle_id,
      scryfall_uri: data.scryfall_uri,
    };

    // Upsert into cards table
    const { data: cardRow, error: cardErr } = await supabase
      .from("cards")
      .upsert(
        {
          scryfall_id: scry.id,
          name: scry.name,
          oracle_id: scry.oracle_id ?? null,
          scryfall_uri: scry.scryfall_uri ?? null,
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

    // Upsert into deck_cards by unique key (deck_id, card_id, board)
    // If you DON'T have that constraint yet, we can add it; otherwise do read+update like before.
    const { data: existing, error: readErr } = await supabase
      .from("deck_cards")
      .select("id, qty")
      .eq("deck_id", deckId)
      .eq("card_id", card_id)
      .eq("board", it.board)
      .maybeSingle();

    if (readErr) {
      setMsg("DB error (deck_cards read): " + readErr.message);
      return;
    }

    if (!existing) {
      const { error: insErr } = await supabase
        .from("deck_cards")
        .insert({ deck_id: deckId, card_id, qty: it.qty, board: it.board });

      if (insErr) {
        setMsg("DB error (deck_cards insert): " + insErr.message);
        return;
      }
    } else {
      const { error: updErr } = await supabase
        .from("deck_cards")
        .update({ qty: existing.qty + it.qty })
        .eq("id", existing.id);

      if (updErr) {
        setMsg("DB error (deck_cards update): " + updErr.message);
        return;
      }
    }
  }

  setMsg(`Imported ${items.length} line(s).`);
  setImportText("");
  await refresh();
}

  return (
    <main className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{deck?.name ?? "Deck"}</h1>
        <div className="text-sm opacity-70">
          {deck?.format ? deck.format : "No format"} {deck?.is_template ? " • template" : ""}
        </div>
      </div>

      <div className="border rounded p-4">
        <div className="font-semibold">Add cards (Scryfall search)</div>
        <div className="mt-2 flex gap-2">
          <input
            className="border rounded px-3 py-2 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search (e.g., Sol Ring)"
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
                  <button className="border rounded px-2 py-1" onClick={() => addToDeck(c, 1, "main")}>
                    +1 main
                  </button>
                  <button className="border rounded px-2 py-1" onClick={() => addToDeck(c, 1, "side")}>
                    +1 side
                  </button>
                  <button className="border rounded px-2 py-1" onClick={() => addToDeck(c, 4, "main")}>
                    +4 main
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p>{msg}</p>}
<section className="border rounded p-4">
  <div className="flex items-center justify-between">
    <div className="font-semibold">Build check (vs your collection)</div>
    <button className="border rounded px-3 py-1" onClick={() => computeBuildability(rows)}>
      Refresh
    </button>
  </div>

<button className="border rounded px-3 py-2" onClick={exportDecklist}>
  Export decklist
</button>

  {!buildSummary ? (
    <p className="mt-2 opacity-70">Computing…</p>
  ) : buildSummary.ok ? (
    <p className="mt-2">
      ✅ You have everything you need for this deck (based on your collection quantities).
    </p>
  ) : (
    <>
      <p className="mt-2">
        ❌ Missing <strong>{buildSummary.missingTotal}</strong> total card(s).
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Card</th>
              <th className="text-left p-2 w-24">Need</th>
              <th className="text-left p-2 w-24">Have</th>
              <th className="text-left p-2 w-24">Missing</th>
            </tr>
          </thead>
          <tbody>
            {needed.map((n) => (
              <tr key={n.cardName} className="border-b">
                <td className="p-2">
                  {n.scryfallUri ? (
                    <a className="underline" href={n.scryfallUri} target="_blank" rel="noreferrer">
                      {n.cardName}
                    </a>
                  ) : (
                    n.cardName
                  )}
                </td>
                <td className="p-2">{n.needed}</td>
                <td className="p-2">{n.owned}</td>
                <td className="p-2 font-semibold">{n.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )}
</section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="border rounded">
          <div className="p-3 border-b font-semibold flex items-center justify-between">
            <span>Main</span>
            <span className="text-sm opacity-70">{mainTotal} cards</span>
          </div>
          <div className="p-3">
            {mainRows.length === 0 ? (
              <p className="opacity-70">No main-deck cards yet.</p>
            ) : (
              <ul className="space-y-2">
                {mainRows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {r.cards?.scryfall_uri ? (
                        <a className="underline" href={r.cards.scryfall_uri} target="_blank" rel="noreferrer">
                          {r.cards.name}
                        </a>
                      ) : (
                        r.cards?.name ?? "(missing card)"
                      )}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="w-8 text-right">{r.qty}</span>
                      <button className="border rounded px-2 py-1" onClick={() => setQty(r.id, r.qty + 1)}>
                        +1
                      </button>
                      <button
                        className="border rounded px-2 py-1"
                        onClick={() => setQty(r.id, Math.max(0, r.qty - 1))}
                      >
                        -1
                      </button>
                      <button className="border rounded px-2 py-1" onClick={() => setQty(r.id, 0)}>
                        Del
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="border rounded">
          <div className="p-3 border-b font-semibold flex items-center justify-between">
            <span>Side</span>
            <span className="text-sm opacity-70">{sideTotal} cards</span>
          </div>
          <div className="p-3">
            {sideRows.length === 0 ? (
              <p className="opacity-70">No sideboard cards yet.</p>
            ) : (
              <ul className="space-y-2">
                {sideRows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {r.cards?.scryfall_uri ? (
                        <a className="underline" href={r.cards.scryfall_uri} target="_blank" rel="noreferrer">
                          {r.cards.name}
                        </a>
                      ) : (
                        r.cards?.name ?? "(missing card)"
                      )}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="w-8 text-right">{r.qty}</span>
                      <button className="border rounded px-2 py-1" onClick={() => setQty(r.id, r.qty + 1)}>
                        +1
                      </button>
                      <button
                        className="border rounded px-2 py-1"
                        onClick={() => setQty(r.id, Math.max(0, r.qty - 1))}
                      >
                        -1
                      </button>
                      <button className="border rounded px-2 py-1" onClick={() => setQty(r.id, 0)}>
                        Del
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="border rounded p-4">
  <div className="font-semibold">Import decklist</div>
  <div className="mt-2">
  <input
    type="file"
    accept=".txt,.csv"
    onChange={(e) => {
      const f = e.target.files?.[0];
      if (f) handleDeckFile(f);
      e.currentTarget.value = ""; // allows re-upload same file
    }}
  />
  <div className="text-sm opacity-70 mt-1">
    Upload a .txt or .csv decklist. It will populate the box below.
  </div>
</div>

  <textarea
    className="border rounded w-full p-2 mt-2"
    rows={10}
    value={importText}
    onChange={(e) => setImportText(e.target.value)}
    placeholder={`Example:\n4 Lightning Bolt\n2 Mountain\n\nSideboard\n1 Pyroblast`}
  />
  <div className="mt-2 flex gap-2">
    <button className="border rounded px-3 py-2" onClick={() => importDecklist(false)}>
      Import (add/merge)
    </button>
    <button className="border rounded px-3 py-2" onClick={() => importDecklist(true)}>
      Import (replace deck)
    </button>
  </div>
</section>

      </div>
    </main>
  );
function exportDecklist() {
  const main = rows
    .filter((r) => r.board === "main" && r.cards?.name)
    .sort((a, b) => (a.cards!.name).localeCompare(b.cards!.name))
    .map((r) => `${r.qty} ${r.cards!.name}`)
    .join("\n");

  const side = rows
    .filter((r) => r.board === "side" && r.cards?.name)
    .sort((a, b) => (a.cards!.name).localeCompare(b.cards!.name))
    .map((r) => `${r.qty} ${r.cards!.name}`)
    .join("\n");

  const text = side.length ? `${main}\n\nSideboard\n${side}\n` : `${main}\n`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${deck?.name ?? "deck"}.txt`;
  a.click();

  URL.revokeObjectURL(url);
}
function parseDecklist(text: string): { qty: number; name: string; board: "main" | "side" }[] {
  const lines = text.split(/\r?\n/);
  let board: "main" | "side" = "main";
  const out: { qty: number; name: string; board: "main" | "side" }[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // section headers
    const lower = line.toLowerCase();
    if (lower === "sideboard" || lower === "sb") { board = "side"; continue; }
    if (lower === "main" || lower === "deck") { board = "main"; continue; }

    // ignore comments
    if (line.startsWith("#") || line.startsWith("//")) continue;

    // match "4 Card Name"
    const m = line.match(/^(\d+)\s+(.+?)\s*$/);
    if (!m) continue;

    const qty = Number(m[1]);
    const name = m[2].replace(/\s+\(\w+\)\s+\d+$/, "").trim(); // strips " (SET) 123" if present
    if (!qty || !name) continue;

    out.push({ qty, name, board });
  }
  return out;
}

}

