const API = "/api";
const MONEY = (val) => {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};
let chartProfit;
let chartRevenue;
let chartSuppliers;
let chartMargin;
let chartMonthly;
let chartSuppliersPerf;
let monthlySummaryData = [];
let dailyDataCache = null;
let chartDaily;
let currentWeekends = new Set([0]); // 0 = Sunday

const STATUS_COLORS = {
  "Прийнято": "pill-blue",
  "Виконано": "pill-green",
  "Під замовлення": "pill-orange",
  "Відмова": "pill-red",
  "Повернення": "pill-amber",
  "Скасовано": "pill-grey"
};

const getRangeParams = (startId, endId) => {
  const start = document.getElementById(startId)?.value || "";
  const end = document.getElementById(endId)?.value || "";
  const params = new URLSearchParams();
  if (start) params.append("start", start);
  if (end) params.append("end", end);
  return params;
};

// ===================================================================
// ==================== LOAD SUPPLIERS (SELECT+FILTER) =================
// ===================================================================
async function loadSuppliers() {
  try {
    const res = await fetch(`${API}/suppliers`);
    const suppliers = await res.json();

    const createSelect = document.getElementById("order-supplier");
    const editSelect = document.getElementById("edit-supplier");
    const filterSelect = document.getElementById("filter-supplier");
    const table = document.querySelector("#suppliers-table tbody");
    const adjustSelect = document.getElementById("adjust-supplier");

    if (createSelect) {
      createSelect.innerHTML = "";
      suppliers.forEach(s => {
        let opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        createSelect.appendChild(opt);
      });
    }

    if (editSelect) {
      editSelect.innerHTML = "";
      suppliers.forEach(s => {
        let opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        editSelect.appendChild(opt);
      });
    }

    if (filterSelect) {
      filterSelect.innerHTML = `<option value="">Всі постачальники</option>`;
      suppliers.forEach(s => {
        let opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        filterSelect.appendChild(opt);
      });
    }

    if (adjustSelect) {
      adjustSelect.innerHTML = "";
      suppliers.forEach(s => {
        const bal = Number(s.balance ?? 0);
        let opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${s.name} (баланс: ${MONEY(bal)})`;
        adjustSelect.appendChild(opt);
      });
    }

    if (table) {
      table.innerHTML = "";
      suppliers.forEach(s => {
        const row = document.createElement("tr");
        const bal = Number(s.balance ?? 0);
        const statusText =
          bal > 0 ? `Він нам винен ${MONEY(bal)} грн` :
          bal < 0 ? `Ми винні ${MONEY(Math.abs(bal))} грн` :
          "0 грн";

        row.innerHTML = `
          <td>${s.id}</td>
          <td>${s.name}</td>
          <td>${statusText}</td>
          <td><button class="danger" onclick="deleteSupplier(${s.id})">🗑</button></td>
        `;
        table.appendChild(row);
      });
    }

  } catch (err) {
    console.error("Помилка постачальників:", err);
  }
}

async function addSupplier() {
  const input = document.getElementById("supplier-name");
  const name = (input?.value || "").trim();
  if (!name) {
    alert("Вкажіть назву постачальника");
    return;
  }

  const res = await fetch(`${API}/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (!res.ok) {
    alert("Не вдалось додати постачальника");
    return;
  }

  input.value = "";
  showSuccess("Постачальника додано");
  loadSuppliers();
}

async function adjustSupplier() {
  const supplierId = Number(document.getElementById("adjust-supplier")?.value);
  const kind = document.getElementById("adjust-kind")?.value;
  let amount = Number(document.getElementById("adjust-amount")?.value);
  const note = document.getElementById("adjust-note")?.value || "";
  const sign = document.getElementById("adjust-sign")?.value || "positive";

  if (!supplierId || !kind || !amount || amount <= 0) {
    alert("Оберіть постачальника та суму > 0");
    return;
  }

  if (kind === "set" && sign === "negative") {
    amount = -amount;
  }

  const res = await fetch(`${API}/suppliers/${supplierId}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, amount, note })
  });

  if (!res.ok) {
    alert("Не вдалось застосувати операцію");
    return;
  }

  document.getElementById("adjust-amount").value = "";
  document.getElementById("adjust-note").value = "";
  showSuccess("Операцію проведено");
  loadSuppliers();
}

async function deleteSupplier(id) {
  if (!confirm("Точно видалити постачальника?")) return;
  const res = await fetch(`${API}/suppliers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Не вдалось видалити постачальника");
    return;
  }
  showSuccess("Постачальника видалено");
  loadSuppliers();
}

// ===================================================================
// ====================== QUICK STATUS UPDATE ========================
// ===================================================================
async function quickStatus(id, status) {
  try {
    const order = ALL_ORDERS.find(o => o.id === id);
    if (!order) throw new Error("order not found");

    const payload = {
      order_number: order.order_number,
      title: order.title,
      note: order.note,
      date: order.date,
      sale: order.sale,
      cost: order.cost,
      prosail: order.prosail,
      prepay: order.prepay,
      supplier_id: order.supplier_id,
      promoPay: !!order.promoPay,
      ourTTN: !!order.ourTTN,
      fromSupplier: !!order.fromSupplier,
      isReturn: !!order.isReturn,
      returnDelivery: order.returnDelivery,
      traffic_source: order.traffic_source,
      status,
      cancel_reason: order.cancel_reason || ""
    };

    const res = await fetch(`${API}/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    showSuccess("Статус оновлено");
    loadOrders();
  } catch (err) {
    alert("Не вдалося оновити статус");
  }
}

// ===================================================================
// ========================= SUCCESS MESSAGE ===========================
// ===================================================================
function showSuccess(msg) {
  let box = document.getElementById("success-box");

  if (!box) {
    box = document.createElement("div");
    box.id = "success-box";
    box.style.position = "fixed";
    box.style.top = "20px";
    box.style.right = "20px";
    box.style.padding = "12px 18px";
    box.style.background = "#4CAF50";
    box.style.color = "#fff";
    box.style.borderRadius = "8px";
    box.style.fontSize = "16px";
    box.style.zIndex = 9999;
    document.body.appendChild(box);
  }

  box.textContent = msg;
  box.style.display = "block";

  setTimeout(() => {
    box.style.display = "none";
  }, 2000);
}

// ===================================================================
// ========================= RESET CREATE FORM ========================
// ===================================================================
function resetCreateForm() {
  const fields = [
    "order-number", "order-title", "order-note",
    "order-date", "order-sale", "order-cost",
    "order-prosail", "order-prepay"
  ];

  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  document.getElementById("promoPay").checked = false;
  document.getElementById("ourTTN").checked = false;
  document.getElementById("fromSupplier").checked = false;

  document.getElementById("order-number").value = `№${Date.now()}`;
  document.getElementById("order-number").focus();
}

// ===================================================================
// ========================= LOAD ORDERS ===============================
// ===================================================================
let ALL_ORDERS = [];

async function loadOrders(applyFilter = false) {
  try {
    const rangeParams = getRangeParams("filter-start", "filter-end");
    const query = rangeParams.toString();
    const res = await fetch(`${API}/orders${query ? `?${query}` : ""}`);
    const orders = await res.json();
    ALL_ORDERS = orders;
    if (applyFilter) {
      filterAndRender();
    } else {
      renderOrders(orders);
    }
  } catch (err) {
    console.error("Помилка завантаження замовлень:", err);
  }
}

function renderOrders(orders) {
  const table = document.querySelector("#orders-table tbody");
  const cards = document.getElementById("orders-cards");
  if (!table) return;

  table.innerHTML = "";
  if (cards) cards.innerHTML = "";

  orders.forEach(o => {
    const change = Number(o.supplier_balance_change ?? 0);
    const debt =
      change > 0 ? `Він нам: ${MONEY(change)}` :
      change < 0 ? `Ми винні: ${MONEY(Math.abs(change))}` :
      "0 грн";

    const isReturnBadge = o.isReturn ? `<div style="color:#ff9f43;font-weight:700;font-size:12px;">Повернення</div>` : "";
    const statusBadge = o.status ? `<div style="color:#9fb4ff;font-weight:600;font-size:12px;">${o.status}</div>` : "";
    const statusClass = STATUS_COLORS[o.status] || "pill-blue";

    const row = document.createElement("tr");
    if (o.isReturn) row.classList.add("row-return");
    row.innerHTML = `
      <td>${o.id}</td>
      <td>${o.order_number || "-"}</td>
      <td>${o.date || "-"}</td>
      <td>${o.title || "-"} ${isReturnBadge}</td>
      <td>${o.traffic_source || "-"}</td>
      <td>
        <div class="status-pill ${statusClass}">${o.status || "Прийнято"}</div>
        <select class="status-select" onchange="quickStatus(${o.id}, this.value)">
          <option value="Прийнято" ${o.status==="Прийнято"?"selected":""}>Прийнято</option>
          <option value="Виконано" ${o.status==="Виконано"?"selected":""}>Виконано</option>
          <option value="Під замовлення" ${o.status==="Під замовлення"?"selected":""}>Під замовлення</option>
          <option value="Відмова" ${o.status==="Відмова"?"selected":""}>Відмова</option>
          <option value="Повернення" ${o.status==="Повернення"?"selected":""}>Повернення</option>
          <option value="Скасовано" ${o.status==="Скасовано"?"selected":""}>Скасовано</option>
        </select>
      </td>
      <td>${MONEY(o.sale)} грн</td>
      <td>${MONEY(o.cost)} грн</td>
      <td>${MONEY(o.prosail)} грн</td>
      <td>${MONEY(o.prepay)} грн</td>
      <td>${o.supplier_name || "-"}</td>
      <td>${debt}</td>
      <td>${MONEY(o.profit)} грн</td>
      <td>
        <button onclick="openEditModal(${o.id})">✏️</button>
        <button class="danger" onclick="deleteOrder(${o.id})">🗑</button>
      </td>
    `;
    table.appendChild(row);

    if (cards) {
      const card = document.createElement("div");
      card.className = "order-card";
      card.innerHTML = `
        <div class="row"><span class="label">Номер:</span><span>${o.order_number || "-"}</span></div>
        <div class="row"><span class="label">Дата:</span><span>${o.date || "-"}</span></div>
        <div class="row"><span class="label">Назва:</span><span>${o.title || "-"}</span></div>
        <div class="row"><span class="label">Трафік:</span><span>${o.traffic_source || "-"}</span></div>
        <div class="row"><span class="label">Статус:</span><span>${o.status || "-"}</span></div>
        <div class="row"><span class="label">Продаж:</span><span>${MONEY(o.sale)} грн</span></div>
        <div class="row"><span class="label">Опт:</span><span>${MONEY(o.cost)} грн</span></div>
        <div class="row"><span class="label">ProSale:</span><span>${MONEY(o.prosail)} грн</span></div>
        <div class="row"><span class="label">Передплата:</span><span>${MONEY(o.prepay)} грн</span></div>
        <div class="row"><span class="label">Постачальник:</span><span>${o.supplier_name || "-"}</span></div>
        <div class="row"><span class="label">Баланс:</span><span>${debt}</span></div>
        <div class="row"><span class="label">Прибуток:</span><span>${MONEY(o.profit)} грн</span></div>
        <div class="row" style="justify-content:flex-start; gap:8px; margin-top:8px;">
          <button onclick="openEditModal(${o.id})">✏️</button>
          <button class="danger" onclick="deleteOrder(${o.id})">🗑</button>
        </div>
      `;
      cards.appendChild(card);
    }
  });
}

// ===================================================================
// ============================= ADD ORDER ============================
// ===================================================================
async function addOrder() {
  const order_number = document.getElementById("order-number").value;
  const title = document.getElementById("order-title").value;
  const note = document.getElementById("order-note").value;
  const date = document.getElementById("order-date").value;

  const sale = Number(document.getElementById("order-sale").value);
  const cost = Number(document.getElementById("order-cost").value);
  const prosail = Number(document.getElementById("order-prosail").value);
  const prepay = Number(document.getElementById("order-prepay").value);

  const supplier_id = Number(document.getElementById("order-supplier").value);
  const traffic_source = document.getElementById("order-source")?.value || "";
  const status = document.getElementById("order-status")?.value || "Прийнято";
  const cancel_reason = document.getElementById("order-cancel-reason")?.value || "";

  const promoPay = document.getElementById("promoPay").checked;
  const ourTTN = document.getElementById("ourTTN").checked;
  const fromSupplier = document.getElementById("fromSupplier").checked;

  const isReturn = document.getElementById("isReturn")?.checked || false;
  const returnDelivery = Number(document.getElementById("returnDelivery")?.value || 0);

  if (!date) {
    alert("Дата — обов'язкова");
    return;
  }
  if (!isReturn && status !== "Відмова" && status !== "Скасовано" && status !== "Під замовлення") {
    if (!sale || sale < 0) {
      alert("Продаж має бути > 0");
      return;
    }
  }
  if (!supplier_id) {
    alert("Оберіть постачальника");
    return;
  }

  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
      returnDelivery,
      traffic_source,
      status,
      cancel_reason
    })
  });

  if (!res.ok) {
    alert("Помилка створення замовлення!");
    return;
  }

  showSuccess("Замовлення успішно створено!");
  resetCreateForm();
}

// ===================================================================
// ========================= EDIT ORDER ===============================
// ===================================================================
async function openEditModal(id) {
  const res = await fetch(`${API}/orders/${id}`);
  const data = await res.json();

  document.getElementById("edit-id").value = data.id;
  document.getElementById("edit-number").value = data.order_number || "";
  document.getElementById("edit-title").value = data.title || "";
  document.getElementById("edit-note").value = data.note || "";
  document.getElementById("edit-date").value = data.date ? String(data.date).slice(0, 10) : "";
  document.getElementById("edit-sale").value = data.sale;
  document.getElementById("edit-cost").value = data.cost;
  document.getElementById("edit-prosail").value = data.prosail;
  document.getElementById("edit-prepay").value = data.prepay;
  const sourceSelect = document.getElementById("edit-source");
  if (sourceSelect) sourceSelect.value = data.traffic_source || "";
  const statusSelect = document.getElementById("edit-status");
  if (statusSelect) statusSelect.value = data.status || "Прийнято";
  document.getElementById("edit-cancel-reason").value = data.cancel_reason || "";

  document.getElementById("edit-supplier").value = data.supplier_id;

  document.getElementById("edit-promoPay").checked = !!data.promoPay;
  document.getElementById("edit-ourTTN").checked = !!data.ourTTN;
  document.getElementById("edit-fromSupplier").checked = !!data.fromSupplier;

  document.getElementById("edit-return").checked = data.isReturn;
  document.getElementById("edit-returnDelivery").value = data.returnDelivery;

  document.getElementById("edit-modal").classList.remove("hidden");
}

async function saveEditedOrder() {
  const id = document.getElementById("edit-id").value;

  const payload = {
    order_number: document.getElementById("edit-number").value,
    title: document.getElementById("edit-title").value,
    note: document.getElementById("edit-note").value,
    date: document.getElementById("edit-date").value,
    sale: Number(document.getElementById("edit-sale").value),
    cost: Number(document.getElementById("edit-cost").value),
    prosail: Number(document.getElementById("edit-prosail").value),
    prepay: Number(document.getElementById("edit-prepay").value),
    supplier_id: Number(document.getElementById("edit-supplier").value),
    promoPay: document.getElementById("edit-promoPay").checked,
    ourTTN: document.getElementById("edit-ourTTN").checked,
    fromSupplier: document.getElementById("edit-fromSupplier").checked,
    isReturn: document.getElementById("edit-return").checked,
    returnDelivery: Number(document.getElementById("edit-returnDelivery").value),
    traffic_source: document.getElementById("edit-source")?.value || "",
    status: document.getElementById("edit-status")?.value || "Прийнято",
    cancel_reason: document.getElementById("edit-cancel-reason")?.value || ""
  };

  if (!payload.date) {
    alert("Дата — обов'язкова");
    return;
  }
  if (!payload.isReturn && (!payload.sale || payload.sale < 0)) {
    alert("Продаж має бути > 0");
    return;
  }
  if (!payload.supplier_id) {
    alert("Оберіть постачальника");
    return;
  }

  await fetch(`${API}/orders/${id}`, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });

  closeModal();
  loadOrders();
}

function closeModal() {
  document.getElementById("edit-modal").classList.add("hidden");
}

// ===================================================================
// ========================== DELETE ORDER ============================
// ===================================================================
async function deleteOrder(id) {
  if (!confirm("Точно видалити це замовлення?")) return;
  await fetch(`${API}/orders/${id}`, { method: "DELETE" });
  loadOrders();
}

// ===================================================================
// =============================== FILTERS ============================
// ===================================================================
function filterAndRender() {
  const num = document.getElementById("filter-number").value.toLowerCase();
  const title = document.getElementById("filter-title").value.toLowerCase();
  const supplier = document.getElementById("filter-supplier").value;
  const showReturns = document.getElementById("filter-returns").checked;
  const status = document.getElementById("filter-status")?.value || "";
  const start = document.getElementById("filter-start")?.value;
  const end = document.getElementById("filter-end")?.value;

  let filtered = ALL_ORDERS.filter(o => {
    if (num && !(o.order_number || "").toLowerCase().includes(num)) return false;
    if (title && !(o.title || "").toLowerCase().includes(title)) return false;
    if (supplier && o.supplier_id != supplier) return false;
    if (status && o.status !== status) return false;
    if (!showReturns && o.isReturn) return false;
    if (start && (!o.date || o.date < start)) return false;
    if (end && (!o.date || o.date > end)) return false;
    return true;
  });

  renderOrders(filtered);
}

async function applyFilters() {
  await loadOrders(true);
}

function resetFilters() {
  document.getElementById("filter-number").value = "";
  document.getElementById("filter-title").value = "";
  document.getElementById("filter-supplier").value = "";
  document.getElementById("filter-returns").checked = false;
  document.getElementById("filter-status").value = "";
  const fs = document.getElementById("filter-start");
  const fe = document.getElementById("filter-end");
  if (fs) fs.value = "";
  if (fe) fe.value = "";
  loadOrders();
}

// ===================================================================
// ============================= STATS ================================
// ===================================================================
async function loadStats() {
  try {
    const rangeParams = getRangeParams("stats-start", "stats-end");
    const qs = rangeParams.toString();
    const suffix = qs ? `?${qs}` : "";
    const [revRes, profitRes, debtRes, seriesRes] = await Promise.all([
      fetch(`${API}/stats/revenue${suffix}`),
      fetch(`${API}/stats/profit${suffix}`),
      fetch(`${API}/stats/debts${suffix}`),
      fetch(`${API}/stats/series${suffix}`)
    ]);
    const revenue = await revRes.json();
    const profit = await profitRes.json();
    const debts = await debtRes.json();
    const series = await seriesRes.json();

    const totalSalesEl = document.getElementById("total-sales");
    const totalProfitEl = document.getElementById("total-profit");
    const oweYouEl = document.getElementById("suppliers-owe-you");
    const youOweEl = document.getElementById("you-owe-suppliers");
    const avgCheckEl = document.getElementById("avg-check");

    const marginPercent = revenue.totalSales ? (profit.totalProfit / revenue.totalSales) * 100 : 0;

    if (totalSalesEl) totalSalesEl.textContent = `${MONEY(revenue.totalSales)} ₴`;
    if (totalProfitEl) totalProfitEl.textContent = `${MONEY(profit.totalProfit)} ₴`;
    if (oweYouEl) oweYouEl.textContent = `${MONEY(debts.suppliersOwe)} ₴`;
    if (youOweEl) youOweEl.textContent = `${MONEY(debts.weOwe)} ₴`;
    const totalMarginEl = document.getElementById("total-margin");
    if (totalMarginEl) totalMarginEl.textContent = `${marginPercent.toFixed(2)} %`;
    if (avgCheckEl && series.overall) avgCheckEl.textContent = `${MONEY(series.overall.avgCheck)} ₴`;

    renderCharts(series);
    monthlySummaryData = series.monthly || [];
    renderMonthlySummary();
  } catch (err) {
    console.error("Помилка статистики:", err);
  }
}

function renderCharts(series) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded");
    return;
  }
  const { revenueProfit = [], suppliers = [], monthly = [], suppliersPerf = [] } = series || {};

  const labels = revenueProfit.map(r => r.label);
  const profitData = revenueProfit.map(r => r.profit);
  const revenueData = revenueProfit.map(r => r.revenue);

  if (chartProfit) chartProfit.destroy();
  if (chartRevenue) chartRevenue.destroy();
  if (chartSuppliers) chartSuppliers.destroy();
  if (chartMargin) chartMargin.destroy();
  if (chartMonthly) chartMonthly.destroy();
  if (chartSuppliersPerf) chartSuppliersPerf.destroy();

  const profitCtx = document.getElementById("profit-chart")?.getContext("2d");
  if (profitCtx) {
    chartProfit = new Chart(profitCtx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Прибуток",
          data: profitData,
          borderColor: "#5c76ff",
          backgroundColor: "rgba(92, 118, 255, 0.15)",
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  }

  const revenueCtx = document.getElementById("revenue-chart")?.getContext("2d");
  if (revenueCtx) {
    chartRevenue = new Chart(revenueCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Виручка",
            data: revenueData,
            backgroundColor: "rgba(92, 118, 255, 0.55)"
          },
          {
            label: "Прибуток",
            data: profitData,
            backgroundColor: "rgba(0, 201, 167, 0.55)"
          }
        ]
      },
      options: {
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { display: false } },
          y: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  }

  const supplierCtx = document.getElementById("suppliers-chart")?.getContext("2d");
  if (supplierCtx) {
    chartSuppliers = new Chart(supplierCtx, {
      type: "bar",
      data: {
        labels: suppliers.map(s => s.name),
        datasets: [{
          label: "Баланс постачальника",
          data: suppliers.map(s => s.balance),
          backgroundColor: suppliers.map(s => s.balance >= 0 ? "rgba(0, 201, 167, 0.6)" : "rgba(255, 112, 112, 0.6)")
        }]
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#cfd3ea" }, grid: { display: false } }
        }
      }
    });
  }

  // Monthly charts
  const monthlyLabels = monthly.map(m => m.label);
  const monthlyRev = monthly.map(m => m.revenue);
  const monthlyProf = monthly.map(m => m.profit);
  const monthlyMarginData = monthly.map(m => m.margin);

  const marginCtx = document.getElementById("margin-chart")?.getContext("2d");
  if (marginCtx) {
    chartMargin = new Chart(marginCtx, {
      type: "line",
      data: {
        labels: monthlyLabels,
        datasets: [{
          label: "Маржа, %",
          data: monthlyMarginData,
          borderColor: "#00c9a7",
          backgroundColor: "rgba(0, 201, 167, 0.15)",
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  }

  const monthlyCtx = document.getElementById("monthly-chart")?.getContext("2d");
  if (monthlyCtx) {
    chartMonthly = new Chart(monthlyCtx, {
      type: "bar",
      data: {
        labels: monthlyLabels,
        datasets: [
          { label: "Виручка", data: monthlyRev, backgroundColor: "rgba(92, 118, 255, 0.55)" },
          { label: "Прибуток", data: monthlyProf, backgroundColor: "rgba(0, 201, 167, 0.55)" }
        ]
      },
      options: {
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { display: false } },
          y: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  }

  // Suppliers performance (margin)
  const supPerfCtx = document.getElementById("suppliers-perf-chart")?.getContext("2d");
  if (supPerfCtx) {
    chartSuppliersPerf = new Chart(supPerfCtx, {
      type: "bar",
      data: {
        labels: suppliersPerf.map(s => s.name),
        datasets: [
          {
            label: "Маржа, %",
            data: suppliersPerf.map(s => s.margin),
            backgroundColor: "rgba(92, 118, 255, 0.65)"
          },
          {
            label: "Прибуток",
            data: suppliersPerf.map(s => s.profit),
            backgroundColor: "rgba(0, 201, 167, 0.65)"
          }
        ]
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#cfd3ea" }, grid: { display: false } }
        }
      }
    });
  }

  renderMonthlySummary();
}

function renderMonthlySummary() {
  const table = document.querySelector("#monthly-summary tbody");
  if (!table) return;
  table.innerHTML = "";
  (monthlySummaryData || []).forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.label}</td>
      <td>${MONEY(m.revenue)} ₴</td>
      <td>${MONEY(m.profit)} ₴</td>
      <td>${m.orders}</td>
      <td>${MONEY(m.avgCheck)} ₴</td>
      <td>${m.margin.toFixed(2)} %</td>
    `;
    table.appendChild(tr);
  });
}

async function saveManualMonth() {
  const month = document.getElementById("manual-month")?.value;
  const revenue = Number(document.getElementById("manual-revenue")?.value);
  const profit = Number(document.getElementById("manual-profit")?.value);
  const orders = Number(document.getElementById("manual-orders")?.value);

  if (!month) {
    alert("Вкажіть місяць");
    return;
  }

  await fetch(`${API}/stats/manual-months`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month, revenue, profit, orders })
  });

  loadStats();
}

function toggleSidebar(forceState) {
  const body = document.body;
  const shouldOpen = typeof forceState === "boolean" ? forceState : !body.classList.contains("sidebar-open");
  if (shouldOpen) body.classList.add("sidebar-open");
  else body.classList.remove("sidebar-open");
}


// ===================================================================
// ========================= DAILY / PLAN =============================
// ===================================================================
async function loadDaily(plan) {
  try {
    const weekends = Array.from(currentWeekends).join(",");
    const rangeParams = getRangeParams("stats-start", "stats-end");
    rangeParams.append("plan", plan);
    rangeParams.append("weekends", weekends);
    const qs = rangeParams.toString();
    const res = await fetch(`${API}/stats/daily?${qs}`);
    const data = await res.json();
    dailyDataCache = data;
    renderDaily(data);
  } catch (err) {
    console.error("Помилка денної статистики:", err);
  }
}

function renderDaily(d) {
  if (!d) return;
  const todayRevenue = document.getElementById("today-revenue");
  const todayProfit = document.getElementById("today-profit");
  const todayCount = document.getElementById("today-count");
  const todayRemaining = document.getElementById("today-remaining");
  const shortfallEl = document.getElementById("plan-shortfall");
  const sourcesEl = document.getElementById("today-sources");
  const monthExpected = document.getElementById("month-expected");
  const monthRevenue = document.getElementById("month-revenue");
  const monthProfit = document.getElementById("month-profit");
  const monthOrders = document.getElementById("month-orders");

  if (todayRevenue) todayRevenue.textContent = `${MONEY(d.today.revenue)} ₴`;
  if (todayProfit) todayProfit.textContent = `${MONEY(d.today.profit)} ₴`;
  if (todayCount) todayCount.textContent = d.today.count;
  if (todayRemaining) todayRemaining.textContent = `${MONEY(d.today.remaining)} ₴`;
  if (shortfallEl) shortfallEl.textContent = `${MONEY(d.shortfall)} ₴`;
  if (monthExpected) monthExpected.textContent = `${MONEY(d.month.expected)} ₴`;
  if (monthRevenue) monthRevenue.textContent = `${MONEY(d.month.revenue)} ₴`;
  if (monthProfit) monthProfit.textContent = `${MONEY(d.month.profit)} ₴`;
  if (monthOrders) monthOrders.textContent = d.month.orders;

  if (sourcesEl) {
    sourcesEl.innerHTML = "";
    const entries = Object.entries(d.today.sources || {});
    if (!entries.length) {
      sourcesEl.innerHTML = "<li>Немає даних</li>";
    } else {
      entries.forEach(([name, count]) => {
        const li = document.createElement("li");
        li.textContent = `${name}: ${count}`;
        sourcesEl.appendChild(li);
      });
    }
  }

  const table = document.querySelector("#daily-table tbody");
  if (table) {
    table.innerHTML = "";
    (d.days || []).forEach(day => {
      const tr = document.createElement("tr");
      if (day.isSunday) tr.style.opacity = "0.6";
      tr.innerHTML = `
        <td>${day.date}</td>
        <td>${MONEY(day.revenue)} ₴</td>
        <td>${MONEY(day.profit)} ₴</td>
        <td>${day.margin.toFixed(2)} %</td>
        <td>${day.count}</td>
      `;
      table.appendChild(tr);
    });
  }

  const revenueCtx = document.getElementById("daily-revenue-chart")?.getContext("2d");
  if (revenueCtx) {
    const labels = (d.days || []).map(x => x.date);
    const revenues = (d.days || []).map(x => x.revenue);
    const profits = (d.days || []).map(x => x.profit);
    if (chartDaily) chartDaily.destroy();
    chartDaily = new Chart(revenueCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Виручка", data: revenues, backgroundColor: "rgba(92,118,255,0.55)" },
          { label: "Прибуток", data: profits, backgroundColor: "rgba(0, 201, 167, 0.55)" }
        ]
      },
      options: {
        plugins: { legend: { labels: { color: "#e9ecff" } } },
        scales: {
          x: { ticks: { color: "#cfd3ea" }, grid: { display: false } },
          y: { ticks: { color: "#cfd3ea" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  }
}

// ===================================================================
// ============================= PAGE LOAD ============================
// ===================================================================
window.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("orders-table")) {
    loadSuppliers();
    loadOrders();
  }

  if (document.getElementById("suppliers-table")) {
    loadSuppliers();
  }

  // СТОРІНКА СТВОРЕННЯ ЗАМОВЛЕННЯ
  if (document.getElementById("order-supplier")) {
    loadSuppliers();
    const numberInput = document.getElementById("order-number");
    if (numberInput && !numberInput.value) {
      numberInput.value = `№${Date.now()}`;
    }
  }

  if (document.getElementById("profit-chart") || document.getElementById("total-sales")) {
    loadStats();
  }

  const kindSelect = document.getElementById("adjust-kind");
  const signLabel = document.getElementById("adjust-sign-label");
  const signSelect = document.getElementById("adjust-sign");
  if (kindSelect && signLabel && signSelect) {
    kindSelect.addEventListener("change", () => {
      const isSet = kindSelect.value === "set";
      signLabel.style.display = isSet ? "" : "none";
      signSelect.style.display = isSet ? "" : "none";
    });
  }

  if (document.getElementById("daily-table")) {
    const planInput = document.getElementById("plan-target");
    const refreshBtn = document.getElementById("plan-refresh");
    const weekendToggles = document.querySelectorAll(".weekend-toggle");
    const manualSave = document.getElementById("manual-save");
    const statsApply = document.getElementById("stats-apply");
    const statsReset = document.getElementById("stats-reset");

    const load = () => {
      const plan = Number(planInput?.value) || 3000;
      loadDaily(plan);
    };

    if (refreshBtn) refreshBtn.addEventListener("click", load);
    weekendToggles.forEach(cb => {
      cb.addEventListener("change", () => {
        const val = Number(cb.value);
        if (cb.checked) currentWeekends.add(val);
        else currentWeekends.delete(val);
        load();
      });
    });
    if (manualSave) {
      manualSave.addEventListener("click", saveManualMonth);
    }
    if (statsApply) {
      statsApply.addEventListener("click", () => {
        loadStats();
        load();
      });
    }
    if (statsReset) {
      statsReset.addEventListener("click", () => {
        const s = document.getElementById("stats-start");
        const e = document.getElementById("stats-end");
        if (s) s.value = "";
        if (e) e.value = "";
        loadStats();
        load();
      });
    }
    load();
  }

  document.querySelectorAll('.burger-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSidebar());
  });
  document.querySelectorAll('.sidebar a').forEach(a => {
    a.addEventListener('click', () => toggleSidebar(false));
  });
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => toggleSidebar(false));
});
