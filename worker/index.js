const PRODUCT_CODE = "ROBUX";
const JAKARTA_TIME_ZONE = "Asia/Jakarta";

const PACKAGE_AMOUNTS = [80, 400, 800, 1700, 4500, 10000];

const PAYMENT_FEES = new Map([
  ["QRIS", 0],
  ["DANA", 1500],
  ["GoPay", 2000],
  ["Bank Transfer", 3000]
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const corsHeaders = buildCorsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      if (origin && !corsHeaders["Access-Control-Allow-Origin"]) {
        return json({ error: "Origin tidak diizinkan." }, 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, service: "crowbux-api" }, 200, corsHeaders);
      }

      if (request.method === "GET" && (url.pathname === "/api/stock" || url.pathname === "/api/catalog")) {
        return getCatalog(env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/orders") {
        return createOrder(request, env, corsHeaders);
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([A-Z0-9-]+)$/);
      if (request.method === "GET" && orderMatch) {
        return getOrder(orderMatch[1], env, corsHeaders);
      }

      const paymentMatch = url.pathname.match(/^\/api\/orders\/([A-Z0-9-]+)\/confirm-payment$/);
      if (request.method === "POST" && paymentMatch) {
        return confirmPayment(paymentMatch[1], request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/settings") {
        return getAdminSettings(request, env, corsHeaders);
      }

      if (request.method === "PUT" && url.pathname === "/api/admin/settings") {
        return updateAdminSettings(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/orders") {
        return getAdminOrders(request, env, corsHeaders);
      }

      const adminPaymentMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Z0-9-]+)\/mark-paid$/);
      if (request.method === "POST" && adminPaymentMatch) {
        return confirmAdminPayment(adminPaymentMatch[1], request, env, corsHeaders);
      }

      return json({ error: "Endpoint tidak ditemukan." }, 404, corsHeaders);
    } catch (error) {
      console.error(error);
      const message = String(error && error.message ? error.message : error);
      if (message.includes("INSUFFICIENT_STOCK")) {
        return json({ error: "Stok Robux tidak mencukupi untuk menyelesaikan pembayaran ini." }, 409, corsHeaders);
      }
      return json({ error: "Terjadi kesalahan pada server." }, 500, corsHeaders);
    }
  }
};

async function getCatalog(env, corsHeaders) {
  const inventory = await env.DB.prepare(
    "SELECT available_robux, price_per_1000, updated_at FROM inventory WHERE product_code = ?"
  ).bind(PRODUCT_CODE).first();

  if (!inventory) return json({ error: "Data stok belum tersedia." }, 503, corsHeaders);

  return json({
    availableRobux: inventory.available_robux,
    pricePer1000: inventory.price_per_1000,
    packages: buildPackageCatalog(inventory.price_per_1000),
    updatedAt: inventory.updated_at
  }, 200, corsHeaders);
}

async function createOrder(request, env, corsHeaders) {
  const payload = await readJson(request);
  const username = String(payload.username || "").trim();
  const robuxAmount = Number(payload.robuxAmount);
  const paymentMethod = String(payload.paymentMethod || "");
  const phone = String(payload.phone || "").replace(/\D/g, "");
  const email = String(payload.email || "").trim().toLowerCase();
  const adminFee = PAYMENT_FEES.get(paymentMethod);

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return json({ error: "Username Roblox tidak valid." }, 400, corsHeaders);
  }
  if (!PACKAGE_AMOUNTS.includes(robuxAmount)) {
    return json({ error: "Paket Robux tidak valid." }, 400, corsHeaders);
  }
  if (adminFee === undefined) {
    return json({ error: "Metode pembayaran tidak valid." }, 400, corsHeaders);
  }
  if (!/^(?:62|0)8\d{8,12}$/.test(phone)) {
    return json({ error: "Nomor WhatsApp tidak valid." }, 400, corsHeaders);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Alamat email tidak valid." }, 400, corsHeaders);
  }

  const inventory = await env.DB.prepare(
    "SELECT available_robux, price_per_1000 FROM inventory WHERE product_code = ?"
  ).bind(PRODUCT_CODE).first();
  if (!inventory || Number(inventory.available_robux) < robuxAmount) {
    return json({ error: "Stok Robux tidak cukup untuk paket yang dipilih." }, 409, corsHeaders);
  }
  const packagePrice = calculatePackagePrice(robuxAmount, inventory.price_per_1000);

  const orderDate = jakartaDate(new Date());
  const orderId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO daily_counters (order_date, last_number)
      VALUES (?, 1)
      ON CONFLICT(order_date) DO UPDATE SET last_number = last_number + 1
    `).bind(orderDate),
    env.DB.prepare(`
      INSERT INTO orders (
        id, order_date, queue_number, order_code, username, robux_amount,
        package_price, admin_fee, payment_method, phone, email
      )
      SELECT ?, ?, last_number,
        'CBX-' || REPLACE(?, '-', '') || '-' || printf('%03d', last_number),
        ?, ?, ?, ?, ?, ?, ?
      FROM daily_counters
      WHERE order_date = ?
      RETURNING order_code, order_date, queue_number, username, robux_amount,
        package_price, admin_fee, payment_method, status, created_at
    `).bind(
      orderId,
      orderDate,
      orderDate,
      username,
      robuxAmount,
      packagePrice,
      adminFee,
      paymentMethod,
      phone,
      email || null,
      orderDate
    )
  ]);

  const order = results[1] && results[1].results && results[1].results[0];
  if (!order) throw new Error("ORDER_CREATION_FAILED");

  return json({ order: serializeOrder(order) }, 201, corsHeaders);
}

async function getOrder(orderCode, env, corsHeaders) {
  const order = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, robux_amount,
      package_price, admin_fee, payment_method, status, created_at, paid_at
    FROM orders
    WHERE order_code = ?
  `).bind(orderCode).first();

  if (!order) return json({ error: "Pesanan tidak ditemukan." }, 404, corsHeaders);
  return json({ order: serializeOrder(order) }, 200, corsHeaders);
}

