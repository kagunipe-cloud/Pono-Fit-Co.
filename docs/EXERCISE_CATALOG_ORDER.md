# Pono exercise catalog order (muscle map)

The member **muscle map** sorts lifts by your curated list in `data/pono-exercise-catalog.txt`, not alphabetically.

## Update workflow

1. Edit the catalog text (or re-export from Pages into `data/pono-exercise-catalog.txt`).
2. Run:

```bash
npm run build-exercise-catalog
```

This regenerates:

- `src/lib/exercise-catalog-order.json` — section lists and ranks
- `src/lib/exercise-catalog-aliases.json` — resolved alias → rank (do not edit by hand)

## Name aliases (DB vs catalog)

When an import name does not match the catalog literally, add a row to **`data/exercise-catalog-aliases.json`**:

```json
{
  "from": "Barbell Bench Press",
  "to": "Flat Barbell Bench Press",
  "note": "optional comment"
}
```

Optional `"section": "chest"` if the `to` title appears in more than one section (rare).

Matching otherwise uses normalization, plurals, parentheticals, and guarded fuzzy overlap (`src/lib/exercise-catalog-match.ts`).

## Diagnostics

```bash
npm run report-catalog-match
```

Checks catalog self-match and (if present) FitnessDB CSV overlap.