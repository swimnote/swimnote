import { Router, type Response } from "express";
import type { Pool, PoolClient } from "pg";
import type { AuthRequest } from "../middlewares/auth.js";
import type { OfficeActor } from "../lib/office-command.js";
import { OperationError, object, requestId, digest, date } from "../lib/office-operations-data.js";
import { financeActions, normalizeFinance, checkFinance, projectFinance, financeTotals, type FinanceEvent } from "../lib/office-finance.js";
import { COURSE_ATTENDANCE_SQL, historicalContractAttendanceSql } from "../lib/office-finance-sql.js";
import { normalizeInvoiceBatch, previewInvoiceBatch } from "../lib/office-finance-batch.js";
import { financeView } from "../lib/office-finance-view.js";

type Handler = (req: AuthRequest, res: Response, owner: OfficeActor) => Promise<void>;
type Wrap = (fn: Handler, needsSchema?: boolean) => (req: AuthRequest, res: Response) => Promise<void>;
type Query = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export async function requireFinanceSchema(c: Query) {
  if (!(await c.query("SELECT to_regclass('public.office_finance_schema') IS NOT NULL AS ready")).rows[0]?.ready)
    throw new OperationError(503, "OFFICE_FINANCE_MIGRATION_REQUIRED", "수납·수강 운영 migration 적용 대기입니다. 실제 저장 가능 상태가 아닙니다.");
}
export async function readLedger(c: Query, poolId: string): Promise<FinanceEvent[]> {
  return (await c.query(`SELECT id,data FROM office_operation_records WHERE pool_id=$1 AND resource='ledger'
    ORDER BY (data->>'sequence')::bigint,id`, [poolId])).rows.map(r => ({ ...r.data, id: r.id }));
}
export async function appendLedger(c: Query, poolId: string, actorId: string, event: FinanceEvent) {
  await c.query(`INSERT INTO office_operation_records(id,pool_id,resource,data,created_by)
    VALUES($1,$2,'ledger',$3::jsonb,$4)`, [event.id, poolId, JSON.stringify(event), actorId]);
  await c.query(`INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data)
    VALUES($1,1,$2,$3,$4::jsonb)`, [event.id, poolId, actorId, JSON.stringify(event)]);
}
export async function courseContext(c: Query, poolId: string, events: FinanceEvent[], asOf: string) {
  const records = (await c.query(`SELECT id,resource,data FROM office_operation_records
    WHERE pool_id=$1 AND resource IN ('contracts','enrollments','products')`, [poolId])).rows;
  const students = (await c.query("SELECT id,name,parent_phone FROM students WHERE swimming_pool_id=$1 AND deleted_at IS NULL ORDER BY name,id", [poolId])).rows;
  const attendance = (await c.query(COURSE_ATTENDANCE_SQL, [poolId, asOf])).rows;
  const contracts = records.filter(r => r.resource === "contracts");
  const enrollments = records.filter(r => r.resource === "enrollments");
  const candidates = (a: any) => contracts.filter(r => {
    a={...a,date:a.entitlement_date,class_group_id:a.entitlement_class};
    const d = r.data, amendments = events.filter(e => e.contractId === r.id && e.date <= a.date).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence);
    const end = amendments.filter(e => e.action === "contract.amend").at(-1)?.endDate ?? d.endDate;
    const held = amendments.filter(e => ["contract.hold", "contract.resume"].includes(e.action)).at(-1)?.action === "contract.hold";
    const ended = amendments.some(e => e.action === "contract.cancel");
    return d.status === "active" && !ended && d.studentId === a.student_id && d.startDate <= a.date && end >= a.date && !held &&
      enrollments.some(en => en.data.contractId === r.id && en.data.classId === a.class_group_id && en.data.startDate <= a.date && en.data.endDate >= a.date);
  });
  const usage = new Map<string, Set<string>>();
  const ambiguousAttendance: string[] = [];
  for (const a of attendance) {
    const matches = candidates(a);
    if (matches.length > 1) { ambiguousAttendance.push(a.id); continue; }
    if (matches.length === 1) {
      const set = usage.get(matches[0].id) ?? new Set();
      set.add(a.id); usage.set(matches[0].id, set);
    }
  }
  const rights = contracts.map(r => {
    const d = r.data, changes = events.filter(e => e.contractId === r.id && e.date <= asOf).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence);
    const endDate = changes.filter(e => e.action === "contract.amend").at(-1)?.endDate ?? d.endDate;
    const totalCount = (d.terms?.lessonCount ?? 0) + (d.terms?.freeCount ?? 0) +
      changes.filter(e => e.action === "rights.adjust").reduce((n, e) => n + e.deltaCount, 0);
    const usedCount = usage.get(r.id)?.size ?? 0;
    const weekStart=new Date(`${asOf}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate()-((weekStart.getUTCDay()+6)%7));
    const week=weekStart.toISOString().slice(0,10);
    const weeklyUsedCount=new Set(attendance.filter(a=>usage.get(r.id)?.has(a.id)&&a.date>=week&&a.date<=asOf).map(a=>a.id)).size;
    const countLimited=!["period","weekly"].includes(d.terms?.productType);
    return { id: r.id, studentId: d.studentId, label: `${students.find(s => s.id === d.studentId)?.name ?? d.studentId} · ${d.terms?.name ?? r.id}`,
      startDate: d.startDate, endDate, totalCount, usedCount, remainingCount: countLimited?totalCount-usedCount:null,
      weeklyCount:d.terms?.weeklyCount??null,weeklyUsedCount,
      held: changes.filter(e => ["contract.hold", "contract.resume"].includes(e.action)).at(-1)?.action === "contract.hold",
      renewalDue: d.status === "active" && !changes.some(e=>e.action==="contract.cancel") && (endDate <= asOf || countLimited&&totalCount-usedCount<=1),
      sourceAttendanceCount: usedCount, status: changes.some(e=>e.action==="contract.cancel") ? "ended" : d.status, terms: d.terms, previousContractId: d.previousContractId };
  });
  return { records, students, rights, ambiguousAttendance };
}
async function checkReferences(c: Query, poolId: string, events: FinanceEvent[], command: FinanceEvent) {
  const { students, rights } = await courseContext(c, poolId, events, command.date);
  const projected = checkFinance(events, command);
  if (command.studentId && !students.some(s => s.id === command.studentId)) throw new OperationError(403, "SCOPE_MISMATCH", "센터 회원이 아닙니다.");
  if (command.contractId) {
    const r = rights.find(x => x.id === command.contractId);
    if (!r || command.studentId && command.studentId !== r.studentId) throw new OperationError(403, "CONTRACT_SCOPE", "회원의 계약이 아닙니다.");
    if(command.action.startsWith("contract.") && (r.status!=="active"||command.date<r.startDate))
      throw new OperationError(409,"CONTRACT_STATE","유효한 계약의 시작일 이후 동작이어야 합니다.");
    if(command.action==="rights.adjust"&&r.remainingCount===null) throw new OperationError(409,"PERIOD_ENTITLEMENT","기간·주당형은 만료일/주당 정책으로 관리합니다. 총횟수 조정 대상이 아닙니다.");
    if (command.action === "rights.adjust" && r.remainingCount! + command.deltaCount < 0)
      throw new OperationError(409, "RIGHTS_OVERDRAWN", "이미 사용한 횟수보다 권리를 줄일 수 없습니다.");
    if (command.action === "contract.hold" && r.held || command.action === "contract.resume" && !r.held)
      throw new OperationError(409, "RIGHTS_STATE", "휴회·복귀 상태가 이미 변경되었습니다.");
    if (command.action === "contract.amend" && (command.endDate < r.startDate||command.endDate<command.date))
      throw new OperationError(400, "INVALID_PERIOD", "변경 기록일 이전의 수강 이력을 만료일 변경으로 잘라내지 않습니다.");
    if(["contract.hold","contract.cancel","contract.amend"].includes(command.action)){
      const boundary=command.action==="contract.amend"?command.endDate:command.date;
      const actual=await c.query(historicalContractAttendanceSql(command.action==="contract.amend"),
      [poolId,r.studentId,boundary,command.contractId]);
      if(actual.rows.length) throw new OperationError(409,"HISTORICAL_ATTENDANCE","이미 확정 출결이 있는 과거 권리를 휴회·종료·기간 단축으로 덮어쓰지 않습니다.");
    }
  }
  if (command.action === "receipt.allocate") {
    const rec = projected.receipts.find(r => r.id === command.receiptId)!;
    const inv = projected.invoices.find(r => r.id === command.invoiceId)!;
    if (rec.studentId !== inv.studentId) {
      // Financial family attribution uses an existing parent relationship, not a phone-derived permission.
      const family = await c.query(`SELECT 1 FROM parent_students a JOIN parent_students b ON a.parent_id=b.parent_id
        JOIN students s1 ON s1.id=a.student_id JOIN students s2 ON s2.id=b.student_id
        WHERE a.student_id=$1 AND b.student_id=$2 AND a.status='approved' AND b.status='approved'
        AND a.swimming_pool_id=$3 AND b.swimming_pool_id=$3
        AND s1.swimming_pool_id=$3 AND s2.swimming_pool_id=$3 LIMIT 1`,
      [rec.studentId, inv.studentId, poolId]);
      if (!family.rows.length) throw new OperationError(409, "ALLOCATION_OWNER", "동일 회원 또는 기존 보호자 관계로 연결된 가족 청구에만 배분할 수 있습니다.");
    }
  }
  return projected;
}
export function createOfficeFinanceRouter(pool: Pool, run: Wrap) {
  const router = Router();
  router.get("/snapshot", run(async (req, res, owner) => {
    await requireFinanceSchema(pool);
    const from = req.query.from ? date(req.query.from) : "0001-01-01";
    const to = req.query.to ? date(req.query.to) : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (from > to) throw new OperationError(400, "INVALID_PERIOD", "조회 기간을 확인하세요.");
    // A read-only repeatable snapshot keeps all reported amounts on one DB snapshot.
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const all = await readLedger(c, owner.poolId), events = all.filter(e => e.date <= to);
      const context = await courseContext(c, owner.poolId, events, to);
      const p = projectFinance(events);
      const parentLinks = (await c.query(`SELECT ps.parent_id,ps.student_id FROM parent_students ps
        JOIN students s ON s.id=ps.student_id WHERE s.swimming_pool_id=$1
        AND ps.swimming_pool_id=$1 AND ps.status='approved'`, [owner.poolId])).rows;
      const familyMap = new Map<string, string[]>();
      for (const s of context.students) {
        const parents=parentLinks.filter(x=>x.student_id===s.id).map(x=>x.parent_id);
        for(const key of parents.length?parents.map(id=>`parent:${id}`):[`student:${s.id}`])
          familyMap.set(key,[...new Set([...(familyMap.get(key)??[]),s.id])]);
      }
      const uniqueFamily=new Map([...familyMap].map(([key,ids])=>[ids.slice().sort().join("|"),{key,ids}]));
      const families = [...uniqueFamily.values()].map(({key,ids:studentIds}) => ({ key, studentIds,
        label: context.students.filter(s => studentIds.includes(s.id)).map(s => s.name).join(" · "),
        billedKrw: p.invoices.filter(i => studentIds.includes(i.studentId)).reduce((n, i) => n + i.amountKrw, 0),
        dueKrw: p.invoices.filter(i => studentIds.includes(i.studentId)).reduce((n, i) => n + i.dueKrw, 0) }));
      const sid = String(req.query.studentId ?? "");
      if (sid && !context.students.some(s => s.id === sid)) throw new OperationError(403, "SCOPE_MISMATCH", "센터 회원을 확인하세요.");
      const search = String(req.query.search ?? "").trim();
      if (search.length > 200) throw new OperationError(400,"INVALID_SEARCH","검색어는 200자 이하로 입력하세요.");
      const view = financeView(events, context.students, from, to, sid, search);
      const studentView = sid ? financeView(events, context.students, from, to, sid) : null;
      const invIds = new Set(p.invoices.filter(i => !sid || i.studentId === sid).map(i => i.id));
      const recIds = new Set(p.receipts.filter(r => !sid || r.studentId === sid).map(r => r.id));
      const selected = events.filter(e => !sid || e.studentId === sid || invIds.has(e.invoiceId) || recIds.has(e.receiptId) ||
        context.rights.some(r => r.id === e.contractId && r.studentId === sid) ||
        (e.allocationId && p.allocations.some(a => a.id === e.allocationId && (invIds.has(a.invoiceId) || recIds.has(a.receiptId)))));
      const name = (studentId: string) => context.students.find(s => s.id === studentId)?.name ?? studentId;
      const refs = {
        students: context.students.map(s => ({ id: s.id, label: s.name })),
        contracts: context.rights.map(r => ({ id: r.id, label: r.label })),
        invoices: p.invoices.filter(i => !i.cancelled).map(i => ({ id: i.id, label: `${name(i.studentId)} · ${i.label} · 미납 ${i.dueKrw.toLocaleString()}원` })),
        receipts: p.receipts.filter(r => !r.voided).map(r => ({ id: r.id, label: `${name(r.studentId)} · ${r.date} · 미배분 ${r.unallocatedKrw.toLocaleString()}원` })),
        allocations: p.allocations.filter(a => a.remainingKrw > 0).map(a => ({ id: a.id, label: `${a.id} · 잔여 ${a.remainingKrw.toLocaleString()}원` })),
        expenses: p.expenses.filter(e => !e.cancelled).map(e => ({ id: e.id, label: `${e.vendor} · ${e.label} · 미지급 ${e.dueKrw.toLocaleString()}원` })),
        closings: p.closings.filter(c => c.active).map(c => ({ id: c.id, label: `${c.fromDate} ~ ${c.toDate}` })),
      };
      await c.query("COMMIT");
      res.json({ ...p, ...view,
        version: all.length, actions: financeActions, rights: context.rights.filter(r => (!sid || r.studentId === sid) &&
          (!search || `${r.label} ${name(r.studentId)}`.toLowerCase().includes(search.toLowerCase()))),
        students: context.students, families: families.filter(f=>(!sid||f.studentIds.includes(sid))&&
          (!search||f.label.toLowerCase().includes(search.toLowerCase()))), refs, studentTotals: studentView?.totals ?? null,
        reportVersion:1,filter:{from,to,studentId:sid,search},tableTotals:view.tableTotals,
        ambiguousAttendance: context.ambiguousAttendance,
        basis: ["청구·미납·미배분·수강권은 종료일 기준 잔액, 수납·환불·지출·자금수지는 선택 기간 거래입니다.",
          "검색·회원 조건은 목록과 서버 합계·CSV에 동일 적용합니다. 수납 목록 금액/환불 누계는 기준일까지, 요약의 기간 수납/환불은 거래일 기준입니다.",
          "회원 조회에서는 센터 공통 지출을 제외합니다. 가족 간 배분은 수납자 귀속과 청구 회원 귀속을 분리하며 실제 전체 원장을 먼저 계산합니다.",
          "전체 합계와 회원별 귀속을 구분합니다. 가족 묶음은 기존 보호자 관계 기준이며 권한을 새로 부여하지 않습니다.",
          "여러 보호자 가족 묶음에 같은 회원이 포함될 수 있습니다. 가족 행을 단순 합산하지 않고 전체/회원 합계를 사용하세요.",
          "수기 수납·환불·지출 기록이며 PG 승인·실제 송금·환불 실행이 아닙니다.",
          "수납은 오입력 취소를 차감한 기록 순액입니다. 시작 미배분금과 과거 납부 이전은 기간 영업 수납에 재합산하지 않습니다.",
          "환불액은 센터가 확인해 입력합니다. 법정 비율·자동 환불 정책을 임의 적용하지 않습니다.",
          "수강 사용은 기존 출결의 출석/지각과 계약 배정으로 대조합니다. 복수 계약 후보 출결은 자동 차감 보류입니다."] });
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }));
  const process = (execute: boolean) => run(async (req, res, owner) => {
    const input = object(req.body), command = normalizeFinance(input.command);
    if(command.date>new Date(Date.now()+9*3600_000).toISOString().slice(0,10)&&!command.action.startsWith("contract."))
      throw new OperationError(400,"FUTURE_FINANCIAL_RECORD","실제 수납·환불·지출은 미래 거래로 기록하지 않습니다. 납부/지급 예정일은 별도 입력하세요.");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new OperationError(400, "INVALID_VERSION", "원장 버전을 확인하세요.");
    const rid = execute ? requestId(input.requestId) : null;
    const hash = digest({ command, version: input.expectedVersion });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE", [owner.poolId]);
      await requireFinanceSchema(c);
      if (rid) {
        const old = (await c.query("SELECT actor_id,input_hash,result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2", [owner.poolId, rid])).rows[0];
        if (old) {
          if (old.actor_id !== owner.userId || old.input_hash !== hash) throw new OperationError(409, "REQUEST_REUSED", "다른 처리에 사용한 요청 ID입니다.");
          await c.query("COMMIT"); res.json(old.result); return;
        }
      }
      const events = await readLedger(c, owner.poolId);
      if (events.length !== input.expectedVersion) throw new OperationError(409, "REVISION_CONFLICT", "원장이 변경됐습니다. 다시 조회·미리보기 하세요.");
      command.id = `fin_${rid ?? "preview"}`;
      command.sequence = events.length + 1;
      await checkReferences(c, owner.poolId, events, command);
      const proof = digest({ owner, version: events.length, command: { ...command, id: "" } });
      const impact = { before: financeTotals(events), after: financeTotals([...events, command]) };
      if (!execute) {
        const beforeAll=(await courseContext(c,owner.poolId,events,command.date)).rights;
        const afterAll=(await courseContext(c,owner.poolId,[...events,command],command.date)).rights;
        const projected=projectFinance(events);
        const relatedStudent=command.studentId??projected.receipts.find(r=>r.id===command.receiptId)?.studentId??projected.invoices.find(i=>i.id===command.invoiceId)?.studentId;
        const affected=beforeAll.filter(r=>command.contractId?r.id===command.contractId:relatedStudent&&r.studentId===relatedStudent);
        const rightsWarnings=affected.map(before=>{
          const after=afterAll.find(r=>r.id===before.id)!;
          return `${before.label}: 잔여 ${before.remainingCount??"총횟수 없음"} → ${after.remainingCount??"총횟수 없음"} · 만료 ${before.endDate} → ${after.endDate} · 휴회 ${!!before.held} → ${!!after.held}`;
        });
        await c.query("ROLLBACK");
        res.json({ command: normalizeFinance(input.command), expectedVersion: events.length, previewHash: proof, impact,
          warnings: ["금액·회원·원거래·귀속을 확인하세요. 실제 결제/송금/환불 실행은 하지 않습니다.",
            "환불 기록은 청구 감액·수강권 조정을 자동 실행하지 않습니다. 필요한 별도 정정 영향도 확인하세요.",
            ...rightsWarnings] }); return;
      }
      if (input.confirmed !== true || input.previewHash !== proof) throw new OperationError(409, "PREVIEW_REQUIRED", "현재 영향 미리보기 확인이 필요합니다.");
      command.actorId = owner.userId;
      command.recordedAt = new Date().toISOString();
      command.source = "manual_record_not_pg";
      await syncContractHistory(c,owner.poolId,command,events);
      await appendLedger(c, owner.poolId, owner.userId, command);
      const result = { event: command, version: events.length + 1 };
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",
        [owner.poolId, rid, owner.userId, hash, JSON.stringify(result)]);
      await c.query("COMMIT"); res.json(result);
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  });
  router.post("/preview", process(false));
  router.post("/execute", process(true));
  const batch = (execute: boolean) => run(async (req, res, owner) => {
    const input = object(req.body), commands = normalizeInvoiceBatch(input.commands);
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (commands.some(e => e.date > today)) throw new OperationError(400, "FUTURE_FINANCIAL_RECORD", "청구 기록일은 오늘 이후일 수 없습니다. 납부기한을 별도로 지정하세요.");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
      throw new OperationError(400, "INVALID_VERSION", "원장 버전을 확인하세요.");
    const rid = execute ? requestId(input.requestId) : null;
    const hash = digest({ kind: "invoice.batch", commands, version: input.expectedVersion });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE", [owner.poolId]);
      await requireFinanceSchema(c);
      if (rid) {
        const old = (await c.query("SELECT actor_id,input_hash,result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2", [owner.poolId, rid])).rows[0];
        if (old) {
          if (old.actor_id !== owner.userId || old.input_hash !== hash)
            throw new OperationError(409, "REQUEST_REUSED", "다른 처리에 사용한 요청 ID입니다.");
          await c.query("COMMIT"); res.json(old.result); return;
        }
      }
      const events = await readLedger(c, owner.poolId);
      if (events.length !== input.expectedVersion) throw new OperationError(409, "REVISION_CONFLICT", "원장이 변경됐습니다. 다시 조회·미리보기 하세요.");
      // Scope, contract owner and existing business rules are shared with single entry.
      const checked = [...events];
      for (const [i, command] of commands.entries()) {
        const event = { ...command, id: `fin_${rid ?? "preview"}_${i}`, sequence: events.length + i + 1 };
        await checkReferences(c, owner.poolId, checked, event);
        checked.push(event);
      }
      const proof = digest({ owner, version: events.length, commands });
      const impact = previewInvoiceBatch(events, commands);
      if (!execute) {
        await c.query("ROLLBACK");
        res.json({ commands, expectedVersion: events.length, previewHash: proof, impact,
          warnings: ["대상 전체를 한 번에 기록합니다. 한 명이라도 권한·마감·계약 검사가 실패하면 전체가 저장되지 않습니다.", "청구 발행은 실제 결제나 자동 발송이 아닙니다."] });
        return;
      }
      if (input.confirmed !== true || input.previewHash !== proof)
        throw new OperationError(409, "PREVIEW_REQUIRED", "현재 대상·금액의 미리보기 확인이 필요합니다.");
      const recordedAt = new Date().toISOString();
      const saved = checked.slice(events.length).map(e => ({ ...e, actorId: owner.userId, recordedAt, source: "manual_record_not_pg" }));
      for (const e of saved) await appendLedger(c, owner.poolId, owner.userId, e);
      const result = { events: saved, version: events.length + saved.length };
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",
        [owner.poolId, rid, owner.userId, hash, JSON.stringify(result)]);
      await c.query("COMMIT"); res.json(result);
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  });
  router.post("/batch/preview", batch(false));
  router.post("/batch/execute", batch(true));
  return router;
}

async function syncContractHistory(c: Query,poolId:string,e:FinanceEvent,events:FinanceEvent[]) {
  if(!["contract.hold","contract.resume","contract.cancel","contract.amend"].includes(e.action)) return;
  const context=await courseContext(c,poolId,events,e.date);
  const owned=context.records.filter(r=>r.resource==="enrollments"&&r.data.contractId===e.contractId&&r.data.status==="active"&&
    (e.action==="contract.amend"||r.data.startDate<=e.date&&r.data.endDate>=e.date));
  for(const en of owned) {
    const d=en.data;
    const other=context.records.some(r=>r.resource==="enrollments"&&r.data.studentId===d.studentId&&r.data.classId===d.classId&&r.data.contractId!==e.contractId&&
      r.data.startDate<=e.date&&r.data.endDate>=e.date&&context.rights.some(x=>x.id===r.data.contractId&&x.status==="active"&&!x.held));
    if(e.action==="contract.amend"){
      if(e.endDate<d.startDate) throw new OperationError(409,"FUTURE_ENROLLMENT","예정 수강 배정의 시작 전으로 계약을 줄일 수 없습니다. 배정을 먼저 정리하세요.");
      const interval=d.historyId?(await c.query(`SELECT id,enrolled_at::text,left_at::text FROM student_class_history
        WHERE id=$1 AND swimming_pool_id=$2 AND student_id=$3 AND class_group_id=$4`,
      [d.historyId,poolId,d.studentId,d.classId])).rows[0]:null;
      let historyId=interval?.id;
      if(!other&&interval&&interval.enrolled_at<=e.date&&(!interval.left_at||interval.left_at>e.date)){
        await c.query("UPDATE student_class_history SET left_at=$1::date+1 WHERE id=$2 AND swimming_pool_id=$3",[e.endDate,interval.id,poolId]);
      }else{
        historyId=`sch_${e.id}_${en.id}`;
        await c.query(`INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at,left_at,created_at)
          VALUES($1,$2,$3,$4,$5::date,$6::date+1,now())`,[historyId,d.studentId,d.classId,poolId,d.startDate>e.date?d.startDate:e.date,e.endDate]);
      }
      const data={...d,endDate:e.endDate,historyId};
      const saved=await c.query("UPDATE office_operation_records SET data=$1::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND pool_id=$3 RETURNING revision",
        [JSON.stringify(data),en.id,poolId]);
      await c.query("INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data) VALUES($1,$2,$3,$4,$5::jsonb)",[en.id,saved.rows[0].revision,poolId,e.actorId,JSON.stringify(data)]);
    }else if(other) continue;
    else if(e.action!=="contract.resume") {
      // Only the linked canonical interval; no broad replacement of other classes.
      if(d.historyId) await c.query(`UPDATE student_class_history SET left_at=$1::date WHERE id=$2 AND swimming_pool_id=$3
        AND student_id=$4 AND class_group_id=$5 AND enrolled_at<=$1::date AND (left_at IS NULL OR left_at>$1::date)`,
      [e.date,d.historyId,poolId,d.studentId,d.classId]);
    } else {
      await c.query(`INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at,left_at,created_at)
        SELECT $1,$2,$3,$4,$5::date,$6::date+1,now() WHERE NOT EXISTS (
          SELECT 1 FROM student_class_history WHERE swimming_pool_id=$4 AND student_id=$2 AND class_group_id=$3
          AND enrolled_at<=$5::date AND (left_at IS NULL OR left_at>$5::date))`,
      [`sch_${e.id}_${en.id}`,d.studentId,d.classId,poolId,e.date,d.endDate]);
      const interval=(await c.query(`SELECT id FROM student_class_history WHERE swimming_pool_id=$1 AND student_id=$2 AND class_group_id=$3
        AND enrolled_at<=$4::date AND (left_at IS NULL OR left_at>$4::date) ORDER BY enrolled_at DESC LIMIT 1`,[poolId,d.studentId,d.classId,e.date])).rows[0];
      if(interval) {
        const data={...d,historyId:interval.id};
        const saved=await c.query("UPDATE office_operation_records SET data=$1::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND pool_id=$3 RETURNING revision",
          [JSON.stringify(data),en.id,poolId]);
        await c.query("INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data) VALUES($1,$2,$3,$4,$5::jsonb)",
          [en.id,saved.rows[0].revision,poolId,e.actorId,JSON.stringify(data)]);
      }
    }
    const active=(await c.query(`SELECT DISTINCT class_group_id FROM student_class_history WHERE swimming_pool_id=$1 AND student_id=$2
      AND enrolled_at<=(now() AT TIME ZONE 'Asia/Seoul')::date AND (left_at IS NULL OR left_at>(now() AT TIME ZONE 'Asia/Seoul')::date)
      ORDER BY class_group_id`,[poolId,d.studentId])).rows.map(r=>r.class_group_id);
    await c.query(`UPDATE students SET assigned_class_ids=$3::jsonb,class_group_id=CASE WHEN class_group_id=ANY($4::text[])
      THEN class_group_id ELSE $5 END,updated_at=clock_timestamp() WHERE id=$1 AND swimming_pool_id=$2`,
    [d.studentId,poolId,JSON.stringify(active),active,active[0]??null]);
  }
}
