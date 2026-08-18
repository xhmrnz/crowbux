(function initTopupPrototype() {
  var form = document.getElementById("topup-form");
  var usernameInput = document.getElementById("roblox-username");
  var usernameButton = document.getElementById("check-username");
  var usernameMessage = document.getElementById("username-message");
  var phoneInput = document.getElementById("phone");
  var emailInput = document.getElementById("email");
  var modal = document.getElementById("success-modal");
  var toast = document.getElementById("toast");
  var toastTimer;
  var usernameVerified = false;

  var summary = {
    package: document.getElementById("summary-package"),
    username: document.getElementById("summary-username"),
    payment: document.getElementById("summary-payment"),
    subtotal: document.getElementById("summary-subtotal"),
    fee: document.getElementById("summary-fee"),
    total: document.getElementById("summary-total")
  };

  function formatCurrency(value) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(value);
  }

  function selectedInput(name) {
    return form.querySelector('input[name="' + name + '"]:checked');
  }

  function updateSummary() {
    var selectedPackage = selectedInput("package");
    var selectedPayment = selectedInput("payment");
    var subtotal = Number(selectedPackage.dataset.price);
    var fee = Number(selectedPayment.dataset.fee);
    var username = usernameInput.value.trim();

    summary.package.textContent = Number(selectedPackage.value).toLocaleString("id-ID") + " Robux";
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

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function() {
      toast.classList.remove("is-visible");
    }, 3200);
  }

  function checkUsername() {
    var username = usernameInput.value.trim();
    usernameVerified = false;

    if (!validUsername(username)) {
      usernameInput.classList.add("is-invalid");
      setUsernameMessage("Username harus terdiri dari 3–20 huruf, angka, atau underscore.", "error");
      usernameInput.focus();
      return;
    }

    usernameInput.classList.remove("is-invalid");
    usernameButton.disabled = true;
    usernameButton.textContent = "Mengecek…";
    setUsernameMessage("Mencari akun demo…", "neutral");

    window.setTimeout(function() {
      usernameVerified = true;
      usernameButton.disabled = false;
      usernameButton.textContent = "Cek ulang";
      setUsernameMessage("Akun ditemukan dalam simulasi: @" + username, "success");
      updateSummary();
    }, 700);
  }

  function validateContact() {
    var phone = phoneInput.value.replace(/\D/g, "");
    var emailValid = !emailInput.value || emailInput.validity.valid;
    var phoneValid = /^(?:62|0)8\d{8,12}$/.test(phone);

    phoneInput.classList.toggle("is-invalid", !phoneValid);
    emailInput.classList.toggle("is-invalid", !emailValid);

    return phoneValid && emailValid;
  }

  function openModal() {
    var suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    document.getElementById("demo-order-id").textContent = "RUX-" + suffix;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector(".modal-close").focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  document.querySelectorAll("[data-scroll-to]").forEach(function(button) {
    button.addEventListener("click", function() {
      document.getElementById(button.dataset.scrollTo).scrollIntoView({ behavior: "smooth" });
    });
  });

  usernameButton.addEventListener("click", checkUsername);
  usernameInput.addEventListener("input", function() {
    usernameVerified = false;
    usernameInput.classList.remove("is-invalid");
    setUsernameMessage("Gunakan username, bukan display name.", "neutral");
    updateSummary();
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

  form.addEventListener("submit", function(event) {
    event.preventDefault();

    if (!validUsername(usernameInput.value.trim())) {
      checkUsername();
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

    openModal();
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
})();
