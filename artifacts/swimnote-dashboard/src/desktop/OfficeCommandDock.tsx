import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useOfficeManager } from "./OfficeManagerContext";
import { useOfficeActions } from "./OfficeActionContext";
import { OfficeTaskCard } from "./OfficeTaskCard";
import { ACCEPT_ATTR, MAX_FILES, formatBytes } from "./local-attachments";

/** Future common Action boundary. Not connected: no submit handler exists yet. */
export type OfficeCommandAction = { type: "command"; text: string };
export type OfficeCommandHandler = (action: OfficeCommandAction) => void;

const BUSINESS_MIN = 160;
const BUSINESS_MIN_LOW = 80;
const CARD_MIN = 168;
const BUSINESS_LARGE = 96;
const STEP = 24;

export function OfficeCommandDock({ available = 0 }: { available?: number }) {
  const m = useOfficeManager();
  const actions = useOfficeActions();
  if (!m) throw new Error("OfficeCommandDock requires OfficeManagerProvider");
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const head = useRef<HTMLElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [essential, setEssential] = useState(CARD_MIN);
  const [chrome, setChrome] = useState(54);
  const composing = useRef(false);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const reason = `${id}-reason`;

  useEffect(() => {
    let timer: number | undefined;
    const retain = (event: PointerEvent) => {
      const node = input.current;
      if (!node || document.activeElement !== node || !(event.target instanceof Element) ||
          !event.target.closest("aside, [data-office-navigation]") || event.target.closest(".office-dock")) return;
      const start = node.selectionStart, end = node.selectionEnd;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!node.isConnected) return;
        node.focus({ preventScroll: true });
        node.setSelectionRange(start, end);
      }, 0);
    };
    document.addEventListener("pointerdown", retain, true);
    return () => { document.removeEventListener("pointerdown", retain, true); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (m.focusToken > 0) input.current?.focus({ preventScroll: true });
  }, [m.focusToken]);

  const low = available > 0 && available < 560;
  const bizMin = low ? BUSINESS_MIN_LOW : BUSINESS_MIN;
  const bizLarge = low ? BUSINESS_MIN_LOW : BUSINESS_LARGE;
  const gutter = low ? 8 : 12;
  const hardMax = available > 0 ? Math.max(0, available - bizMin - gutter) : 392;
  const largeMax = available > 0 ? Math.max(0, available - bizLarge - gutter) : 392;
  const minimum = Math.min(Math.max(CARD_MIN, essential), hardMax);
  const normalMax = Math.max(minimum, available > 0 ? Math.min(hardMax, Math.round(available * (low ? 0.5 : 0.55))) : hardMax);
  const maxH = m.large ? Math.max(minimum, largeMax) : normalMax;
  const wanted = m.large ? Math.max(m.preferredHeight, Math.round(available * 0.7)) : m.preferredHeight;
  const height = Math.min(Math.max(wanted, minimum), maxH);
  const clampPref = (h: number) => Math.min(Math.max(Math.round(h), minimum), normalMax);
  const [help, setHelp] = useState(false);

  useLayoutEffect(() => {
    const n = input.current;
    if (!n) return;
    n.style.height = "auto";
    n.style.height = `${Math.max(44, Math.min(n.scrollHeight, low ? (available < 380 ? 44 : 72) : 120))}px`;
  }, [m.draft, m.expanded, available, low]);

  useLayoutEffect(() => {
    const measure = () => {
      if (!head.current || !form.current || !composer.current || !footer.current) return;
      const header = head.current.offsetHeight + (m.expanded ? 12 : 0);
      const css = getComputedStyle(form.current);
      const gap = parseFloat(css.rowGap) || 0;
      const extras = (m.attachments.length || m.attachmentErrors.length ? 40 : 0) + (help ? 26 : 0);
      setChrome(header);
      setEssential(Math.ceil(header + composer.current.offsetHeight + footer.current.offsetHeight +
        (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0) + 2 + extras +
        gap * (1 + (extras ? 1 : 0) + (help ? 1 : 0))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    [head.current, composer.current, footer.current].forEach(n => n && observer.observe(n));
    return () => observer.disconnect();
  }, [m.expanded, m.attachments.length, m.attachmentErrors.length, help, low]);

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!m.expanded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
    setDragging(true);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    m.setLarge(false);
    m.setPreferredHeight(clampPref(drag.current.h + drag.current.y - e.clientY));
  };
  const endDrag = () => { drag.current = null; setDragging(false); };
  const onResizeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const set = (h: number) => { e.preventDefault(); m.setLarge(false); m.setPreferredHeight(clampPref(h)); };
    if (e.key === "ArrowUp") set(height + STEP);
    else if (e.key === "ArrowDown") set(height - STEP);
    else if (e.key === "Home") set(minimum);
    else if (e.key === "End") set(maxH);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return; // newline
    // Plain Enter, IME confirm (isComposing/229/ref) and Ctrl/Meta+Enter are all non-sending.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
  };
  const pickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) m.addFiles(files);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []).filter(f => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); m.addFiles(files); }
  };
  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) m.addFiles(files);
  };

  const cls = `office-dock${m.expanded ? "" : " is-collapsed"}${m.large ? " is-large" : ""}${dragging ? " is-dragging" : ""}${low ? " is-low" : ""}`;
  return <section className={cls} data-office-navigation aria-label="AI 매니저"
    style={{ ...(m.expanded ? { height } : {}), "--office-dock-chrome": `${chrome}px` } as CSSProperties}>
    {m.expanded && <div className="office-dock-resize" role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label="AI 매니저 높이 조절" aria-valuemin={minimum} aria-valuemax={maxH} aria-valuenow={height}
      onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onKeyDown={onResizeKey}><span aria-hidden="true" /></div>}
    <header ref={head} className="office-dock-head">
      <div className="office-dock-title">
        <h2>AI 매니저</h2>
        <span id={`${id}-connection`} className="office-dock-badge">{actions?.aiMode === "fixture" ? "mock 모델 격리 검증" : actions?.stage3Enabled ? "AI 서버 연결 · 실행 전 확인" : "AI 연결 전"}</span>
      </div>
      <div className="office-dock-tools">
        <button type="button" onClick={() => m.setLarge(!m.large)} disabled={!m.expanded} aria-pressed={m.large}>
          {m.large ? "원래 크기" : "크게 보기"}
        </button>
        <button type="button" onClick={() => m.setExpanded(!m.expanded)} aria-expanded={m.expanded}
          aria-controls={`${id}-body`}>{m.expanded ? "접기" : "펼치기"}</button>
      </div>
    </header>
    <div id={`${id}-body`} className="office-dock-log" role="log" aria-live="off" tabIndex={0}
      aria-label="AI 업무 처리 영역" hidden={!m.expanded}>
      {!actions?.tasks?.length && <p className="office-dock-status">처리 내역이 없습니다.</p>}
      {actions?.tasks?.map(task => <div key={task.id}>
        <OfficeTaskCard task={task} onConfirm={() => void actions.confirmProposal(task.id)}
          onOpenResult={result => void actions.openResult(task.id, result.id)} />
        {task.status === "unknown" && task.id.includes(":write:") && <button type="button"
          onClick={() => void actions.resolveWrite(task.id.split(":write:")[1])}>요청 상태 확인 · 재실행 아님</button>}
      </div>)}
    </div>
    <form ref={form} className={`office-dock-form${dragOver ? " is-dragover" : ""}`}
      onSubmit={event => { event.preventDefault(); if (actions?.stage3Enabled && !composing.current && m.draft.trim()) void actions.interpret(m.draft); }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {(m.attachments.length > 0 || m.attachmentErrors.length > 0) && <div className="office-dock-attachments" hidden={!m.expanded && m.attachmentErrors.length === 0}>
        {m.attachments.length > 0 && <ul aria-label="선택한 파일 (업로드되지 않음)">
          {m.attachments.map(a => <li key={a.id}>
            <span className="office-dock-file-name" title={a.name}>{a.name}</span>
            <span className="office-dock-file-meta" title={`${a.type} · ${formatBytes(a.size)}`}>{a.type} · {formatBytes(a.size)}</span>
            <button type="button" aria-label={`${a.name} 제거`} onClick={() => m.removeFile(a.id)}>제거</button>
          </li>)}
        </ul>}
        {m.attachmentErrors.length > 0 && <div className="office-dock-errors" role="alert">
          {m.attachmentErrors.map((t, i) => <p key={i}>{t}</p>)}
        </div>}
      </div>}
      {help && <div id={`${id}-file-help`} className="office-dock-help" role="region" aria-label="첨부 도움말" tabIndex={0}>
        파일 선택만 가능하며 읽기·업로드·보관 기능은 연결되지 않았습니다.
        최대 {MAX_FILES}개, 파일당 10MiB, 합계 25MiB.
        허용 형식: PDF, PNG, JPG/JPEG, WEBP, HWP, HWPX, DOCX, XLSX, CSV, TXT.
      </div>}
      <div ref={composer} className="office-dock-composer">
        <textarea ref={input} className="office-dock-input" rows={2} value={m.draft} aria-label="업무 입력"
          aria-describedby={`${id}-connection ${reason}`} placeholder="업무 내용을 입력하세요"
          onChange={event => m.setDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }} />
        <input ref={fileInput} type="file" multiple accept={ACCEPT_ATTR} hidden tabIndex={-1} onChange={pickFiles} />
        <div className="office-dock-actions">
          <button type="button" className="office-dock-attach" onClick={() => fileInput.current?.click()}>파일 선택</button>
          <button type="submit" className="office-dock-send" disabled={!actions?.stage3Enabled || !m.draft.trim()} aria-describedby={`${id}-connection ${reason}`}>전송</button>
        </div>
      </div>
      <div ref={footer} className="office-dock-footer">
        <p id={reason} className="office-dock-reason">{actions?.stage3Enabled ? "업무 텍스트만 전송 · 변경은 별도 확인" : "전송 불가"} · 첨부는 로컬 선택만</p>
        <button type="button" className="office-dock-help-toggle" aria-expanded={help} aria-controls={`${id}-file-help`}
          onClick={() => setHelp(v => !v)}>파일 안내</button>
      </div>
    </form>
  </section>;
}
