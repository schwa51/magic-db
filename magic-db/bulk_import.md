# Bulk Import

## Overview
Bulk import ingests rows from XLSX/CSV into:
- `decks` (create if missing)
- `deck_cards` (set need)
- `allocations` (set/add allocated per board)
- `collection` (set/add owned qty)

Import is executed by Postgres RPC:
`public.bulk_import_rows(rows jsonb, collection_mode text, allocation_mode text)`

Runs as the authenticated user and scopes writes using `auth.uid()`.

## Import Types

### A) Deck Import Sheet
Headers:
- `deck` (text): deck name
- `board` (text): `m` or `s` (also accepts `main`, `side`, `sideboard`)
- `card` (text): card name
- `need` (int): deck needs qty for that board
- `allocated` (int): qty to allocate and (optionally) apply to collection, depending on import mode

Example:
deck | board | card | need | allocated
---|---|---|---:|---:
pestilence | m | Ash Barrens | 2 | 2
pestilence | s | Ash Barrens | 1 | 1

Board normalization:
- `m` → `main`
- `s` → `side`

### B) Collection-Only Sheet
Headers:
- `card` (text)
- `allocated` (int)

Deck/board/need may be blank or omitted.
These rows update `collection` only.

Example:
card | allocated
---|---:
Lightning Bolt | 4
Ponder | 12

## Modes: Snapshot vs Additive

### collection_mode
- `set`: overwrite `collection.qty` with `allocated`
- `add`: increment `collection.qty` by `allocated`

Recommended default:
- Initial import: `set`
- Later incremental adds: `add`

### allocation_mode
- `set`: overwrite `allocations.qty` with `allocated` for that deck+card+board
- `add`: increment `allocations.qty` by `allocated`

Recommended default:
- Initial import: `set`
- Later incremental adds: usually `set` (because allocation is “current assignment”), but `add` is available if desired.

## Card Resolution
Current behavior resolves `cards.id` by matching `cards.name` case-insensitively.
If multiple rows share the same name, the import selects the most recently updated.

If no match is found:
- Import throws an error (because `cards` requires a valid `scryfall_id` and we do not create placeholder cards).

## UI Workflow Recommendation
1. Upload file (.xlsx / .csv)
2. Parse rows client-side
3. Preview first ~25 rows + show:
   - invalid/missing columns
   - cards not found (pre-validate)
   - totals per deck and board
4. Choose mode: Snapshot (set) vs Additive (add)
5. Call RPC once with rows

## Troubleshooting
- “Not authenticated”: calling RPC outside a logged-in browser context.
- “card not found”: card name does not exist in `public.cards` (must ingest cards first or import with identifiers).
- “duplicate key”: usually indicates conflicting unique indexes (old allocation uniqueness without board).
