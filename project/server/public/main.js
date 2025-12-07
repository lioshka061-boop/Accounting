const API = "/api";

// ===============================
// ======== ADD SUPPLIER =========
// ===============================
async function addSupplier() {
  const input = document.getElementById("supplier-name");
  const name = input.value.trim();

  if (!name) {
    alert("Введи назву постачальника!");
    return;
  }

  try {
    const res = await fetch(`${API}/suppliers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (!res.ok) {
      console.error("Помилка:", await res.text());
      alert("Не вдалося додати постачальника");
      return;
    }

    input.value = "";
    loadSuppliers();

  } catch (err) {
    console.error("Fetch error:", err);
  }
}

// ===============================
// ======== LOAD SUPPLIERS =======
// ===============================
async function loadSuppliers() {
  try {
    const res = await fetch(`${API}/suppliers`);
    const suppliers = await res.json();

    const select = document.getElementById("order-supplier");
    const table = document.querySelector("#suppliers-table tbody");

    // Заповнення селекту (orders page)
    if (select) {
      select.innerHTML = "";
      suppliers.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${s.name} (баланс: ${s.balance} грн)`;
        select.appendChild(opt);
      });
    }

    // Таблиця постачальників
    if (table) {
      table.innerHTML = "";
      suppliers.forEach(s => {
        const status =
          s.balance > 0 ? `Він нам винен ${s.balance} грн` :
          s.balance < 0 ? `Ми винні ${Math.abs(s.balance)} грн` :
          "0 грн";

        const row = document.createElement("tr");
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

// ===============================
// ======== LOAD ORDERS ==========
// ===============================
async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders`);
    const orders = await res.json();

    const table = document.querySelector("#orders-table tbody");
    if (!table) return;

    table.innerHTML = "";

    orders.forEach(o => {
      const debt =
        o.supplier_balance > 0 ? `Він нам: ${o.supplier_balance}` :
        o.supplier_balance < 0 ? `Ми винні: ${Math.abs(o.supplier_balance)}` :
        "0";

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${o.id}</td>
        <td>${o.order_number || "-"}</td>
        <td>${o.date || "-"}</td>
        <td>${o.title || "-"}</td>
        <td>${o.sale} грн</td>
        <td>${o.cost} грн</td>
        <td>${o.prosail} грн</td>
        <td>${o.prepay} грн</td>
        <td>${o.supplier_id || "-"}</td>
        <td>${debt}</td>
        <td>${o.profit} грн</td>
      `;
      table.appendChild(row);
    });

  } catch (err) {
    console.error("Помилка замовлень:", err);
  }
}

// ===============================
// ========= ADD ORDER ===========
// ===============================
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

  const promoPay = document.getElementById("promoPay").checked;
  const ourTTN = document.getElementById("ourTTN").checked;
  const fromSupplier = document.getElementById("fromSupplier").checked;

  const isReturn = false;
  const returnDelivery = 0;

  if (!sale || !date) {
    alert("Вартість та дата — обов'язкові!");
    return;
  }

  await fetch(`${API}/orders`, {
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
      returnDelivery
    })
  });

  loadOrders();
}

// ===============================
// ========= LOAD STATS ==========
// ===============================
async function loadStats() {
  const ordersRes = await fetch(`${API}/orders`);
  const orders = await ordersRes.json();

  let turnover = 0;
  let profit = 0;
  let suppliers_owe = 0;
  let we_owe = 0;

  orders.forEach(o => {
    turnover += o.sale || 0;
    profit += o.profit || 0;
    if (o.supplier_balance > 0) suppliers_owe += o.supplier_balance;
    if (o.supplier_balance < 0) we_owe += Math.abs(o.supplier_balance);
  });

  const totalSales = document.getElementById("total-sales");
  const totalProfit = document.getElementById("total-profit");
  const suppliersOweYou = document.getElementById("suppliers-owe-you");
  const youOweSuppliers = document.getElementById("you-owe-suppliers");

  if (totalSales) totalSales.textContent = `${turnover} грн`;
  if (totalProfit) totalProfit.textContent = `${profit} грн`;
  if (suppliersOweYou) suppliersOweYou.textContent = `${suppliers_owe} грн`;
  if (youOweSuppliers) youOweSuppliers.textContent = `${we_owe} грн`;

  if (document.getElementById("profit-chart")) {
    new Chart(document.getElementById("profit-chart"), {
      type: "line",
      data: {
        labels: orders.map(o => o.date),
        datasets: [{
          label: "Прибуток",
          data: orders.map(o => o.profit),
          borderColor: "#4a67ff",
          backgroundColor: "rgba(74,103,255,0.2)",
          borderWidth: 2,
          tension: 0.2
        }]
      }
    });
  }
}

// ===============================
// ====== PAGE AUTOLOAD ==========
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("orders-table")) {
    loadSuppliers();
    loadOrders();
  }

  if (document.getElementById("suppliers-table")) {
    loadSuppliers();
  }

  if (document.getElementById("profit-chart")) {
    loadStats();
  }
});
