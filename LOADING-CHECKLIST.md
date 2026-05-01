# If the app won’t load locally

Use this when the dev server fails to start, the browser shows a blank page, or you cannot connect.

## 1. Start the dev server

From the project root:

```bash
cd /path/to/The-Fox-Says
rm -rf .next
npm run dev
```

Wait until the terminal shows something like **Ready** and **Local: http://127.0.0.1:3000**.

- Prefer **`http://127.0.0.1:3000`** (matches `package.json`; avoids some DNS/`localhost` quirks).

If Turbopack or the default bundler causes odd errors, try:

```bash
npm run dev:webpack
```

## 2. Open the app

You should get the real app shell (login / dashboard), not a placeholder page.

## 3. Common problems

**“Can’t connect” / browser cannot open the page**

- Confirm the dev server is still running and shows no fatal error.
- Use **`http://127.0.0.1:3000`** (not `https`, unless you’ve added TLS locally).

**Blank white page**

- Hard refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows).
- Open DevTools → **Console** and note any **red** errors.

**Port already in use**

```bash
lsof -ti :3000 | xargs kill -9
npm run dev
```

## 4. What to capture when asking for help

- Last ~20 lines from the **terminal** after `npm run dev` (or `dev:webpack`).
- Whether the browser shows blank, an error string, or “can’t connect”.
- Any **Console** errors from DevTools.
