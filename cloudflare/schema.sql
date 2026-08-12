-- Schema D1 para goteo cloud backend (v2 — fixes de revisión de seguridad)
-- Base de todos los datos: usuarios, calendario cifrado, pairing, sync

-- Cuentas de usuario
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- UUID
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- PBKDF2-SHA256 100k (formato salt:hash)
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

-- Vínculo de pareja (pairing entre cuentas, canónico y revocable)
CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,                    -- UUID
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by TEXT,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)                 -- par canónico: user_a siempre < user_b
);

CREATE INDEX IF NOT EXISTS idx_pairings_user_a ON pairings(user_a) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pairings_user_b ON pairings(user_b) WHERE status = 'active';

-- Invites de pairing (código de un solo uso, hash del código)
CREATE TABLE IF NOT EXISTS pairing_invites (
  code_hash TEXT PRIMARY KEY,             -- SHA-256 del código (nunca el código en claro)
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT
);

-- Sesiones de auth (token -> user)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,            -- SHA-256 del token de sesión
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Rate limiting simple (ventana por clave: email|ip)
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,                   -- 'login:persona@x.com' | 'redeem:ip' | ...
  window_start INTEGER NOT NULL,          -- epoch seconds del inicio de ventana
  attempts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);

-- Log de sync (auditoría, con enum)
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('push', 'pull', 'pair', 'unpair', 'register', 'login_fail', 'invite_redeem')),
  peer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket ON rate_limits(bucket, window_start);
