import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// ---- Serve frontend ----
app.use(express.static(path.join(__dirname, "public")));

// ======== DB INIT =========
async function initDB() {
  const db = await open({
    filename: path.join(__dirname, "db.sqlite"),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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
      isReturn INTEGER,
      returnDelivery REAL,
      profit REAL,
      supplier_balance REAL
    );
  `);

  return db;
}
const dbPromise = initDB();

// inject db
app.use((req, res, next) => {
  dbPromise.then(db => {
    req.db = db;
    next();
  });
});

// =========================
//     SUPPLIERS ROUTES
// =========================

app.get("/api/suppliers", async (req, res) => {
  const suppliers = await req.db.all("SELECT * FROM suppliers ORDER BY id DESC");
  res.json(suppliers);
});

app.post("/api/suppliers", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  await req.db.run("INSERT INTO suppliers (name) VALUES (?)", [name]);
  res.json({ ok: true });
});

// =========================
//        ORDERS ROUTES
// =========================

app.get("/api/orders", async (req, res) => {
  const orders = await req.db.all("SELECT * FROM orders ORDER BY id DESC");
  res.json(orders);
});

app.get("/api/orders/:id", async (req, res) => {
  const order = await req.db.get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
  res.json(order);
});

// ------ Recalculate balances ------
function calcOrderBalance(order) {
  const { sale, cost, prosail, prepay, promoPay, isReturn, returnDelivery } = order;

  if (isReturn) {
    return {
      profit: -(prosail + returnDelivery),
      supplier_balance: 0
    };
  }

  // Normal order
  const profit = sale - cost - prosail;

  // supplier balance:
  // promoPay or ourTTN → we owe supplier cost
  // no promoPay → supplier owes us (sale - cost)
  let supplier_balance = 0;

  if (promoPay) supplier_balance = -cost;
  else supplier_balance = sale - cost;

  // subtract prepay (prepay reduces supplier debt to us)
  supplier_balance -= prepay;

  return { profit, supplier_balance };
}

// ------ Create order ------
app.post("/api/orders", async (req, res) => {
  try {
    const data = req.body;

    const { profit, supplier_balance } = calcOrderBalance(data);

    await req.db.run(
      `INSERT INTO orders 
      (order_number, title, note, date, sale, cost, prosail, prepay,
       supplier_id, promoPay, ourTTN, fromSupplier,
       isReturn, returnDelivery, profit, supplier_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.order_number,
        data.title,
        data.note,
        data.date,
        data.sale,
        data.cost,
        data.prosail,
        data.prepay,
        data.supplier_id,
        data.promoPay ? 1 : 0,
        data.ourTTN ? 1 : 0,
        data.fromSupplier ? 1 : 0,
        data.isReturn ? 1 : 0,
        data.returnDelivery,
        profit,
        supplier_balance
      ]
    );

    res.json({ ok: true });

  } catch (err) {
    console.log("ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Update order ------
app.put("/api/orders/:id", async (req, res) => {
  try {
    const data = req.body;
    const { profit, supplier_balance } = calcOrderBalance(data);

    await req.db.run(
      `UPDATE orders SET
        order_number=?, title=?, note=?, date=?, sale=?, cost=?, prosail=?, prepay=?,
        supplier_id=?, promoPay=?, ourTTN=?, fromSupplier=?,
        isReturn=?, returnDelivery=?, profit=?, supplier_balance=?
       WHERE id=?`,
      [
        data.order_number,
        data.title,
        data.note,
        data.date,
        data.sale,
        data.cost,
        data.prosail,
        data.prepay,
        data.supplier_id,
        data.promoPay ? 1 : 0,
        data.ourTTN ? 1 : 0,
        data.fromSupplier ? 1 : 0,
        data.isReturn ? 1 : 0,
        data.returnDelivery,
        profit,
        supplier_balance,
        req.params.id
      ]
    );

    res.json({ ok: true });

  } catch (err) {
    console.log("UPDATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Delete order ------
app.delete("/api/orders/:id", async (req, res) => {
  await req.db.run("DELETE FROM orders WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

// fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// start
app.listen(PORT, () => {
  console.log("SERVER RUNNING → http://localhost:" + PORT);
});
