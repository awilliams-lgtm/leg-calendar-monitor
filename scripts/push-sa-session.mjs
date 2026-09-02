import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const raw = readFileSync("data/sa-session.json", "utf8");
const session = JSON.parse(raw);
if (!session.cookie && !session.bearer) throw new Error("Local SA session has no cookie or token");

const sql = neon(url);
await sql`CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`;
await sql`
  INSERT INTO sync_meta (key, value) VALUES ('sa_session', ${raw})
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
`;
console.log("Stored local SA session in Neon", session.email || session.source || "ok");
