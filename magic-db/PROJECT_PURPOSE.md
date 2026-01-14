# MTG Collection + Deck Allocation App (Next.js + Supabase)

## Purpose
This project is a Next.js app backed by Supabase (Postgres + Auth) to manage:
- A Magic: The Gathering collection (owned quantities per card)
- Decklists (mainboard/sideboard needed quantities)
- Per-deck allocations (how many owned copies are assigned to each deck and board)
- Bulk upload from XLSX/CSV to initialize or update decks, decklists, allocations, and collection

## Tech Stack
- Next.js (App Router)
- Supabase Auth + Postgres
- Client-side Supabase calls using a browser client helper (`supabaseBrowser()`)
- Card data stored in `public.cards` with unique `scryfall_id`

## Core Concepts
- **Collection** (`public.collection.qty`): total owned copies per user+card.
- **Decklist Need** (`public.deck_cards.qty`): how many copies a deck needs in a given board.
- **Allocation** (`public.allocations.qty`): how many owned copies are assigned to a deck, tracked per board:
  - `allocations.board` is `main` or `side`.

## Bulk Import
Bulk import supports two spreadsheet types:
1) Deck import: `deck, board, card, need, allocated`
2) Collection-only import: `card, allocated` (deck blank)

Import behavior uses modes:
- `collection_mode`: `set` (snapshot overwrite) or `add` (increment)
- `allocation_mode`: `set` (snapshot overwrite) or `add` (increment)

The Postgres function `public.bulk_import_rows(rows jsonb, collection_mode text, allocation_mode text)` executes the import in a single transaction.

## Security / RLS
Row Level Security (RLS) is enabled.
The app uses client-side calls, so SELECT/INSERT/UPDATE/DELETE must be allowed by policies.
The bulk import RPC uses `auth.uid()` to scope writes to the current user.

## Non-goals (current)
- Pricing / value tracking
- Selling workflow
- Multi-user deck sharing
