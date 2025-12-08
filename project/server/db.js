import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  const {
    PGHOST = "localhost",
    PGUSER = "",
    PGPASSWORD = "",
    PGDATABASE = "",
    PGPORT = "5432"
  } = process.env;
  connectionString = `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
}

const isLocal =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function none(text, params) {
  await pool.query(text, params);
}
