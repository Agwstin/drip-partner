-- Schema D1 para drip cloud backend
-- Base de todos los datos: usuarios, calendario cifrado, pairing, sync

-- Cuentas de usuario
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- UUID
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- scrypt/argon2 (hash, nunca texto plano)
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Claves E2EE por dispositivo (la app cifra con estas antes de subir)
CREATE TABLE IF NOT EXISTS device_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,                -- id generado por la app
  public_key TEXT NOT NULL,               -- X25519 base64
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

-- Blob cifrado del calendario de cada usuario (el server nunca ve el contenido)
CREATE TABLE IF NOT EXISTS calendar_blobs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_blob TEXT NOT NULL,           -- payload cifrado E2EE
  blob_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vínculo de pareja (pairing entre cuentas)
CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,                    -- UUID
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_a, user_b)
);

-- Invites de pairing (código de un solo uso)
CREATE TABLE IF NOT EXISTS pairing_invites (
  code TEXT PRIMARY KEY,                  -- código corto tipo "DRIP-XXXX"
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Sesiones de auth (token -> user)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,            -- hash del token de sesión
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Log de sync (auditoría)
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                   -- 'push' | 'pull' | 'pair'
  peer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pairings_user_a ON pairings(user_a);
CREATE INDEX IF NOT EXISTS idx_pairings_user_b ON pairings(user_b);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, created_at);
