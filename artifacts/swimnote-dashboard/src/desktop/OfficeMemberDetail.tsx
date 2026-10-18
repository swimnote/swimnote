import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { Student } from "../pages/members/MembersPage";
import { OFFICE_MEMBER_TABS, type OfficeMemberTab } from "./OfficeNavigation";
import "./OfficeMemberDetail.css";
import { OfficeFinancePanel } from "./OfficeFinancePanel";

const TAB_LABELS: Record<OfficeMemberTab, string> = {
  basic: "기본정보", contacts: "연락처·보호자", classes: "수강반", notes: "메모", growth: "성장리포트",
};
const TABS = OFFICE_MEMBER_TABS.map(id => ({ id, label: TAB_LABELS[id] }));

const STATUS: Record<string, string> = {
  active: "재원", suspended: "연기", withdrawn: "퇴원", inactive: "비활성",
  pending: "대기", archived: "탈퇴", unassigned: "미배정",
};

const MISSING = "등록된 값 없음";

function labels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => text(x)).filter((x): x is string => x !== null);
  const s = text(v);
  return s ? [s] : [];
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function fmtDate(v?: string): string | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("ko-KR");
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="office-member-detail-field">
      <dt>{label}</dt>
      <dd data-missing={value === null ? "true" : undefined}>{value ?? MISSING}</dd>
    </div>
  );
}

