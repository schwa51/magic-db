# Row Level Security (RLS) Notes

This project uses Supabase Row Level Security (RLS) with client-side Supabase calls.
All data access is scoped to the authenticated user via `auth.uid()`.

## General principles
- All tables have RLS enabled.
- Reads and writes are allowed only for rows owned by the authenticated user.
- Ownership is determined either directly via `user_id` columns or indirectly via related tables (e.g. `deck_cards → decks`).
- The bulk import RPC (`public.bulk_import_rows`) relies on these policies and uses `auth.uid()` internally.

---

## public.cards

### Policies
- **SELECT**: allowed for everyone
- **INSERT / UPDATE**: allowed for authenticated users

### Rationale
- Card data is global/shared.
- Users may ingest cards (via Scryfall) but do not own them.
- Reads are unrestricted so all users can reference cards by name/id.

---

## public.collection

### Policies
- **SELECT**: `user_id = auth.uid()`
- **INSERT**: allowed if `user_id = auth.uid()`
- **UPDATE**: allowed if `user_id = auth.uid()`
- **DELETE**: allowed if `user_id = auth.uid()`

### Rationale
- Collection rows represent owned cards.
- Users can only see and modify their own collection.
- Bulk import works because inserted rows include `user_id = auth.uid()`.

---

## public.decks

### Policies
- **SELECT**: `user_id = auth.uid()`
- **INSERT**: allowed if `user_id = auth.uid()`
- **UPDATE**: allowed if `user_id = auth.uid()`
- **DELETE**: allowed if `user_id = auth.uid()`

### Rationale
- Decks are owned per user.
- Deck creation during bulk import succeeds because the RPC inserts decks with `user_id = auth.uid()`.

---

## public.deck_cards

### Policies
All operations require that the deck belongs to the current user.

Condition (simplified):
```sql
EXISTS (
  SELECT 1 FROM decks d
  WHERE d.id = deck_cards.deck_id
    AND d.user_id = auth.uid()
)
