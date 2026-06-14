-- OSS-shape Postgres fixture for the live-backend Playwright spec.
--
-- Verbatim copy of the in-tree CE constants
--   ossOAuthClientsSchema  (cmd/identuum-idp/integration_oss_to_ce_oauth_clients_test.go)
--   ossSigningKeysSchema   (cmd/identuum-idp/integration_oss_to_ce_signing_keys_test.go)
--   ossSessionsSchema      (cmd/identuum-idp/integration_oss_to_ce_local_sessions_test.go)
--   ossGooseLedgerSchema   (cmd/identuum-idp/integration_oss_to_ce_upgrade_smoke_test.go)
-- plus a single synthetic seeded row per collision table so the
-- spec can verify that the OSS rows survive the CE migration apply.
--
-- gen_random_uuid() is used instead of uuidv7() because the OSS
-- migration installs uuidv7() as a SQL function; we are not
-- installing it here (the seed rows do not need it for the
-- preservation contract). The CE migration installs its own
-- uuidv7 function and continues from there.
--
-- Do NOT add OSS columns or rows that the prune/list contract
-- relies on — those are exercised through HTTP, not SQL.

CREATE TABLE goose_db_version (
    id SERIAL PRIMARY KEY,
    version_id BIGINT NOT NULL,
    is_applied BOOLEAN NOT NULL,
    tstamp TIMESTAMP NOT NULL DEFAULT NOW()
);
INSERT INTO goose_db_version (version_id, is_applied) VALUES (0, true);

CREATE TABLE oauth_clients (
    id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                       VARCHAR(255) NOT NULL UNIQUE,
    client_secret_hash              VARCHAR(255) NOT NULL,
    name                            VARCHAR(255) NOT NULL,
    redirect_uris                   TEXT[]       NOT NULL,
    scope                           TEXT         NOT NULL,
    is_public                       BOOLEAN      NOT NULL DEFAULT false,
    service_account_id              UUID,
    organization_id                 UUID,
    allowed_audiences               TEXT[],
    post_logout_redirect_uris       TEXT[]       DEFAULT '{}'::text[],
    skip_consent                    BOOLEAN      NOT NULL DEFAULT false,
    token_ttl_secs                  INTEGER,
    token_endpoint_auth_method      TEXT         NOT NULL DEFAULT 'client_secret_basic',
    jwks_uri                        TEXT,
    jwks                            TEXT,
    token_endpoint_auth_signing_alg TEXT         NOT NULL DEFAULT 'EdDSA',
    deleted_at                      TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_clients_auth_method_check
        CHECK (token_endpoint_auth_method IN (
            'client_secret_basic',
            'client_secret_post',
            'none',
            'private_key_jwt'
        )),
    CONSTRAINT oauth_clients_signing_alg_check
        CHECK (token_endpoint_auth_signing_alg IN (
            'EdDSA','ES256','ES384','RS256','RS384','RS512',
            'PS256','PS384','PS512'
        ))
);
CREATE INDEX idx_oauth_clients_client_id   ON oauth_clients(client_id);
CREATE INDEX idx_oauth_clients_deleted_at  ON oauth_clients(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE signing_keys (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    kid          VARCHAR(255) NOT NULL,
    algorithm    VARCHAR(50)  NOT NULL,
    private_key  TEXT         NOT NULL,
    public_key   TEXT         NOT NULL,
    state        VARCHAR(50)  NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMPTZ              DEFAULT CURRENT_TIMESTAMP,
    rotated_at   TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_by   VARCHAR(255),

    CONSTRAINT chk_signing_key_state
        CHECK (state IN ('active','rotating','deprecated'))
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_selector UUID NOT NULL,
    token_validator_hash VARCHAR(255) NOT NULL,
    client_id VARCHAR(255),
    acr VARCHAR(50) DEFAULT '0',
    amr TEXT DEFAULT 'pwd',
    last_acr_uplift_at TIMESTAMPTZ,
    last_acr_uplift_value TEXT,
    remember_me BOOLEAN NOT NULL DEFAULT false,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(100),
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_cleanup_composite ON sessions(expires_at, revoked_at);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_revoked ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_client_id ON sessions(client_id) WHERE client_id IS NOT NULL;

-- Synthetic seed rows — one per collision table — so the post-apply
-- verification can confirm OSS data survived the CE migration. The
-- values are deliberately stable + non-secret so the report can
-- echo their substrings safely.
INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, scope)
    VALUES ('pw-live-smoke-client-1', 'bcrypt-placeholder', 'Live smoke seed client', ARRAY['http://localhost/cb'], 'openid');

INSERT INTO signing_keys (kid, algorithm, private_key, public_key)
    VALUES ('pw-live-smoke-kid-1', 'EdDSA', 'placeholder-encoded-private', 'placeholder-encoded-public');

INSERT INTO sessions (user_id, token_selector, token_validator_hash, expires_at)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'pw-live-smoke-validator-1', NOW() + INTERVAL '1 day');
