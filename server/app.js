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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ======================== DB INIT HELPERS ============================

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      balance NUMERIC DEFAULT 0
    );
  `);

  await query(`
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
      promo_pay BOOLEAN DEFAULT FALSE,
      our_ttn BOOLEAN DEFAULT FALSE,
      from_supplier BOOLEAN DEFAULT FALSE,
      is_return BOOLEAN DEFAULT FALSE,
      return_delivery NUMERIC DEFAULT 0,
      traffic_source TEXT,
      status TEXT DEFAULT 'Прийнято'
    );
  `);

  // Ensure new columns exist on older deployments
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS profit NUMERIC DEFAULT 0;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS supplier_balance_change NUMERIC DEFAULT 0;
  `);

  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS promo_pay BOOLEAN DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS our_ttn BOOLEAN DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS from_supplier BOOLEAN DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS return_delivery NUMERIC DEFAULT 0;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS traffic_source TEXT;
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Прийнято';
  `);

  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS supplier_adjustments (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS manual_months (
      id SERIAL PRIMARY KEY,
      month TEXT UNIQUE NOT NULL,
      revenue NUMERIC DEFAULT 0,
      profit NUMERIC DEFAULT 0,
      orders INTEGER DEFAULT 0
    );
  `);
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(val) {
  if (!val) return null;
  // If already ISO-like (yyyy-mm-dd), return as is
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  // If in format dd.mm.yyyy – convert
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) {
    const [dd, mm, yyyy] = val.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  // Fallback: let Postgres try to parse
  return val;
}

function computeFinancials(payload) {
  const sale = toNumber(payload.sale);
  const cost = toNumber(payload.cost);
  const prosail = toNumber(payload.prosail);
  const prepay = toNumber(payload.prepay);
  const returnDelivery = toNumber(payload.returnDelivery);
  const isReturn = !!payload.isReturn;
  const promoPay = !!payload.promoPay;
  const ourTTN = !!payload.ourTTN;
  const fromSupplier = !!payload.fromSupplier;
  const status = payload.status || "Прийнято";

  let profit;
  let supplierBalanceChange;

  if (isReturn) {
    profit = -returnDelivery;
    supplierBalanceChange = cost;
  } else {
    const fullProfit = sale - cost - prosail;

    if (status === "Під замовлення") {
      // Під замовлення:
      // одразу визнаємо прибуток лише з передплати мінус ProSale,
      // постачальнику поки що нічого не винні.
      profit = prepay - prosail;
      supplierBalanceChange = 0;
    } else {
      // Звичайне/виконане замовлення:
      // повний прибуток: продаж - опт - ProSale
      profit = fullProfit;

      // Баланс постачальника.
      // Промоплата або наша ТТН -> ми винні опт.
      // Відправка від постачальника (його ТТН) -> постачальник винен нам маржу.
      if (fromSupplier && !promoPay && !ourTTN) {
        supplierBalanceChange = sale - cost; // постачальник нам винен
      } else {
        supplierBalanceChange = -cost; // ми винні постачальнику
      }
    }
  }

  return {
    sale,
    cost,
    prosail,
    returnDelivery,
    profit,
    supplierBalanceChange
  };
}

// =========================== SUPPLIERS ===============================

