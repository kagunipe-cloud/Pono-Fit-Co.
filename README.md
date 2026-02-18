# The Fox Says — Member Dashboard

Next.js app with Tailwind CSS and SQLite. Displays member data from a CSV in a searchable table.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Import CSV data into SQLite (run from project root):

   ```bash
   npm run import
   ```

   By default the script looks for `The Fox Says - Members.csv` in the project root. To use another file (e.g. `The-Fox-Says.csv`):

   ```bash
   CSV_PATH=The-Fox-Says.csv npm run import
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and use the search box to filter the table.

## Scripts

- `npm run dev` — start Next.js dev server
- `npm run build` — production build
- `npm run start` — run production server
- `npm run import` — import CSV into SQLite (creates `data/the-fox-says.db`)
