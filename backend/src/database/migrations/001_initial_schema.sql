CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hackathons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  min_team_size INTEGER NOT NULL DEFAULT 1,
  max_team_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hackathons_team_size_bounds_check
    CHECK (min_team_size >= 1 AND max_team_size >= min_team_size)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id UUID NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  leader_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teams_id_hackathon_id_unique UNIQUE (id, hackathon_id),
  CONSTRAINT teams_hackathon_name_unique UNIQUE (hackathon_id, team_name)
);

CREATE TABLE team_members (
  team_id UUID NOT NULL,
  hackathon_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_members_team_hackathon_fk
    FOREIGN KEY (team_id, hackathon_id)
    REFERENCES teams(id, hackathon_id) ON DELETE CASCADE,
  CONSTRAINT team_members_team_user_unique UNIQUE (team_id, user_id),
  CONSTRAINT team_members_hackathon_user_unique UNIQUE (hackathon_id, user_id)
);

CREATE UNIQUE INDEX team_members_one_leader_per_team_idx
  ON team_members (team_id)
  WHERE role = 'leader';

ALTER TABLE teams
  ADD CONSTRAINT teams_leader_must_be_member_fk
  FOREIGN KEY (id, leader_id)
  REFERENCES team_members (team_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX teams_hackathon_created_at_idx
  ON teams (hackathon_id, created_at DESC);

CREATE INDEX team_members_team_id_idx
  ON team_members (team_id);

CREATE TABLE join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX join_requests_one_pending_per_user_team_idx
  ON join_requests (team_id, user_id)
  WHERE status = 'pending';

CREATE INDEX join_requests_team_status_created_at_idx
  ON join_requests (team_id, status, created_at);

CREATE INDEX join_requests_user_created_at_idx
  ON join_requests (user_id, created_at DESC);

CREATE TABLE invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invite_codes_sha256_hex_check CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX invite_codes_team_active_idx
  ON invite_codes (team_id, expires_at)
  WHERE is_active = TRUE;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_team_created_at_idx
  ON audit_logs (team_id, created_at DESC);

CREATE INDEX audit_logs_actor_created_at_idx
  ON audit_logs (actor_id, created_at DESC);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_data JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idempotency_keys_user_key_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idempotency_keys_expires_at_idx
  ON idempotency_keys (expires_at);
