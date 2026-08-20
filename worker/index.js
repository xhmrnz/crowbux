const PRODUCT_CODE = "ROBUX";
const JAKARTA_TIME_ZONE = "Asia/Jakarta";
const ROBLOX_USERS_URL = "https://users.roblox.com";
const ROBLOX_THUMBNAILS_URL = "https://thumbnails.roblox.com";
const ROBLOX_OAUTH_URL = "https://apis.roblox.com/oauth";
const OAUTH_FLOW_TTL_SECONDS = 10 * 60;
const OAUTH_EXCHANGE_TTL_SECONDS = 5 * 60;
const OAUTH_SESSION_TTL_SECONDS = 20 * 60;
const MAX_EXTERNAL_RESPONSE_BYTES = 512 * 1024;

const PACKAGE_AMOUNTS = [80, 400, 800, 1700, 4500, 10000];

const PAYMENT_FEES = new Map([
  ["QRIS", 0],
  ["DANA", 1500],
  ["GoPay", 2000],
  ["Bank Transfer", 3000]
]);

export default {
  async fetch(request, env, ctx) {
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
        return await getCatalog(env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/roblox/users/resolve") {
        return await resolveRobloxAccountRequest(request, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/roblox/oauth/status") {
        return json({ enabled: oauthEnabled(env) }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/roblox/oauth/start") {
        return await startRobloxOAuth(url, env);
      }

      if (request.method === "GET" && url.pathname === "/api/roblox/oauth/callback") {
        return await finishRobloxOAuth(url, env, ctx);
      }

      if (request.method === "POST" && url.pathname === "/api/roblox/oauth/redeem") {
        return await redeemRobloxOAuth(request, env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/orders") {
        return await createOrder(request, env, corsHeaders);
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([A-Z0-9-]+)$/);
      if (request.method === "GET" && orderMatch) {
        return await getOrder(orderMatch[1], env, corsHeaders);
      }

      const paymentMatch = url.pathname.match(/^\/api\/orders\/([A-Z0-9-]+)\/confirm-payment$/);
      if (request.method === "POST" && paymentMatch) {
        return await confirmPayment(paymentMatch[1], request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/settings") {
        return await getAdminSettings(request, env, corsHeaders);
      }

      if (request.method === "PUT" && url.pathname === "/api/admin/settings") {
        return await updateAdminSettings(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/orders") {
        return await getAdminOrders(request, env, corsHeaders);
      }

      const adminPaymentMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Z0-9-]+)\/mark-paid$/);
      if (request.method === "POST" && adminPaymentMatch) {
        return await confirmAdminPayment(adminPaymentMatch[1], request, env, corsHeaders);
      }

      return json({ error: "Endpoint tidak ditemukan." }, 404, corsHeaders);
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      console.error(JSON.stringify({ event: "request_error", message }));
      if (error instanceof HttpError) {
        return json({ error: error.publicMessage }, error.status, corsHeaders);
      }
      if (message.includes("INSUFFICIENT_STOCK")) {
        return json({ error: "Stok Robux tidak mencukupi untuk menyelesaikan pembayaran ini." }, 409, corsHeaders);
      }
      return json({ error: "Terjadi kesalahan pada server." }, 500, corsHeaders);
    }
  }
};

class HttpError extends Error {
  constructor(status, publicMessage, internalMessage = publicMessage) {
    super(internalMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

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

async function resolveRobloxAccountRequest(request, corsHeaders) {
  const payload = await readJson(request);
  const account = await resolveRobloxAccount(String(payload.username || ""));
  return json({ account }, 200, corsHeaders);
}

async function resolveRobloxAccount(rawUsername) {
  const username = rawUsername.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw new HttpError(400, "Username Roblox tidak valid.");
  }

  const lookup = await fetchExternalJson(`${ROBLOX_USERS_URL}/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  }, "roblox_username_lookup");
  const match = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!match) {
    throw new HttpError(404, "Akun Roblox tidak ditemukan atau tidak dapat digunakan.");
  }

  const [profileResult, thumbnailResult] = await Promise.allSettled([
    fetchExternalJson(`${ROBLOX_USERS_URL}/v1/users/${match.id}`, {}, "roblox_user_profile"),
    fetchExternalJson(
      `${ROBLOX_THUMBNAILS_URL}/v1/users/avatar-headshot?userIds=${match.id}&size=150x150&format=Png&isCircular=true`,
      {},
      "roblox_avatar_thumbnail"
    )
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value : {};
  const thumbnailData = thumbnailResult.status === "fulfilled" && Array.isArray(thumbnailResult.value.data)
    ? thumbnailResult.value.data[0]
    : null;

  return {
    id: Number(match.id),
    username: match.name,
    displayName: match.displayName,
    hasVerifiedBadge: Boolean(match.hasVerifiedBadge),
    description: String(profile.description || ""),
    createdAt: profile.created || null,
    avatarUrl: thumbnailData && thumbnailData.state === "Completed" ? thumbnailData.imageUrl : null,
    profileUrl: `https://www.roblox.com/users/${match.id}/profile`,
    ownershipVerified: false,
    verificationMethod: "ROBLOX_API"
  };
}

function oauthEnabled(env) {
  return Boolean(env.ROBLOX_OAUTH_CLIENT_ID && env.ROBLOX_OAUTH_REDIRECT_URI);
}

async function startRobloxOAuth(url, env) {
  if (!oauthEnabled(env)) {
    throw new HttpError(503, "Login Roblox belum dikonfigurasi oleh admin.");
  }

  const returnUrl = safeReturnUrl(url.searchParams.get("return_to"), env.CROWBUX_FRONTEND_URL);
  const state = randomToken(32);
  const codeVerifier = randomToken(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const now = unixNow();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM roblox_oauth_flows WHERE expires_at <= ?").bind(now),
    env.DB.prepare(`
      INSERT INTO roblox_oauth_flows (state, code_verifier, return_url, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(state, codeVerifier, returnUrl, now + OAUTH_FLOW_TTL_SECONDS)
  ]);

  const authorizationUrl = new URL(`${ROBLOX_OAUTH_URL}/v1/authorize`);
  authorizationUrl.searchParams.set("client_id", env.ROBLOX_OAUTH_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", env.ROBLOX_OAUTH_REDIRECT_URI);
  authorizationUrl.searchParams.set("scope", "openid profile");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);
  return Response.redirect(authorizationUrl.toString(), 302);
}

async function finishRobloxOAuth(url, env, ctx) {
  const state = String(url.searchParams.get("state") || "");
  const flow = state
    ? await env.DB.prepare(`
        DELETE FROM roblox_oauth_flows
        WHERE state = ? AND expires_at > ?
        RETURNING code_verifier, return_url
      `).bind(state, unixNow()).first()
    : null;
  const returnUrl = flow ? flow.return_url : safeReturnUrl(null, env.CROWBUX_FRONTEND_URL);

  if (!flow) {
    return redirectWithParam(returnUrl, "roblox_oauth_error", "Sesi login kedaluwarsa atau tidak valid.");
  }
  if (url.searchParams.get("error")) {
    return redirectWithParam(
      returnUrl,
      "roblox_oauth_error",
      url.searchParams.get("error_description") || "Login Roblox dibatalkan."
    );
  }

  const authorizationCode = String(url.searchParams.get("code") || "");
  if (!authorizationCode) {
    return redirectWithParam(returnUrl, "roblox_oauth_error", "Kode otorisasi Roblox tidak ditemukan.");
  }

  try {
    const tokenBody = new URLSearchParams({
      client_id: env.ROBLOX_OAUTH_CLIENT_ID,
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: flow.code_verifier
    });
    if (env.ROBLOX_OAUTH_CLIENT_SECRET) tokenBody.set("client_secret", env.ROBLOX_OAUTH_CLIENT_SECRET);

    const tokenResponse = await fetchExternalJson(`${ROBLOX_OAUTH_URL}/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    }, "roblox_oauth_token");
    if (!tokenResponse.access_token) throw new Error("ROBLOX_ACCESS_TOKEN_MISSING");

    const userInfo = await fetchExternalJson(`${ROBLOX_OAUTH_URL}/v1/userinfo`, {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
    }, "roblox_oauth_userinfo");
    const robloxUserId = Number(userInfo.sub);
    if (!Number.isSafeInteger(robloxUserId) || !userInfo.preferred_username) {
      throw new Error("ROBLOX_USERINFO_INVALID");
    }

    const exchangeCode = randomToken(32);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM roblox_oauth_exchange_codes WHERE expires_at <= ?").bind(unixNow()),
      env.DB.prepare(`
        INSERT INTO roblox_oauth_exchange_codes (
          code, roblox_user_id, username, display_name, avatar_url, profile_url, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        exchangeCode,
        robloxUserId,
        userInfo.preferred_username,
        userInfo.name || userInfo.preferred_username,
        userInfo.picture || null,
        userInfo.profile || `https://www.roblox.com/users/${robloxUserId}/profile`,
        unixNow() + OAUTH_EXCHANGE_TTL_SECONDS
      )
    ]);

    ctx.waitUntil(revokeRobloxToken(tokenResponse.access_token, env));
    return redirectWithParam(returnUrl, "roblox_auth_code", exchangeCode);
  } catch (error) {
    console.error(JSON.stringify({ event: "roblox_oauth_callback_error", message: String(error.message || error) }));
    return redirectWithParam(returnUrl, "roblox_oauth_error", "Roblox gagal mengotorisasi akun. Silakan coba lagi.");
  }
}

