(function initCrowbuxAdmin() {
  var apiBaseUrl = document.documentElement.dataset.apiBase || "";
  var loginSection = document.getElementById("admin-auth");
  var dashboard = document.getElementById("admin-dashboard");
  var loginForm = document.getElementById("admin-login-form");
  var settingsForm = document.getElementById("admin-settings-form");
  var secretInput = document.getElementById("admin-secret");
  var priceInput = document.getElementById("price-per-1000");
  var stockAmountInput = document.getElementById("stock-amount");
  var stockOperationInput = document.getElementById("stock-operation");
  var preview = document.getElementById("price-preview");
  var orderList = document.getElementById("admin-order-list");
  var toast = document.getElementById("toast");
  var toastTimer;
  var adminSecret = sessionStorage.getItem("crowbux-admin-secret") || "";
  var packageAmounts = [80, 400, 800, 1700, 4500, 10000];

  function apiUrl(path) {
    return apiBaseUrl.replace(/\/$/, "") + path;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("id-ID");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function() {
      toast.classList.remove("is-visible");
    }, 3600);
  }

  async function adminRequest(path, options) {
    var requestOptions = options || {};
    requestOptions.headers = Object.assign({}, requestOptions.headers, {
      Authorization: "Bearer " + adminSecret
    });
    var response = await fetch(apiUrl(path), requestOptions);
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Permintaan admin gagal.");
    return body;
  }

  function renderPreview(pricePer1000) {
    preview.innerHTML = "";
    packageAmounts.forEach(function(robuxAmount) {
      var row = document.createElement("div");
      var calculatedPrice = Math.round((robuxAmount * Number(pricePer1000 || 0)) / 1000);
      row.innerHTML = "<span>" + formatNumber(robuxAmount) + " Robux</span><strong>" + formatCurrency(calculatedPrice) + "</strong>";
      preview.appendChild(row);
    });
  }

  function displaySettings(settings) {
    document.getElementById("admin-current-stock").textContent = formatNumber(settings.availableRobux);
    document.getElementById("admin-current-price").textContent = formatCurrency(settings.pricePer1000);
    document.getElementById("admin-updated-at").textContent = settings.updatedAt || "—";
    priceInput.value = settings.pricePer1000;
    renderPreview(settings.pricePer1000);
  }

  function renderOrders(orders) {
    orderList.innerHTML = "";
    if (!orders.length) {
      orderList.innerHTML = '<p class="empty-orders">Belum ada pesanan.</p>';
      return;
    }

    orders.forEach(function(order) {
      var item = document.createElement("article");
      item.className = "admin-order-item";
      item.innerHTML =
        '<div class="admin-order-main"><span>#' + String(order.queueNumber).padStart(3, "0") + ' · ' + order.orderDate + '</span>' +
        '<strong>' + order.orderCode + '</strong><small>@' + order.username + ' · ' + formatNumber(order.robuxAmount) + ' Robux</small></div>' +
        '<div class="admin-order-payment"><span>' + order.paymentMethod + '</span><strong>' + formatCurrency(order.total) + '</strong></div>' +
        '<div class="admin-order-action"><span class="status-chip ' + order.status.toLowerCase() + '">' + order.status + '</span>' +
        (order.status === "PENDING" ? '<button class="secondary-button" type="button" data-mark-paid="' + order.orderCode + '">Tandai dibayar</button>' : '') + '</div>';
      orderList.appendChild(item);
    });
  }

  async function loadOrders() {
    var response = await adminRequest("/api/admin/orders");
    renderOrders(response.orders);
  }

  async function unlockDashboard() {
    var settings = await adminRequest("/api/admin/settings");
    sessionStorage.setItem("crowbux-admin-secret", adminSecret);
    loginSection.hidden = true;
    dashboard.hidden = false;
    displaySettings(settings);
    await loadOrders();
  }

  loginForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    adminSecret = secretInput.value.trim();
    var button = loginForm.querySelector("button");
    button.disabled = true;
    button.textContent = "Memverifikasi…";
    try {
      await unlockDashboard();
      secretInput.value = "";
    } catch (error) {
      adminSecret = "";
      sessionStorage.removeItem("crowbux-admin-secret");
      showToast(error.message);
      secretInput.focus();
    } finally {
      button.disabled = false;
      button.textContent = "Buka dashboard";
    }
  });

  priceInput.addEventListener("input", function() {
    renderPreview(priceInput.value);
  });

  settingsForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    var button = settingsForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      var settings = await adminRequest("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockOperation: stockOperationInput.value,
          stockAmount: Number(stockAmountInput.value),
          pricePer1000: Number(priceInput.value)
        })
      });
      stockAmountInput.value = "0";
      stockOperationInput.value = "add";
      displaySettings(settings);
      await loadOrders();
      showToast("Stok dan harga berhasil diperbarui.");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("admin-logout").addEventListener("click", function() {
    adminSecret = "";
    sessionStorage.removeItem("crowbux-admin-secret");
    dashboard.hidden = true;
    loginSection.hidden = false;
    secretInput.focus();
  });

  document.getElementById("refresh-orders").addEventListener("click", function() {
    loadOrders().catch(function(error) { showToast(error.message); });
  });

  orderList.addEventListener("click", async function(event) {
    var button = event.target.closest("[data-mark-paid]");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Memproses…";
    try {
      await adminRequest("/api/admin/orders/" + button.dataset.markPaid + "/mark-paid", {
        method: "POST"
      });
      var settings = await adminRequest("/api/admin/settings");
      displaySettings(settings);
      await loadOrders();
      showToast("Pembayaran dikonfirmasi dan stok telah dikurangi.");
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = "Tandai dibayar";
    }
  });

  if (adminSecret) {
    unlockDashboard().catch(function() {
      adminSecret = "";
      sessionStorage.removeItem("crowbux-admin-secret");
    });
  }
})();
