CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  -- ponytail: Legacy hashes stay inert for rollback; remove the column in a later destructive migration.
  password_hash TEXT,
  google_sub TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  impersonator_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sessions_impersonator_not_self CHECK (impersonator_user_id IS NULL OR impersonator_user_id <> user_id)
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonator_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_impersonator_not_self' AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_impersonator_not_self
      CHECK (impersonator_user_id IS NULL OR impersonator_user_id <> user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_impersonator_idx ON sessions(impersonator_user_id) WHERE impersonator_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS model_catalog (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT,
  supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
  supports_tools BOOLEAN NOT NULL DEFAULT FALSE,
  supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE model_catalog DROP COLUMN IF EXISTS tier;
ALTER TABLE model_catalog DROP COLUMN IF EXISTS input_rate;
ALTER TABLE model_catalog DROP COLUMN IF EXISTS output_rate;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Chat baru',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('streaming', 'complete', 'partial', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);
-- Link legacy assistant messages to their nearest preceding prompt for reliable retry/context filtering.
UPDATE messages AS assistant SET parent_message_id = (
  SELECT prompt.id FROM messages AS prompt
  WHERE prompt.conversation_id = assistant.conversation_id
    AND prompt.role = 'user' AND prompt.created_at <= assistant.created_at
  ORDER BY prompt.created_at DESC, prompt.id DESC LIMIT 1
) WHERE assistant.role = 'assistant' AND assistant.parent_message_id IS NULL;

CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  error_code TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS generation_runs_user_created_idx ON generation_runs(user_id, created_at DESC);

-- Remove obsolete monetization storage while preserving users, conversations, messages, and generation history.
DROP TABLE IF EXISTS usage_ledger;
DROP TABLE IF EXISTS billing_events;
ALTER TABLE generation_runs DROP COLUMN IF EXISTS quota_period_id;
ALTER TABLE generation_runs DROP COLUMN IF EXISTS reserved_credits;
ALTER TABLE generation_runs DROP COLUMN IF EXISTS charged_credits;
DROP TABLE IF EXISTS quota_periods;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plans;

CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
