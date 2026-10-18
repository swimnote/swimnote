import { createHash } from "node:crypto";

export const resources = ["contacts", "products", "contracts", "sessions", "enrollments", "marketing", "cards", "imports", "templates", "support", "policies"] as const;
export type Resource = typeof resources[number];
export class OperationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const bad = (message: string): never => { throw new OperationError(400, "INVALID_INPUT", message); };
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad("자료 형식을 확인하세요.");
  return value as Record<string, any>;
}
export function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return bad(`${label}을 확인하세요.`);
  return value.trim();
}
export function date(value: unknown): string {
  const v = text(value, "날짜", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) ||
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return bad("유효한 날짜가 필요합니다.");
  return v;
}
export function requestId(value: unknown): string {
  const v = text(value, "요청 ID", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return bad("요청 ID 형식 오류");
  return v;
}
export function digest(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const fields: Record<Resource, string[]> = {
  contacts: ["name","phone","stage","assigneeId","followUpAt","note","source","campaignId","studentId","referrerStudentId"],
  products: ["name","priceKrw","lessonCount","validDays","productType","weeklyCount","freeCount","discountKrw","conditions"],
  contracts: ["studentId","productId","startDate","endDate","status","note","previousContractId","discountKrw"],
  sessions: ["classId","teacherId","lane","date","startTime","endTime","capacity","status","note"],
  enrollments: ["studentId","contractId","classId","startDate","endDate","status"],
  marketing: ["name","channel","managementUrl","publishAt","assigneeId","postUrl","status","note","consentReference","materialUrl","relatedContactId"],
  cards: ["studentId","cardUid","status","note"],
  imports: ["name","files","rules","decisions","status","note","referenceDate"],
  templates: ["name","version","body","consentText","status"],
  support: ["name","kind","status","dueDate","assigneeId","vendor","quantity","note","url","merchantStage","merchantReference","merchantConfirmedAt"],
  policies: ["name","refundPolicy","discountPolicy","attendancePolicy","note"],
};
export const operationFields=(resource:Resource)=>fields[resource];
export function validateData(resource: Resource, input: unknown): Record<string, any> {
  const raw = object(input), data: Record<string, any> = {};
  for (const key of fields[resource]) if (raw[key] !== undefined) data[key] = raw[key];
  for (const [key, value] of Object.entries(data)) {
    if (["files", "rules", "decisions"].includes(key)) continue;
    if (typeof value === "string" && value.length > (["body","consentText","note"].includes(key) ? 12000 : 2000)) bad("입력 길이를 초과했습니다.");
  }
  const required = (...keys: string[]) => keys.forEach(k => { data[k] = text(data[k], k,["body","consentText"].includes(k)?12000:1000); });
  const choice = (key: string, values: string[]) => {
    if (!values.includes(data[key])) bad(`${key} 상태를 확인하세요.`);
  };
  const integer = (key: string, min: number) => {
    if (!Number.isSafeInteger(data[key]) || data[key] < min) bad(`${key} 숫자를 확인하세요.`);
  };
  if (resource === "contacts") {
    required("name", "phone");
    choice("stage", ["inquiry","trial","level_test","waiting","offered","registered","closed"]);
    if (data.stage === "registered" && !data.studentId) bad("등록전환은 실제 회원 연결이 필요합니다.");
  }
  if (resource === "products") {
    required("name"); integer("priceKrw", 0); integer("lessonCount", ["period","weekly"].includes(data.productType)?0:1); integer("validDays", 1);
    data.productType ??= "count"; data.freeCount ??= 0; data.discountKrw ??= 0;
    choice("productType", ["period","count","weekly","composite"]);
    integer("freeCount",0); integer("discountKrw",0);
    if(data.discountKrw>data.priceKrw) bad("할인은 상품 금액을 초과할 수 없습니다.");
    if(data.weeklyCount!==undefined) {integer("weeklyCount",1);if(data.weeklyCount>7) bad("주당 횟수를 확인하세요.");}
    if(data.productType==="weekly"&&!data.weeklyCount) bad("주당형은 주당 횟수가 필요합니다.");
  }
  if (resource === "contracts" || resource === "enrollments") {
    required("studentId");
    data.startDate = date(data.startDate); data.endDate = date(data.endDate);
    if (data.endDate < data.startDate) bad("종료일은 시작일 이후여야 합니다.");
    if (resource === "contracts") {
      required("productId"); choice("status", ["draft","active","cancelled"]);
      if(data.discountKrw!==undefined) integer("discountKrw",0);
    } else {
      required("contractId","classId"); choice("status", ["active","paused","ended"]);
    }
  }
  if (resource === "sessions") {
    required("classId","startTime","endTime");
    data.date = date(data.date); integer("capacity", 1);
    for (const k of ["startTime","endTime"]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data[k])) bad("수업 시간을 확인하세요.");
    if (data.startTime >= data.endTime) bad("종료 시간은 시작 시간 이후여야 합니다.");
    choice("status", ["scheduled","cancelled"]);
  }
  if (resource === "marketing") {
    required("name","channel");
    choice("status", ["draft","scheduled","posted_manual","held","closed"]);
    for (const key of ["managementUrl","postUrl","materialUrl"]) if (data[key]) {
      try { const u = new URL(data[key]); if (!["https:","http:"].includes(u.protocol) || u.username || u.password) bad("웹 주소를 확인하세요."); }
      catch { bad("웹 주소를 확인하세요."); }
    }
    if (data.status === "posted_manual" && !data.postUrl) bad("수동 게시 확인에는 게시 링크가 필요합니다.");
    if(data.materialUrl&&!data.consentReference) bad("홍보 자료 사용 근거·동의 기록을 확인하세요.");
  }
  if(resource==="templates") {
    required("name","version","body","consentText");
    choice("status",["draft","active","retired"]);
  }
  if(resource==="support") {
    required("name"); choice("kind",["facility","supplies","competition","vendor","headquarters","merchant_application"]);
    choice("status",["planned","requested","in_progress","completed","held","cancelled"]);
    if (data.kind === "merchant_application") {
      choice("merchantStage",["preparing","application_submitted","contract_signed","review_approved","payment_active"]);
      if (data.merchantStage !== "preparing") required("merchantReference","merchantConfirmedAt");
      if (data.merchantConfirmedAt) {
        data.merchantConfirmedAt = date(data.merchantConfirmedAt);
        if (data.merchantConfirmedAt > new Date(Date.now()+9*3600_000).toISOString().slice(0,10)) bad("확인일은 미래일 수 없습니다.");
      }
      // These are centre-entered progress notes only; never a payment capability.
    } else {
      delete data.merchantStage; delete data.merchantReference; delete data.merchantConfirmedAt;
    }
    if(data.dueDate) data.dueDate=date(data.dueDate);
    if(data.quantity!==undefined) integer("quantity",0);
    if(data.url) {
      try {const u=new URL(data.url);if(!["https:","http:"].includes(u.protocol)||u.username||u.password) bad("주소를 확인하세요.");}
      catch {bad("주소를 확인하세요.");}
    }
  }
  if(resource==="policies") required("name");
  if (resource === "cards") {
    required("studentId","cardUid"); choice("status", ["active","lost","revoked"]);
    data.cardUid = data.cardUid.replace(/[\s:-]/g, "").toUpperCase();
    if (!/^[0-9A-F]{8,32}$/.test(data.cardUid) || data.cardUid.length % 2) bad("지원 카드 식별값(16진수)을 확인하세요.");
  }
  if (resource === "imports") {
    required("name"); choice("status", ["draft","reviewed"]);
    if(data.referenceDate) data.referenceDate=date(data.referenceDate);
    if (!Array.isArray(data.files) || data.files.length > 100) bad("파일 목록을 확인하세요.");
    data.rules = object(data.rules);
    const targets = new Set(["name","parent_phone","parent_name","phone","birth_year","memo","class_group_id","class_name"]);
    for (const [key, value] of Object.entries(data.rules)) {
      if (!targets.has(key) || typeof value !== "string" || value.length > 200) bad("지원하지 않는 변환 규칙입니다.");
    }
    let count = 0;
    data.files = data.files.map((v: unknown) => {
      const f = object(v);
      if (!Array.isArray(f.rows)) bad("시트 행을 확인하세요.");
      count += f.rows.length;
      if (count > 20000) bad("작업당 20,000행을 초과했습니다. 작업을 나누세요.");
      return { name: text(f.name, "파일명", 250), sheet: text(f.sheet, "시트명", 150),
        rows: f.rows.map((r: unknown) => object(r)) };
    });
  }
  return data;
}
export function previewImport(data: Record<string, any>, existing: Array<{name: string; parent_phone: string}>, classes:Array<{id:string;name:string}>=[]) {
  const seen = new Set<string>(), files = new Set<string>();
  const old = new Set(existing.map(s => `${s.name.trim().replace(/\s/g,"")}|${phone(s.parent_phone)}`));
  const rows: any[] = [];
  for (const f of data.files) {
    const fileHash = digest({sheet:f.sheet, rows:f.rows});
    const duplicateFile = files.has(fileHash); files.add(fileHash);
    for (const [index, raw] of f.rows.entries()) {
      const normalized: Record<string, string | number> = {};
      for (const [target, source] of Object.entries(data.rules))
        normalized[target] = String(raw[String(source)] ?? "").trim();
      normalized.parent_phone = phone(normalized.parent_phone);
      if (normalized.phone) normalized.phone = phone(normalized.phone);
      const errors: string[] = [];
      if (normalized.class_name) {
        const matches=classes.filter(c=>c.name.trim()===String(normalized.class_name).trim());
        if(matches.length===1) normalized.class_group_id=matches[0].id;
        else errors.push("반 이름 없음·중복 — 배정 보류");
      }
      if (normalized.class_group_id && !classes.some(c=>c.id===normalized.class_group_id))
        errors.push("센터의 반 ID 확인");
      if (!normalized.name) errors.push("이름 없음");
      if (!/^0\d{8,10}$/.test(String(normalized.parent_phone))) errors.push("보호자 연락처 확인");
      const key = `${String(normalized.name ?? "").replace(/\s/g,"")}|${normalized.parent_phone}`;
      if (duplicateFile) errors.push("중복 파일·시트");
      if (old.has(key)) errors.push("기존 회원과 일치 — 자동 덮어쓰기 금지");
      if (seen.has(key)) errors.push("작업 내 중복 회원 — 확인 필요");
      seen.add(key);
      const source = {file:f.name, sheet:f.sheet, row:index+2};
      rows.push({source, sourceKey:digest({source,raw}), normalized, errors});
    }
  }
  return { rows, ready:rows.filter(r => !r.errors.length).length, held:rows.filter(r => r.errors.length).length };
}
export function phone(value: unknown): string {
  let v = String(value ?? "").replace(/\D/g,"");
  if (v.startsWith("82")) v = "0" + v.slice(2);
  if (v.length === 10 && v.startsWith("1")) v = "0" + v;
  return v;
}
