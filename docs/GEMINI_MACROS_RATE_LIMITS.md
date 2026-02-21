# Gemini API rate limits (macros / calculate-macros)

The **Calculate** button for macros uses the Gemini API (e.g. `gemini-2.0-flash`). Google’s **free tier** limits are strict:

- **~10 requests per minute (RPM)**
- **~250 requests per day (RPD)**

So 429s are expected if:

- Several users hit Calculate in the same minute, or
- One user runs many calculations in a short time, or
- You share one API key across the whole app (all traffic counts toward the same quota).

References: [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## What we do to reduce 429s

- **Server-side cache**: Identical requests (same food + portion + unit) are cached for 24 hours. The first “2 cups rice” call hits Gemini; later “2 cups rice” calls (from any user) are served from cache and do **not** use quota.
- **User-facing message**: On 429 we return: “API rate limit reached. Please wait a minute and try again.”

## If you still hit limits

1. **Rely on cache**: Repeated foods (e.g. “1 cup oats”) will stop calling Gemini after the first time.
2. **Upgrade quota**: In [Google AI Studio](https://aistudio.google.com/) or Google Cloud Console you can request higher quotas (paid tier); then you get much higher RPM/RPD.
3. **Optional env**: You can point to another model/version with `GEMINI_API_VERSION` and `GEMINI_MODEL` if a different model has better limits for your project.
