import express from "express";
import { db } from "../app.js";

const router = express.Router();

// ---------- GET ALL ORDERS ----------
router.get("/", async (req, res) => {
  const rows = await db.all("SELECT * FROM orders ORDER BY id DESC");
  res.json(rows);
});

// ---------- ADD ORDER ----------
router.post("/", async (req, res) => {
  try {
    const {
      order_number,
      title,
      note,
      date,
      sale,
      cost,
      prosail,
      prepay,
      supplier_id,
      promoPay,
      ourTTN,
      fromSupplier,
      isReturn,
      returnDelivery
    } = req.body;

    // --------- Обчислення балансу постачальника ----------
    let supplier_balance = 0;
    let profit = 0;

    if (isReturn) {
      // Повернення
      supplier_balance = 0;
      profit = -(prosail + returnDelivery);
    } else {
      if (promoPay || ourTTN) {
        // Ми винні постачальнику (мінус)
        supplier_balance = -cost;
      } else {
        // Постачальник винен нам
        supplier_balance = sale - cost;
      }

      profit = sale - cost - prosail + prepay;
    }

    // ----- INSERT ORDER -----
    await db.run(
      `
      INSERT INTO orders (
        order_number, title, note, date,
        sale, cost, prosail, prepay,
        supplier_id, supplier_balance,
        promoPay, ourTTN, fromSupplier,
        isReturn, returnDelivery,
        profit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        order_number,
        title,
        note,
        date,
        sale,
        cost,
        prosail,
        prepay,
        supplier_id,
        supplier_balance,
        promoPay ? 1 : 0,
        ourTTN ? 1 : 0,
        fromSupplier ? 1 : 0,
        isReturn ? 1 : 0,
        returnDelivery,
        profit
      ]
    );

    // -------- UPDATE supplier balance --------
    await db.run(
      `UPDATE suppliers SET balance = balance + ? WHERE id = ?`,
      [supplier_balance, supplier_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.log("ORDER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
