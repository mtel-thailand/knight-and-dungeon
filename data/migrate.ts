/**
 * Schema migration runner.
 *
 * Usage:  npx tsx data/migrate.ts
 *
 * Environment: DATABASE_URL must point to the target Postgres.
 * Applies pending migrations in order. Idempotent — safe to re-run.
 */

const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001-add-spawn-count-to-campaigns",
    sql: `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spawn_count INTEGER NOT NULL DEFAULT 0;`,
  },
];

async function main() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure the migration tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows: applied } = await pool.query(
    "SELECT id FROM _migrations ORDER BY id",
  );
  const appliedSet = new Set(applied.map((r: any) => r.id));

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.id)) {
      console.log(`  [skip] ${m.id} — already applied`);
      continue;
    }
    console.log(`  [apply] ${m.id}`);
    await pool.query(m.sql);
    await pool.query("INSERT INTO _migrations (id) VALUES ($1)", [m.id]);
  }

  await pool.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
