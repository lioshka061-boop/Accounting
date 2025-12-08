import pkg from "pg";
const { Pool } = pkg;

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://manda@localhost:5432/manda",
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false
});

export default pool;
