import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useOfficeActions } from "./OfficeActionContext";
import type { ActionOrigin } from "./OfficeActionCore";

export type OfficeDestination = { screen: "home" } | { screen: "members"; memberId?: string };
type View = { search: string; status: string; classId: string; page: number; scroll: number; horizontalScroll: number };
type History = { entries: OfficeDestination[]; index: number };
const initialView: View = { search: "", status: "active", classId: "", page: 1, scroll: 0, horizontalScroll: 0 };
const route = (target: OfficeDestination) => target.screen === "home" ? "/admin" : "/admin/members";
const same = (a: OfficeDestination, b: OfficeDestination) =>
  a.screen === b.screen && (a.screen === "home" || (b.screen === "members" && a.memberId === b.memberId));

export function validOfficeDestination(value: unknown): value is OfficeDestination {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.screen === "home") return Object.keys(v).every(key => key === "screen");
  return v.screen === "members" && Object.keys(v).every(key => key === "screen" || key === "memberId") &&
    (v.memberId === undefined || typeof v.memberId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v.memberId));
}

type Navigation = {
  destination: OfficeDestination; view: View; notice: string;
  canBack: boolean; canForward: boolean;
  open: (target: OfficeDestination, options?: { directReturn?: boolean; listOnly?: boolean }) => boolean;
  getDestination: () => OfficeDestination;
  getRevision: () => number;
  back: () => void; forward: () => void; closeDetail: () => void;
  missingMember: () => void;
  updateView: (patch: Partial<View>) => void;
};
const Context = createContext<Navigation | null>(null);
export const useOfficeNavigation = () => useContext(Context);

