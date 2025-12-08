import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function none(text, params) {
  await pool.query(text, params);
}
