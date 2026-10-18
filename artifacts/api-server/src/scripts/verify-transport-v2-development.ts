/** Real PostgreSQL, existing managed development DB only. No auth fixture/server, no production connection, all schema/data ROLLBACK. */
import pg from "pg";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {loadTransportPlanning} from "../lib/transport-v2-planning.js";
import {reviewRun,readRunEvents} from "../lib/transport-v2-store.js";
import {checkTransportCommand,transportState,type TransportCommand} from "@workspace/api-zod";
import {dispatchTransportIntents} from "../lib/transport-push-dispatch.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000,max:2});
const c=await pool.connect(),other=await pool.connect();
let checks=0;
try{
  const name=(await c.query("SELECT current_database() AS name")).rows[0].name;
  assert.equal(name,"heliumdb","Only the existing Replit development DB heliumdb is allowed");
  await c.query("BEGIN");
  const schema=`transport_verify_${randomUUID().replaceAll("-","")}`;
  await c.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},pg_catalog`);
  await c.query(`CREATE TABLE parent_students(id text,parent_id text,student_id text,swimming_pool_id text,status text);
    CREATE TABLE parent_accounts(id text PRIMARY KEY,swimming_pool_id text,is_active boolean,withdrawal_requested_at timestamptz);
    CREATE TABLE push_tokens(parent_account_id text,token text);
    CREATE TABLE students(id text PRIMARY KEY,name text,swimming_pool_id text,status text,deleted_at timestamptz,parent_phone text,parent_phone2 text,parent_phone3 text,parent_phone4 text);
    CREATE TABLE users(id text,swimming_pool_id text);
    CREATE TABLE class_groups(id text,name text,swimming_pool_id text,is_deleted boolean,schedule_days text,schedule_time text,is_one_time boolean,one_time_date text);
    CREATE TABLE student_class_history(student_id text,class_group_id text,swimming_pool_id text,enrolled_at date,left_at date);
    CREATE TABLE makeup_sessions(student_id text,swimming_pool_id text,assigned_date text,assigned_class_group_id text,cancelled_at timestamptz,status text);
    CREATE TABLE attendance(student_id text,class_group_id text,swimming_pool_id text,date text,status text,modified_by text,created_by text);
    CREATE TABLE pool_holidays(pool_id text,holiday_date date);
    CREATE TABLE office_operation_receipts(pool_id text,request_id uuid,actor_id text,input_hash text,result jsonb,PRIMARY KEY(pool_id,request_id));`);
  for(const file of ["office-transport-preparation.sql","office-transport-v2.sql","office-transport-v2-completion.sql"]){
    const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),"utf8");
    await c.query(sql.replace(/^\s*(BEGIN|COMMIT);/gm,""));
    checks++;
  }
  await c.query(`INSERT INTO class_groups VALUES('cg','Fixture class','fixture',false,'월','08:00~08:50',false,NULL);
    INSERT INTO students(id,name,swimming_pool_id,status) VALUES('s','Fixture student','fixture','active');
    INSERT INTO student_class_history VALUES('s','cg','fixture','2026-10-01',NULL);
    INSERT INTO office_transport_memberships(id,pool_id,principal_type,principal_id,name,duty,status,invited_by)
      VALUES('driver','fixture','users','d','Fixture driver','DRIVER','ACTIVE','admin');
    INSERT INTO office_transport_records(id,pool_id,kind,data,created_by,updated_by) VALUES
      ('v','fixture','vehicle','{"name":"Fixture van","status":"active","capacity":2}','admin','admin'),
      ('stop','fixture','stop','{"name":"Fixture stop","status":"active","address":"Fixture address"}','admin','admin');
    INSERT INTO office_transport_vehicle_availability(pool_id,vehicle_id,data,updated_by)
      VALUES('fixture','v','{"start":"07:00","end":"20:00","weekdays":[1]}','admin');
    INSERT INTO office_transport_preferences(pool_id,student_id,data,updated_by) VALUES
      ('fixture','s','{"enabled":true,"from":"2026-10-01","to":"2026-10-31","weekdays":[1],"inboundStopId":"","outboundStopId":"stop","handover":"Guardian at stop","exceptions":[]}','admin');
    INSERT INTO office_transport_settings(pool_id,data,updated_by) VALUES('fixture',
      '{"departureBufferMinutes":5,"handoverBufferMinutes":5,"durations":{},"overrides":[],"travel":[]}','admin');`);
  const context=await loadTransportPlanning(c,"fixture","2026-10-19");
  assert.equal(context.items[0].windows[0].end,"08:50");checks++;
  const plan:any={name:"Fixture run",date:"2026-10-19",vehicleId:"v",driverId:"driver",escortId:"",capacity:2,startTime:"09:00",returnBy:"10:00",
    steps:[{id:"start",action:"CENTER_BOARD",stopId:"CENTER",name:"Center",time:"09:00",travelMinutes:0,fixed:false,studentIds:["s"]},
      {id:"drop",action:"DROP",stopId:"stop",name:"Stop",time:"09:10",travelMinutes:10,fixed:false,studentIds:["s"]},
      {id:"end",action:"CENTER_HANDOVER",stopId:"CENTER",name:"Center",time:"09:20",travelMinutes:10,fixed:false,studentIds:[]}]};
  const reviewed=await reviewRun(c,"fixture",plan);
  assert.equal(reviewed.plan.handoverSnapshot?.s,"Guardian at stop");checks++;
  await c.query("INSERT INTO pool_holidays VALUES('fixture','2026-10-19')");
  assert.equal((await loadTransportPlanning(c,"fixture","2026-10-19")).items[0].windows.length,0);checks++;
  await c.query("DELETE FROM pool_holidays");
  await c.query(`UPDATE office_transport_settings SET data=jsonb_set(data,'{departureBufferMinutes}','15') WHERE pool_id='fixture'`);
  await assert.rejects(()=>reviewRun(c,"fixture",plan),/버퍼/);checks++;
  await c.query("INSERT INTO office_transport_runs(id,pool_id,status,plan,created_by) VALUES('run','fixture','PUBLISHED',$1::jsonb,'admin')",[JSON.stringify(reviewed.plan)]);
  const id=randomUUID(),command={requestId:id,revision:1,kind:"ACK",deviceAt:"2026-10-19T00:00:00Z"};
  await c.query("INSERT INTO office_transport_events(request_id,run_id,pool_id,revision,actor,payload,device_at) VALUES($1,'run','fixture',1,'users:d',$2::jsonb,now())",[id,JSON.stringify(command)]);
  await c.query("SAVEPOINT duplicate");
  await assert.rejects(()=>c.query("INSERT INTO office_transport_events(request_id,run_id,pool_id,revision,actor,payload,device_at) VALUES($1,'run','fixture',1,'users:d',$2::jsonb,now())",[id,JSON.stringify(command)]),{code:"23505"});
  await c.query("ROLLBACK TO SAVEPOINT duplicate");checks++;
  await c.query("SAVEPOINT immutable");
  await assert.rejects(()=>c.query("UPDATE office_transport_events SET actor='other' WHERE request_id=$1",[id]));
  await c.query("ROLLBACK TO SAVEPOINT immutable");checks++;
  for(const data of [{kind:"START"},{kind:"BOARD",stepId:"start",studentIds:["s"]},{kind:"ALIGHT",stepId:"drop",studentIds:["s"]},
    {kind:"FINISH",cabinChecked:true,centerReturned:true}]){
    const next={requestId:randomUUID(),revision:1,deviceAt:"2026-10-19T00:10:00Z",...data} as TransportCommand;
    checkTransportCommand(reviewed.plan,await readRunEvents(c,"run"),next,"users:d",1);
    await c.query(`INSERT INTO office_transport_events(request_id,run_id,pool_id,revision,actor,payload,device_at)
      VALUES($1,'run','fixture',1,'users:d',$2::jsonb,$3)`,[next.requestId,JSON.stringify(next),next.deviceAt]);
  }
  const state=transportState(reviewed.plan,await readRunEvents(c,"run"));
  assert.equal(state.closed,true);assert.equal(state.onboard.length,0);assert.equal(state.pending.length,0);checks++;
  await c.query(`INSERT INTO office_transport_observations(id,pool_id,run_id,actor,revision,command,plan,reason)
    VALUES($1,'fixture','run','users:d',1,$2::jsonb,$3::jsonb,'Fixture lost response')`,[id,JSON.stringify(command),JSON.stringify(reviewed.plan)]);
  await c.query(`INSERT INTO office_transport_resolutions(id,observation_id,pool_id,decision,reason,event_id,resolved_by)
    VALUES($1,$2,'fixture','LINK_EXISTING','Fixture exact original proof',$2,'users:admin')`,[randomUUID(),id]);
  assert.equal((await c.query("SELECT count(*)::int AS n FROM office_transport_events WHERE request_id=$1",[id])).rows[0].n,1);checks++;
  await c.query("SAVEPOINT resolution");
  await assert.rejects(()=>c.query(`INSERT INTO office_transport_resolutions(id,observation_id,pool_id,decision,reason,resolved_by)
    VALUES($1,$2,'fixture','RETAIN_OBSERVATION','Duplicate fixture','users:admin')`,[randomUUID(),id]),{code:"23505"});
  await c.query("ROLLBACK TO SAVEPOINT resolution");checks++;
  await c.query("SAVEPOINT observation");
  await assert.rejects(()=>c.query("UPDATE office_transport_observations SET reason='overwrite' WHERE id=$1",[id]));
  await c.query("ROLLBACK TO SAVEPOINT observation");checks++;
  await c.query(`INSERT INTO office_transport_operations(id,pool_id,vehicle_id,kind,data,created_by)
    VALUES($1,'fixture','v','FUEL','{"amount":100,"date":"2026-10-19","odometer":1}','users:admin')`,[randomUUID()]);checks++;
  await c.query(`INSERT INTO office_transport_certifications(id,pool_id,run_id,revision,content_hash,signature,reason,signed_by)
    VALUES($1,'fixture','run',1,'fixture-hash','Fixture signature','Fixture reason','users:admin')`,[randomUUID()]);
  await c.query("SAVEPOINT certificate");
  await assert.rejects(()=>c.query(`INSERT INTO office_transport_certifications(id,pool_id,run_id,revision,content_hash,signature,reason,signed_by)
    VALUES($1,'fixture','run',1,'fixture-hash','Duplicate','Fixture reason','users:admin')`,[randomUUID()]),{code:"23505"});
  await c.query("ROLLBACK TO SAVEPOINT certificate");checks++;
  await c.query(`INSERT INTO office_transport_model_calls(request_id,pool_id,actor,input_hash,approval_reference,model,max_tokens,state)
    VALUES($1,'fixture','users:admin','hash','fixture-no-provider','NO_MODEL_CALLED',1,'SENDING')`,[id]);
  await c.query("SAVEPOINT model_call");
  await assert.rejects(()=>c.query(`INSERT INTO office_transport_model_calls(request_id,pool_id,actor,input_hash,approval_reference,model,max_tokens,state)
    VALUES($1,'fixture','users:admin','hash','fixture-no-provider','NO_MODEL_CALLED',1,'SENDING')`,[id]),{code:"23505"});
  await c.query("ROLLBACK TO SAVEPOINT model_call");checks++;
  const board=(await c.query("SELECT request_id FROM office_transport_events WHERE payload->>'kind'='BOARD'")).rows[0].request_id;
  await c.query(`INSERT INTO parent_accounts VALUES('parent','fixture',true,NULL);
    INSERT INTO parent_students VALUES('relation','parent','s','fixture','approved');
    UPDATE parent_students SET transport_notify=true;
    INSERT INTO push_tokens VALUES('parent','fixture-no-network-provider');`);
  await c.query(`INSERT INTO office_transport_notification_intents(event_id,parent_id,student_id,pool_id)
    VALUES($1,'parent','s','fixture')`,[board]);
  // Execute the REAL adapter SQL inside the outer rollback via nested savepoints.
  // Provider is injected: this tests claim/replay/failure SQL, NOT an actual push or delivery.
  const tx={query:async(sql:string,args?:any[])=>c.query(sql==="BEGIN"?"SAVEPOINT dispatch":sql==="COMMIT"?"RELEASE SAVEPOINT dispatch":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT dispatch":sql,args),release:()=>{}};
  const scoped={connect:async()=>tx,query:(sql:string,args?:any[])=>c.query(sql,args)} as any;
  let providerAttempts=0;
  const approval={poolId:"fixture",eventIds:[board],expiresAt:Date.now()+60000,approvalReference:"fixture-injected-provider-only"};
  assert.equal((await dispatchTransportIntents(scoped,approval,async()=>{providerAttempts++;return false;})).attempted,1);
  assert.equal((await c.query("SELECT state FROM office_transport_notification_intents WHERE event_id=$1",[board])).rows[0].state,"DELIVERY_UNKNOWN");checks++;
  assert.equal((await dispatchTransportIntents(scoped,approval,async()=>{providerAttempts++;return true;})).attempted,0);
  assert.equal(providerAttempts,1);checks++;
  const lock=`transport-test:${randomUUID()}`;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[lock]);
  assert.equal((await other.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",[lock])).rows[0].acquired,false);checks++;
  await c.query("ROLLBACK");
  assert.equal((await other.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",[lock])).rows[0].acquired,true);checks++;
  assert.equal((await c.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists",[schema])).rows[0].exists,false);checks++;
  console.log(`PASS ${checks} real PostgreSQL migration/planning/holiday/buffer/snapshot/duplicate/immutable/concurrency/rollback checks; no operating data changed`);
}finally{await c.query("ROLLBACK").catch(()=>{});c.release();other.release();await pool.end();}
