import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// Лог для діагностики, щоб railway НЕ був сліпим
console.log("DATABASE_URL:", process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL IS MISSING");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Перевіряємо підключення при старті
pool.connect()
  .then(client => {
    console.log("✅ Connected to PostgreSQL");
    client.release();
  })
  .catch(err => {
    console.error("❌ PostgreSQL connection error:", err);
    process.exit(1);
  });

export async function query(text, params) {
  return pool.query(text, params);
}

export async function none(text, params) {
  await pool.query(text, params);
}
