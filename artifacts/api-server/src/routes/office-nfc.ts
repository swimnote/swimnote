import { Router, type Response } from "express";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthRequest } from "../middlewares/auth.js";
import type { OfficeActor } from "../lib/office-command.js";
import { OperationError, object, text, digest, requestId } from "../lib/office-operations-data.js";
import { requireFinanceSchema } from "./office-finance.js";
import { writeCanonicalAttendance, AttendanceConflict } from "../lib/canonical-attendance.js";

type Handler = (req: AuthRequest, res: Response, owner: OfficeActor) => Promise<void>;
type Wrap = (fn: Handler) => (req: AuthRequest, res: Response) => Promise<void>;
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export function readerUid(v: unknown) {
  const uid = text(v, "카드 UID", 100).replace(/[\s:-]/g, "").toUpperCase();
  if (!/^(?:[0-9A-F]{2}){4,16}$/.test(uid)) throw new OperationError(400, "INVALID_UID", "지원하는 16진수 UID가 아닙니다.");
  return uid;
}
export function createOfficeNfcRouter(pool: Pool, run: Wrap) {
  const router = Router();
  const resolve = async (c: Pick<Pool,"query">, poolId: string, uid: string, day: string) => {
    const found = (await c.query(`SELECT s.id,s.name FROM office_operation_records r JOIN students s ON s.id=r.data->>'studentId'
      AND s.swimming_pool_id=r.pool_id WHERE r.pool_id=$1 AND r.resource='cards'
      AND r.data->>'cardUid'=$2 AND r.data->>'status'='active' AND s.deleted_at IS NULL`, [poolId, uid])).rows;
    if (found.length !== 1) throw new OperationError(409, "CARD_NOT_ACTIVE", "등록된 사용 카드와 회원을 확인하세요.");
    const classes = (await c.query(`SELECT DISTINCT cg.id,cg.name FROM student_class_history h
      JOIN class_groups cg ON cg.id=h.class_group_id AND cg.swimming_pool_id=h.swimming_pool_id
      WHERE h.swimming_pool_id=$1 AND h.student_id=$2 AND h.enrolled_at<=$3::date
      AND (h.left_at IS NULL OR h.left_at>$3::date) AND cg.is_deleted=false
      AND NOT EXISTS(SELECT 1 FROM office_operation_records r WHERE r.pool_id=$1 AND r.resource='sessions'
        AND r.data->>'classId'=cg.id AND r.data->>'date'=$3 AND r.data->>'status'='cancelled')
      ORDER BY cg.name,cg.id`, [poolId, found[0].id, day])).rows;
    return { student: found[0], classes, date: day };
  };
  router.post("/resolve", run(async (req,res,owner) => {
    await requireFinanceSchema(pool);
    res.json(await resolve(pool,owner.poolId,readerUid(object(req.body).uid),today()));
  }));
  router.post("/scan", run(async (req,res,owner) => {
    const b=object(req.body), uid=readerUid(b.uid), rid=requestId(b.requestId);
    const classId=text(b.classId,"출석 반",160), hash=digest({uid,classId,action:"nfc.scan"});
    const c=await pool.connect();
    let result:any;
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE",[owner.poolId]);
      await requireFinanceSchema(c);
      const old=(await c.query("SELECT actor_id,input_hash,result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[owner.poolId,rid])).rows[0];
      if(old) {
        if(old.actor_id!==owner.userId||old.input_hash!==hash) throw new OperationError(409,"REQUEST_REUSED","다른 스캔 요청 ID입니다.");
        await c.query("COMMIT");res.json(old.result);return;
      }
      const context=await resolve(c,owner.poolId,uid,today());
      if(!context.classes.some(x=>x.id===classId)) throw new OperationError(409,"CHOOSE_CLASS","오늘 실제 수강 중인 반을 선택하세요.");
      const previous=(await c.query(`SELECT id,status FROM attendance WHERE swimming_pool_id=$1 AND student_id=$2
        AND class_group_id=$3 AND date=$4 AND session_type='regular'`,[owner.poolId,context.student.id,classId,context.date])).rows[0];
      const duplicate=previous?.status==="present"||previous?.status==="late";
      const attendance=await writeCanonicalAttendance({poolId:owner.poolId,studentId:context.student.id,classId,date:context.date,
        kind:"regular",status:"present",actorId:owner.userId,preserveExisting:duplicate},drizzle(c));
      if(!duplicate) await c.query(`UPDATE makeup_sessions SET status='cancelled',cancelled_at=now(),cancelled_reason='absent_cleared'
        WHERE swimming_pool_id=$1 AND student_id=$2 AND original_class_group_id=$3 AND absence_date=$4
        AND status IN ('waiting','assigned','transferred') AND cancelled_at IS NULL`,
      [owner.poolId,context.student.id,classId,context.date]);
      if(!duplicate) await c.query(`INSERT INTO office_nfc_notifications(attendance_id,pool_id,student_id,status)
        VALUES($1,$2,$3,'pending_activation') ON CONFLICT(attendance_id) DO NOTHING`,
      [attendance.id,owner.poolId,context.student.id]);
      result={attendance,duplicate,notificationStatus:duplicate?"duplicate_no_dispatch":"pending_activation"};
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",
        [owner.poolId,rid,owner.userId,hash,JSON.stringify(result)]);
      await c.query("COMMIT");
    } catch(e) {
      await c.query("ROLLBACK");
      if(e instanceof AttendanceConflict) throw new OperationError(409,e.code,e.message);
      throw e;
    } finally {c.release();}
    // At most one logical dispatch; uncertain provider results are not automatically retried.
    if(!result.duplicate && process.env.OFFICE_NFC_NOTIFICATIONS_ENABLED==="true") {
      const claimed=(await pool.query(`UPDATE office_nfc_notifications SET status='dispatch_attempted',attempted_at=clock_timestamp()
        WHERE attendance_id=$1 AND pool_id=$2 AND status='pending_activation' RETURNING student_id`,
      [result.attendance.id,owner.poolId])).rows[0];
      if(claimed) {
        try {
          const parents=(await pool.query(`SELECT ps.parent_id FROM parent_students ps JOIN parent_accounts pa ON pa.id=ps.parent_id
            WHERE ps.student_id=$1 AND ps.swimming_pool_id=$2 AND ps.status='approved' AND pa.swimming_pool_id=$2
            AND pa.withdrawal_requested_at IS NULL`,[claimed.student_id,owner.poolId])).rows;
          const {sendPushToUser}=await import("../lib/push-service.js");
          for(const parent of parents) await sendPushToUser(parent.parent_id,true,"attendance","출석 안내",
            "수영장에 도착하여 출석 처리되었습니다.",{type:"attendance",attendance_id:result.attendance.id},owner.userId,{singleAttempt:true});
          result.notificationStatus=parents.length?"dispatch_requested_not_device_verified":"no_approved_parent";
        } catch {result.notificationStatus="dispatch_unknown_no_retry";}
        await pool.query("UPDATE office_nfc_notifications SET status=$1 WHERE attendance_id=$2 AND pool_id=$3",
          [result.notificationStatus,result.attendance.id,owner.poolId]);
        await pool.query("UPDATE office_operation_receipts SET result=$1::jsonb WHERE pool_id=$2 AND request_id=$3",
          [JSON.stringify(result),owner.poolId,rid]);
      }
    }
    res.json(result);
  }));
  return router;
}
