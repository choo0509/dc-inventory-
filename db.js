'use strict';
/* Database layer: SQLite file (default) or PostgreSQL (when DATABASE_URL is set). Same interface for both. */
const FIELDS = ['location','row','rack','u','model','serial','firmware','purpose','assetTag','owner','user','contract','remarks','ip','conn10g','item','status','pduA','pduB'];
const q = f => `"${f}"`;

function sqliteAdapter(file) {
  const { DatabaseSync } = require('node:sqlite');            // built into Node 22.13+
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL');
  const mk = h => ({
    all: async (sql, p = []) => h.prepare(sql).all(...p),
    get: async (sql, p = []) => h.prepare(sql).get(...p),
    run: async (sql, p = []) => Number(h.prepare(sql).run(...p).changes),
  });
  return { kind: 'sqlite', label: file, ...mk(d), exec: async s => d.exec(s),
    tx: async fn => { d.exec('BEGIN'); try { const r = await fn(mk(d)); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } },
    close: async () => d.close() };
}

function pgAdapter(url) {
  const { Pool } = require('pg');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;
  const pool = new Pool({ connectionString: url, ssl, max: parseInt(process.env.DATABASE_POOL, 10) || 10, connectionTimeoutMillis: 10000 });
  pool.on('error', e => console.error('[db] idle client error:', e.message));
  const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };   // ? placeholders -> $1, $2 ...
  const mk = h => ({
    all: async (sql, p = []) => (await h.query(conv(sql), p)).rows,
    get: async (sql, p = []) => (await h.query(conv(sql), p)).rows[0],
    run: async (sql, p = []) => (await h.query(conv(sql), p)).rowCount,
  });
  let label = 'PostgreSQL'; try { const u = new URL(url); label = `PostgreSQL ${u.hostname}:${u.port || 5432}${u.pathname}`; } catch {}
  return { kind: 'postgres', label, ...mk(pool), exec: async s => { await pool.query(s); },
    tx: async fn => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(mk(c)); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } },
    close: async () => pool.end() };
}

async function init(a) {
  const ts = a.kind === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';
  await a.exec(`CREATE TABLE IF NOT EXISTS users(
    username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), created_at ${ts} DEFAULT CURRENT_TIMESTAMP)`);
  await a.exec(`CREATE TABLE IF NOT EXISTS items(
    id TEXT PRIMARY KEY, ${FIELDS.map(f => `${q(f)} TEXT NOT NULL DEFAULT ''`).join(', ')},
    updated_by TEXT, updated_at ${ts} DEFAULT CURRENT_TIMESTAMP)`);
  await a.exec('CREATE INDEX IF NOT EXISTS idx_items_place ON items(location, "row", rack)');
  await a.exec('CREATE INDEX IF NOT EXISTS idx_items_serial ON items(serial)');
  return a;
}

/* connect({ url }) -> PostgreSQL;  connect({ file }) -> SQLite */
async function connect({ url, file }) { return init(url ? pgAdapter(url) : sqliteAdapter(file)); }
module.exports = { connect, FIELDS, q };
