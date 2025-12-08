import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
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
const generateOrderNumber = () => `№${Date.now()}`;
const buildDateFilter = (column, start, end) => {
  const parts = [];
  const params = [];
  if (start) {
    params.push(start);
    parts.push(`${column} >= $${params.length}`);
  }
  if (end) {
    params.push(end);
    parts.push(`${column} <= $${params.length}`);
  }
  if (!parts.length) return { clause: "", params: [] };
  return { clause: ` AND ${parts.join(" AND ")}`, params };
};

const q = async (text, params = []) => {
  const res = await query(text, params);
  return res.rows ?? res;
};
const one = async (text, params = []) => {
  const rows = await q(text, params);
  return rows[0] || null;
};
const exec = async (text, params = []) => {
  await query(text, params);
};

const PROMO_PERCENT = 0.175;
const OUR_DELIVERY_PRICE = 60;
const SUPPLIER_DELIVERY_PRICE = 0;

async function ensureTables() {
  await exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      balance NUMERIC DEFAULT 0
    );
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT,
      title TEXT,
      note TEXT,
      date DATE,
      sale NUMERIC,
      cost NUMERIC,
      prosail NUMERIC,
      prepay NUMERIC,
      supplier_id INTEGER REFERENCES suppliers(id),
      promoPay BOOLEAN DEFAULT FALSE,
      ourTTN BOOLEAN DEFAULT FALSE,
      fromSupplier BOOLEAN DEFAULT FALSE,
      isReturn BOOLEAN DEFAULT FALSE,
      returnDelivery NUMERIC DEFAULT 0,
      profit NUMERIC DEFAULT 0,
      supplier_balance NUMERIC DEFAULT 0,
      traffic_source TEXT,
      status TEXT DEFAULT 'Прийнято',
      cancel_reason TEXT
    );
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS supplier_adjustments (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER REFERENCES suppliers(id),
      delta NUMERIC NOT NULL,
      type TEXT,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS manual_months (
      month TEXT PRIMARY KEY,
      revenue NUMERIC DEFAULT 0,
      profit NUMERIC DEFAULT 0,
      orders INTEGER DEFAULT 0
    );
  `);
}

async function recalcSupplierBalance(supplierId) {
  if (!supplierId) return;
  const orderRow = await one(
    `SELECT COALESCE(SUM(supplier_balance),0) AS balance FROM orders WHERE supplier_id = $1`,
    [supplierId]
  );
  const adjRow = await one(
    `SELECT COALESCE(SUM(delta),0) AS adj FROM supplier_adjustments WHERE supplier_id = $1`,
    [supplierId]
  );
  const balance = round2(toNumber(orderRow?.balance) + toNumber(adjRow?.adj));
  await exec(`UPDATE suppliers SET balance = $1 WHERE id = $2`, [balance, supplierId]);
  return balance;
}

async function addAdjustment(supplierId, delta, type = "manual", note = "") {
  await exec(
    `INSERT INTO supplier_adjustments (supplier_id, delta, type, note) VALUES ($1, $2, $3, $4)`,
    [supplierId, round2(delta), type, note]
  );
  return recalcSupplierBalance(supplierId);
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
    const returnCost = baseReturnDelivery;
    const supplierDeliveryCost = fromSupplier ? SUPPLIER_DELIVERY_PRICE : 0;
    const profitRaw = -(returnCost + baseProsail);
    const supplierBalanceChange = -returnCost - supplierDeliveryCost;
    return {
      sale: 0,
      cost: round2(baseCost),
      prosail: 0,
      prepay: round2(basePrepay),
      returnDelivery: round2(returnCost),
      profit: round2(profitRaw),
      supplier_balance: round2(supplierBalanceChange),
      promoPay,
      ourTTN,
      fromSupplier,
      isReturn,
      status
    };
  }

  const sale = baseSale;
  const cost = baseCost;
  const prosail = baseProsail;
  const prepay = basePrepay;
  const returnDelivery = baseReturnDelivery;

  const promoFee = promoPay ? sale * PROMO_PERCENT : 0;
  const deliveryCost = ourTTN ? OUR_DELIVERY_PRICE : 0;
  const supplierDeliveryCost = fromSupplier ? SUPPLIER_DELIVERY_PRICE : 0;
  const returnCost = returnDelivery;

  // Базовий прибуток: Продаж - Опт - ProSale
  let profitRaw = sale - cost - prosail;

  let supplierBalanceChange = 0;
  switch (status) {
    case "Відмова":
      profitRaw = -(deliveryCost + returnCost);
      supplierBalanceChange = 0;
      break;
    case "Повернення":
      profitRaw = -(returnCost + prosail);
      supplierBalanceChange = -returnCost;
      break;
    case "Під замовлення":
      profitRaw = prepay - prosail - deliveryCost;
      supplierBalanceChange = 0;
      break;
    case "Скасовано":
      profitRaw = 0;
      supplierBalanceChange = 0;
      break;
    default:
      if (fromSupplier) {
        supplierBalanceChange = sale - cost;
      } else if (ourTTN || promoPay) {
        supplierBalanceChange = -cost;
      } else {
        supplierBalanceChange = sale - cost;
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

async function validateOrder(data) {
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

  const exists = await one(`SELECT id FROM suppliers WHERE id = $1`, [supplierId]);
  if (!exists) throw new Error("Постачальник не знайдений");

  return normalizedDate;
}

async function recalcSupplierBalancesAfterChange(oldSupplierId, newSupplierId) {
  const uniq = new Set([oldSupplierId, newSupplierId].filter(Boolean));
  for (const id of uniq) {
    await recalcSupplierBalance(id);
  }
}

// ---------- SUPPLIERS ----------
app.get("/api/suppliers", async (_req, res) => {
  const suppliers = await q(`SELECT * FROM suppliers ORDER BY id DESC`);
  res.json(suppliers);
});

app.post("/api/suppliers", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  await exec(`INSERT INTO suppliers (name) VALUES ($1)`, [name]);
  res.json({ ok: true });
});

app.post("/api/suppliers/:id/adjust", async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    const { kind, amount, note } = req.body;
    if (!supplierId) return res.status(400).json({ error: "supplier required" });
    const exists = await one(`SELECT id, balance FROM suppliers WHERE id = $1`, [supplierId]);
    if (!exists) return res.status(404).json({ error: "supplier not found" });

    if (kind === "set") {
      const target = round2(toNumber(amount));
      const current = round2(toNumber(exists.balance));
      const delta = target - current;
      await addAdjustment(supplierId, delta, "set", note || "Ручна зміна балансу");
      return res.json({ ok: true, balance: target });
    }

    const sum = toNumber(amount);
    if (!sum || sum < 0) return res.status(400).json({ error: "amount must be > 0" });

    let delta = 0;
    let typeLabel = kind;
    if (kind === "payout") {
      delta = sum;
      typeLabel = "Виплата постачальнику";
    } else if (kind === "payment") {
      delta = -sum;
      typeLabel = "Оплата від постачальника";
    } else {
      return res.status(400).json({ error: "invalid kind" });
    }

    const balance = await addAdjustment(supplierId, delta, kind, note || typeLabel);
    res.json({ ok: true, balance });
  } catch (err) {
    console.error("ADJUST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- ORDERS ----------
app.get("/api/orders", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("o.date", start, end);

  const orders = await q(
    `
    SELECT o.*, s.name AS supplier_name
    FROM orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE 1=1
    ${dateFilter.clause}
    ORDER BY o.id DESC
  `,
    dateFilter.params
  );
  res.json(orders);
});

app.get("/api/orders/:id", async (req, res) => {
  const order = await one(
    `
    SELECT o.*, s.name AS supplier_name
    FROM orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = $1
  `,
    [req.params.id]
  );
  if (!order) return res.status(404).json({ error: "Not found" });
  res.json(order);
});

app.post("/api/orders", async (req, res) => {
  try {
    const data = req.body;
    const normalizedDate = await validateOrder(data);
    const fin = computeFinancials(data);
    const orderNumber = (data.order_number || "").trim() || generateOrderNumber();

    await exec(
      `
      INSERT INTO orders
      (order_number, title, note, date, sale, cost, prosail, prepay, supplier_id,
       promoPay, ourTTN, fromSupplier, isReturn, returnDelivery, profit, supplier_balance,
       traffic_source, status, cancel_reason)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12,$13,$14,$15,$16,
       $17,$18,$19)
    `,
      [
        orderNumber,
        data.title,
        data.note,
        normalizedDate,
        fin.sale,
        fin.cost,
        fin.prosail,
        fin.prepay,
        data.supplier_id,
        fin.promoPay,
        fin.ourTTN,
        fin.fromSupplier,
        fin.isReturn,
        fin.returnDelivery,
        fin.profit,
        fin.supplier_balance,
        data.traffic_source || null,
        data.status || "Прийнято",
        data.cancel_reason || null
      ]
    );

    await recalcSupplierBalance(data.supplier_id);
    res.json({ ok: true });
  } catch (err) {
    console.error("ORDER CREATE ERROR:", err);
    res.status(400).json({ error: err.message || "Server error" });
  }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const data = req.body;
    const normalizedDate = await validateOrder(data);
    const fin = computeFinancials(data);

    await exec(
      `
      UPDATE orders SET
        order_number=$1, title=$2, note=$3, date=$4,
        sale=$5, cost=$6, prosail=$7, prepay=$8,
        supplier_id=$9, promoPay=$10, ourTTN=$11, fromSupplier=$12,
        isReturn=$13, returnDelivery=$14, profit=$15, supplier_balance=$16,
        traffic_source=$17, status=$18, cancel_reason=$19
      WHERE id=$20
    `,
      [
        data.order_number || existing.order_number,
        data.title,
        data.note,
        normalizedDate,
        fin.sale,
        fin.cost,
        fin.prosail,
        fin.prepay,
        data.supplier_id,
        fin.promoPay,
        fin.ourTTN,
        fin.fromSupplier,
        fin.isReturn,
        fin.returnDelivery,
        fin.profit,
        fin.supplier_balance,
        data.traffic_source || null,
        data.status || "Прийнято",
        data.cancel_reason || null,
        id
      ]
    );

    await recalcSupplierBalancesAfterChange(existing.supplier_id, data.supplier_id);
    res.json({ ok: true });
  } catch (err) {
    console.error("ORDER UPDATE ERROR:", err);
    res.status(400).json({ error: err.message || "Server error" });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT supplier_id FROM orders WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: "Not found" });

    await exec(`DELETE FROM orders WHERE id = $1`, [id]);
    await recalcSupplierBalance(existing.supplier_id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- STATS ----------
app.get("/api/stats/revenue", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("date", start, end);
  const row = await one(
    `SELECT COALESCE(SUM(sale),0) AS totalSales FROM orders WHERE isReturn = FALSE ${dateFilter.clause}`,
    dateFilter.params
  );
  const totalSales = round2(toNumber(row?.totalsales ?? row?.totalSales ?? 0));
  res.json({ totalSales });
});

app.get("/api/stats/profit", async (req, res) => {
  const start = normalizeDate(req.query.start);
  const end = normalizeDate(req.query.end);
  const dateFilter = buildDateFilter("date", start, end);
  const row = await one(
    `SELECT COALESCE(SUM(profit),0) AS totalProfit FROM orders WHERE 1=1 ${dateFilter.clause}`,
    dateFilter.params
  );
  const totalProfit = round2(toNumber(row?.totalprofit ?? row?.totalProfit ?? 0));
  res.json({ totalProfit });
});

app.get("/api/stats/debts", async (_req, res) => {
  const row = await one(`SELECT COALESCE(SUM(balance),0) AS sumBalance FROM suppliers`, []);
  const sumBalance = round2(row?.sumbalance || row?.sumBalance || 0);
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
  const orders = await q(
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

  const revenueProfit = await q(
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

  const monthlyActual = await q(
    `
    SELECT to_char(date, 'YYYY-MM') AS label,
           COALESCE(SUM(sale), 0) AS revenue,
           COALESCE(SUM(profit), 0) AS profit,
           COUNT(*) AS orders
    FROM orders
    WHERE 1=1
    ${dateFilter.clause}
    GROUP BY to_char(date, 'YYYY-MM')
    ORDER BY label ASC
  `,
    dateFilter.params
  );

  const manualMonths = await q(
    `SELECT month AS label, revenue, profit, orders FROM manual_months ORDER BY month ASC`
  );

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

  const suppliers = await q(
    `
    SELECT name, balance
    FROM suppliers
    ORDER BY balance DESC
    LIMIT 7
  `
  );

  const suppliersPerf = await q(
    `
    SELECT s.name,
           COALESCE(SUM(o.sale), 0) AS revenue,
           COALESCE(SUM(o.profit), 0) AS profit
    FROM suppliers s
    LEFT JOIN orders o ON o.supplier_id = s.id
    WHERE 1=1
    ${dateFilter.clause.replace(/date/g, "o.date")}
    GROUP BY s.id
    ORDER BY profit DESC
  `,
    dateFilter.params
  );

  const totalsRow = await one(
    `SELECT COALESCE(SUM(sale),0) AS revenue, COALESCE(SUM(profit),0) AS profit, COUNT(*) AS orders FROM orders WHERE 1=1 ${dateFilter.clause}`,
    dateFilter.params
  );
  const overallAvgCheck = totalsRow?.orders ? round2(toNumber(totalsRow.revenue) / Number(totalsRow.orders)) : 0;

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
      orders: Number(m.orders) || 0,
      margin: round2(m.revenue ? (m.profit / m.revenue) * 100 : 0)
    })),
    suppliers: suppliers.map(s => ({
      label: s.name,
      value: round2(s.balance)
    })),
    suppliersPerf: suppliersPerf.map(s => ({
      label: s.name,
      revenue: round2(s.revenue),
      profit: round2(s.profit),
      margin: round2(s.revenue ? (s.profit / s.revenue) * 100 : 0)
    })),
    avgCheck: overallAvgCheck
  });
});

app.get("/api/stats/manual-months", async (_req, res) => {
  const rows = await q(`SELECT * FROM manual_months ORDER BY month DESC`);
  res.json(rows);
});

app.post("/api/stats/manual-months", async (req, res) => {
  try {
    const { month, revenue, profit, orders } = req.body;
    if (!month) return res.status(400).json({ error: "month required" });
    const rev = toNumber(revenue);
    const prof = toNumber(profit);
    const ord = Number.isInteger(orders) ? orders : Number(orders) || 0;

    await exec(
      `
      INSERT INTO manual_months (month, revenue, profit, orders)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (month) DO UPDATE
        SET revenue = EXCLUDED.revenue,
            profit = EXCLUDED.profit,
            orders = EXCLUDED.orders
    `,
      [month, rev, prof, ord]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("MANUAL MONTH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.status(404).send("Not Found");
});

ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SERVER RUNNING on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Failed to init tables:", err);
    process.exit(1);
  });
