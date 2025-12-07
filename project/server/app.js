import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- DB INIT ----------
async function initDB() {
  const db = await open({
    filename: "./db.sqlite",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      balance REAL DEFAULT 0
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT,
      title TEXT,
      note TEXT,
      date TEXT,
      sale REAL,
      cost REAL,
      prosail REAL,
      prepay REAL,
      supplier_id INTEGER,
      promoPay INTEGER,
      ourTTN INTEGER,
      fromSupplier INTEGER,
      isReturn INTEGER DEFAULT 0,
      returnDelivery REAL DEFAULT 0,
      profit REAL,
      supplier_balance REAL
    );
  `);

  return db;
}

const dbPromise = initDB();

app.use((req, res, next) => {
  dbPromise.then(db => {
    req.db = db;
    next();
  });
});

// ---------- SUPPLIERS ----------
app.get("/api/suppliers", async (req, res) => {
  const suppliers = await req.db.all("SELECT * FROM suppliers");
  res.json(suppliers);
});

app.post("/api/suppliers", async (req, res) => {
  const { name } = req.body;
  await req.db.run("INSERT INTO suppliers (name) VALUES (?)", [name]);
  res.json({ ok: true });
});

// ---------- ORDERS ----------
app.get("/api/orders", async (req, res) => {
  const orders = await req.db.all("SELECT * FROM orders");
  res.json(orders);
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      order_number, title, note, date,
      sale, cost, prosail, prepay,
      supplier_id, promoPay, ourTTN, fromSupplier,
      isReturn, returnDelivery
    } = req.body;

    // --------------------
    // РОЗРАХУНОК ПРИБУТКУ
    // --------------------
    let profit = sale - cost - prosail;

    if (isReturn) {
      profit = -returnDelivery;
    }

    // --------------------
    // РОЗРАХУНОК БОРГУ ПОСТАЧАЛЬНИКА
    // --------------------
    // 1) ми винні постачальнику (опт)
    let supplier_balance = 0;

    if (promoPay || ourTTN) {
      supplier_balance = -cost; // ми винні
    } else {
      supplier_balance = sale - cost; // постачальник винен нам
    }

    // враховуємо передплату
    supplier_balance += prepay;

    // --------------------
    // Запис замовлення
    // --------------------
    await req.db.run(
      `
      INSERT INTO orders 
      (order_number, title, note, date, sale, cost, prosail, prepay,
       supplier_id, promoPay, ourTTN, fromSupplier, isReturn, 
       returnDelivery, profit, supplier_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        order_number, title, note, date,
        sale, cost, prosail, prepay,
        supplier_id, promoPay ? 1 : 0, ourTTN ? 1 : 0, fromSupplier ? 1 : 0,
        isReturn ? 1 : 0, returnDelivery,
        profit, supplier_balance
      ]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("ORDER ERROR:", err);
    res.status(500).json({ error: "Order insert failed" });
  }
});

// ---------- FALLBACK ----------
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`SERVER RUNNING → http://localhost:${PORT}`);
});
