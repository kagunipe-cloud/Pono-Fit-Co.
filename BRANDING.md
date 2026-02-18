# Branding: icons and colors

All app and PWA branding is driven from **one place** so you can personalize quickly.

## 1. Colors and name (one file)

Edit **`brand-colors.json`** in the **project root**:

- **`name`** / **`shortName`** – App name (browser tab, sidebar, PWA home screen).
- **`themeColor`** – PWA theme (address bar, splash) and primary accent. Hex (e.g. `#a2f4b1`).
- **`backgroundColor`** – PWA splash/background. Hex.
- **`primary`** – Full palette for buttons, links, and highlights. `DEFAULT` is the main button/link color; 50 = lightest, 800/900 = darkest (for hovers, text). Keep `primary.DEFAULT` in line with `themeColor` if you want a single accent.

Both the app (Tailwind) and PWA (manifest, layout) read from this file. Change it in one place and restart the dev server to see updates.

## 2. PWA icons

The PWA expects two PNGs in **`public/`**:

- **`icon-192.png`** – 192×192 px  
- **`icon-512.png`** – 512×512 px  

**How to add them:**

1. **Use your own logo**  
   Export your logo as 192×192 and 512×512 PNGs (square, or with safe padding for maskable). Save them as `public/icon-192.png` and `public/icon-512.png`.

2. **From the placeholder**  
   Replace **`public/icon.svg`** with your logo (SVG), then export PNGs at 192 and 512 (e.g. in Figma, Illustrator, or [realfavicongenerator.net](https://realfavicongenerator.net) / [favicon.io](https://favicon.io)).

3. **Optional: maskable**  
   For “maskable” icons (rounded or shaped by the OS), keep the important content in the center ~80% so edges aren’t cropped.

The manifest is served from **`/api/manifest`** and already points to `/icon-192.png` and `/icon-512.png`; once those files exist in `public/`, the PWA will use them.

## 3. Optional: CSS variables

**`src/app/globals.css`** defines:

- `--brand`  
- `--brand-hover`  
- `--brand-light`  

They’re used for any non-Tailwind styling. For consistency, keep them in sync with `brand-colors.json` (e.g. `primary.DEFAULT` and `primary.800`, `primary.50`).

## Summary

| What              | Where to change it        |
|-------------------|---------------------------|
| App name & colors | **`brand-colors.json`** (project root) |
| PWA icons         | Add `public/icon-192.png` and `public/icon-512.png` |
