# Exercise catalog: popularity & web difficulty

Admin **`/exercises`** uses:

| Signal | Source |
|--------|--------|
| **Popularity (LOGS)** | Fox gym only — count of `workout_exercises` rows linked to each catalog `exercise_id` |
| **Difficulty** | Internet — Serper search snippets + Gemini → `beginner` / `intermediate` / `advanced`, cached in `exercise_difficulty_cache` (~120 days) |

## Admin UI

- **Sort** dropdown: popularity, difficulty, or name.
- **Look up difficulty (web)** — runs up to **12** exercises in the current filter that have no difficulty yet (needs `GEMINI_API_KEY`; `SERPER_API_KEY` recommended).

Same env vars as macros and exercise demo videos.

## APIs

- `GET /api/admin/exercises/catalog?sort=popularity_desc|…` — admin only
- `POST /api/admin/exercises/enrich-difficulty` — body `{ "exercise_ids": [1,2,3] }`

Member autocomplete is unchanged (`GET /api/exercises?q=…`).
