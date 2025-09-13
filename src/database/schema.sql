CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,                              -- app-generated (uuid/nanoid)
  type             TEXT NOT NULL CHECK (type IN ('market','limit','sniper')),
  token_in    TEXT NOT NULL,                                 -- token symbol
  token_out   TEXT NOT NULL,                                 -- token symbol
  amount_in        BIGINT NOT NULL CHECK (amount_in > 0),         -- smallest units
  executed_amount  BIGINT,                                        -- fill on success (smallest units)
  status           TEXT NOT NULL CHECK (
                     status IN ('pending','routing','building','submitted','confirmed','failed')
                   ),
  dex     TEXT,
  tx_hash          TEXT UNIQUE,                                   -- nullable until submitted
  error_message    TEXT,                                          -- fill on failure
  retry_count      SMALLINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at      TIMESTAMPTZ
);
