import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __drizzlePool?: Pool; __drizzle?: ReturnType<typeof drizzle> };

function getDb() {
  if (!globalForDb.__drizzle) {
    const pool =
      globalForDb.__drizzlePool ??
      new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 3,
      });
    globalForDb.__drizzlePool = pool;
    globalForDb.__drizzle = drizzle(pool, { schema });
  }
  return globalForDb.__drizzle;
}

export { getDb };
