import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { acceptanceQueries } from "../lib/swap-acceptance";
import type { database } from "../lib/db";

const requester = "00000000-0000-0000-0000-000000000001";
const recipient = "00000000-0000-0000-0000-000000000002";
const stranger = "00000000-0000-0000-0000-000000000003";
const first = "00000000-0000-0000-0000-000000000011";
const second = "00000000-0000-0000-0000-000000000012";
const request = "00000000-0000-0000-0000-000000000021";

async function fixture(swap = false, open = false) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE staff (id uuid PRIMARY KEY, active boolean DEFAULT true);
    CREATE TABLE shifts (id uuid PRIMARY KEY, status text DEFAULT 'assigned', shift_date date DEFAULT CURRENT_DATE);
    CREATE TABLE shift_assignments (id serial PRIMARY KEY, shift_id uuid REFERENCES shifts, staff_id uuid REFERENCES staff, assigned_by uuid REFERENCES staff, UNIQUE(shift_id, staff_id));
    CREATE TABLE swap_requests (id uuid PRIMARY KEY, shift_id uuid REFERENCES shifts, target_shift_id uuid REFERENCES shifts, requester_id uuid REFERENCES staff, recipient_id uuid REFERENCES staff, status text DEFAULT 'pending', reviewed_by uuid REFERENCES staff, reviewed_at timestamptz);
    INSERT INTO staff (id) VALUES ('${requester}'), ('${recipient}'), ('${stranger}');
    INSERT INTO shifts (id) VALUES ('${first}'), ('${second}');
    INSERT INTO shift_assignments (shift_id, staff_id) VALUES ('${first}', '${requester}'), ('${second}', '${recipient}');
  `);
  await db.query("INSERT INTO swap_requests (id, shift_id, target_shift_id, requester_id, recipient_id) VALUES ($1,$2,$3,$4,$5)", [request, first, swap ? second : null, requester, open ? null : recipient]);
  async function accept(actor = recipient) {
    // Execute the exact parameterized statements used in the production Neon transaction.
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => ({
      query: strings.reduce((text, segment, index) => text + (index ? `$${index}` : "") + segment, ""), values,
    })) as unknown as ReturnType<typeof database>;
    const queries = acceptanceQueries(sql, request, actor) as unknown as { query: string; values: unknown[] }[];
    return db.transaction(async (tx) => {
      const results = [];
      for (const query of queries) results.push(await tx.query(query.query, query.values));
      return results[1].rows;
    });
  }
  async function assignments() { return (await db.query("SELECT shift_id, staff_id FROM shift_assignments ORDER BY shift_id, staff_id")).rows; }
  return { db, accept, assignments };
}

test("cover acceptance transfers the shift and removes its pending notification", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.accept()).length, 1);
    assert.deepEqual(await f.assignments(), [{ shift_id: first, staff_id: recipient }, { shift_id: second, staff_id: recipient }]);
    assert.equal((await f.db.query("SELECT id FROM swap_requests WHERE status='pending'")).rows.length, 0);
    assert.equal((await f.accept()).length, 0, "repeated acceptance is rejected");
  } finally { await f.db.close(); }
});

test("swap acceptance exchanges both assignments and clears pending status", async () => {
  const f = await fixture(true);
  try {
    assert.equal((await f.accept()).length, 1);
    assert.deepEqual(await f.assignments(), [{ shift_id: first, staff_id: recipient }, { shift_id: second, staff_id: requester }]);
    assert.equal((await f.db.query("SELECT id FROM swap_requests WHERE status='pending'")).rows.length, 0);
  } finally { await f.db.close(); }
});

for (const scenario of ["wrong recipient", "self acceptance", "stale source", "stale target", "already assigned", "inactive recipient", "cancelled shift", "declined request", "past shift"]) {
  test(`${scenario} leaves the assignments and request unchanged`, async () => {
    const f = await fixture(true);
    try {
      if (scenario === "stale source") await f.db.query("DELETE FROM shift_assignments WHERE shift_id=$1", [first]);
      if (scenario === "stale target") await f.db.query("DELETE FROM shift_assignments WHERE shift_id=$1", [second]);
      if (scenario === "already assigned") await f.db.query("INSERT INTO shift_assignments (shift_id, staff_id) VALUES ($1,$2)", [first, recipient]);
      if (scenario === "inactive recipient") await f.db.query("UPDATE staff SET active=false WHERE id=$1", [recipient]);
      if (scenario === "cancelled shift") await f.db.query("UPDATE shifts SET status='cancelled' WHERE id=$1", [second]);
      if (scenario === "declined request") await f.db.exec("UPDATE swap_requests SET status='declined'");
      if (scenario === "past shift") await f.db.query("UPDATE shifts SET shift_date=CURRENT_DATE-1 WHERE id=$1", [first]);
      const before = await f.assignments();
      assert.equal((await f.accept(scenario === "wrong recipient" ? stranger : scenario === "self acceptance" ? requester : recipient)).length, 0);
      assert.deepEqual(await f.assignments(), before);
      assert.equal((await f.db.query<{ status: string }>("SELECT status FROM swap_requests")).rows[0].status, scenario === "declined request" ? "declined" : "pending");
    } finally { await f.db.close(); }
  });
}

test("an open cover can be accepted by another active staff member", async () => {
  const f = await fixture(false, true);
  try {
    assert.equal((await f.accept(stranger)).length, 1);
    assert.equal((await f.db.query<{ recipient_id: string }>("SELECT recipient_id FROM swap_requests")).rows[0].recipient_id, stranger);
  } finally { await f.db.close(); }
});

test("a database failure rolls back schedule changes and pending status together", async () => {
  const f = await fixture(true);
  try {
    await f.db.exec("ALTER TABLE swap_requests ADD CONSTRAINT reject_approval CHECK (status <> 'approved')");
    const before = await f.assignments();
    await assert.rejects(f.accept());
    assert.deepEqual(await f.assignments(), before);
    assert.equal((await f.db.query<{ status: string }>("SELECT status FROM swap_requests")).rows[0].status, "pending");
  } finally { await f.db.close(); }
});
