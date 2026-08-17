/**
 * SuperAudit — 감사 / 로그
 * 기존 AuditLogs 컴포넌트 재사용 (REUSED, not duplicated).
 */
import AuditLogs from "@/pages/super/AuditLogs";

export default function SuperAudit() {
  return (
    <div>
      <div className="px-6 pt-6 pb-0">
        <h1 className="text-[20px] font-bold text-[#111]">감사 / 로그</h1>
        <p className="text-[12px] text-[#999] mt-0.5 mb-4">
          Super Admin 변경 이력 · 엔티티별 감사 추적 (READ ONLY)
        </p>
      </div>
      <AuditLogs />
    </div>
  );
}