app.get("/api/suppliers", async (req, res) => {
  try {
    const result = await query(
      `
      SELECT
        s.id,
        s.name,
        COALESCE(SUM(o.supplier_balance_change), 0) +
        COALESCE(SUM(a.amount), 0) AS balance
      FROM suppliers s
      LEFT JOIN orders o ON o.supplier_id = s.id
      LEFT JOIN supplier_adjustments a ON a.supplier_id = s.id
      GROUP BY s.id, s.name
      ORDER BY s.id ASC
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/suppliers error:", err);
    res.status(500).json({ error: "Failed to load suppliers" });
  }
});

app.post("/api/suppliers", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const result = await query(
      "INSERT INTO suppliers(name) VALUES($1) RETURNING id, name, balance",
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/suppliers error:", err);
    res.status(500).json({ error: "Failed to add supplier" });
  }
});

app.post("/api/suppliers/:id/adjust", async (req, res) => {
  const supplierId = Number(req.params.id);
  const { kind, amount, note } = req.body || {};
  const amt = toNumber(amount);

  if (!supplierId || !kind || !amt) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const currentRes = await query(
      "SELECT balance FROM suppliers WHERE id = $1",
      [supplierId]
    );
    if (!currentRes.rows.length) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    let newBalance;
    if (kind === "set") {
      newBalance = amt;
    } else {
      newBalance = toNumber(currentRes.rows[0].balance) + amt;
    }

    await query(
      "UPDATE suppliers SET balance = $1 WHERE id = $2",
      [newBalance, supplierId]
    );

    // Adjustment history is optional: if table/schema differs from expectation,
    // логіку балансу не ламаємо.
    try {
      await query(
        "INSERT INTO supplier_adjustments(supplier_id, kind, amount, note) VALUES($1,$2,$3,$4)",
        [supplierId, kind, amt, note || ""]
      );
    } catch (historyErr) {
      console.error("supplier_adjustments insert error (ignored):", historyErr);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/suppliers/:id/adjust error:", err);
    res.status(500).json({ error: "Failed to adjust supplier" });
  }
});

// ============================ ORDERS =================================

function buildDateFilter(queryObj, params) {
  const where = [];
  if (queryObj.start) {
    params.push(queryObj.start);
    where.push(`date >= $${params.length}`);
  }
  if (queryObj.end) {
    params.push(queryObj.end);
    where.push(`date <= $${params.length}`);
  }
  return where.length ? "WHERE " + where.join(" AND ") : "";
}

function mapOrderRow(row) {
  return {
    id: row.id,
    order_number: row.order_number,
    title: row.title,
    note: row.note,
    date: row.date,
    sale: Number(row.sale ?? 0),
    cost: Number(row.cost ?? 0),
    prosail: Number(row.prosail ?? 0),
    prepay: Number(row.prepay ?? 0),
    supplier_id: row.supplier_id,
    promoPay: row.promo_pay,
    ourTTN: row.our_ttn,
    fromSupplier: row.from_supplier,
    isReturn: row.is_return,
    returnDelivery: Number(row.return_delivery ?? 0),
    traffic_source: row.traffic_source,
    status: row.status,
    cancel_reason: row.cancel_reason,
    profit: Number(row.profit ?? 0),
    supplier_balance_change: Number(row.supplier_balance_change ?? 0),
    supplier_name: row.supplier_name
  };
}

app.get("/api/orders", async (req, res) => {
  try {
    const params = [];
    const where = buildDateFilter(req.query, params);
    const sql = `
      SELECT o.*,
             s.name AS supplier_name,
             COALESCE(
               (SELECT SUM(supplier_balance_change) FROM orders oo WHERE oo.supplier_id = o.supplier_id),
               0
             ) AS supplier_balance
      FROM orders o
      LEFT JOIN suppliers s ON s.id = o.supplier_id
      ${where}
      ORDER BY o.date DESC NULLS LAST, o.id DESC
    `;
    const result = await query(sql, params);
    res.json(result.rows.map(mapOrderRow));
  } catch (err) {
    console.error("GET /api/orders error:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const sql = `
      SELECT o.*,
             s.name AS supplier_name
      FROM orders o
      LEFT JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.id = $1
    `;
    const result = await query(sql, [id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(mapOrderRow(result.rows[0]));
  } catch (err) {
    console.error("GET /api/orders/:id error:", err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.supplier_id) {
      return res.status(400).json({ error: "supplier_id is required" });
    }
    const fin = computeFinancials(payload);

    const completedAt =
      payload.status === "Виконано" ? new Date().toISOString() : null;

    const insertSql = `
      INSERT INTO orders(
        order_number, title, note, date,
        sale, cost, prosail, prepay,
        supplier_id,
        promo_pay, our_ttn, from_supplier,
        is_return, return_delivery,
        traffic_source,
        status, cancel_reason,
        completed_at,
        profit, supplier_balance_change
      )
      VALUES(
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,
        $10,$11,$12,
        $13,$14,
        $15,
        $16,$17,
        $18,
        $19,$20
      )
      RETURNING *;
    `;

    const values = [
      payload.order_number || null,
      payload.title || null,
      payload.note || null,
      normalizeDate(payload.date),
      fin.sale,
      fin.cost,
      fin.prosail,
      toNumber(payload.prepay),
      payload.supplier_id,
      !!payload.promoPay,
      !!payload.ourTTN,
      !!payload.fromSupplier,
      !!payload.isReturn,
      fin.returnDelivery,
      payload.traffic_source || null,
      payload.status || "Прийнято",
      payload.cancel_reason || "",
      completedAt,
      fin.profit,
      fin.supplierBalanceChange
    ];

    const result = await query(insertSql, values);

    await query(
      "UPDATE suppliers SET balance = COALESCE(balance,0) + $1 WHERE id = $2",
      [fin.supplierBalanceChange, payload.supplier_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/orders error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

app.put("/api/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const existingRes = await query(
      "SELECT supplier_id, supplier_balance_change, status, completed_at FROM orders WHERE id = $1",
      [id]
    );
    if (!existingRes.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }
    const existing = existingRes.rows[0];

    const payload = req.body || {};
    const fin = computeFinancials(payload);

    const becameCompleted =
      existing.status !== "Виконано" && payload.status === "Виконано";
    const noLongerCompleted =
      existing.status === "Виконано" && payload.status !== "Виконано";

    let completedAt = existing.completed_at;
    if (becameCompleted) {
      completedAt = new Date().toISOString();
    } else if (noLongerCompleted) {
      completedAt = null;
    }

    const updateSql = `
      UPDATE orders SET
        order_number = $1,
        title = $2,
        note = $3,
        date = $4,
        sale = $5,
        cost = $6,
        prosail = $7,
        prepay = $8,
        supplier_id = $9,
        promo_pay = $10,
        our_ttn = $11,
        from_supplier = $12,
        is_return = $13,
        return_delivery = $14,
        traffic_source = $15,
        status = $16,
        cancel_reason = $17,
        completed_at = $18,
        profit = $19,
        supplier_balance_change = $20
      WHERE id = $21
      RETURNING *;
    `;

    const values = [
      payload.order_number || null,
      payload.title || null,
      payload.note || null,
      normalizeDate(payload.date),
      fin.sale,
      fin.cost,
      fin.prosail,
      toNumber(payload.prepay),
      payload.supplier_id,
      !!payload.promoPay,
      !!payload.ourTTN,
      !!payload.fromSupplier,
      !!payload.isReturn,
      fin.returnDelivery,
      payload.traffic_source || null,
      payload.status || "Прийнято",
      payload.cancel_reason || "",
      completedAt,
      fin.profit,
      fin.supplierBalanceChange,
      id
    ];

    const result = await query(updateSql, values);

    // revert old balance
    await query(
      "UPDATE suppliers SET balance = COALESCE(balance,0) - $1 WHERE id = $2",
      [existing.supplier_balance_change, existing.supplier_id]
    );
    // apply new balance
    await query(
      "UPDATE suppliers SET balance = COALESCE(balance,0) + $1 WHERE id = $2",
      [fin.supplierBalanceChange, payload.supplier_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/orders/:id error:", err);
    res.status(500).json({ error: "Failed to update order" });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const existingRes = await query(
      "SELECT supplier_id, supplier_balance_change FROM orders WHERE id = $1",
      [id]
    );
    if (!existingRes.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }
    const existing = existingRes.rows[0];

    await query("DELETE FROM orders WHERE id = $1", [id]);
    await query(
      "UPDATE suppliers SET balance = COALESCE(balance,0) - $1 WHERE id = $2",
      [existing.supplier_balance_change, existing.supplier_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/orders/:id error:", err);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// ============================= STATS ================================

app.get("/api/stats/revenue", async (req, res) => {
  try {
    const params = [];
    const where = buildDateFilter(req.query, params);
    const result = await query(
      `SELECT COALESCE(SUM(sale),0) AS total_sales FROM orders ${where}`,
      params
    );
    res.json({ totalSales: Number(result.rows[0].total_sales || 0) });
  } catch (err) {
    console.error("GET /api/stats/revenue error:", err);
    res.status(500).json({ error: "Failed to load revenue" });
  }
});

app.get("/api/stats/profit", async (req, res) => {
  try {
    const params = [];
    const where = buildDateFilter(req.query, params);
    const result = await query(
      `SELECT COALESCE(SUM(profit),0) AS total_profit FROM orders ${where}`,
      params
    );
    res.json({ totalProfit: Number(result.rows[0].total_profit || 0) });
  } catch (err) {
    console.error("GET /api/stats/profit error:", err);
    res.status(500).json({ error: "Failed to load profit" });
  }
});

app.get("/api/stats/debts", async (req, res) => {
  try {
    const result = await query(
      "SELECT COALESCE(SUM(balance) FILTER (WHERE balance > 0),0) AS suppliers_owe, COALESCE(SUM(balance) FILTER (WHERE balance < 0),0) AS we_owe FROM suppliers"
    );
    const row = result.rows[0] || {};
    const suppliersOwe = Number(row.suppliers_owe || 0);
    const weOwe = Number(row.we_owe || 0);
    res.json({
      suppliersOwe,
      weOwe: Math.abs(weOwe)
    });
  } catch (err) {
    console.error("GET /api/stats/debts error:", err);
    res.status(500).json({ error: "Failed to load debts" });
  }
});

app.get("/api/stats/series", async (req, res) => {
  try {
    const params = [];
    const where = buildDateFilter(req.query, params);

    const revenueProfitRes = await query(
      `
      SELECT
        date::date AS day,
        COALESCE(SUM(sale),0) AS revenue,
        COALESCE(SUM(profit),0) AS profit
      FROM orders
      ${where}
      GROUP BY day
      ORDER BY day
      `,
      params
    );

    const suppliersRes = await query(
      "SELECT name, COALESCE(balance,0) AS balance FROM suppliers ORDER BY name"
    );

    const monthlyRes = await query(
      `
      SELECT
        to_char(date, 'YYYY-MM') AS label,
        COALESCE(SUM(sale),0) AS revenue,
        COALESCE(SUM(profit),0) AS profit,
        COUNT(*) AS orders
      FROM orders
      ${where}
      GROUP BY label
      ORDER BY label
      `,
      params
    );

    const suppliersPerfRes = await query(
      `
      SELECT
        s.name,
        COALESCE(SUM(o.sale),0) AS revenue,
        COALESCE(SUM(o.profit),0) AS profit
      FROM orders o
      LEFT JOIN suppliers s ON s.id = o.supplier_id
      ${where}
      GROUP BY s.name
      ORDER BY s.name
      `,
      params
    );

    const overallRes = await query(
      `
      SELECT
        COALESCE(SUM(sale),0) AS revenue,
        COALESCE(SUM(profit),0) AS profit,
        COUNT(*) AS orders
      FROM orders
      ${where}
      `,
      params
    );

    const overallRow = overallRes.rows[0] || {};
    const overallRevenue = Number(overallRow.revenue || 0);
    const overallProfit = Number(overallRow.profit || 0);
    const overallOrders = Number(overallRow.orders || 0);

    const revenueProfit = revenueProfitRes.rows.map((r) => ({
      label: r.day,
      revenue: Number(r.revenue || 0),
      profit: Number(r.profit || 0)
    }));

    const suppliers = suppliersRes.rows.map((r) => ({
      name: r.name,
      balance: Number(r.balance || 0)
    }));

    const monthly = monthlyRes.rows.map((r) => {
      const revenue = Number(r.revenue || 0);
      const profit = Number(r.profit || 0);
      const orders = Number(r.orders || 0);
      const avgCheck = orders ? revenue / orders : 0;
      const margin = revenue ? (profit / revenue) * 100 : 0;
      return {
        label: r.label,
        revenue,
        profit,
        orders,
        avgCheck,
        margin
      };
    });

    const suppliersPerf = suppliersPerfRes.rows.map((r) => {
      const revenue = Number(r.revenue || 0);
      const profit = Number(r.profit || 0);
      const margin = revenue ? (profit / revenue) * 100 : 0;
      return {
        name: r.name || "Невідомий",
        profit,
        margin
      };
    });

    res.json({
      revenueProfit,
      suppliers,
      monthly,
      suppliersPerf,
      overall: {
        revenue: overallRevenue,
        profit: overallProfit,
        orders: overallOrders,
        avgCheck: overallOrders ? overallRevenue / overallOrders : 0
      }
    });
  } catch (err) {
    console.error("GET /api/stats/series error:", err);
    res.status(500).json({ error: "Failed to load stats series" });
  }
});

app.get("/api/stats/manual-months", async (req, res) => {
  try {
    const result = await query(
      "SELECT month, revenue, profit, orders FROM manual_months ORDER BY month"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/stats/manual-months error:", err);
    res.status(500).json({ error: "Failed to load manual months" });
  }
});

app.post("/api/stats/manual-months", async (req, res) => {
  try {
    const { month, revenue, profit, orders } = req.body || {};
    if (!month) {
      return res.status(400).json({ error: "month is required" });
    }
    await query(
      `
      INSERT INTO manual_months(month, revenue, profit, orders)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (month)
      DO UPDATE SET revenue = EXCLUDED.revenue, profit = EXCLUDED.profit, orders = EXCLUDED.orders
      `,
      [month, toNumber(revenue), toNumber(profit), Number(orders) || 0]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/stats/manual-months error:", err);
    res.status(500).json({ error: "Failed to save manual month" });
  }
});

// Simple daily stats implementation used by dashboard
app.get("/api/stats/daily", async (req, res) => {
  try {
    const plan = toNumber(req.query.plan) || 3000;
    const weekendsParam = (req.query.weekends || "").toString();
    const weekendSet = new Set(
      weekendsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    );

    const params = [];
    const where = buildDateFilter(req.query, params) || "WHERE date >= date_trunc('month', CURRENT_DATE)";

    const result = await query(
      `
      SELECT
        date::date AS day,
        COALESCE(SUM(sale),0) AS revenue,
        COALESCE(SUM(profit),0) AS profit,
        COUNT(*) AS count
      FROM orders
      ${where}
      GROUP BY day
      ORDER BY day
      `,
      params
    );

    const days = [];
    let monthRevenue = 0;
    let monthProfit = 0;
    let monthOrders = 0;

    const byDate = new Map();
    for (const row of result.rows) {
      const date = row.day;
      const revenue = Number(row.revenue || 0);
      const profit = Number(row.profit || 0);
      const count = Number(row.count || 0);
      byDate.set(date.toISOString().slice(0, 10), { revenue, profit, count });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const baseDate = result.rows.length
      ? new Date(result.rows[0].day)
      : new Date();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= lastDay; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = dateObj.toISOString().slice(0, 10);
      const weekday = dateObj.getDay(); // 0-6
      const entry = byDate.get(dateStr) || { revenue: 0, profit: 0, count: 0 };
      const revenue = entry.revenue;
      const profit = entry.profit;
      const count = entry.count;
      const margin = revenue ? (profit / revenue) * 100 : 0;

      monthRevenue += revenue;
      monthProfit += profit;
      monthOrders += count;

      days.push({
        date: dateStr,
        revenue,
        profit,
        margin,
        count,
        isSunday: weekday === 0
      });
    }

    const workingDays = days.filter((d) => !weekendSet.has(new Date(d.date).getDay())).length;
    const expectedMonthProfit = plan * workingDays;

    const todayData =
      days.find((d) => d.date === todayStr) || {
        revenue: 0,
        profit: 0,
        count: 0
      };

    res.json({
      today: {
        revenue: todayData.revenue,
        profit: todayData.profit,
        count: todayData.count,
        remaining: Math.max(0, plan - todayData.profit),
        sources: {}
      },
      shortfall: Math.max(0, expectedMonthProfit - monthProfit),
      month: {
        expected: expectedMonthProfit,
        revenue: monthRevenue,
        profit: monthProfit,
        orders: monthOrders
      },
      days
    });
  } catch (err) {
    console.error("GET /api/stats/daily error:", err);
    res.status(500).json({ error: "Failed to load daily stats" });
  }
});

// ============================ FALLBACK ===============================

app.get("/api/test", async (req, res) => {
  try {
    const r = await query("SELECT NOW()");
    res.json({ ok: true, time: r.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server after ensuring tables

ensureTables()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`SERVER RUNNING on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to ensure tables:", err);
    process.exit(1);
  });
