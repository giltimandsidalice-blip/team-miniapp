// api/_db.js
import pkg from "pg";
const { Pool } = pkg;

const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString || !String(rawConnectionString).trim()) {
  throw new Error("[db] DATABASE_URL is missing");
}

const connectionString = String(rawConnectionString).trim();
if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
  throw new Error("[db] DATABASE_URL must be a Postgres connection string");
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export const q = (sql, params = []) => pool.query(sql, params);
