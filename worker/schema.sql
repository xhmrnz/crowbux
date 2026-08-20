PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory (
  product_code TEXT PRIMARY KEY,
  available_robux INTEGER NOT NULL CHECK (available_robux >= 0),
  price_per_1000 INTEGER NOT NULL CHECK (price_per_1000 > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO inventory (product_code, available_robux, price_per_1000)
VALUES ('ROBUX', 50000, 160000);

CREATE TABLE IF NOT EXISTS daily_counters (
  order_date TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  queue_number INTEGER NOT NULL CHECK (queue_number > 0),
  order_code TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  roblox_user_id INTEGER,
  roblox_display_name TEXT,
  roblox_avatar_url TEXT,
  roblox_ownership_verified INTEGER NOT NULL DEFAULT 0 CHECK (roblox_ownership_verified IN (0, 1)),
  robux_amount INTEGER NOT NULL CHECK (robux_amount > 0),
  package_price INTEGER NOT NULL CHECK (package_price >= 0),
  admin_fee INTEGER NOT NULL CHECK (admin_fee >= 0),
  payment_method TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  payment_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  UNIQUE (order_date, queue_number)
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx
ON orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_roblox_user_idx
ON orders (roblox_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS roblox_oauth_flows (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS roblox_oauth_flows_expiry_idx
ON roblox_oauth_flows (expires_at);

CREATE TABLE IF NOT EXISTS roblox_oauth_exchange_codes (
  code TEXT PRIMARY KEY,
  roblox_user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS roblox_oauth_exchange_expiry_idx
ON roblox_oauth_exchange_codes (expires_at);

CREATE TABLE IF NOT EXISTS roblox_authorization_sessions (
  token_hash TEXT PRIMARY KEY,
  roblox_user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  used_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS roblox_authorization_user_expiry_idx
ON roblox_authorization_sessions (roblox_user_id, expires_at);

CREATE TRIGGER IF NOT EXISTS prevent_payment_without_stock
BEFORE UPDATE OF status ON orders
WHEN NEW.status = 'PAID'
  AND OLD.status != 'PAID'
  AND (
    SELECT available_robux
    FROM inventory
    WHERE product_code = 'ROBUX'
  ) < NEW.robux_amount
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

CREATE TRIGGER IF NOT EXISTS deduct_stock_after_payment
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'PAID' AND OLD.status != 'PAID'
BEGIN
  UPDATE inventory
  SET available_robux = available_robux - NEW.robux_amount,
      updated_at = CURRENT_TIMESTAMP
  WHERE product_code = 'ROBUX';
END;
