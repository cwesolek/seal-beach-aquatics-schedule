import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { postScheduleQueries, publicationDeliveryCounts } from "../lib/schedule-publications";
import { deliverSchedulePublication } from "../lib/deliver-schedule-publication";
import { sendPublicationBatch } from "../lib/schedule-publication-email";
import { periodEnd, periodOffsetFrom, validPeriodStart, schedulePath, scheduleSignInTarget } from "../lib/schedule-period";
import type { database } from "../lib/db";
type Query={text:string;values:unknown[]};
const a="00000000-0000-0000-0000-000000000001",b="00000000-0000-0000-0000-000000000002",c="00000000-0000-0000-0000-000000000003";
async function fixture() {
 const db=new PGlite();
 const base=(await readFile(new URL("../db/schema.sql",import.meta.url),"utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;","");
 await db.exec(base);await db.exec(await readFile(new URL("../db/schedule-publications.sql",import.meta.url),"utf8"));
 await db.query("INSERT INTO staff(id,name,email,role,approval_status,active) VALUES ($1,'Manager','manager@example.test','manager','approved',true),($2,'Staff','staff@example.test','staff','approved',true),($3,'Inactive','inactive@example.test','staff','approved',false)",[a,b,c]);
 await db.exec("INSERT INTO shifts(shift_date,title,starts_at,ends_at) VALUES ('2026-11-08','Morning','06:00','10:00')");
 const sql=((strings:TemplateStringsArray,...values:unknown[])=>{
  const q={text:strings.reduce((s,p,i)=>s+(i?`$${i}`:"")+p,""),values};
  return {...q,then:(resolve: (rows:unknown[])=>unknown,reject:(reason:unknown)=>unknown)=>db.query(q.text,q.values).then(r=>r.rows).then(resolve,reject)};
 }) as unknown as ReturnType<typeof database>;
 sql.transaction=(async (queries:Query[])=>db.transaction(async tx=>{const results=[];for(const q of queries) results.push((await tx.query(q.text,q.values)).rows);return results;})) as unknown as typeof sql.transaction;
 const post=async (start="2026-11-08")=>(await sql.transaction(postScheduleQueries(sql,start,periodEnd(start),a)))[2][0] as {id:string;periodStart:string;periodEnd:string};
 return {db,sql,post};
}
test("posting records the exact period, snapshots approved active staff, and preserves shifts",async()=>{
 const f=await fixture();try{
 const before=(await f.db.query("SELECT * FROM shifts")).rows;
 const post=await f.post();assert.equal(post.periodStart,"2026-11-08");assert.equal(post.periodEnd,"2026-11-21");
 assert.deepEqual(await publicationDeliveryCounts(f.sql,post.id),{total:2,sent:0});
 assert.deepEqual((await f.db.query("SELECT * FROM shifts")).rows,before);
 await f.db.query("UPDATE staff SET active=true WHERE id=$1",[c]);assert.equal((await f.post()).id,post.id);
 assert.deepEqual(await publicationDeliveryCounts(f.sql,post.id),{total:2,sent:0});
 assert.equal(await f.post("2026-12-06"),undefined);
 }finally{await f.db.close();}
});
test("failed delivery preserves posting and retries only unsent batches without duplicate sends",async()=>{
 const f=await fixture();try{
 const post=await f.post();let attempts=0;
 await deliverSchedulePublication(f.sql,post,async()=>{attempts++;throw Error("provider offline");});
 assert.deepEqual(await publicationDeliveryCounts(f.sql,post.id),{total:2,sent:0});assert.equal((await f.post()).id,post.id);
 await deliverSchedulePublication(f.sql,post,async(p,batch,recipients)=>{attempts++;assert.equal(p.id,post.id);assert.equal(batch,0);assert.equal(recipients.length,2);return ["email-a","email-b"];});
 assert.deepEqual(await publicationDeliveryCounts(f.sql,post.id),{total:2,sent:2});
 await deliverSchedulePublication(f.sql,post,async()=>{throw Error("must not resend");});assert.equal(attempts,2);
 }finally{await f.db.close();}
});
test("a concurrent posting request cannot send an already claimed publication",async()=>{
 const f=await fixture();try{const post=await f.post();await f.db.query("UPDATE schedule_publications SET sending_until=now()+interval '1 minute' WHERE id=$1",[post.id]);let sent=false;await deliverSchedulePublication(f.sql,post,async()=>{sent=true;return [];});assert.equal(sent,false);}finally{await f.db.close();}
});
test("emails use individual private recipients and a stable date link and idempotency key",async()=>{
 const p={id:"publication-1",periodStart:"2026-11-08",periodEnd:"2026-11-21"};
 const fetcher=(async(url,options)=>{assert.equal(url,"https://api.resend.com/emails/batch");const body=JSON.parse(options?.body as string);assert.deepEqual(body.map((item:{to:string[]})=>item.to),[["a@example.test"],["b@example.test"]]);assert.match(body[0].text,/https:\/\/sba-schedule.com\/\?tab=Schedule&periodStart=2026-11-08/);assert.equal((options?.headers as Record<string,string>)["Idempotency-Key"],"schedule-post/publication-1/0");return new Response(JSON.stringify({data:[{id:"one"},{id:"two"}]}));}) as typeof fetch;
 assert.deepEqual(await sendPublicationBatch(p,0,[{staffId:a,email:"a@example.test"},{staffId:b,email:"b@example.test"}],{apiKey:"test",domain:"sba-schedule.com",fetcher}),["one","two"]);
 await assert.rejects(sendPublicationBatch(p,0,[{staffId:a,email:"a@example.test"}],{apiKey:"test",domain:"sba-schedule.com",fetcher:(async()=>new Response('{}',{status:429})) as typeof fetch}),/429/);
});
test("absolute schedule links remain tied to the same pay period across daylight saving and year changes",()=>{
 assert.equal(validPeriodStart("2026-11-08"),true);assert.equal(validPeriodStart("2026-11-09"),false);assert.equal(validPeriodStart("2026-02-31"),false);
 assert.equal(periodEnd("2026-11-08"),"2026-11-21");assert.equal(periodOffsetFrom("2026-11-08","2026-10-25"),1);assert.equal(periodOffsetFrom("2026-11-08","2027-01-03"),-4);assert.equal(schedulePath("2026-11-08"),"/?tab=Schedule&periodStart=2026-11-08");
});

test("sign-in preserves a validated schedule destination and rejects external or malformed redirect targets",()=>{
 assert.equal(scheduleSignInTarget("/?tab=Schedule&periodStart=2026-11-08"),"/?tab=Schedule&periodStart=2026-11-08");
 for (const target of ["https://evil.example/?periodStart=2026-11-08","//evil.example/?periodStart=2026-11-08","http://[",undefined,"/?periodStart=2026-11-09"]) assert.equal(scheduleSignInTarget(target),"/");
});
