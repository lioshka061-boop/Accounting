import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

// Basic money helpers
const MONEY_SCALE = 100;
const round2 = (value) => Math.round((Number(value) || 0) * MONEY_SCALE) / MONEY_SCALE;
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const normalizeDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};
const buildDateFilter = (column, start, end) => {
  const parts = [];
  const params = [];
  if (start) {
    parts.push(`${column} >= ?`);
    params.push(start);
  }
  if (end) {
    parts.push(`${column} <= ?`);
    params.push(end);
  }
  if (!parts.length) return { clause: "", params: [] };
  return { clause: " AND " + parts.join(" AND "), params };
};
const generateOrderNumber = () => `№${Date.now()}`;

// Financial parameters (can be tuned)
const PROMO_PERCENT = 0.175;          // 17.5% комісія Prom
const OUR_DELIVERY_PRICE = 60;        // доставка, якщо ourTTN = true
const SUPPLIER_DELIVERY_PRICE = 0;    // компенсація доставки постачальнику, якщо fromSupplier = true

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
      supplier_balance REAL,
      traffic_source TEXT,
      status TEXT DEFAULT 'Прийнято',
      cancel_reason TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      type TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
  `);

  await ensureOrderColumns(db);
  await ensureManualMonths(db);
  await normalizeExistingOrders(db);
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

async function recalcSupplierBalance(db, supplierId) {
  if (!supplierId) return;
  const orderRow = await db.get(
    `SELECT COALESCE(SUM(supplier_balance), 0) AS balance
     FROM orders WHERE supplier_id = ?`,
    [supplierId]
  );

  const adjustRow = await db.get(
    `SELECT COALESCE(SUM(delta), 0) AS adj
     FROM supplier_adjustments WHERE supplier_id = ?`,
    [supplierId]
  );

  const balance = round2(orderRow.balance + adjustRow.adj);
  await db.run("UPDATE suppliers SET balance = ? WHERE id = ?", [balance, supplierId]);
}

function computeFinancials(payload) {
  const baseSale = toNumber(payload.sale);
  const baseCost = toNumber(payload.cost);
  const baseProsail = toNumber(payload.prosail);
  const basePrepay = toNumber(payload.prepay);
  const baseReturnDelivery = toNumber(payload.returnDelivery);
  const status = (payload.status || "Прийнято").trim();

  const promoPay = !!payload.promoPay;
  const ourTTN = !!payload.ourTTN;
  const fromSupplier = !!payload.fromSupplier;
  const isReturn = !!payload.isReturn || status === "Повернення";

  if (isReturn) {
    const sale = 0;
    const cost = baseCost;
    const prosail = 0;
    const returnCost = baseReturnDelivery;
    const supplierDeliveryCost = fromSupplier ? SUPPLIER_DELIVERY_PRICE : 0;

    // Повернення: платимо Prosale і доставку
    const profitRaw = -(returnCost + baseProsail);
    let supplierBalanceChange = -returnCost - supplierDeliveryCost;

    return {
      sale: round2(sale),
      cost: round2(cost),
      prosail: round2(prosail),
      prepay: round2(basePrepay),
      returnDelivery: round2(returnCost),
      profit: round2(profitRaw),
      supplier_balance: round2(supplierBalanceChange),
      promoPay,
      ourTTN,
      fromSupplier,
      isReturn
    };
  }

  const sale = baseSale;
  const cost = baseCost;
  const prosail = baseProsail;
  const prepay = basePrepay;
  const returnDelivery = baseReturnDelivery;

  const promoFee = 0; // за поточною логікою комісію Prom не віднімаємо
  const deliveryCost = ourTTN ? OUR_DELIVERY_PRICE : 0;
  const supplierDeliveryCost = fromSupplier ? SUPPLIER_DELIVERY_PRICE : 0;
  const returnCost = returnDelivery;

  let profitRaw =
    sale
    - cost
    - promoFee
    - deliveryCost
    - supplierDeliveryCost
    - returnCost
    - prosail;

  let supplierBalanceChange = 0;

  switch (status) {
    case "Відмова":
      // ProSale повернувся, мінусуємо тільки доставку
      profitRaw = -(deliveryCost + returnCost);
      supplierBalanceChange = 0;
      break;
    case "Повернення":
      profitRaw = -(returnCost + prosail);
      supplierBalanceChange = -returnCost;
      break;
    case "Під замовлення":
      // Заробляємо передплату, віднімаємо ProSale і доставку, без руху по постачальнику
      profitRaw = prepay - prosail - deliveryCost;
      supplierBalanceChange = 0;
      break;
    case "Скасовано":
      profitRaw = 0;
      supplierBalanceChange = 0;
      break;
    default: // Прийнято / Виконано
      if (fromSupplier) {
        supplierBalanceChange = sale - cost; // постачальник нам винен маржу
      } else if (ourTTN || promoPay) {
        supplierBalanceChange = -cost; // ми винні постачальнику за товар
      } else {
        supplierBalanceChange = sale - cost; // базово постачальник винен маржу
      }
      break;
  }

  return {
    sale: round2(sale),
    cost: round2(cost),
    prosail: round2(prosail),
    prepay: round2(prepay),
    returnDelivery: round2(returnDelivery),
    profit: round2(profitRaw),
    supplier_balance: round2(supplierBalanceChange),
    promoPay,
    ourTTN,
    fromSupplier,
    isReturn,
    status
  };
}

async function validateOrder(db, data, { isUpdate = false } = {}) {
  const normalizedDate = normalizeDate(data.date);
  if (!normalizedDate) throw new Error("Невірна дата");

  const supplierId = Number(data.supplier_id);
  if (!supplierId) throw new Error("Постачальник обов'язковий");

  const status = (data.status || "Прийнято").trim();
  const isReturn = !!data.isReturn || status === "Повернення";

  if (!isReturn && !["Відмова", "Скасовано", "Під замовлення"].includes(status)) {
    const saleNum = toNumber(data.sale);
    if (!saleNum || saleNum < 0) throw new Error("Продаж має бути > 0");
  }

  const exists = await db.get("SELECT id FROM suppliers WHERE id = ?", [supplierId]);
  if (!exists) throw new Error("Постачальник не знайдений");

  return normalizedDate;
}

async function recalcSupplierBalancesAfterChange(db, oldSupplierId, newSupplierId) {
  const uniqIds = new Set([oldSupplierId, newSupplierId].filter(Boolean));
  for (const id of uniqIds) {
    await recalcSupplierBalance(db, id);
  }
}

async function normalizeExistingOrders(db) {
  const orders = await db.all("SELECT * FROM orders");
  const touchedSuppliers = new Set();

  for (const order of orders) {
    const normalizedDate = normalizeDate(order.date) || order.date;
    const fin = computeFinancials(order);
    touchedSuppliers.add(order.supplier_id);

    await db.run(
      `UPDATE orders SET
        date = ?, sale = ?, cost = ?, prosail = ?, prepay = ?, promoPay = ?, ourTTN = ?, fromSupplier = ?,
        isReturn = ?, returnDelivery = ?, profit = ?, supplier_balance = ?, traffic_source = ?, status = ?, cancel_reason = ?
       WHERE id = ?`,
      [
        normalizedDate,
        fin.sale,
        fin.cost,
        fin.prosail,
        fin.prepay,
        fin.promoPay ? 1 : 0,
        fin.ourTTN ? 1 : 0,
        fin.fromSupplier ? 1 : 0,
        fin.isReturn ? 1 : 0,
        fin.returnDelivery,
        fin.profit,
        fin.supplier_balance,
        order.traffic_source || null,
        order.status || "Прийнято",
        order.cancel_reason || null,
        order.id
      ]
    );
  }

  for (const supplierId of touchedSuppliers) {
    await recalcSupplierBalance(db, supplierId);
  }
}

async function addAdjustment(db, supplierId, delta, type = "manual", note = "") {
  await db.run(
    `INSERT INTO supplier_adjustments (supplier_id, delta, type, note)
     VALUES (?, ?, ?, ?)`,
    [supplierId, round2(delta), type, note]
  );
  await recalcSupplierBalance(db, supplierId);
}

async function ensureOrderColumns(db) {
  const cols = await db.all("PRAGMA table_info(orders)");
  const names = cols.map(c => c.name);
  const alters = [];
  if (!names.includes("traffic_source")) alters.push("ADD COLUMN traffic_source TEXT");
  if (!names.includes("status")) alters.push("ADD COLUMN status TEXT DEFAULT 'Прийнято'");
  if (!names.includes("cancel_reason")) alters.push("ADD COLUMN cancel_reason TEXT");
  for (const stmt of alters) {
    await db.exec(`ALTER TABLE orders ${stmt}`);
  }
}

async function ensureManualMonths(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS manual_months (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL UNIQUE,
      revenue REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      orders INTEGER DEFAULT 0
    );
  `);
}

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

