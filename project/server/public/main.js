const API = "/api";
const MONEY = (val) => (Number(val ?? 0)).toFixed(2);
let chartProfit;
let chartRevenue;
let chartSuppliers;
let chartMargin;
let chartMonthly;
let chartSuppliersPerf;
let dailyDataCache = null;
let chartDaily;
let currentWeekends = new Set([0]); // 0 = Sunday

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
        let opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${s.name} (баланс: ${MONEY(s.balance)})`;
        adjustSelect.appendChild(opt);
      });
    }

    if (table) {
      table.innerHTML = "";
      suppliers.forEach(s => {
        const row = document.createElement("tr");
        const status =
          s.balance > 0 ? `Він нам винен ${s.balance} грн` :
          s.balance < 0 ? `Ми винні ${Math.abs(s.balance)} грн` :
          "0 грн";

        row.innerHTML = `
          <td>${s.id}</td>
          <td>${s.name}</td>
          <td>${status}</td>
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

async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders`);
    const orders = await res.json();
    ALL_ORDERS = orders;
    renderOrders(orders);
  } catch (err) {
    console.error("Помилка завантаження замовлень:", err);
  }
}

function renderOrders(orders) {
  const table = document.querySelector("#orders-table tbody");
  if (!table) return;

  table.innerHTML = "";

  orders.forEach(o => {
    const debt =
      o.supplier_balance > 0 ? `Він нам: ${MONEY(o.supplier_balance)}` :
      o.supplier_balance < 0 ? `Ми винні: ${MONEY(Math.abs(o.supplier_balance))}` :
      "0";

    const isReturnBadge = o.isReturn ? `<div style="color:#ff9f43;font-weight:700;font-size:12px;">Повернення</div>` : "";
    const statusBadge = o.status ? `<div style="color:#9fb4ff;font-weight:600;font-size:12px;">${o.status}</div>` : "";

    const row = document.createElement("tr");
    if (o.isReturn) row.classList.add("row-return");
    row.innerHTML = `
      <td>${o.id}</td>
      <td>${o.order_number || "-"}</td>
      <td>${o.date || "-"}</td>
      <td>${o.title || "-"} ${isReturnBadge}</td>
      <td>${o.traffic_source || "-"}</td>
      <td>${statusBadge}</td>
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
  document.getElementById("edit-date").value = data.date || "";
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
function applyFilters() {
  const num = document.getElementById("filter-number").value.toLowerCase();
  const title = document.getElementById("filter-title").value.toLowerCase();
  const supplier = document.getElementById("filter-supplier").value;
  const showReturns = document.getElementById("filter-returns").checked;

  let filtered = ALL_ORDERS.filter(o => {
    if (num && !(o.order_number || "").toLowerCase().includes(num)) return false;
    if (title && !(o.title || "").toLowerCase().includes(title)) return false;
    if (supplier && o.supplier_id != supplier) return false;
    if (!showReturns && o.isReturn) return false;
    return true;
  });

  renderOrders(filtered);
}

function resetFilters() {
  document.getElementById("filter-number").value = "";
  document.getElementById("filter-title").value = "";
  document.getElementById("filter-supplier").value = "";
  document.getElementById("filter-returns").checked = false;
  renderOrders(ALL_ORDERS);
}

// ===================================================================
// ============================= STATS ================================
// ===================================================================
async function loadStats() {
  try {
    const [revRes, profitRes, debtRes, seriesRes] = await Promise.all([
      fetch(`${API}/stats/revenue`),
      fetch(`${API}/stats/profit`),
      fetch(`${API}/stats/debts`),
      fetch(`${API}/stats/series`)
    ]);
    const revenue = await revRes.json();
    const profit = await profitRes.json();
    const debts = await debtRes.json();
    const series = await seriesRes.json();

    const totalSalesEl = document.getElementById("total-sales");
    const totalProfitEl = document.getElementById("total-profit");
    const oweYouEl = document.getElementById("suppliers-owe-you");
    const youOweEl = document.getElementById("you-owe-suppliers");

    const marginPercent = revenue.totalSales ? (profit.totalProfit / revenue.totalSales) * 100 : 0;

    if (totalSalesEl) totalSalesEl.textContent = `${MONEY(revenue.totalSales)} ₴`;
    if (totalProfitEl) totalProfitEl.textContent = `${MONEY(profit.totalProfit)} ₴`;
    if (oweYouEl) oweYouEl.textContent = `${MONEY(debts.suppliersOwe)} ₴`;
    if (youOweEl) youOweEl.textContent = `${MONEY(debts.weOwe)} ₴`;
    const totalMarginEl = document.getElementById("total-margin");
    if (totalMarginEl) totalMarginEl.textContent = `${marginPercent.toFixed(2)} %`;

    renderCharts(series);
  } catch (err) {
    console.error("Помилка статистики:", err);
  }
}

function renderCharts(series) {
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
}

// ===================================================================
// ========================= DAILY / PLAN =============================
// ===================================================================
async function loadDaily(plan) {
  try {
    const weekends = Array.from(currentWeekends).join(",");
    const res = await fetch(`${API}/stats/daily?plan=${plan}&weekends=${weekends}`);
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
    load();
  }
});