function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="office-member-detail-fold">
      <h3>
        <button type="button" id={`${id}-btn`} aria-expanded={open} aria-controls={`${id}-body`}
          onClick={() => setOpen(o => !o)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {title}
        </button>
      </h3>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-btn`} hidden={!open}
        className="office-member-detail-fold-body">{children}</div>
    </section>
  );
}

export function OfficeMemberDetail({ student, tab, onTabChange, onBack, growth, editor, editable = false }: {
  student: Student; tab: OfficeMemberTab; onTabChange: (tab: OfficeMemberTab) => void;
  onBack: () => void; growth: ReactNode;
  editor?: ReactNode; editable?: boolean;
}) {
  const p = `office-member-detail-${student.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const classes = student.assignedClasses ?? [];
  const weekly = (student as { weekly_count?: number }).weekly_count;
  const birth = student.birth_year ? `${student.birth_year}년생` : text(student.birth_date);
  const scheduleLabels = labels((student as { schedule_labels?: unknown }).schedule_labels);
  const assignedIds = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
  const enrichmentMissing = classes.length === 0 && assignedIds.length > 0;
  const missingClassCount = assignedIds.filter(id => !classes.some(c => c.id === id)).length;
  const extra = student as { parent_phone2?: string; parent_phone3?: string; parent_phone4?: string; class_enrolled_at?: string };
  const [financeOpen,setFinanceOpen]=useState(false);
  const enrolledAt = fmtDate(extra.class_enrolled_at);
  const levelText = text(student.level) ?? "미연결";
  const memo = text(student.memo);
  const notes = text(student.notes);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex(t => t.id === tab);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onTabChange(TABS[n].id);
    document.getElementById(`${p}-tab-${TABS[n].id}`)?.focus();
  };

  return (
    <article className="office-member-detail" aria-label={`${student.name} 회원 상세`}>
      <header className="office-member-detail-summary">
        {editable&&<div><button type="button" onClick={()=>setFinanceOpen(x=>!x)} aria-expanded={financeOpen}>청구·미납·부분수납 {financeOpen?"접기":"이어가기"}</button>
          {financeOpen&&<OfficeFinancePanel key={student.id} initialStudentId={student.id}/>}</div>}
        <button type="button" className="office-member-detail-back" onClick={onBack}>회원 목록으로</button>
        <div className="office-member-detail-title">
          <h2>{student.name}</h2>
          <span className="office-member-detail-status">{STATUS[student.status] ?? student.status}</span>
        </div>
        <dl className="office-member-detail-chips">
          <div><dt>수강반</dt><dd>{classes.length > 0 ? classes.map(c => c.name).join(" · ") : enrichmentMissing ? `배정 ${assignedIds.length}건 (상세 정보 미연결)` : text(student.class_group_name) ?? "미배정"}</dd></div>
          <div><dt>주 수업 횟수</dt><dd>{typeof weekly === "number" ? `주 ${weekly}회` : "정보 없음"}</dd></div>
          <div><dt>레벨</dt><dd>{levelText}</dd></div>
          <div><dt>등록일</dt><dd>{fmtDate(student.created_at) ?? MISSING}</dd></div>
        </dl>
        <p className="office-member-detail-readonly">{editable ? "일반 정보·반이동 조건부 저장" : "조회 전용"} · 수강 기간 미연결 · 청구·납입 미연결</p>
      </header>

      <div role="tablist" aria-label="회원 상세 구분" className="office-member-detail-tabs" onKeyDown={onKey}>
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`${p}-tab-${t.id}`}
            aria-selected={tab === t.id} aria-controls={`${p}-panel`}
            tabIndex={tab === t.id ? 0 : -1} onClick={() => onTabChange(t.id)}>{t.label}</button>
        ))}
      </div>

      {editor}
      <div role="tabpanel" id={`${p}-panel`} aria-labelledby={`${p}-tab-${tab}`} className="office-member-detail-panel">
        {tab === "basic" && (
          <Fold id={`${p}-basic`} title="기본 정보">
            <dl className="office-member-detail-grid">
              <Field label="이름" value={text(student.name)} />
              <Field label="상태" value={STATUS[student.status] ?? text(student.status)} />
              <Field label="생년" value={birth} />
              <Field label="생년월일" value={text(student.birth_date)} />
              <Field label="레벨" value={levelText} />
              <Field label="등록일" value={fmtDate(student.created_at)} />
            </dl>
          </Fold>
        )}
        {tab === "contacts" && (
          <Fold id={`${p}-contacts`} title="연락처·보호자">
            <dl className="office-member-detail-grid">
              <Field label="회원 전화번호" value={text(student.phone)} />
              <Field label="보호자명" value={text(student.parent_name)} />
              <Field label="보호자 연락처" value={text(student.parent_phone)} />
              {([["추가 연락처 2", extra.parent_phone2], ["추가 연락처 3", extra.parent_phone3], ["추가 연락처 4", extra.parent_phone4]] as const).map(([l, v]) =>
                text(v) ? <Field key={l} label={l} value={text(v)} /> : null)}
            </dl>
            <p className="office-member-detail-labels">보호자는 기존 단일 필드(보호자명·보호자 연락처) 값 그대로 표시합니다. 다중 보호자 연결은 이 버전에서 연결되지 않았습니다.</p>
          </Fold>
        )}
        {tab === "classes" && (
          <Fold id={`${p}-classes`} title={`수강반 (${classes.length})`}>
            {classes.length === 0 ? (
              <p className="office-member-detail-empty">{enrichmentMissing
                ? `배정된 반 ${assignedIds.length}건이 있으나 반 상세 정보를 불러오지 못했습니다. 반 이름·일정 확인 불가.`
                : text(student.class_group_name) ?? "배정된 반이 없습니다."}</p>
            ) : (
              <ul className="office-member-detail-classes">
                {classes.map(c => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span>{[text(c.schedule_days), text(c.schedule_time)].filter(Boolean).join(" ") || "일정 정보 없음"}</span>
                    <span>담당: {text(c.instructor) ?? "정보 없음"}</span>
                  </li>
                ))}
              </ul>
            )}
            {classes.length > 0 && missingClassCount > 0 && <p className="office-member-detail-labels" role="status">
              배정된 반 {missingClassCount}건의 상세 정보가 미연결입니다. 표시된 반이 전체 배정과 다를 수 있습니다.
            </p>}
            {scheduleLabels.length > 0 && (
              <p className="office-member-detail-labels">일정 표기: {scheduleLabels.join(", ")}</p>
            )}
            <dl className="office-member-detail-grid">
              <Field label="반 등록일" value={enrolledAt ?? MISSING} />
              <Field label="수강 기간" value="미연결" />
              <Field label="수납 연동" value="미연결 (납부·미납 정보 확인 불가)" />
            </dl>
          </Fold>
        )}
        {tab === "notes" && (
          <Fold id={`${p}-notes`} title="메모">
            <div className="office-member-detail-memo" tabIndex={0} aria-label="메모 내용">
              {memo ?? notes ?? <span data-missing="true">{MISSING}</span>}
            </div>
            {memo && notes && memo !== notes && (
              <>
                <h4 className="office-member-detail-sub">추가 노트</h4>
                <div className="office-member-detail-memo" tabIndex={0} aria-label="추가 노트 내용">{notes}</div>
              </>
            )}
          </Fold>
        )}
        {tab === "growth" && (
          <Fold id={`${p}-growth`} title="성장리포트 발행 이력">
            <div className="office-member-detail-growth">{growth}</div>
          </Fold>
        )}
      </div>

      <aside className="office-member-detail-unavailable" aria-label="연결 준비 중인 정보">
        수납·차량·상담·변경 이력은 아직 연결되지 않아 표시하지 않습니다.
      </aside>
    </article>
  );
}
