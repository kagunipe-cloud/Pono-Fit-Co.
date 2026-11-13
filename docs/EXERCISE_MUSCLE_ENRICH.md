# Exercise muscle enrichment (web + AI)

Fills **primary**, **secondary**, **antagonist** muscles, and **compound vs isolation** (`movement_class`) using Serper + Gemini, normalized to the app vocabulary (`src/lib/exercise-muscle-vocabulary.ts`).

## Admin

On **`/exercises`**:

- **Look up muscles (web)** — up to **8** exercises in the current filter that lack `muscles_enriched_at` or primary muscles (click repeatedly to batch through the catalog).
- Saves when confidence is **high** or **medium**; **low** is skipped (re-run with `apply_low` via API if needed).

Requires `GEMINI_API_KEY`; `SERPER_API_KEY` recommended.

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
