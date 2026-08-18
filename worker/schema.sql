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