/** Desktop session memory only. No credentials, member records or URL parameters are persisted. */
export function OfficeNavigationProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [history, setHistory] = useState<History>(() => ({
    entries: [{ screen: location === "/admin/members" ? "members" : "home" }], index: 0,
  }));
  const historyRef = useRef(history);
  const revision = useRef(0);
  const lastMembers = useRef<OfficeDestination>({ screen: "members" });
  const [view, setView] = useState<View>(initialView);
  const [notice, setNotice] = useState("");
  const commit = useCallback((next: History) => {
    revision.current++;
    historyRef.current = next;
    setHistory(next);
    // Keep the existing router, but not personal Context in browser history/URLs.
    navigate(route(next.entries[next.index]), { replace: true });
  }, [navigate]);
  const open = useCallback((input: OfficeDestination, options?: { directReturn?: boolean; listOnly?: boolean }) => {
    if (!validOfficeDestination(input)) {
      setNotice("현재 지원하지 않는 이동 대상입니다.");
      return false;
    }
    const current = historyRef.current;
    const target: OfficeDestination = input.screen === "home" ? { screen: "home" }
      : input.memberId ? { screen: "members", memberId: input.memberId } : options?.listOnly ? { screen: "members" } : lastMembers.current;
    setNotice("");
    if (same(current.entries[current.index], target)) {
      commit(current); // Also recovers a supported destination from a blocked direct URL.
      return true;
    }
    if (target.screen === "members") lastMembers.current = target;
    const entries = current.entries.slice(0, current.index + 1);
    // A direct OPEN/resume from Home still gives Back a valid list before leaving members.
    if (!options?.directReturn && target.screen === "members" && target.memberId && current.entries[current.index].screen !== "members")
      entries.push({ screen: "members" });
    entries.push(target);
    commit({ entries, index: entries.length - 1 });
    return true;
  }, [commit]);
  const step = useCallback((delta: number) => {
    const current = historyRef.current;
    const index = current.index + delta;
    if (index < 0 || index >= current.entries.length) return;
    const target = current.entries[index];
    if (target.screen === "members") lastMembers.current = target;
    setNotice("");
    commit({ ...current, index });
  }, [commit]);
  const closeDetail = useCallback(() => {
    const current = historyRef.current;
    lastMembers.current = { screen: "members" };
    const previous = current.entries[current.index - 1];
    if (previous?.screen === "members" && !previous.memberId) step(-1);
    else commit({ ...current, entries: current.entries.map((entry, i) =>
      i === current.index ? { screen: "members" } : entry) });
  }, [commit, step]);
  const missingMember = useCallback(() => {
    const current = historyRef.current;
    const target = current.entries[current.index];
    if (target.screen !== "members" || !target.memberId) return;
    lastMembers.current = { screen: "members" };
    // Remove this unavailable ID from every entry; Forward cannot reopen stale detail.
    commit({ ...current, entries: current.entries.map(entry =>
      entry.screen === "members" && entry.memberId === target.memberId ? { screen: "members" } : entry) });
    setNotice("선택한 회원이 현재 목록에 없거나 조회 권한이 없습니다. 회원목록으로 돌아왔습니다.");
  }, [commit]);
  const updateView = useCallback((patch: Partial<View>) => setView(current => ({ ...current, ...patch })), []);
  const getDestination = useCallback(() => historyRef.current.entries[historyRef.current.index], []);
  const getRevision = useCallback(() => revision.current, []);
  useEffect(() => {
    const current = historyRef.current.entries[historyRef.current.index];
    if (location === "/admin/login") navigate(route(current), { replace: true });
    else if (location !== route(current) && (location === "/admin" || location === "/admin/members"))
      open({ screen: location === "/admin" ? "home" : "members" });
  }, [location, navigate, open]);
  const value = useMemo<Navigation>(() => ({
    destination: history.entries[history.index], view, notice,
    canBack: history.index > 0, canForward: history.index < history.entries.length - 1,
    open, getDestination, getRevision, back: () => step(-1), forward: () => step(1), closeDetail, missingMember, updateView,
  }), [history, view, notice, open, getDestination, getRevision, step, closeDetail, missingMember, updateView]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Shared menu/dashboard adapter. Outside Desktop the existing Web router is unchanged. */
export function useOfficeNavigate(origin: ActionOrigin = "menu") {
  const office = useOfficeNavigation();
  const actions = useOfficeActions();
  const [, navigate] = useLocation();
  return (path: string) => {
    if (!office) { navigate(path); return; }
    if (actions && (path === "/admin" || path === "/admin/members")) {
      void actions.execute({ action: path === "/admin" ? "office.home.open" : "office.members.open", input: {} }, origin);
      return;
    }
    if (path === "/admin") office.open({ screen: "home" });
    else if (path === "/admin/members") office.open({ screen: "members" });
    else office.open({ screen: "unsupported" } as unknown as OfficeDestination);
  };
}

export function OfficeNavigationBar() {
  const nav = useOfficeNavigation();
  const actions = useOfficeActions();
  if (!nav) return null;
  return <section data-office-navigation className="office-navigation-bar">
    <div className="office-navigation-controls">
      <button disabled={!nav.canBack} onClick={nav.back} aria-label="앱 내 뒤로">뒤로</button>
      <button disabled={!nav.canForward} onClick={nav.forward} aria-label="앱 내 앞으로">앞으로</button>
      <nav aria-label="현재 업무 위치">
        {nav.destination.screen === "home" ? <span className="office-breadcrumb-current" aria-current="page">홈 현황</span> : <>
          <button onClick={() => actions ? void actions.execute({ action: "office.home.open", input: {} }, "menu") : nav.open({ screen: "home" })}>홈 현황</button>
          {" / "}
          {nav.destination.memberId
            ? <><button onClick={nav.closeDetail}>회원목록</button>{" / "}<span className="office-breadcrumb-current" aria-current="page">회원 상세</span></>
            : <span className="office-breadcrumb-current" aria-current="page">회원목록</span>}
        </>}
      </nav>
    </div>
    {nav.notice && <p role="status">{nav.notice}</p>}
    {actions?.notice && <p role="status">{actions.notice}</p>}
  </section>;
}