async function redeemRobloxOAuth(request, env, corsHeaders) {
  const payload = await readJson(request);
  const exchangeCode = String(payload.code || "");
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(exchangeCode)) {
    throw new HttpError(400, "Kode otorisasi tidak valid.");
  }

  const exchange = await env.DB.prepare(`
    DELETE FROM roblox_oauth_exchange_codes
    WHERE code = ? AND expires_at > ?
    RETURNING roblox_user_id, username, display_name, avatar_url, profile_url
  `).bind(exchangeCode, unixNow()).first();
  if (!exchange) {
    throw new HttpError(410, "Kode otorisasi sudah digunakan atau kedaluwarsa.");
  }

  const authorizationToken = randomToken(48);
  const tokenHash = await sha256Hex(authorizationToken);
  await env.DB.prepare(`
    INSERT INTO roblox_authorization_sessions (
      token_hash, roblox_user_id, username, display_name, avatar_url, profile_url, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    exchange.roblox_user_id,
    exchange.username,
    exchange.display_name,
    exchange.avatar_url,
    exchange.profile_url,
    unixNow() + OAUTH_SESSION_TTL_SECONDS
  ).run();

  return json({
    authorizationToken,
    account: {
      id: Number(exchange.roblox_user_id),
      username: exchange.username,
      displayName: exchange.display_name,
      avatarUrl: exchange.avatar_url,
      profileUrl: exchange.profile_url,
      ownershipVerified: true,
      verificationMethod: "ROBLOX_OAUTH"
    }
  }, 200, corsHeaders);
}

async function revokeRobloxToken(accessToken, env) {
  try {
    const body = new URLSearchParams({ token: accessToken, client_id: env.ROBLOX_OAUTH_CLIENT_ID });
    if (env.ROBLOX_OAUTH_CLIENT_SECRET) body.set("client_secret", env.ROBLOX_OAUTH_CLIENT_SECRET);
    await fetch(`${ROBLOX_OAUTH_URL}/v1/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "roblox_token_revoke_failed", message: String(error.message || error) }));
  }
}

