import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL);
  const schema = await readFile(new URL('../db/schedule-publications.sql',import.meta.url),'utf8');
  await sql.transaction(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>sql.query(s)));
  console.log('Schedule publication tables ready; no schedules or staff records changed.');
}
