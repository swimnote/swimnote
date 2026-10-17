import { newOfficeRequestId } from "../lib/office-request-id";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Student } from "../pages/members/MembersPage";
import type { OfficeMemberTab } from "./OfficeNavigation";
import "./OfficeMemberEditor.css";

type ClassOption = { id: string; name: string; schedule_days?: string; schedule_time?: string };
type Result = { status: string; message?: string };
type Props = {
  student: Student & { office_revision?: string };
  tab: OfficeMemberTab;
  classes: ClassOption[];
  enabled: boolean;
  execute: (request: unknown) => Promise<Result>;
  registerGuard: (guard: ((next: () => void) => void) | null) => void;
  confirmedRequestIds?: string[];
};
type Draft = { name: string; birth_date: string; birth_year: string; phone: string; parent_name: string; memo: string };
type Outcome = { kind: "success" | "error" | "unknown"; message: string } | null;

const FIELDS: Record<string, (keyof Draft)[]> = {
  basic: ["name", "birth_date", "birth_year"], contacts: ["phone", "parent_name"], notes: ["memo"],
};
const classify = (r: Result | undefined): NonNullable<Outcome>["kind"] => {
  const s = r?.status;
  if (s === "success") return "success";
  if (s === "failed" || s === "cancelled") return "error";
  return "unknown"; // "unknown" or any unsupported status: never assume, never resend
};

function toDraft(s: Student): Draft {
  return {
    name: s.name ?? "", birth_date: s.birth_date ?? "", birth_year: s.birth_year ? String(s.birth_year) : "",
    phone: s.phone ?? "", parent_name: s.parent_name ?? "", memo: s.memo ?? "",
  };
}

