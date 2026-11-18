# Exercise muscle enrichment (web + AI)

Fills **primary**, **secondary**, **antagonist** muscles, and **compound vs isolation** (`movement_class`) using Serper + Gemini, normalized to the app vocabulary (`src/lib/exercise-muscle-vocabulary.ts`).

## Bulk edit in Excel / Sheets

On **Admin → Exercise database** (`/exercises`):

1. **Download muscle-edit CSV** — columns include `id`, `name`, `type`, `muscle_group`, `movement_class`, `primary_muscles`, `secondary_muscles`, `antagonist_muscles`, `equipment`.
2. Edit in Excel or Google Sheets (keep **`id`** unchanged).
3. **Apply muscle CSV updates** — paste or upload the file. Updates existing rows by `id` only; does not create new exercises. Clears web-enrich timestamps so you are not fighting stale auto-lookup.

The muscle map picker matches regions using **primary muscles only** (see `MuscleMapPicker.tsx`). For compounds, put the main movers in `primary_muscles` and synergists in `secondary_muscles` so each lift shows under the right body region.

API: `GET` / `POST` `/api/admin/exercises/spreadsheet` (admin session required).

## Admin

On **`/exercises`**:

- **Look up muscles (web)** — up to **8** exercises in the current filter that lack `muscles_enriched_at` or primary muscles (click repeatedly to batch through the catalog).
- Saves when confidence is **high** or **medium**; **low** is skipped (re-run with `apply_low` via API if needed).

Requires `GEMINI_API_KEY`; `SERPER_API_KEY` recommended.

## Terminal (batch — recommended)

Same enrich logic, one command, no clicking. Uses the SQLite file on this machine (`data/the-fox-says.db`) or the Railway volume when run in **Railway Shell**.

```bash
npm install   # once, picks up tsx
npm run enrich-exercises
```

Options (after `--`):

| Flag | Meaning |
|------|---------|
| `--muscles-only` | Skip difficulty |
| `--difficulty-only` | Skip muscles |
| `--limit=100` | Cap how many per phase (default: all that need it) |
| `--type=lift` | Only lifts |
| `--force` | Re-run even if recently enriched |
| `--apply-low` | Save low-confidence muscle lookups |
| `--sleep=1500` | Ms between API calls (default 1200) |

**Production:** Railway → service → **Shell**:

```bash
cd /app && npm run enrich-exercises
```

Env vars (`GEMINI_API_KEY`, `SERPER_API_KEY`) must already be set on the service. A full catalog can take a while (Serper + Gemini per exercise).

## API

`POST /api/admin/exercises/enrich-muscles`

```json
{ "exercise_ids": [1, 2, 3], "force": false, "apply_low": false }
```

## Database

- `antagonist_muscles` — comma-separated canonical terms
- `movement_class` — `compound` | `isolation` (lifts only; null for stretch/cardio)
- `muscles_enriched_at`, `muscles_enrich_confidence`

Re-enrich after ~120 days unless `force: true`.

## Vocabulary

Terms come from `MUSCLE_TO_GROUP` plus muscle-map region terms. Synonyms map to canonical strings (e.g. `lats` → `latissimus dorsi`, `quads` → `quadriceps`).