async function createOrder(request, env, corsHeaders) {
  const payload = await readJson(request);
  const requestedUsername = String(payload.username || "").trim();
  const requestedUserId = Number(payload.robloxUserId);
  const authorizationToken = String(payload.robloxAuthorizationToken || "");
  const robuxAmount = Number(payload.robuxAmount);
  const paymentMethod = String(payload.paymentMethod || "");
  const phone = String(payload.phone || "").replace(/\D/g, "");
  const email = String(payload.email || "").trim().toLowerCase();
  const adminFee = PAYMENT_FEES.get(paymentMethod);

  if (!Number.isSafeInteger(requestedUserId) || requestedUserId <= 0) {
    return json({ error: "Verifikasi akun Roblox diperlukan sebelum checkout." }, 400, corsHeaders);
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

  const account = await resolveRobloxAccount(requestedUsername);
  if (account.id !== requestedUserId) {
    return json({ error: "Data akun Roblox berubah. Silakan verifikasi ulang." }, 409, corsHeaders);
  }

  let ownershipVerified = false;
  let authorizationTokenHash = null;
  if (authorizationToken) {
    authorizationTokenHash = await sha256Hex(authorizationToken);
    const authorization = await env.DB.prepare(`
      SELECT roblox_user_id
      FROM roblox_authorization_sessions
      WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL
    `).bind(authorizationTokenHash, unixNow()).first();
    if (!authorization || Number(authorization.roblox_user_id) !== account.id) {
      return json({ error: "Otorisasi Roblox tidak valid atau sudah kedaluwarsa." }, 401, corsHeaders);
    }
    ownershipVerified = true;
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
  const statements = [
    env.DB.prepare(`
      INSERT INTO daily_counters (order_date, last_number)
      VALUES (?, 1)
      ON CONFLICT(order_date) DO UPDATE SET last_number = last_number + 1
    `).bind(orderDate),
    env.DB.prepare(`
      INSERT INTO orders (
        id, order_date, queue_number, order_code, username, roblox_user_id,
        roblox_display_name, roblox_avatar_url, roblox_ownership_verified,
        robux_amount, package_price, admin_fee, payment_method, phone, email
      )
      SELECT ?, ?, last_number,
        'CBX-' || REPLACE(?, '-', '') || '-' || printf('%03d', last_number),
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM daily_counters
      WHERE order_date = ?
      RETURNING order_code, order_date, queue_number, username, roblox_user_id,
        roblox_display_name, roblox_avatar_url, roblox_ownership_verified,
        robux_amount, package_price, admin_fee, payment_method, status, created_at
    `).bind(
      orderId,
      orderDate,
      orderDate,
      account.username,
      account.id,
      account.displayName,
      account.avatarUrl,
      ownershipVerified ? 1 : 0,
      robuxAmount,
      packagePrice,
      adminFee,
      paymentMethod,
      phone,
      email || null,
      orderDate
    )
  ];

  if (authorizationTokenHash) {
    statements.push(env.DB.prepare(`
      UPDATE roblox_authorization_sessions
      SET used_at = CURRENT_TIMESTAMP, used_order_id = ?
      WHERE token_hash = ? AND used_at IS NULL
    `).bind(orderId, authorizationTokenHash));
  }

  const results = await env.DB.batch(statements);
  const order = results[1] && results[1].results && results[1].results[0];
  if (!order) throw new Error("ORDER_CREATION_FAILED");
  return json({ order: serializeOrder(order) }, 201, corsHeaders);
}

async function getOrder(orderCode, env, corsHeaders) {
  const order = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, roblox_user_id,
      roblox_display_name, roblox_avatar_url, roblox_ownership_verified,
      robux_amount, package_price, admin_fee, payment_method, status, created_at, paid_at
    FROM orders WHERE order_code = ?
  `).bind(orderCode).first();
  if (!order) return json({ error: "Pesanan tidak ditemukan." }, 404, corsHeaders);
  return json({ order: serializeOrder(order) }, 200, corsHeaders);
}

async function confirmPayment(orderCode, request, env, corsHeaders) {
  if (!(await authorized(request, env.PAYMENT_WEBHOOK_SECRET))) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }
  const payload = await readJson(request);
  const paymentReference = String(payload.paymentReference || "MANUAL").slice(0, 100);
  return markOrderPaid(orderCode, paymentReference, env, corsHeaders);
}

async function confirmAdminPayment(orderCode, request, env, corsHeaders) {
  if (!(await authorized(request, env.ADMIN_API_SECRET))) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }
  return markOrderPaid(orderCode, "ADMIN-CONFIRMED", env, corsHeaders);
}

async function markOrderPaid(orderCode, paymentReference, env, corsHeaders) {
  const existing = await env.DB.prepare("SELECT status FROM orders WHERE order_code = ?").bind(orderCode).first();
  if (!existing) return json({ error: "Pesanan tidak ditemukan." }, 404, corsHeaders);
  if (existing.status === "CANCELLED") {
    return json({ error: "Pesanan sudah dibatalkan." }, 409, corsHeaders);
  }
  if (existing.status === "PENDING") {
    await env.DB.prepare(`
      UPDATE orders SET status = 'PAID', payment_reference = ?, paid_at = CURRENT_TIMESTAMP
      WHERE order_code = ? AND status = 'PENDING'
    `).bind(paymentReference, orderCode).run();
  }

  const order = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, roblox_user_id,
      roblox_display_name, roblox_avatar_url, roblox_ownership_verified,
      robux_amount, package_price, admin_fee, payment_method, status, created_at, paid_at
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
  if (!(await authorized(request, env.ADMIN_API_SECRET))) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }
  const result = await env.DB.prepare(`
    SELECT order_code, order_date, queue_number, username, roblox_user_id,
      roblox_display_name, roblox_avatar_url, roblox_ownership_verified,
      robux_amount, package_price, admin_fee, payment_method, status, created_at, paid_at
    FROM orders ORDER BY created_at DESC LIMIT 50
  `).all();
  return json({ orders: result.results.map(serializeOrder) }, 200, corsHeaders);
}

async function getAdminSettings(request, env, corsHeaders) {
  if (!(await authorized(request, env.ADMIN_API_SECRET))) {
    return json({ error: "Tidak memiliki akses." }, 401, corsHeaders);
  }
  return getCatalog(env, corsHeaders);
}

async function updateAdminSettings(request, env, corsHeaders) {
  if (!(await authorized(request, env.ADMIN_API_SECRET))) {
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
    SET available_robux = ${stockExpression}, price_per_1000 = ?, updated_at = CURRENT_TIMESTAMP
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
    robloxUserId: order.roblox_user_id ? Number(order.roblox_user_id) : null,
    robloxDisplayName: order.roblox_display_name || order.username,
    robloxAvatarUrl: order.roblox_avatar_url || null,
    robloxOwnershipVerified: Boolean(order.roblox_ownership_verified),
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

async function fetchExternalJson(url, init, eventName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const contentLength = Number(response.headers.get("Content-Length") || 0);
    if (contentLength > MAX_EXTERNAL_RESPONSE_BYTES) {
      throw new Error(`${eventName}_RESPONSE_TOO_LARGE`);
    }
    if (!response.ok) throw new Error(`${eventName}_HTTP_${response.status}`);
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new HttpError(504, "Roblox terlalu lama merespons. Silakan coba lagi.", `${eventName}_TIMEOUT`);
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Layanan Roblox sedang tidak tersedia. Silakan coba lagi.", String(error.message || error));
  } finally {
    clearTimeout(timeout);
  }
}

function safeReturnUrl(candidate, configuredFrontendUrl) {
  const fallback = new URL(configuredFrontendUrl || "https://xhmrnz.me/crowbux/");
  try {
    const parsed = new URL(candidate || fallback.toString());
    if (parsed.origin !== fallback.origin || !parsed.pathname.startsWith(fallback.pathname)) {
      return fallback.toString();
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fallback.toString();
  }
}

function redirectWithParam(destination, name, value) {
  const redirectUrl = new URL(destination);
  redirectUrl.searchParams.set(name, value);
  return Response.redirect(redirectUrl.toString(), 302);
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
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

async function authorized(request, secret) {
  if (!secret) return false;
  return timingSafeEqual(request.headers.get("Authorization") || "", `Bearer ${secret}`);
}

async function timingSafeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
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
    throw new HttpError(415, "Format permintaan harus berupa JSON.");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Data JSON tidak valid.");
  }
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
