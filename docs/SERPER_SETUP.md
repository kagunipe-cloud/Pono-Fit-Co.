# Serper Setup (Grounded Macro Lookup)

Serper powers web search for the AI Calculate tool. When configured, the app searches Google for nutrition data and feeds it to Gemini for more accurate results (especially for branded products like Musashi bars).

## Steps

### 1. Get your API key

1. Go to **[serper.dev](https://serper.dev)**
2. Click **"Get 2,500 free queries"** or **"Try 2,500 queries for free"**
3. Sign up (no credit card required)
4. Copy your API key from the dashboard

### 2. Add to your environment

Add this to `.env.local` in the project root:

```
SERPER_API_KEY=your_key_here
```

### 3. Restart the dev server

```bash
# Stop the server (Ctrl+C) and restart
npm run dev
```

### 4. Test it

1. Open the app → Macros → Add Food
2. In "Or calculate macros", type **musashi high protein bar**
3. Click **Calculate**
4. You should get accurate macros (similar to Google search results)

---

**Note:** If `SERPER_API_KEY` is not set, the Calculate tool still works — it just uses Gemini without web grounding, which can be less accurate for branded products.