// Adjust supplier balance: kind = payout|payment|set
app.post("/api/suppliers/:id/adjust", async (req, res) => {
  try {
    const db = req.db;
    const supplierId = Number(req.params.id);
    const { kind, amount, note } = req.body;

    if (!supplierId) return res.status(400).json({ error: "supplier required" });
    const exists = await db.get("SELECT id FROM suppliers WHERE id = ?", [supplierId]);
    if (!exists) return res.status(404).json({ error: "supplier not found" });

    if (kind === "set") {
      const target = toNumber(amount);
      const currBalRow = await db.get("SELECT balance FROM suppliers WHERE id = ?", [supplierId]);
      const current = toNumber(currBalRow?.balance);

      const delta = target - current;
      await addAdjustment(db, supplierId, delta, "set", note || "Ручна зміна балансу");
      return res.json({ ok: true, balance: target });
    }

    const sum = toNumber(amount);
    if (!sum || sum < 0) return res.status(400).json({ error: "amount must be > 0" });

    let delta = 0;
    let typeLabel = kind;

    if (kind === "payout") {
      // Ми платимо постачальнику → баланс рухається в бік збільшення (менше боргу)
      delta = sum;
      typeLabel = "Виплата постачальнику";
    } else if (kind === "payment") {
      // Постачальник платить нам → баланс зменшується
      delta = -sum;
      typeLabel = "Оплата від постачальника";
    } else {
      return res.status(400).json({ error: "invalid kind" });
    }

    await addAdjustment(db, supplierId, delta, kind, note || typeLabel);
    const newBal = await db.get("SELECT balance FROM suppliers WHERE id = ?", [supplierId]);
    res.json({ ok: true, balance: newBal.balance });

  } catch (err) {
    console.error("ADJUST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
//        ORDERS ROUTES
// =========================

app.get("/api/orders", async (req, res) => {
  const db = req.db;
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const rows = await db.all(`SELECT * FROM orders ORDER BY id DESC`);

  const touchedSuppliers = new Set();
  for (const row of rows) {
    const fin = computeFinancials(row);
    const normalizedDate = normalizeDate(row.date) || row.date;
    await db.run(
      `UPDATE orders SET
        date=?, sale=?, cost=?, prosail=?, prepay=?, promoPay=?, ourTTN=?, fromSupplier=?,
        isReturn=?, returnDelivery=?, profit=?, supplier_balance=?, traffic_source=?, status=?, cancel_reason=?
       WHERE id=?`,
      [
        normalizedDate,
        fin.sale,
        fin.cost,
        fin.prosail,
        fin.prepay,
        fin.promoPay ? 1 : 0,
        fin.ourTTN ? 1 : 0,
        fin.fromSupplier ? 1 : 0,
        fin.isReturn ? 1 : 0,
        fin.returnDelivery,
        fin.profit,
        fin.supplier_balance,
        row.traffic_source || null,
        row.status || "Прийнято",
        row.cancel_reason || null,
        row.id
      ]
    );
    touchedSuppliers.add(row.supplier_id);
  }

  for (const sid of touchedSuppliers) {
    await recalcSupplierBalance(db, sid);
  }

  const dateFilter = buildDateFilter("o.date", start, end);
  const orders = await db.all(`
    SELECT o.*, s.name AS supplier_name
    FROM orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE 1=1
    ${dateFilter.clause}
    ORDER BY o.id DESC
  `, dateFilter.params);

  res.json(orders);
});

app.get("/api/orders/:id", async (req, res) => {
  const order = await req.db.get(`
    SELECT o.*, s.name AS supplier_name
    FROM orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = ?`,
    [req.params.id]
  );
  if (!order) return res.status(404).json({ error: "Not found" });
  res.json(order);
});

// ------ Create order ------
app.post("/api/orders", async (req, res) => {
  try {
    const data = req.body;
    const db = req.db;

    const normalizedDate = await validateOrder(db, data);
    const financials = computeFinancials(data);
    const orderNumber = (data.order_number || "").trim() || generateOrderNumber();
    if (financials.sale === null || Number.isNaN(financials.sale)) throw new Error("Невірні дані продажу");

    await db.run(
      `INSERT INTO orders 
      (order_number, title, note, date, sale, cost, prosail, prepay,
       supplier_id, promoPay, ourTTN, fromSupplier,
       isReturn, returnDelivery, profit, supplier_balance, traffic_source, status, cancel_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        data.title,
        data.note,
        normalizedDate,
        financials.sale,
        financials.cost,
        financials.prosail,
        financials.prepay,
        data.supplier_id,
        financials.promoPay ? 1 : 0,
        financials.ourTTN ? 1 : 0,
        financials.fromSupplier ? 1 : 0,
        financials.isReturn ? 1 : 0,
        financials.returnDelivery,
        financials.profit,
        financials.supplier_balance,
        data.traffic_source || null,
        data.status || "Прийнято",
        data.cancel_reason || null
      ]
    );

    await recalcSupplierBalance(db, data.supplier_id);

    res.json({ ok: true });

  } catch (err) {
    console.log("ORDER ERROR:", err);
    const code = err.message ? 400 : 500;
    res.status(code).json({ error: err.message || "Server error" });
  }
});

// ------ Update order ------
app.put("/api/orders/:id", async (req, res) => {
  try {
    const data = req.body;
    const db = req.db;
    const id = req.params.id;

    const existing = await db.get("SELECT supplier_id FROM orders WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const normalizedDate = await validateOrder(db, data, { isUpdate: true });
    const financials = computeFinancials(data);
    const orderNumber = (data.order_number || "").trim() || generateOrderNumber();

    await db.run(
      `UPDATE orders SET
        order_number=?, title=?, note=?, date=?, sale=?, cost=?, prosail=?, prepay=?,
        supplier_id=?, promoPay=?, ourTTN=?, fromSupplier=?,
        isReturn=?, returnDelivery=?, profit=?, supplier_balance=?, traffic_source=?, status=?, cancel_reason=?
       WHERE id=?`,
      [
        orderNumber,
        data.title,
        data.note,
        normalizedDate,
        financials.sale,
        financials.cost,
        financials.prosail,
        financials.prepay,
        data.supplier_id,
        financials.promoPay ? 1 : 0,
        financials.ourTTN ? 1 : 0,
        financials.fromSupplier ? 1 : 0,
        financials.isReturn ? 1 : 0,
        financials.returnDelivery,
        financials.profit,
        financials.supplier_balance,
        data.traffic_source || null,
        data.status || "Прийнято",
        data.cancel_reason || null,
        id
      ]
    );

    await recalcSupplierBalancesAfterChange(db, existing.supplier_id, data.supplier_id);

    res.json({ ok: true });

  } catch (err) {
    console.log("UPDATE ERROR:", err);
    const code = err.message ? 400 : 500;
    res.status(code).json({ error: err.message || "Server error" });
  }
});

// ------ Delete order ------
app.delete("/api/orders/:id", async (req, res) => {
  const db = req.db;
  const existing = await db.get("SELECT supplier_id FROM orders WHERE id = ?", [req.params.id]);
  await db.run("DELETE FROM orders WHERE id = ?", [req.params.id]);
  if (existing) await recalcSupplierBalance(db, existing.supplier_id);
  res.json({ ok: true });
});

// =========================
//          STATS
// =========================
app.get("/api/stats/revenue", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("date", start, end);
  const row = await req.db.get(
    `SELECT COALESCE(SUM(sale),0) AS totalSales FROM orders WHERE isReturn = 0 ${dateFilter.clause}`,
    dateFilter.params
  );
  res.json({ totalSales: round2(row.totalSales) });
});

app.get("/api/stats/profit", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("date", start, end);
  const row = await req.db.get(
    `SELECT COALESCE(SUM(profit),0) AS totalProfit FROM orders WHERE 1=1 ${dateFilter.clause}`,
    dateFilter.params
  );
  res.json({ totalProfit: round2(row.totalProfit) });
});

app.get("/api/stats/debts", async (req, res) => {
  const row = await req.db.get("SELECT COALESCE(SUM(balance),0) AS sumBalance FROM suppliers");
  const sumBalance = round2(row.sumBalance);
  const suppliersOwe = sumBalance > 0 ? sumBalance : 0;
  const weOwe = sumBalance < 0 ? Math.abs(sumBalance) : 0;
  res.json({ suppliersOwe, weOwe });
});

app.get("/api/stats/daily", async (req, res) => {
  const planTarget = toNumber(req.query.plan) || 3000;
  const weekendParam = (req.query.weekends || "0").toString();
  const weekendSet = new Set(
    weekendParam.split(",").map(v => Number(v)).filter(v => Number.isInteger(v) && v >= 0 && v <= 6)
  );
  if (!weekendSet.size) weekendSet.add(0);

  const startQuery = normalizeDate(req.query.start);
  const endQuery = normalizeDate(req.query.end);
  const today = endQuery ? new Date(endQuery) : new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 60);
  const startStr = startQuery || defaultStart.toISOString().slice(0, 10);
  const endStr = endQuery || todayStr;

  const dateFilter = buildDateFilter("date", startStr, endStr);
  const orders = await req.db.all(
    `
    SELECT date, sale, profit, traffic_source
    FROM orders
    WHERE 1=1
    ${dateFilter.clause}
  `,
    dateFilter.params.length ? dateFilter.params : []
  );

  const byDate = new Map();
  for (const o of orders) {
    const d = normalizeDate(o.date);
    if (!d) continue;
    const entry = byDate.get(d) || { revenue: 0, profit: 0, count: 0, sources: {} };
    entry.revenue += toNumber(o.sale);
    entry.profit += toNumber(o.profit);
    entry.count += 1;
    const src = o.traffic_source || "Невідомо";
    entry.sources[src] = (entry.sources[src] || 0) + 1;
    byDate.set(d, entry);
  }

  const sortedDates = Array.from(byDate.keys()).sort();

  let shortfall = 0;
  for (const d of sortedDates) {
    if (d >= todayStr) continue;
    const day = new Date(d);
    if (weekendSet.has(day.getDay())) continue;
    const profit = byDate.get(d).profit;
    shortfall += Math.max(0, planTarget - profit);
  }

  const todayData = byDate.get(todayStr) || { revenue: 0, profit: 0, count: 0, sources: {} };
  const todayRemaining = Math.max(0, planTarget - todayData.profit + shortfall);

  // Monthly summary
  const rangeStart = new Date(startStr);
  const rangeEnd = new Date(endStr);
  let workingDays = 0;
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    if (weekendSet.has(d.getDay())) continue;
    workingDays++;
  }

  const monthData = { revenue: 0, profit: 0, count: 0 };
  for (const [dateStr, data] of byDate.entries()) {
    if (dateStr >= startStr && dateStr <= endStr) {
      monthData.revenue += data.revenue;
      monthData.profit += data.profit;
      monthData.count += data.count;
    }
  }

  res.json({
    planTarget,
    shortfall: round2(shortfall),
    today: {
      date: todayStr,
      revenue: round2(todayData.revenue),
      profit: round2(todayData.profit),
      count: todayData.count,
      remaining: round2(todayRemaining),
      sources: todayData.sources
    },
    month: {
      expected: round2(planTarget * workingDays),
      revenue: round2(monthData.revenue),
      profit: round2(monthData.profit),
      orders: monthData.count,
      workingDays
    },
    days: sortedDates.map(d => {
      const day = new Date(d);
      const isWeekend = weekendSet.has(day.getDay());
      const data = byDate.get(d);
      return {
        date: d,
        revenue: round2(data.revenue),
        profit: round2(data.profit),
        count: data.count,
        margin: round2(data.revenue ? (data.profit / data.revenue) * 100 : 0),
        isSunday: day.getDay() === 0,
        isWeekend,
        sources: data.sources
      };
    })
  });
});

app.get("/api/stats/series", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("date", start, end);
  const revenueProfit = await req.db.all(
    `
    SELECT date AS label,
           COALESCE(SUM(sale), 0) AS revenue,
           COALESCE(SUM(profit), 0) AS profit
    FROM orders
    WHERE 1=1
    ${dateFilter.clause}
    GROUP BY date
    ORDER BY date ASC
  `,
    dateFilter.params
  );

  const monthlyActual = await req.db.all(
    `
    SELECT strftime('%Y-%m', date) AS label,
           COALESCE(SUM(sale), 0) AS revenue,
           COALESCE(SUM(profit), 0) AS profit,
           COUNT(*) AS orders
    FROM orders
    WHERE 1=1
    ${dateFilter.clause}
    GROUP BY strftime('%Y-%m', date)
    ORDER BY label ASC
  `,
    dateFilter.params
  );

  const manualMonths = await req.db.all(`
    SELECT month AS label, revenue, profit, orders
    FROM manual_months
    ORDER BY month ASC
  `);

  const monthlyMap = new Map();
  for (const m of monthlyActual) {
    monthlyMap.set(m.label, { ...m });
  }
  for (const m of manualMonths) {
    monthlyMap.set(m.label, { ...m });
  }
  let monthly = Array.from(monthlyMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  if (start || end) {
    monthly = monthly.filter(m => {
      const label = `${m.label}-01`;
      if (start && label < start) return false;
      if (end && label > end) return false;
      return true;
    });
  }

  const suppliers = await req.db.all(`
    SELECT name, balance
    FROM suppliers
    ORDER BY balance DESC
    LIMIT 7
  `);

  const suppliersPerf = await req.db.all(`
    SELECT s.name,
           COALESCE(SUM(o.sale), 0) AS revenue,
           COALESCE(SUM(o.profit), 0) AS profit
    FROM suppliers s
    LEFT JOIN orders o ON o.supplier_id = s.id
    GROUP BY s.id
    ORDER BY profit DESC
  `);

  const totalsRow = await req.db.get(
    `SELECT COALESCE(SUM(sale),0) AS revenue, COALESCE(SUM(profit),0) AS profit, COUNT(*) AS orders FROM orders WHERE 1=1 ${dateFilter.clause}`,
    dateFilter.params
  );
  const overallAvgCheck = totalsRow.orders ? round2(totalsRow.revenue / totalsRow.orders) : 0;

  res.json({
    revenueProfit: revenueProfit.map(r => ({
      label: r.label,
      revenue: round2(r.revenue),
      profit: round2(r.profit)
    })),
    monthly: monthly.map(m => ({
      label: m.label,
      revenue: round2(m.revenue),
      profit: round2(m.profit),
      orders: m.orders,
      avgCheck: m.orders ? round2(m.revenue / m.orders) : 0,
      margin: round2(m.revenue ? (m.profit / m.revenue) * 100 : 0)
    })),
    suppliers: suppliers.map(s => ({ name: s.name, balance: round2(s.balance) })),
    suppliersPerf: suppliersPerf.map(s => ({
      name: s.name,
      revenue: round2(s.revenue),
      profit: round2(s.profit),
      margin: round2(s.revenue ? (s.profit / s.revenue) * 100 : 0)
    })),
    overall: {
      revenue: round2(totalsRow.revenue),
      profit: round2(totalsRow.profit),
      orders: totalsRow.orders,
      avgCheck: overallAvgCheck
    }
  });
});

// Manual monthly entries
app.get("/api/stats/manual-months", async (req, res) => {
  const rows = await req.db.all("SELECT * FROM manual_months ORDER BY month DESC");
  res.json(rows);
});

app.post("/api/stats/manual-months", async (req, res) => {
  try {
    const { month, revenue, profit, orders } = req.body;
    if (!month) return res.status(400).json({ error: "month required" });
    const rev = toNumber(revenue);
    const prof = toNumber(profit);
    const ord = Number.isInteger(orders) ? orders : Number(orders) || 0;

    await req.db.run(
      `INSERT INTO manual_months (month, revenue, profit, orders)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET revenue=excluded.revenue, profit=excluded.profit, orders=excluded.orders`,
      [month, rev, prof, ord]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("MANUAL MONTH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// start
app.listen(PORT, () => {
  console.log("SERVER RUNNING → http://localhost:" + PORT);
});