async function confirmPayment(orderCode, request, env, corsHeaders) {
  if (!authorized(request, env.PAYMENT_WEBHOOK_SECRET)) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }

  const payload = await readJson(request);
  const paymentReference = String(payload.paymentReference || "MANUAL").slice(0, 100);
  return markOrderPaid(orderCode, paymentReference, env, corsHeaders);
}

async function confirmAdminPayment(orderCode, request, env, corsHeaders) {
  if (!authorized(request, env.ADMIN_API_SECRET)) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }

  return markOrderPaid(orderCode, "ADMIN-CONFIRMED", env, corsHeaders);
}

async function markOrderPaid(orderCode, paymentReference, env, corsHeaders) {
  const existing = await env.DB.prepare(
    "SELECT status FROM orders WHERE order_code = ?"
  ).bind(orderCode).first();

  if (!existing) return json({ error: "Pesanan tidak ditemukan." }, 404, corsHeaders);
  if (existing.status === "CANCELLED") {
    return json({ error: "Pesanan sudah dibatalkan." }, 409, corsHeaders);
  }

  if (existing.status === "PENDING") {
    await env.DB.prepare(`
      UPDATE orders
      SET status = 'PAID', payment_reference = ?, paid_at = CURRENT_TIMESTAMP
      WHERE order_code = ? AND status = 'PENDING'
    `).bind(paymentReference, orderCode).run();
  }

  const order = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, robux_amount,
      package_price, admin_fee, payment_method, status, created_at, paid_at
    FROM orders WHERE order_code = ?
  `).bind(orderCode).first();
  const stock = await env.DB.prepare(
    "SELECT available_robux, price_per_1000, updated_at FROM inventory WHERE product_code = ?"
  ).bind(PRODUCT_CODE).first();

  return json({
    order: serializeOrder(order),
    stock: {
      availableRobux: stock.available_robux,
      pricePer1000: stock.price_per_1000,
      updatedAt: stock.updated_at
    }
  }, 200, corsHeaders);
}

async function getAdminOrders(request, env, corsHeaders) {
  if (!authorized(request, env.ADMIN_API_SECRET)) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }

  const result = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, robux_amount,
      package_price, admin_fee, payment_method, status, created_at, paid_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  return json({ orders: result.results.map(serializeOrder) }, 200, corsHeaders);
}

async function getAdminSettings(request, env, corsHeaders) {
  if (!authorized(request, env.ADMIN_API_SECRET)) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }

  return getCatalog(env, corsHeaders);
}

async function updateAdminSettings(request, env, corsHeaders) {
  if (!authorized(request, env.ADMIN_API_SECRET)) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }

  const payload = await readJson(request);
  const stockAmount = Number(payload.stockAmount);
  const stockOperation = payload.stockOperation === "set" ? "set" : "add";
  const pricePer1000 = Number(payload.pricePer1000);

  if (!Number.isInteger(stockAmount) || stockAmount < 0 || stockAmount > 100000000) {
    return json({ error: "Jumlah stok harus berupa angka bulat positif." }, 400, corsHeaders);
  }
  if (!Number.isInteger(pricePer1000) || pricePer1000 < 1000 || pricePer1000 > 100000000) {
    return json({ error: "Harga per 1.000 Robux tidak valid." }, 400, corsHeaders);
  }

  const stockExpression = stockOperation === "set" ? "?" : "available_robux + ?";
  await env.DB.prepare(`
    UPDATE inventory
    SET available_robux = ${stockExpression},
        price_per_1000 = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE product_code = ?
  `).bind(stockAmount, pricePer1000, PRODUCT_CODE).run();

  const inventory = await env.DB.prepare(
    "SELECT available_robux, price_per_1000, updated_at FROM inventory WHERE product_code = ?"
  ).bind(PRODUCT_CODE).first();

  return json({
    availableRobux: inventory.available_robux,
    pricePer1000: inventory.price_per_1000,
    packages: buildPackageCatalog(inventory.price_per_1000),
    updatedAt: inventory.updated_at
  }, 200, corsHeaders);
}

function buildPackageCatalog(pricePer1000) {
  return PACKAGE_AMOUNTS.map((robuxAmount) => ({
    robuxAmount,
    price: calculatePackagePrice(robuxAmount, pricePer1000)
  }));
}

function calculatePackagePrice(robuxAmount, pricePer1000) {
  return Math.round((Number(robuxAmount) * Number(pricePer1000)) / 1000);
}

function serializeOrder(order) {
  return {
    orderCode: order.order_code,
    orderDate: order.order_date,
    queueNumber: order.queue_number,
    username: order.username,
    robuxAmount: order.robux_amount,
    packagePrice: order.package_price,
    adminFee: order.admin_fee,
    paymentMethod: order.payment_method,
    total: Number(order.package_price) + Number(order.admin_fee),
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at || null
  };
}

function jakartaDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function authorized(request, secret) {
  if (!secret) return false;
  return request.headers.get("Authorization") === `Bearer ${secret}`;
}

function buildCorsHeaders(origin, configuredOrigins) {
  const allowedOrigins = String(configuredOrigins || "https://xhmrnz.me")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (!origin || allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin || allowedOrigins[0];
  }
  return headers;
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("INVALID_CONTENT_TYPE");
  }
  return request.json();
}

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
