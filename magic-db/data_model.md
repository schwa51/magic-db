# Data Model

## Tables

### public.cards
Represents a card printing or canonical card entry from Scryfall ingestion.
- `id` (uuid)
- `scryfall_id` (text, unique)
- `name` (text)
- `oracle_id` (text, optional)
- `scryfall_uri` (text, optional)

**Notes**
- Imports may refer to cards by `name`. Name is not unique, so name-based resolution chooses the most recently updated matching row (current implementation). Long-term, importing by `scryfall_id` or `oracle_id` is more precise.

### public.decks
Decks are owned per user.
- `id`
- `user_id`
- `name`
- `format` (optional)
- `is_template` (bool)

Unique: `(user_id, name)`.

### public.deck_cards
Decklist “need” per deck/card/board.
- `deck_id`
- `card_id`
- `board` (`main` or `side`)
- `qty` (int, default 1)

Unique: `(deck_id, card_id, board)`.

### public.collection
Owned quantities per user+card.
- `user_id`
- `card_id`
- `qty` (int)

Unique: `(user_id, card_id)`.

### public.allocations
Allocated quantities per user+deck+card+board.
- `user_id`
- `deck_id` (nullable allowed by schema; in practice allocations for this app use a deck)
- `card_id`
- `board` (`main` or `side`)
- `qty` (int)

Unique: `(user_id, deck_id, card_id, board)`.

## Definitions / Intended Behavior

### “Need”
`deck_cards.qty` = how many copies the deck wants in that board.

### “Allocated”
`allocations.qty` = how many copies from the user’s owned pool are assigned to that deck+board.

### “Owned”
`collection.qty` = total copies owned by the user (regardless of allocation).

## Common UI operations

### Build / edit decklist
Upsert `deck_cards` keyed by `(deck_id, card_id, board)`.

### Allocate owned cards to a deck
Upsert `allocations` keyed by `(user_id, deck_id, card_id, board)`.

### Unassign allocation
Delete the allocation row for the specific `(user_id, deck_id, card_id, board)`.

### Collection editing
Upsert or increment `collection` keyed by `(user_id, card_id)`.

## Invariants (optional, UI-enforced)
- Allocation for a card across all decks may be constrained not to exceed owned qty.
  (Currently best enforced in UI; can also be enforced with a DB check via triggers if desired.)
