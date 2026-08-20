ALTER TABLE orders ADD COLUMN roblox_user_id INTEGER;
ALTER TABLE orders ADD COLUMN roblox_display_name TEXT;
ALTER TABLE orders ADD COLUMN roblox_avatar_url TEXT;
ALTER TABLE orders ADD COLUMN roblox_ownership_verified INTEGER NOT NULL DEFAULT 0 CHECK (roblox_ownership_verified IN (0, 1));

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
