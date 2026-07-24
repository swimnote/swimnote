import { PageHeader, SectionCard, StatCard, FeatureBadge } from "../components/ui";
import { ScrollText } from "lucide-react";

const LOGS = [
  { time: "2026-07-24 19:00:01", level: "INFO", msg: "[misconception] 오개념 헌터 시스템 초기화 완료" },
  { time: "2026-07-24 18:55:12", level: "INFO", msg: "[misconception] 예시 데이터 12개 삽입 완료" },
  { time: "2026-07-24 18:50:23", level: "INFO", msg: "[api] misconception API 라우터 등록 완료" },
  { time: "2026-07-24 18:30:00", level: "WARN", msg: "[hunter] 자동사냥 비활성 상태 — 수동 모드로 대기 중" },
  { time: "2026-07-24 18:00:00", level: "INFO", msg: "[db] misconception_candidates 테이블 생성 완료" },
];

export default function SystemLogs() {
  return (
    <div className="p-6">
      <PageHeader title="시스템 로그" subtitle="System Logs — API 호출, DB 변경, 오류 내역을 기록합니다." badge={<FeatureBadge kind="LIVE" />} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="오늘 API 호출" value="1,247" color="blue" />
        <StatCard label="오류" value="3" color="red" />
        <StatCard label="경고" value="12" color="amber" />
        <StatCard label="DB 변경" value="89" color="slate" />
      </div>
      <SectionCard title="최근 로그">
        <div className="p-4 font-mono text-xs space-y-1.5">
          {LOGS.map((log, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="text-slate-400 shrink-0">{log.time}</span>
              <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded text-[10px] ${log.level === "INFO" ? "bg-blue-100 text-blue-700" : log.level === "WARN" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{log.level}</span>
              <span className="text-slate-600">{log.msg}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
