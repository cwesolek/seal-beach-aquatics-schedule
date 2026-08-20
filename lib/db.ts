import { neon } from "@neondatabase/serverless";

export function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  return neon(connectionString);
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL && process.env.CLERK_SECRET_KEY);
}
