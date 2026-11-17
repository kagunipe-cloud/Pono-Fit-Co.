# YouTube exercise form videos (member workouts)

Members see **suggested YouTube links** via **Video instructions** on workouts. Videos are discovered via search, ranked for **safety** and **credential signals**, validated with the **YouTube Data API**, and **cached** so the modal stays fast.

## Two features — don’t mix YouTube into both

| Feature | APIs? | Notes |
|---------|--------|--------|
| **Muscle map** exercise order | **No** | Pono catalog file + gym logs (`data/pono-exercise-catalog.txt`) |
| **Video instructions** modal | **Yes** (on demand) | Serper/YouTube/Gemini on cache miss; **lean** queries by default |

We removed YouTube **view/trend sorting** from the muscle map. Video lookup on tap is fine — that’s a separate path.

## Sustainable ops

| Env | Default | Meaning |
|-----|---------|--------|
| `EXERCISE_DEMO_AUTO_REFRESH` | *on* | Member tap can search when cache is empty/stale. Set `false` for cache-only |
| `EXERCISE_DEMO_FULL_DISCOVER` | *off* | Warm / refresh uses **1 Serper + 1 YouTube search** per exercise unless `true` |

Optional batch pre-fill (not required if members trigger lookups):

```bash
npm run warm-youtube-lifts -- --limit=50 --sleep=8000
npm run diagnose-video-apis
```

Avoid running huge warm jobs **and** `EXERCISE_DEMO_FULL_DISCOVER=true` at the same time — pick lean on-demand + optional small warm, not every query mode at once.

## What you need to add

### 1. YouTube Data API key (recommended)

Used to confirm videos are still public and to enrich titles/channels for ranking.

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Use the same project as Gemini (or create one).
3. **APIs & Services → Library** → enable **YouTube Data API v3**.
4. **APIs & Services → Credentials → Create credentials → API key**.
5. Restrict the key (recommended):
   - **API restrictions** → “Restrict key” → **YouTube Data API v3** only.
   - No need for HTTP referrer restrictions if this key is only used server-side.

Add to `.env.local`:

```bash
YOUTUBE_API_KEY=your_youtube_data_api_key
```

**Quota:** Default **10,000 units/day**. A search costs **100** units; validating up to 50 video IDs costs **1** unit. With caching, normal gym usage stays well under quota. Request a quota increase in Cloud Console if needed.

### 2. Serper (you may already have this)

Macros use `SERPER_API_KEY` for Google search. Exercise demos use it to find real YouTube URLs first.

```bash
SERPER_API_KEY=your_serper_key
```

If Serper is missing, discovery falls back to **YouTube search** (uses more quota).

### 3. Gemini (you may already have this)

Ranking uses the same key as macros:

```bash
GEMINI_API_KEY=your_gemini_key
```

Optional override:

```bash
GEMINI_EXERCISE_MODEL=gemini-2.5-flash
```

Without Gemini, the app uses local heuristics (safety/clickbait filters + credential keywords).

## How caching / timing works

| Step | When | Typical time |
|------|------|----------------|
| Open instructions modal | Immediately | Instructions + image (if any) show at once |
| `GET /api/exercises/{id}/demo-videos` | Right after | **&lt;50 ms** on cache hit |
| First visit (no cache) | Background (`after()`) | **~2–6 s** Serper + YouTube + Gemini |
| UI while loading | Same modal | “Finding form videos…” — **no blocking** on door/workout UI |

- Cache **TTL:** 60 days (then refresh in background while still showing old links).
- **Link check:** every 7 days via YouTube API; dead links dropped and cache refreshed if empty.
- Failed empty lookups retry after **14 days**.

Restart the server after changing env vars.

## Strict safety rules (current behavior)

- Only **Tier A** picks from Gemini (credential + instructional signals); clickbait/ego-lift titles penalized.
- Links open **on YouTube** in a new tab (not embedded).
- Member disclaimer shown above the list.

Future: admin-pinned videos and channel allowlists (not implemented yet).

## Batch warm (muscle map YouTube sort)

Pre-run the same Video instructions pipeline for many lifts so muscle-map sorting has view counts without waiting on members.

```bash
npm run warm-youtube-lifts
npm run warm-youtube-lifts -- --limit=30    # smoke test
npm run warm-youtube-lifts -- --sleep=4000  # slower (quota-friendly)
npm run warm-youtube-lifts -- --force       # ignore fresh cache
```

**Railway Shell** (long run — use `nohup`):

```bash
cd /app && nohup npm run warm-youtube-lifts > /tmp/warm-youtube.log 2>&1 &
tail -f /tmp/warm-youtube.log
```

Needs `SERPER_API_KEY` or `YOUTUBE_API_KEY`; `GEMINI_API_KEY` for best ranking. Each lift costs several API calls (~2–6 s + `--sleep` default 2.5s).
