import { api } from "../lib/api-client";

export type OpsResource = "contacts" | "products" | "contracts" | "sessions" | "enrollments" | "marketing" | "cards" | "imports";
export type OpsItem = { id: string; revision: number; data: Record<string, any>; created_at?: string; updated_at?: string };
export type OpsList = { items: OpsItem[]; total: number; has_more: boolean };
export type Ref = "students" | "classes" | "products" | "contracts";
export type Field = { key: string; label: string; type?: "text" | "number" | "date" | "time" | "url" | "datetime-local" | "select" | "ref"; options?: [string, string][]; ref?: Ref; req?: boolean };

const opt = (...a: [string, string][]) => a;
export const SPECS: Record<Exclude<OpsResource, "imports">, { title: string; fields: Field[]; list: string[] }> = {
  contacts: { title: "상담·체험", list: ["name", "phone", "stage", "followUpAt"], fields: [
    { key: "name", label: "이름", req: true }, { key: "phone", label: "연락처", req: true },
    { key: "stage", label: "단계", type: "select", req: true, options: opt(["inquiry", "문의"], ["trial", "체험"], ["level_test", "레벨테스트"], ["waiting", "대기"], ["offered", "등록 안내"], ["registered", "등록됨"], ["closed", "종료"]) },
    { key: "followUpAt", label: "다음 연락", type: "date" }, { key: "source", label: "유입 경로" }, { key: "campaignId", label: "캠페인 ID" },
    { key: "studentId", label: "연결 회원", type: "ref", ref: "students" }, { key: "note", label: "메모" } ] },
  products: { title: "수강 상품", list: ["name", "priceKrw", "lessonCount", "validDays"], fields: [
    { key: "name", label: "상품명", req: true }, { key: "priceKrw", label: "금액(원)", type: "number", req: true },
    { key: "lessonCount", label: "횟수", type: "number", req: true }, { key: "validDays", label: "유효일", type: "number", req: true } ] },
  contracts: { title: "계약", list: ["studentId", "productId", "startDate", "endDate", "status"], fields: [
    { key: "studentId", label: "회원", type: "ref", ref: "students", req: true }, { key: "productId", label: "상품", type: "ref", ref: "products", req: true },
    { key: "startDate", label: "시작", type: "date", req: true }, { key: "endDate", label: "종료", type: "date", req: true },
    { key: "status", label: "상태", type: "select", req: true, options: opt(["draft", "초안"], ["active", "유효"], ["cancelled", "취소"]) }, { key: "note", label: "메모" } ] },
  enrollments: { title: "수강 배정", list: ["studentId", "contractId", "classId", "startDate", "endDate", "status"], fields: [
    { key: "studentId", label: "회원", type: "ref", ref: "students", req: true }, { key: "contractId", label: "계약", type: "ref", ref: "contracts", req: true },
    { key: "classId", label: "반", type: "ref", ref: "classes", req: true },
    { key: "startDate", label: "시작", type: "date", req: true }, { key: "endDate", label: "종료", type: "date", req: true },
    { key: "status", label: "상태", type: "select", req: true, options: opt(["active", "수강중"], ["paused", "휴지"], ["ended", "종료"]) } ] },
  sessions: { title: "수업 세션", list: ["classId", "date", "startTime", "endTime", "capacity", "status"], fields: [
    { key: "classId", label: "반", type: "ref", ref: "classes", req: true }, { key: "date", label: "날짜", type: "date", req: true },
    { key: "startTime", label: "시작", type: "time", req: true }, { key: "endTime", label: "종료", type: "time", req: true },
    { key: "capacity", label: "정원", type: "number", req: true }, { key: "lane", label: "레인" }, { key: "teacherId", label: "강사 ID" },
    { key: "status", label: "상태", type: "select", req: true, options: opt(["scheduled", "예정"], ["cancelled", "취소"]) }, { key: "note", label: "메모" } ] },
  marketing: { title: "마케팅 (수동 게시 관리)", list: ["name", "channel", "publishAt", "status"], fields: [
    { key: "name", label: "이름", req: true }, { key: "channel", label: "채널", req: true }, { key: "managementUrl", label: "관리 URL", type: "url" },
    { key: "publishAt", label: "게시 예정", type: "datetime-local" }, { key: "assigneeId", label: "담당 ID" }, { key: "postUrl", label: "게시 URL", type: "url" },
    { key: "status", label: "상태", type: "select", req: true, options: opt(["draft", "초안"], ["scheduled", "예약"], ["posted_manual", "수동 게시됨"], ["held", "보류"], ["closed", "종료"]) }, { key: "note", label: "메모" } ] },
  cards: { title: "출입 카드 (수동 UID)", list: ["studentId", "cardUid", "status"], fields: [
    { key: "studentId", label: "회원", type: "ref", ref: "students", req: true }, { key: "cardUid", label: "카드 UID", req: true },
    { key: "status", label: "상태", type: "select", req: true, options: opt(["active", "사용"], ["lost", "분실"], ["revoked", "폐기"]) }, { key: "note", label: "메모" } ] },
};

export const uuid = () => crypto.randomUUID();
export const listOps = (r: OpsResource, search: string, offset: number, limit = 100) =>
  api.get<OpsList>(`/office/operations/${r}?search=${encodeURIComponent(search)}&offset=${offset}&limit=${limit}`);

/** Strip empties and coerce per spec before sending to the server validator. */
export function coerce(fields: Field[], raw: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) continue;
    out[f.key] = f.type === "number" ? Number(v) : v;
  }
  return out;
}

/** CSV with formula-injection neutralisation (leading = + - @ tab CR get an apostrophe). */
export function csvCell(v: unknown) {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (head: string[], rows: unknown[][]) => "\ufeff" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
export function download(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const TARGETS: [string, string][] = [["name", "이름"], ["parent_phone", "보호자 연락처"], ["phone", "연락처"], ["birth_year", "생년"], ["parent_name", "보호자 이름"], ["class_name", "반 이름"], ["memo", "메모"]];
const ALIASES: Record<string, string[]> = {
  name: ["이름", "성명", "성함", "회원명", "학생명", "name"], parent_phone: ["보호자연락처", "보호자전화", "보호자번호", "parent_phone"],
  phone: ["연락처", "전화번호", "phone"], birth_year: ["생년", "생년월일", "birth_year"], parent_name: ["보호자이름", "보호자성명", "parent_name"],
  class_name: ["반", "반이름", "class_name"], memo: ["메모", "비고", "memo"],
};
const norm = (s: string) => s.replace(/[\s_()]/g, "").toLowerCase();
/** Deterministic header auto-mapping across all sheets; first match wins. */
export function autoRules(headers: string[]) {
  const rules: Record<string, string> = {};
  for (const [t, al] of Object.entries(ALIASES)) {
    const h = headers.find(x => al.some(a => norm(a) === norm(x)));
    if (h) rules[t] = h;
  }
  return rules;
}
/** Local deterministic conversation rule: "이름=성명" (target label or key = source column). */
export function parseRuleText(text: string, headers: string[]) {
  const m = text.trim().match(/^(.+?)\s*(?:=|<-|은|는)\s*(.+?)$/);
  if (!m) return null;
  const t = TARGETS.find(([k, l]) => k === m[1].trim() || l === m[1].trim());
  const h = headers.find(x => norm(x) === norm(m[2]));
  return t && h ? { target: t[0], source: h } : null;
}
