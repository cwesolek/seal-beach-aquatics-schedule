import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { finalizeSwapQueries } from "../lib/finalize-swap";
import { applyRecurringAssignments } from "../lib/recurring-assignments";
import type { database } from "../lib/db";

const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const c = "00000000-0000-0000-0000-000000000003";
const s1 = "00000000-0000-0000-0000-000000000011";
const s2 = "00000000-0000-0000-0000-000000000012";
const t1 = "00000000-0000-0000-0000-000000000031";
const t2 = "00000000-0000-0000-0000-000000000032";
const requestId = "00000000-0000-0000-0000-000000000021";
const date = "2026-10-19";
type Query = { text: string; values: unknown[] };
const compile = (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.reduce((text, segment, i) => text + (i ? `$${i}` : "") + segment, ""), values });

async function fixture(kind: "cover" | "swap" | "full-day" = "cover") {
  const db = new PGlite();
  const schema = (await readFile(new URL("../db/schema.sql", import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
  await db.exec(schema);
  await db.query("INSERT INTO staff (id,name,email,approval_status) VALUES ($1,'Requester','a@example.test','approved'),($2,'Recipient','b@example.test','approved'),($3,'Other','c@example.test','approved')", [a,b,c]);
  await db.query("INSERT INTO recurring_shift_templates (id,title,day_of_week,starts_at,ends_at,required_staff) VALUES ($1,'Morning',1,'06:00','10:00',2),($2,'Midday',1,'10:00','14:00',2)",[t1,t2]);
  await db.query("INSERT INTO shifts (id,template_id,shift_date,title,starts_at,ends_at) VALUES ($1,$2,$3,'Morning','06:00','10:00'),($4,$5,$3,'Midday','10:00','14:00')",[s1,t1,date,s2,t2]);
  await db.query("INSERT INTO shift_assignments (shift_id,staff_id,scheduled_starts_at,scheduled_ends_at) VALUES ($1,$2,'06:15','09:45'),($3,$4,'10:15','13:45')",[s1,a,s2,kind === "full-day" ? a : b]);
  await db.query("INSERT INTO recurring_staff_assignments (template_id,staff_id,starts_on) VALUES ($1,$2,$3),($4,$5,$3)",[t1,a,date,t2,kind === "full-day" ? a : b]);
  await db.query("INSERT INTO swap_requests (id,shift_id,requester_id,recipient_id,recipient_shift_id,additional_shift_id) VALUES ($1,$2,$3,$4,$5,$6)",[requestId,s1,a,b,kind === "swap" ? s2 : null,kind === "full-day" ? s2 : null]);
  const accept = async (actor = b) => {
    const queries = finalizeSwapQueries(compile as unknown as ReturnType<typeof database>,requestId,actor) as unknown as Query[];
    return db.transaction(async tx => {
      let rows: unknown[] = [];
      for (const q of queries) rows = (await tx.query(q.text,q.values)).rows;
      return rows;
    });
  };
  const refresh = async (start = date, end = date) => {
    const sql = ((strings: TemplateStringsArray,...values: unknown[]) => {
      const q = compile(strings,...values); return db.query(q.text,q.values).then(result => result.rows);
    }) as unknown as ReturnType<typeof database>;
    await applyRecurringAssignments(sql,start,end);
  };
  const assignments = async () => (await db.query("SELECT shift_id,staff_id,scheduled_starts_at,scheduled_ends_at FROM shift_assignments ORDER BY shift_id,staff_id")).rows;
  return { db,accept,refresh,assignments };
}

for (const kind of ["cover","swap","full-day"] as const) {
  test(`${kind} finalizes both schedule and pending request and survives recurring refresh`,async () => {
    const f = await fixture(kind);
    try {
      assert.equal((await f.accept()).length,1);
      const expected = [
        {shift_id:s1,staff_id:b,scheduled_starts_at:"06:15:00",scheduled_ends_at:"09:45:00"},
        {shift_id:s2,staff_id:kind === "swap" ? a : b,scheduled_starts_at:"10:15:00",scheduled_ends_at:"13:45:00"},
      ];
      assert.deepEqual(await f.assignments(),expected);
      assert.equal((await f.db.query("SELECT id FROM swap_requests WHERE status='pending'")).rows.length,0);
      assert.equal((await f.db.query("SELECT id FROM swap_requests WHERE recipient_accepted_at IS NOT NULL AND reviewed_at IS NOT NULL")).rows.length,1);
      await f.refresh(); await f.refresh();
      assert.deepEqual(await f.assignments(),expected,"refresh must not re-add the original recurring staff member");
      assert.equal((await f.db.query("SELECT * FROM recurring_assignment_exclusions")).rows.length,kind === "cover" ? 1 : 2);
      await f.refresh("2026-10-26","2026-10-26");
      const nextWeek = (await f.db.query<{staff_id: string}>("SELECT a.staff_id FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id WHERE s.shift_date='2026-10-26' ORDER BY s.starts_at")).rows;
      assert.deepEqual(nextWeek.map(row => row.staff_id),[a,kind === "full-day" ? a : b],"the recurring schedule must continue next week");
      assert.equal((await f.accept()).length,0,"repeated acceptance must not apply twice");
    } finally {await f.db.close();}
  });
}

for (const scenario of ["wrong recipient","self","stale source","stale target","already assigned","cancelled","declined","inactive","unapproved"]) {
  test(`${scenario} cannot change assignments or pending status`,async () => {
    const f = await fixture("swap");
    try {
      if (scenario === "stale source") await f.db.query("DELETE FROM shift_assignments WHERE shift_id=$1",[s1]);
      if (scenario === "stale target") await f.db.query("DELETE FROM shift_assignments WHERE shift_id=$1",[s2]);
      if (scenario === "already assigned") await f.db.query("INSERT INTO shift_assignments (shift_id,staff_id) VALUES ($1,$2)",[s1,b]);
      if (scenario === "cancelled") await f.db.query("UPDATE shifts SET status='cancelled' WHERE id=$1",[s2]);
      if (scenario === "declined") await f.db.exec("UPDATE swap_requests SET status='declined'");
      if (scenario === "inactive") await f.db.query("UPDATE staff SET active=false WHERE id=$1",[b]);
      if (scenario === "unapproved") await f.db.query("UPDATE staff SET approval_status='pending' WHERE id=$1",[b]);
      const before = await f.assignments();
      assert.equal((await f.accept(scenario === "wrong recipient" ? c : scenario === "self" ? a : b)).length,0);
      assert.deepEqual(await f.assignments(),before);
      assert.equal((await f.db.query("SELECT * FROM recurring_assignment_exclusions")).rows.length,0);
      assert.equal((await f.db.query<{status: string}>("SELECT status FROM swap_requests")).rows[0].status,scenario === "declined" ? "declined" : "pending");
    } finally {await f.db.close();}
  });
}

test("simultaneous repeated acceptance transfers only once", async () => {
  const f = await fixture("full-day");
  try {
    const results = await Promise.all([f.accept(),f.accept()]);
    assert.equal(results.reduce((n,rows) => n+rows.length,0),1);
    assert.equal((await f.assignments()).length,2);
  } finally { await f.db.close(); }
});

test("database failure rolls back transfers, exclusions, and pending status together",async () => {
  const f = await fixture("swap");
  try {
    await f.db.exec("ALTER TABLE swap_requests ADD CONSTRAINT reject_approval CHECK (status<>'approved')");
    const before = await f.assignments();
    await assert.rejects(f.accept());
    assert.deepEqual(await f.assignments(),before);
    assert.equal((await f.db.query("SELECT * FROM recurring_assignment_exclusions")).rows.length,0);
    assert.equal((await f.db.query("SELECT id FROM swap_requests WHERE status='pending'")).rows.length,1);
  } finally {await f.db.close();}
});
