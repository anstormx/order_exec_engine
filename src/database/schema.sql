CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,                              -- app-generated (uuid/nanoid)
  type             TEXT NOT NULL CHECK (type IN ('market','limit','sniper')),
  token_in    TEXT NOT NULL,
  token_out   TEXT NOT NULL,
  token_in_mint TEXT NOT NULL,
  token_out_mint TEXT NOT NULL,
  amount_in        BIGINT NOT NULL CHECK (amount_in > 0),         
  amount_out  BIGINT CHECK (amount_out > 0),
  status           TEXT NOT NULL CHECK (
                     status IN ('pending','routing','building','submitted','confirmed','failed')
                   ),
  dex     TEXT,
  tx_hash          TEXT UNIQUE,
  error_message    TEXT,
  retry_count      SMALLINT NOT NULL DEFAULT 0,
  created_at       DATE NOT NULL DEFAULT NOW(),
  updated_at       DATE NOT NULL DEFAULT NOW(),
  executed_at      DATE
);
