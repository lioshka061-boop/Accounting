const API = "/api";

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
      <td>${o.supplier_name || "-"}</td>
      <td>${debt}</td>
      <td>${o.profit} грн</td>
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

  const promoPay = document.getElementById("promoPay").checked;
  const ourTTN = document.getElementById("ourTTN").checked;
  const fromSupplier = document.getElementById("fromSupplier").checked;

  const isReturn = document.getElementById("isReturn")?.checked || false;
  const returnDelivery = Number(document.getElementById("returnDelivery")?.value || 0);

  if (!sale || !date) {
    alert("Вартість та дата — обов'язкові!");
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
      returnDelivery
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
    returnDelivery: Number(document.getElementById("edit-returnDelivery").value)
  };

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
  }
});
