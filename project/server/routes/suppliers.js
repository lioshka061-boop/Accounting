import express from "express";
import { db } from "../app.js";

const router = express.Router();

// GET all suppliers
router.get("/", async (req, res) => {
  const rows = await db.all("SELECT * FROM suppliers");
  res.json(rows);
});

// ADD supplier
router.post("/", async (req, res) => {
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "Назва обов'язкова" });

  await db.run("INSERT INTO suppliers (name, balance) VALUES (?, ?)", [name, 0]);

  res.json({ ok: true });
});

export default router;