export function OfficeMemberEditor({ student, tab, classes, enabled, execute, registerGuard, confirmedRequestIds = [] }: Props) {
  const uid = useId();
  const incoming = student.office_revision;
  const canEdit = enabled && !!incoming;
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openRev, setOpenRev] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [unknown, setUnknown] = useState(false);
  const [pendingNext, setPendingNext] = useState<null | (() => void)>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [moveRev, setMoveRev] = useState<string | undefined>(undefined);
  const [previewing, setPreviewing] = useState(false);
  const [lastRequest, setLastRequest] = useState("");
  const busyRef = useRef(false);
  const idRef = useRef(student.id);
  const continueRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const dirtyKeys = useMemo(() => (!editing || !draft || !base ? [] :
    (Object.keys(draft) as (keyof Draft)[]).filter(k => draft[k].trim() !== base[k].trim())), [editing, draft, base]);
  const dirty = dirtyKeys.length > 0;
  const moveDirty = !!from || !!to || previewing;
  const unsaved = dirty || moveDirty;
  useEffect(() => {
    if (unknown && lastRequest && confirmedRequestIds.includes(lastRequest)) {
      setUnknown(false); setEditing(false); setBase(null); setDraft(null); setOpenRev(undefined);
      setFrom(""); setTo(""); setPreviewing(false);
      setOutcome({ kind: "success", message: "요청 완료 기록과 정상 재조회로 저장이 확인되었습니다." });
    }
  }, [unknown, lastRequest, confirmedRequestIds]);
  // Different member: drop everything. Same member, new props: keep the draft.
  useEffect(() => {
    if (idRef.current === student.id) return;
    if (dirty) return; // Navigation guards member changes; never silently discard a draft
    idRef.current = student.id;
    setEditing(false); setBase(null); setDraft(null); setOpenRev(undefined); setErrors({});
    setOutcome(null); setUnknown(false); setPendingNext(null); setFrom(""); setTo(""); setPreviewing(false); setMoveRev(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const revisionChanged = editing && !!openRev && !!incoming && incoming !== openRev;

  const start = () => {
    if (!canEdit) return;
    const d = toDraft(student);
    setBase(d); setDraft(d); setOpenRev(incoming); setEditing(true); setErrors({}); setOutcome(null);
  };
  const reset = () => { setEditing(false); setBase(null); setDraft(null); setOpenRev(undefined); setErrors({}); };
  const set = (k: keyof Draft, v: string) => setDraft(d => (d ? { ...d, [k]: v } : d));

  const validate = (d: Draft) => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.name.trim()) e.name = "이름을 입력하세요.";
    if (d.birth_year.trim() && !/^(19|20)\d{2}$/.test(d.birth_year.trim())) e.birth_year = "4자리 연도로 입력하세요.";
    if (d.birth_date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(d.birth_date.trim())) e.birth_date = "YYYY-MM-DD 형식으로 입력하세요.";
    return e;
  };

  /** Resolves true only on a confirmed success. Never resends after an unknown result. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !base || !openRev || busyRef.current || unknown || !dirty) return false;
    const e = validate(draft);
    setErrors(e);
    if (Object.keys(e).length) { setOutcome({ kind: "error", message: "입력 내용을 확인하세요." }); return false; }
    const changes: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      const v = draft[k].trim();
      changes[k] = v;
    }
    busyRef.current = true; setBusy(true); setOutcome(null);
    try {
      const requestId = newOfficeRequestId(); setLastRequest(requestId);
      const r = await execute({ action: "office.member.update", input: {
        memberId: student.id, expectedRevision: openRev, requestId, changes } });
      const kind = classify(r);
      if (kind === "success") { reset(); setOutcome({ kind, message: r?.message || "저장되었습니다." }); return true; }
      if (kind === "unknown") {
        setUnknown(true);
        setOutcome({ kind, message: "처리 결과를 확인하지 못했습니다. 상태 확인이 필요합니다. 자동으로 다시 저장하지 않으며 입력 내용은 유지됩니다." });
      } else setOutcome({ kind, message: r?.message || "저장하지 못했습니다. 입력 내용은 유지됩니다." });
      return false;
    } catch {
      setUnknown(true);
      setOutcome({ kind: "unknown", message: "처리 결과를 확인하지 못했습니다. 상태 확인이 필요합니다. 입력 내용은 유지됩니다." });
      return false;
    } finally { busyRef.current = false; setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, base, openRev, unknown, dirty, dirtyKeys, execute, student.id]);

  useEffect(() => {
    registerGuard(unsaved ? (next: () => void) => setPendingNext(() => next) : null);
    return () => registerGuard(null);
  }, [unsaved, registerGuard]);

  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  useEffect(() => { if (pendingNext) continueRef.current?.focus(); }, [pendingNext]);
  useEffect(() => { if (!unsaved) setPendingNext(null); }, [unsaved]);

  const onDialogKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); setPendingNext(null); return; }
    if (e.key !== "Tab") return;
    const els = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const saveAndLeave = async () => {
    const next = pendingNext;
    if (!dirty && moveDirty && !previewing) { setOutcome({ kind: "error", message: "계속 편집에서 반이동 내용을 먼저 확인하세요." }); return; }
    if (dirty ? await save() : await doMove()) { setPendingNext(null); next?.(); }
  };
  const discardAndLeave = () => { const next = pendingNext; reset(); setFrom(""); setTo(""); setPreviewing(false); setPendingNext(null); next?.(); };

  const disabledReason = !enabled ? "통합 배포 후 수정할 수 있습니다." : !incoming ? "회원 버전 정보가 없어 수정할 수 없습니다." : "";

  // ---- move ----
  const assigned = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
  const nameOf = (id: string) => classes.find(c => c.id === id)?.name ?? `반 ${id} (이름 미연결)`;
  const toOptions = classes.filter(c => c.id !== from && !assigned.includes(c.id));
  const after = from && to ? assigned.map(id => (id === from ? to : id)) : [];
  const moveStale = previewing && !!moveRev && !!incoming && moveRev !== incoming;
  const doMove = async () => {
    if (busyRef.current || !from || !to || !moveRev || unknown || moveStale) return false;
    busyRef.current = true; setBusy(true); setOutcome(null);
    try {
      const requestId = newOfficeRequestId(); setLastRequest(requestId);
      const r = await execute({ action: "office.member.move", input: {
        memberId: student.id, expectedRevision: moveRev, requestId, fromClassId: from, toClassId: to } });
      const kind = classify(r);
      if (kind === "success") { setFrom(""); setTo(""); setPreviewing(false); setMoveRev(undefined); setOutcome({ kind, message: r?.message || "반 이동이 완료되었습니다." }); return true; }
      else if (kind === "unknown") { setUnknown(true); setOutcome({ kind, message: "처리 결과를 확인하지 못했습니다. 상태 확인이 필요합니다. 자동으로 다시 실행하지 않습니다." }); }
      else setOutcome({ kind, message: r?.message || "반 이동에 실패했습니다." });
    } catch { setUnknown(true); setOutcome({ kind: "unknown", message: "처리 결과를 확인하지 못했습니다. 상태 확인이 필요합니다." }); }
    finally { busyRef.current = false; setBusy(false); }
    return false;
  };

  if (tab === "growth" && !unsaved) return null;

  const fld = (k: keyof Draft, label: string, extra?: { multiline?: boolean; placeholder?: string; inputMode?: "numeric" }) => {
    const id = `${uid}-${k}`;
    const common = { id, value: draft?.[k] ?? "", disabled: busy, "aria-invalid": errors[k] ? true : undefined,
      "aria-describedby": errors[k] ? `${id}-err` : undefined, placeholder: extra?.placeholder,
      onChange: (e: { target: { value: string } }) => set(k, e.target.value) };
    return (
      <div className="ome-field" key={k}>
        <label htmlFor={id}>{label}</label>
        {extra?.multiline ? <textarea {...common} /> : <input type="text" inputMode={extra?.inputMode} {...common} />}
        {errors[k] && <span id={`${id}-err`} className="ome-err" role="alert">{errors[k]}</span>}
      </div>
    );
  };
  const LABEL: Record<keyof Draft, string> = { name: "이름", birth_date: "생년월일 (YYYY-MM-DD)", birth_year: "생년 (예: 2015)",
    phone: "회원 전화번호", parent_name: "보호자명", memo: "메모" };

  const msg = outcome && <p className="ome-msg" role={outcome.kind === "success" ? "status" : "alert"} data-kind={outcome.kind}>{outcome.message}</p>;

  if (tab === "classes" && !canEdit) return <section className="ome" aria-label="수강반 이동">
    <h4>수강반 이동</h4><button type="button" disabled>반이동</button><p className="ome-note">{disabledReason}</p>
  </section>;
  return (
    <section className="ome" aria-label="회원 정보 수정">
      {tab !== "classes" ? (
        <>
          <h4>{tab === "basic" ? "기본정보 수정" : tab === "contacts" ? "연락처 수정" : tab === "growth" ? "다른 탭의 편집 내용" : "메모 수정"}</h4>
          {!editing ? (
            <div className="ome-actions" style={{ marginTop: 0 }}>
              <button type="button" onClick={start} disabled={!canEdit || moveDirty || unknown}>수정</button>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); void save(); }} noValidate>
              <div className="ome-grid">{(FIELDS[tab] ?? []).map(k => fld(k, LABEL[k], k === "memo" ? { multiline: true } : k === "birth_year" ? { inputMode: "numeric" } : undefined))}</div>
              <div className="ome-actions">
                <button type="submit" data-primary disabled={busy || unknown || !dirty}>{busy ? "저장 중..." : "저장"}</button>
                <button type="button" disabled={busy} onClick={reset}>취소</button>
              </div>
            </form>
          )}
          {tab === "contacts" && <p className="ome-note">보호자 연락처와 연결된 계정 정보는 여기서 수정하지 않습니다.</p>}
          {!canEdit && <p className="ome-note">{disabledReason}</p>}
          {dirty && <p className="ome-note">저장하지 않은 변경 {dirtyKeys.length}건</p>}
        </>
      ) : (
        <>
          <h4>수강반 이동</h4>
          <div className="ome-grid">
            <div className="ome-field">
              <label htmlFor={`${uid}-from`}>이동 전 반</label>
              <select id={`${uid}-from`} value={from} disabled={!canEdit || busy || dirty} onChange={e => { setFrom(e.target.value); setTo(""); setPreviewing(false); }}>
                <option value="">선택하세요</option>
                {assigned.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
              </select>
            </div>
            <div className="ome-field">
              <label htmlFor={`${uid}-to`}>이동 후 반</label>
              <select id={`${uid}-to`} value={to} disabled={!canEdit || busy || !from} onChange={e => { setTo(e.target.value); setPreviewing(false); }}>
                <option value="">선택하세요</option>
                {toOptions.map(c => <option key={c.id} value={c.id}>{c.name}{c.schedule_days ? ` (${c.schedule_days} ${c.schedule_time ?? ""})` : ""}</option>)}
              </select>
            </div>
          </div>
          {assigned.length === 0 && <p className="ome-note">배정된 반이 없어 이동할 수 없습니다.</p>}
          {previewing && from && to && (
            <div className="ome-preview" aria-label="반 이동 미리보기">
              <div><strong>이동 전</strong><ul>{assigned.map(id => <li key={id}>{nameOf(id)}</li>)}</ul></div>
              <div><strong>이동 후</strong><ul>{after.map(id => <li key={id}>{nameOf(id)}</li>)}</ul></div>
            </div>
          )}
          <div className="ome-actions">
            {!previewing
              ? <button type="button" data-primary disabled={!canEdit || !from || !to || busy || unknown} onClick={() => { setMoveRev(incoming); setPreviewing(true); }}>이동 내용 확인</button>
              : <>
                  <button type="button" data-primary disabled={busy || unknown || moveStale} onClick={() => void doMove()}>{busy ? "이동 중..." : "반 이동 실행"}</button>
                  <button type="button" disabled={busy} onClick={() => { setPreviewing(false); setFrom(""); setTo(""); }}>취소</button>
                </>}
          </div>
          {moveStale && <p className="ome-msg" role="alert" data-kind="warn">미리보기 이후 회원 정보가 변경되었습니다. 취소 후 다시 확인하세요.</p>}
          {dirty && <p className="ome-note">저장하지 않은 변경이 있어 반 이동을 할 수 없습니다.</p>}
          {!canEdit && <p className="ome-note">{disabledReason}</p>}
        </>
      )}
      {revisionChanged && (
        <p className="ome-msg" role="alert" data-kind="warn">
          편집을 시작한 이후 다른 곳에서 회원 정보가 변경되었습니다. 입력 내용은 유지됩니다. 저장하면 충돌로 거절될 수 있으니 최신 정보를 비교한 뒤 취소하고 다시 열어 수정하세요.
        </p>
      )}
      {unknown && (
        <p className="ome-msg" role="alert" data-kind="unknown">
          상태 확인이 필요합니다. 요청 처리 상태가 확인될 때까지 저장과 이동이 잠기며 다시 전송하지 않습니다.
        </p>
      )}
      {msg}
      {pendingNext && (
        <div className="ome-backdrop">
          <div className="ome-dialog" role="dialog" aria-modal="true" aria-labelledby={`${uid}-dt`} aria-describedby={`${uid}-dd`} ref={dialogRef} onKeyDown={onDialogKey}>
            <h2 id={`${uid}-dt`}>저장하지 않은 변경이 있습니다</h2>
            <p id={`${uid}-dd`}>이동하기 전에 변경 내용을 저장할지 선택하세요.</p>
            {outcome && outcome.kind !== "success" && <p className="ome-msg" role="alert" data-kind={outcome.kind}>{outcome.message}</p>}
            <div className="ome-actions">
              <button type="button" data-primary disabled={busy || unknown} onClick={() => void saveAndLeave()}>{busy ? "저장 중..." : "저장하고 이동"}</button>
              <button type="button" disabled={busy} onClick={discardAndLeave}>버리고 이동</button>
              <button type="button" ref={continueRef} disabled={busy} onClick={() => setPendingNext(null)}>계속 편집</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
