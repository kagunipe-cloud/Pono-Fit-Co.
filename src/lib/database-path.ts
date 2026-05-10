import path from "path";

/** Absolute path to the main SQLite file (shared by `getDb` and workout migrations). */
export const DATABASE_FILE_PATH = path.join(process.cwd(), "data", "the-fox-says.db");
