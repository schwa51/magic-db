# Code Map (magic-db)

This project uses the Next.js App Router under `src/app` and Supabase helpers under `src/lib/supabase`.

## App Router entry points
- `src/app/page.tsx`
  - Home / landing page
- `src/app/login/page.tsx`
  - Auth flow UI
- `src/app/collection/page.tsx`
  - Collection browsing/editing UI
  - Candidate home for the Bulk Import UI (file upload + preview + RPC)
- `src/app/decks/page.tsx`
  - Deck list page (list of decks)
- `src/app/decks/[id]/page.tsx`
  - Deck detail page
  - Decklist editing (need quantities) and allocation editing (main/side allocations)
- `src/app/test/page.tsx`
  - Useful sandbox route for temporary test buttons (e.g., testing RPC calls)

## API routes (Next.js Route Handlers)
- `src/app/api/scryfall/search/route.ts`
  - Scryfall search proxy for finding cards
- `src/app/api/scryfall/named/route.ts`
  - Scryfall named lookup proxy

## Supabase clients
- `src/lib/supabase/client.ts`
  - Browser client helper (used in `"use client"` components)
  - This is the primary data access path (client calls)
- `src/lib/supabase/server.ts`
  - Server client helper exists, but the current design primarily uses client calls
  - If server actions or server-side reads are added later, this is the starting point

## Middleware
- `src/middleware.ts`
  - Route protection / auth redirects (if configured)
  - If a page is unexpectedly redirecting, check here first

## Schema & DB features relied on by the app
Tables in play:
- `public.cards`
- `public.decks`
- `public.deck_cards`
- `public.collection`
- `public.allocations` (includes `board` = `main` | `side`)

Key uniqueness assumptions:
- decks: `(user_id, name)`
- deck_cards: `(deck_id, card_id, board)`
- collection: `(user_id, card_id)`
- allocations: `(user_id, deck_id, card_id, board)`

## Allocation operations (board-aware)
Upsert:
- `allocations.upsert({ user_id, deck_id, card_id, board, qty }, { onConflict: "user_id,deck_id,card_id,board" })`

Unassign:
- delete by `user_id + deck_id + card_id + board`

## Bulk import (RPC)
Postgres function:
- `public.bulk_import_rows(rows jsonb, collection_mode text, allocation_mode text)`

Client call pattern (from `src/app/collection/page.tsx` or a component it imports):
```ts
await supabase.rpc("bulk_import_rows", {
  rows,
  collection_mode: "set" | "add",
  allocation_mode: "set" | "add",
});
