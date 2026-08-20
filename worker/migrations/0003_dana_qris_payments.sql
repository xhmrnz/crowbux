ALTER TABLE orders ADD COLUMN checkout_token_hash TEXT;

CREATE TABLE IF NOT EXISTS dana_payments (
  order_id TEXT PRIMARY KEY,
  partner_reference_no TEXT NOT NULL UNIQUE,
  external_id TEXT NOT NULL UNIQUE,
  dana_reference_no TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  qr_content TEXT,
  qr_image TEXT,
  qr_url TEXT,
  redirect_url TEXT,
  merchant_name TEXT,
  status TEXT NOT NULL DEFAULT 'CREATING'
    CHECK (status IN ('CREATING', 'PENDING', 'PAID', 'FAILED', 'EXPIRED')),
  response_code TEXT,
  response_message TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dana_payments_status_expiry_idx
ON dana_payments (status, expires_at);
