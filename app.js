(function initCrowbux() {
  var apiBaseUrl = document.documentElement.dataset.apiBase || "";
  var form = document.getElementById("topup-form");
  var usernameInput = document.getElementById("roblox-username");
  var usernameButton = document.getElementById("check-username");
  var usernameMessage = document.getElementById("username-message");
  var accountPreview = document.getElementById("roblox-account-preview");
  var accountAvatar = document.getElementById("roblox-account-avatar");
  var accountDisplay = document.getElementById("roblox-account-display");
  var accountUsername = document.getElementById("roblox-account-username");
  var accountId = document.getElementById("roblox-account-id");
  var accountProfile = document.getElementById("roblox-account-profile");
  var accountBadge = document.getElementById("roblox-account-badge");
  var connectRobloxButton = document.getElementById("connect-roblox");
  var oauthMessage = document.getElementById("oauth-message");
  var phoneInput = document.getElementById("phone");
  var emailInput = document.getElementById("email");
  var checkoutButton = form.querySelector(".checkout-button");
  var modal = document.getElementById("success-modal");
  var toast = document.getElementById("toast");
  var stockDisplays = document.querySelectorAll("[data-stock-display]");
  var pricePerThousandDisplay = document.getElementById("price-per-thousand");
  var toastTimer;
  var orderPollTimer;
  var activeOrderCode = "";
  var usernameVerified = false;
  var verifiedAccount = null;
  var robloxAuthorizationToken = "";
  var oauthEnabled = false;
  var availableStock = 0;
  var catalogReady = false;

  var summary = {
    package: document.getElementById("summary-package"),
    username: document.getElementById("summary-username"),
    payment: document.getElementById("summary-payment"),
    subtotal: document.getElementById("summary-subtotal"),
    fee: document.getElementById("summary-fee"),
    total: document.getElementById("summary-total")
  };

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

  function selectedInput(name) {
    return form.querySelector('input[name="' + name + '"]:checked');
  }

  function updateSummary() {
    var selectedPackage = selectedInput("package");
    var selectedPayment = selectedInput("payment");
    if (!selectedPackage || !selectedPayment) return;

    var subtotal = Number(selectedPackage.dataset.price);
    var fee = Number(selectedPayment.dataset.fee);
    var username = usernameInput.value.trim();

    summary.package.textContent = formatNumber(selectedPackage.value) + " Robux";
    summary.username.textContent = username || "Belum diisi";
    summary.payment.textContent = selectedPayment.value;
    summary.subtotal.textContent = formatCurrency(subtotal);
    summary.fee.textContent = formatCurrency(fee);
    summary.total.textContent = formatCurrency(subtotal + fee);
  }

  function setUsernameMessage(message, state) {
    usernameMessage.textContent = message;
    usernameMessage.classList.toggle("is-success", state === "success");
    usernameMessage.classList.toggle("is-error", state === "error");
  }

  function validUsername(username) {
    return /^[A-Za-z0-9_]{3,20}$/.test(username);
  }

  function resetVerifiedAccount() {
    usernameVerified = false;
    verifiedAccount = null;
    robloxAuthorizationToken = "";
    accountPreview.hidden = true;
    accountAvatar.removeAttribute("src");
  }

  function renderVerifiedAccount(account) {
    verifiedAccount = account;
    usernameVerified = true;
    usernameInput.value = account.username;
    accountDisplay.textContent = account.displayName || account.username;
    accountUsername.textContent = "@" + account.username;
    accountId.textContent = "User ID " + account.id;
    accountProfile.href = account.profileUrl;
    accountAvatar.src = account.avatarUrl || "favicon.svg";
    accountAvatar.alt = "Avatar Roblox " + account.username;
    accountBadge.textContent = account.ownershipVerified ? "Pemilik terverifikasi" : "Akun valid";
    accountBadge.classList.toggle("is-ownership-verified", Boolean(account.ownershipVerified));
    accountPreview.hidden = false;
    usernameInput.classList.remove("is-invalid");
    setUsernameMessage(
      account.ownershipVerified
        ? "Kepemilikan akun berhasil diverifikasi melalui Roblox OAuth."
        : "Akun Roblox ditemukan. Pastikan avatar dan nama akun sudah benar.",
      "success"
    );
    usernameButton.textContent = "Cek ulang";
    updateSummary();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function() {
      toast.classList.remove("is-visible");
    }, 3600);
  }

  function setCheckoutLoading(isLoading) {
    checkoutButton.disabled = isLoading || !catalogReady;
    checkoutButton.querySelector("span").textContent = isLoading ? "…" : "→";
    checkoutButton.firstChild.textContent = isLoading ? "Membuat pesanan " : "Lanjutkan pembayaran ";
  }

  async function request(path, options) {
    var response = await fetch(apiUrl(path), options || {});
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Permintaan gagal diproses.");
    return body;
  }

  async function loadCatalog() {
    stockDisplays.forEach(function(element) {
      element.textContent = "Memuat…";
    });

    try {
      var catalog = await request("/api/catalog");
      availableStock = Number(catalog.availableRobux);
      catalogReady = true;
      stockDisplays.forEach(function(element) {
        element.textContent = formatNumber(availableStock) + " Robux";
      });
      pricePerThousandDisplay.textContent = formatCurrency(catalog.pricePer1000) + " / 1.000 Robux";

      catalog.packages.forEach(function(packageItem) {
        var input = form.querySelector('input[name="package"][value="' + packageItem.robuxAmount + '"]');
        if (!input) return;
        var option = input.closest(".package-option");
        input.dataset.price = String(packageItem.price);
        input.disabled = Number(packageItem.robuxAmount) > availableStock;
        option.classList.toggle("is-unavailable", input.disabled);
        option.querySelector(".package-price").textContent = formatCurrency(packageItem.price);
      });

      var selectedPackage = selectedInput("package");
      if (!selectedPackage || selectedPackage.disabled) {
        var firstAvailable = form.querySelector('input[name="package"]:not(:disabled)');
        if (firstAvailable) firstAvailable.checked = true;
      }
      setCheckoutLoading(false);
      updateSummary();
    } catch (error) {
      catalogReady = false;
      stockDisplays.forEach(function(element) {
        element.textContent = "Tidak tersedia";
      });
      pricePerThousandDisplay.textContent = "Katalog sedang tidak tersedia";
      setCheckoutLoading(false);
      showToast(error.message);
    }
  }

  async function checkUsername() {
    var username = usernameInput.value.trim();
    resetVerifiedAccount();

    if (!validUsername(username)) {
      usernameInput.classList.add("is-invalid");
      setUsernameMessage("Username harus terdiri dari 3–20 huruf, angka, atau underscore.", "error");
      usernameInput.focus();
      return;
    }

    usernameInput.classList.remove("is-invalid");
    usernameButton.disabled = true;
    usernameButton.textContent = "Mengecek…";
    setUsernameMessage("Mencari akun di Roblox…", "neutral");

    try {
      var response = await request("/api/roblox/users/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username })
      });
      renderVerifiedAccount(response.account);
    } catch (error) {
      usernameInput.classList.add("is-invalid");
      setUsernameMessage(error.message, "error");
      usernameButton.textContent = "Coba lagi";
    } finally {
      usernameButton.disabled = false;
    }
  }

  function cleanOAuthQuery() {
    var url = new URL(window.location.href);
    url.searchParams.delete("roblox_auth_code");
    url.searchParams.delete("roblox_oauth_error");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  async function loadRobloxOAuth() {
    var currentUrl = new URL(window.location.href);
    var exchangeCode = currentUrl.searchParams.get("roblox_auth_code");
    var oauthError = currentUrl.searchParams.get("roblox_oauth_error");
    cleanOAuthQuery();

    try {
      var status = await request("/api/roblox/oauth/status");
      oauthEnabled = Boolean(status.enabled);
      connectRobloxButton.disabled = !oauthEnabled;
      oauthMessage.textContent = oauthEnabled
        ? "Hubungkan akun untuk membuktikan bahwa akun Roblox tersebut milikmu."
        : "Verifikasi kepemilikan akan tersedia setelah aplikasi OAuth Roblox diaktifkan.";
    } catch (error) {
      oauthEnabled = false;
      connectRobloxButton.disabled = true;
      oauthMessage.textContent = "Status login Roblox belum dapat dimuat.";
    }

    if (oauthError) {
      showToast(oauthError);
      return;
    }
    if (!exchangeCode) return;

    connectRobloxButton.disabled = true;
    connectRobloxButton.textContent = "Memverifikasi…";
    try {
      var response = await request("/api/roblox/oauth/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: exchangeCode })
      });
      robloxAuthorizationToken = response.authorizationToken;
      renderVerifiedAccount(response.account);
      showToast("Kepemilikan akun Roblox berhasil diverifikasi.");
    } catch (error) {
      showToast(error.message);
    } finally {
      connectRobloxButton.disabled = !oauthEnabled;
      connectRobloxButton.textContent = "Hubungkan Roblox";
    }
  }

  function validateContact() {
    var phone = phoneInput.value.replace(/\D/g, "");
    var emailValid = !emailInput.value || emailInput.validity.valid;
    var phoneValid = /^(?:62|0)8\d{8,12}$/.test(phone);

    phoneInput.classList.toggle("is-invalid", !phoneValid);
    emailInput.classList.toggle("is-invalid", !emailValid);
    return phoneValid && emailValid;
  }

  function setOrderStatus(status) {
    var statusElement = document.getElementById("order-status");
    var isPaid = status === "PAID";
    statusElement.classList.toggle("is-paid", isPaid);
    statusElement.querySelector("strong").textContent = isPaid ? "Pembayaran terverifikasi" : "Menunggu pembayaran";
    statusElement.querySelector("span").textContent = isPaid
      ? "Stok telah dikurangi dan pesanan siap diproses."
      : "Stok baru berkurang setelah pembayaran diverifikasi.";
  }

  function openModal(order) {
    activeOrderCode = order.orderCode;
    document.getElementById("demo-order-id").textContent = order.orderCode;
    document.getElementById("order-queue").textContent = "#" + String(order.queueNumber).padStart(3, "0");
    document.getElementById("order-date").textContent = order.orderDate;
    setOrderStatus(order.status);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector(".modal-close").focus();
    startOrderPolling();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    window.clearInterval(orderPollTimer);
  }

  function startOrderPolling() {
    window.clearInterval(orderPollTimer);
    orderPollTimer = window.setInterval(async function() {
      if (!activeOrderCode) return;
      try {
        var response = await request("/api/orders/" + activeOrderCode);
        setOrderStatus(response.order.status);
        if (response.order.status === "PAID") {
          window.clearInterval(orderPollTimer);
          await loadCatalog();
        }
      } catch (error) {
        console.warn(error);
      }
    }, 5000);
  }

  async function createOrder() {
    var selectedPackage = selectedInput("package");
    var selectedPayment = selectedInput("payment");
    if (!selectedPackage || selectedPackage.disabled) {
      throw new Error("Pilih paket yang masih tersedia.");
    }

    return request("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        robloxUserId: verifiedAccount.id,
        robloxAuthorizationToken: robloxAuthorizationToken,
        robuxAmount: Number(selectedPackage.value),
        paymentMethod: selectedPayment.value,
        phone: phoneInput.value,
        email: emailInput.value.trim()
      })
    });
  }

  document.querySelectorAll("[data-scroll-to]").forEach(function(button) {
    button.addEventListener("click", function() {
      document.getElementById(button.dataset.scrollTo).scrollIntoView({ behavior: "smooth" });
    });
  });

  usernameButton.addEventListener("click", checkUsername);
  usernameInput.addEventListener("input", function() {
    resetVerifiedAccount();
    usernameInput.classList.remove("is-invalid");
    setUsernameMessage("Gunakan username, bukan display name.", "neutral");
    updateSummary();
  });

  connectRobloxButton.addEventListener("click", function() {
    if (!oauthEnabled) return;
    var returnUrl = new URL(window.location.href);
    returnUrl.searchParams.delete("roblox_auth_code");
    returnUrl.searchParams.delete("roblox_oauth_error");
    window.location.href = apiUrl("/api/roblox/oauth/start?return_to=" + encodeURIComponent(returnUrl.toString()));
  });

  form.querySelectorAll('input[name="package"], input[name="payment"]').forEach(function(input) {
    input.addEventListener("change", updateSummary);
  });

  phoneInput.addEventListener("input", function() {
    phoneInput.value = phoneInput.value.replace(/[^0-9+]/g, "").slice(0, 15);
    phoneInput.classList.remove("is-invalid");
  });

  emailInput.addEventListener("input", function() {
    emailInput.classList.remove("is-invalid");
  });

  form.addEventListener("submit", async function(event) {
    event.preventDefault();

    if (!catalogReady) {
      showToast("Katalog dan stok belum dapat dimuat.");
      return;
    }
    if (!validUsername(usernameInput.value.trim())) {
      void checkUsername();
      showToast("Periksa username Roblox terlebih dahulu.");
      return;
    }
    if (!usernameVerified) {
      showToast("Klik “Cek akun” sebelum melanjutkan.");
      usernameButton.focus();
      return;
    }
    if (!validateContact()) {
      showToast("Periksa kembali nomor WhatsApp atau email.");
      if (phoneInput.classList.contains("is-invalid")) phoneInput.focus();
      else emailInput.focus();
      return;
    }

    setCheckoutLoading(true);
    try {
      var response = await createOrder();
      openModal(response.order);
    } catch (error) {
      showToast(error.message);
      await loadCatalog();
    } finally {
      setCheckoutLoading(false);
    }
  });

  document.querySelectorAll(".faq-item button").forEach(function(button) {
    button.addEventListener("click", function() {
      var expanded = button.getAttribute("aria-expanded") === "true";
      var answer = button.nextElementSibling;
      button.setAttribute("aria-expanded", String(!expanded));
      button.querySelector("span").textContent = expanded ? "+" : "−";
      answer.hidden = expanded;
    });
  });

  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.querySelector(".modal-done").addEventListener("click", closeModal);
  modal.addEventListener("click", function(event) {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  document.getElementById("footer-year").textContent = "© " + new Date().getFullYear();
  updateSummary();
  loadCatalog();
  loadRobloxOAuth();
})();
