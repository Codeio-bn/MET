const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'smet',
  user: process.env.DB_USER || 'smet',
  password: process.env.DB_PASSWORD || 'smet_secret',
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id          UUID PRIMARY KEY,
      reporter    VARCHAR(100) NOT NULL,
      priority    VARCHAR(10)  NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      status      VARCHAR(10)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      complaint   TEXT,
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  // Add event columns to existing installations
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS event_id         VARCHAR(100)`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS event_name       VARCHAR(200)`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_team    VARCHAR(100)`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rejected_by      VARCHAR(100)`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   VARCHAR(100) PRIMARY KEY,
      value JSONB        NOT NULL
    )
  `);
  console.log('Database initialized');
};

module.exports = { pool, initDB };
