/**
 * SuperPoolDetail — /super/pools/:poolId
 * A. 기본 상태  B. Basic 구독  C. X 구독
 * D. X Setup   E. X04 구조화 (FULL — view/edit/approve/package)
 * F. AI Traces  G. 고객센터   H. 장애  I. 사용자 현황
 *
 * SA0-B: 기존 섹션 동결. E 섹션만 X04 완전 연결.
 */
import { useEffect, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";

// ──────────────────── Types ────────────────────
interface PoolDetail {
  id: string; name: string;
  address?: string | null; phone?: string | null;
  owner_name?: string | null; owner_email?: string | null;
  approval_status: string;
  subscription_status?: string | null; subscription_tier?: string | null;
  plan_name?: string | null; subscription_starts_at?: string | null;
  subscription_ends_at?: string | null; trial_ends_at?: string | null;
  member_limit?: number | null; display_storage?: string | null;
  created_at?: string | null; updated_at?: string | null;
  homepage_slug?: string | null; homepage_enabled?: boolean | null;
  xmode_entitlement?: boolean | null; xmode_config_status?: string | null;
  x_paid_entitlement?: boolean | null; x_manual_entitlement?: boolean | null;
  x_force_disabled?: boolean | null; x_plan_key?: string | null;
  x_submission_submitted_at?: string | null;
  x_submission_reviewed_at?: string | null;
  x_submission_status?: string | null;
  active_member_count?: number | null; total_member_count?: number | null;
  total_class_count?: number | null; teacher_count?: number | null;
  staff_count?: number | null;
}

interface AiTrace {
  id: string; feature: string | null; status: string;
  model: string | null; total_tokens: number | null;
  latency_ms: number | null; error_message: string | null; created_at: string;
}

interface Incident {
  id: string; title: string; severity: string; status: string; created_at: string;
}

interface Support {
  total_count: number; open_count: number; resolved_count: number;
}

// X04 types
interface CurriculumLevel {
  id: string; level_order: number; level_name: string | null;
  level_color: string | null; target_students: string | null;
  strokes: string | null; skills: string | null; learning_contents: string | null;
  objectives: string | null; promotion_criteria: string | null;
  test_method: string | null; detailed_skills: string | null;
  common_errors: string | null; correction_methods: string | null;
  drills: string | null; age_notes: string | null;
  teaching_focus: string | null; notes: string | null;
}

interface CurriculumProfile {
  id: string; pool_id: string; status: string;
  source_version: number | null; template_version: string | null;
  total_declared_levels: number | null;
  basic_info: Record<string, any> | null;
  teaching_summary: Record<string, any> | null;
  parse_error: string | null;
  structured_at: string | null; reviewed_at: string | null;
  edited_at: string | null; updated_at: string;
  levels: CurriculumLevel[];
}

interface WebsiteProfile {
  id: string; pool_id: string; status: string;
  source_version: number | null; template_version: string | null;
  basic_info: Record<string, any> | null;
  brand: Record<string, any> | null;
  strengths: Record<string, any> | null;
  differentiation: Record<string, any> | null;
  philosophy: Record<string, any> | null;
  programs: Record<string, any> | null;
  level_system: Record<string, any> | null;
  education_process: Record<string, any> | null;
  facilities: Record<string, any> | null;
  safety: Record<string, any> | null;
  vehicle_location: Record<string, any> | null;
  usage_information: Record<string, any> | null;
  coaches: Record<string, any> | null;
  trust_credentials: Record<string, any> | null;
  faq: Record<string, any> | null;
  website_preferences: Record<string, any> | null;
  restricted_information: string | null;
  free_notes: string | null;
  parse_error: string | null;
  reviewed_at: string | null; edited_at: string | null; updated_at: string;
}

interface PackageRecord {
  id: string; package_version: number; package_name: string;
  generated_at: string; source_submission_version: number | null;
}

interface X04Data {
  curriculum: CurriculumProfile | null;
  website: WebsiteProfile | null;
  packages: PackageRecord[];
}

// ──────────────────── Helpers ────────────────────
function Row({ label, value, valueClass }: { label: string; value?: string | number | boolean | null; valueClass?: string }) {
  const display = value == null ? "—" : typeof value === "boolean" ? (value ? "YES" : "NO") : String(value);
  return (
    <div className="flex justify-between py-2 border-b border-[#f5f5f5] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <span className={`text-[12px] font-medium text-right break-all max-w-[60%] ${valueClass ?? "text-[#111]"}`}>{display}</span>
    </div>
  );
}

function SectionCard({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-[11px] font-bold text-[#999] uppercase tracking-wider">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function SevBadge({ sev }: { sev: string }) {
  const colors: Record<string, string> = {
    SEV1: "bg-red-100 text-red-700",
    SEV2: "bg-orange-100 text-orange-700",
    SEV3: "bg-amber-100 text-amber-700",
    SEV4: "bg-gray-100 text-gray-600",
  };
  return <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${colors[sev] ?? colors.SEV4}`}>{sev}</span>;
}

function xConfigLabel(s?: string | null) {
  const labels: Record<string, string> = {
    NOT_CONFIGURED: "미구성", SUBMITTED: "자료 제출됨",
    UNDER_REVIEW: "검토 중", APPROVED: "승인됨",
    REVISION_NEEDED: "수정 요청", REJECTED: "반려",
  };
  return labels[s ?? ""] ?? (s ?? "—");
}

const X04_STATUS_COLORS: Record<string, string> = {
  NOT_PROCESSED: "bg-gray-100 text-gray-600",
  PROCESSING: "bg-blue-100 text-blue-700",
  STRUCTURED: "bg-indigo-100 text-indigo-700",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${X04_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// ──────────────────── X04 Section ────────────────────
const WEBSITE_JSONB_FIELDS = [
  "basic_info","brand","strengths","differentiation","philosophy",
  "programs","level_system","education_process","facilities","safety",
  "vehicle_location","usage_information","coaches","trust_credentials",
  "faq","website_preferences",
] as const;

const WEBSITE_FIELD_LABELS: Record<string, string> = {
  basic_info: "기본 정보", brand: "브랜드", strengths: "강점",
  differentiation: "차별화", philosophy: "교육 철학", programs: "프로그램",
  level_system: "레벨 시스템", education_process: "교육 과정",
  facilities: "시설", safety: "안전", vehicle_location: "차량·위치",
  usage_information: "이용 안내", coaches: "코치진",
  trust_credentials: "신뢰 자료", faq: "FAQ",
  website_preferences: "홈페이지 선호",
  restricted_information: "공개 제한 정보", free_notes: "기타 메모",
};

const LEVEL_TEXT_FIELDS: Array<keyof CurriculumLevel> = [
  "level_name","level_color","target_students","strokes","skills",
  "learning_contents","objectives","promotion_criteria","test_method",
  "detailed_skills","common_errors","correction_methods","drills",
  "age_notes","teaching_focus","notes",
];

function X04Section({ poolId }: { poolId: string }) {
  const [data, setData] = useState<X04Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"curriculum" | "website" | "packages">("curriculum");

  // Actions
  const [structuring, setStructuring] = useState(false);
  const [structureResult, setStructureResult] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Curriculum edit
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [levelEdits, setLevelEdits] = useState<Record<string, string>>({});
  const [levelSaving, setLevelSaving] = useState(false);

  // Website edit
  const [editingWsField, setEditingWsField] = useState<string | null>(null);
  const [wsFieldEdit, setWsFieldEdit] = useState("");
  const [wsSaving, setWsSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.get<X04Data>(`/super/x-setup/${poolId}/structured`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [poolId]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3000);
  };

  // Trigger structuring
  const handleStructure = async () => {
    setStructuring(true); setStructureResult(null);
    try {
      const r = await api.post<any>(`/super/x-setup/${poolId}/structure`, {});
      setStructureResult(JSON.stringify(r.results ?? r, null, 2));
      load();
    } catch (e: any) {
      setStructureResult("오류: " + (e?.data?.error ?? "서버 오류"));
    } finally {
      setStructuring(false);
    }
  };

  // Approve
  const handleApprove = async (type: "curriculum" | "website" | "both") => {
    setApproving(true);
    try {
      await api.post(`/super/x-setup/${poolId}/structured/approve`, { type });
      flash(`✅ ${type} 승인 완료`);
      load();
    } catch (e: any) {
      flash("❌ " + (e?.data?.error ?? "승인 실패"));
    } finally {
      setApproving(false);
    }
  };

  // Generate package
  const handleGeneratePackage = async () => {
    setGenerating(true);
    try {
      const r = await api.post<any>(`/super/x-setup/${poolId}/package`, {});
      flash(`✅ 패키지 생성 완료: v${r.package_version}`);
      load();
    } catch (e: any) {
      flash("❌ " + (e?.data?.error ?? "패키지 생성 실패"));
    } finally {
      setGenerating(false);
    }
  };

  // Download package
  const handleDownload = async (pkgId: string, pkgName: string) => {
    try {
      const r = await api.get<{ url: string; package_name: string }>(
        `/super/x-setup/${poolId}/packages/${pkgId}/download`
      );
      const a = document.createElement("a");
      a.href = r.url; a.download = pkgName; a.click();
    } catch (e: any) {
      flash("❌ 다운로드 실패: " + (e?.data?.error ?? "서버 오류"));
    }
  };

  // Save level edit
  const handleSaveLevel = async (level: CurriculumLevel) => {
    setLevelSaving(true);
    const updated = { level_order: level.level_order, ...levelEdits };
    try {
      await api.patch(`/super/x-setup/${poolId}/curriculum/structured`, { levels: [updated] });
      flash("✅ 레벨 저장 완료");
      setEditingLevel(null); setLevelEdits({});
      load();
    } catch (e: any) {
      flash("❌ " + (e?.data?.error ?? "저장 실패"));
    } finally {
      setLevelSaving(false);
    }
  };

  // Save website field
  const handleSaveWsField = async (field: string) => {
    setWsSaving(true);
    let value: any = wsFieldEdit;
    if (WEBSITE_JSONB_FIELDS.includes(field as any)) {
      try { value = JSON.parse(wsFieldEdit); }
      catch { flash("❌ JSON 형식 오류"); setWsSaving(false); return; }
    }
    try {
      await api.patch(`/super/x-setup/${poolId}/website/structured`, { [field]: value });
      flash("✅ 저장 완료");
      setEditingWsField(null); setWsFieldEdit("");
      load();
    } catch (e: any) {
      flash("❌ " + (e?.data?.error ?? "저장 실패"));
    } finally {
      setWsSaving(false);
    }
  };

  const btnBase = "px-3 py-1.5 rounded text-[11px] font-semibold transition-colors";
  const btnPrimary = `${btnBase} bg-[#002F5F] text-white hover:bg-[#001F40] disabled:opacity-40`;
  const btnSecondary = `${btnBase} border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5]`;
  const btnGreen = `${btnBase} bg-green-600 text-white hover:bg-green-700 disabled:opacity-40`;

  if (loading) return <p className="text-[12px] text-[#aaa]">구조화 데이터 불러오는 중...</p>;

  const curriculum = data?.curriculum ?? null;
  const website = data?.website ?? null;
  const packages = data?.packages ?? [];

  const canApproveCurriculum = curriculum && ["STRUCTURED","REVIEW_REQUIRED"].includes(curriculum.status);
  const canApproveWebsite = website && ["STRUCTURED","REVIEW_REQUIRED"].includes(website.status);
  const canGeneratePackage = website?.status === "APPROVED";
  const hasSubmission = !error;

  return (
    <div>
      {/* Status summary row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#888]">커리큘럼:</span>
          <StatusBadge status={curriculum?.status ?? "NOT_PROCESSED"} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#888]">홈페이지:</span>
          <StatusBadge status={website?.status ?? "NOT_PROCESSED"} />
        </div>
        <div className="flex-1" />
        <button
          onClick={handleStructure}
          disabled={structuring}
          className={btnPrimary}
        >
          {structuring ? "구조화 중..." : (curriculum || website) ? "재구조화" : "구조화 시작"}
        </button>
      </div>

      {/* Structuring result */}
      {structureResult && (
        <div className="mb-3 p-3 bg-[#f5f5f5] rounded text-[11px] font-mono whitespace-pre-wrap text-[#444] max-h-32 overflow-y-auto">
          {structureResult}
        </div>
      )}

      {/* Action flash */}
      {actionMsg && (
        <div className="mb-3 px-3 py-2 bg-[#f0f7ff] border border-[#b3d4ff] rounded text-[12px] text-[#002F5F]">
          {actionMsg}
        </div>
      )}

      {!curriculum && !website ? (
        <p className="text-[12px] text-[#bbb]">
          {hasSubmission
            ? "구조화 데이터 없음. 제출 자료가 있으면 [구조화 시작]을 눌러주세요."
            : "X03 제출 자료가 없습니다."}
        </p>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-[#e5e5e5]">
            {(["curriculum","website","packages"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[11px] font-semibold transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? "border-[#002F5F] text-[#002F5F]"
                    : "border-transparent text-[#888] hover:text-[#555]"
                }`}
              >
                {t === "curriculum" ? `커리큘럼 (${curriculum?.total_declared_levels ?? 0}단계)` : t === "website" ? "홈페이지 프로필" : `패키지 (${packages.length})`}
              </button>
            ))}
          </div>

          {/* ── CURRICULUM TAB ── */}
          {tab === "curriculum" && (
            <div className="space-y-4">
              {!curriculum ? (
                <p className="text-[12px] text-[#bbb]">커리큘럼 구조화 데이터 없음</p>
              ) : (
                <>
                  {curriculum.parse_error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded text-[11px] text-red-600">
                      파싱 오류: {curriculum.parse_error}
                    </div>
                  )}
                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-[#f9f9f9] rounded p-2">
                      <span className="text-[#888]">버전</span>
                      <span className="ml-2 font-medium">{curriculum.template_version ?? "—"}</span>
                    </div>
                    <div className="bg-[#f9f9f9] rounded p-2">
                      <span className="text-[#888]">레벨 수</span>
                      <span className="ml-2 font-medium">{curriculum.levels.length}개</span>
                    </div>
                    {curriculum.structured_at && (
                      <div className="bg-[#f9f9f9] rounded p-2 col-span-2">
                        <span className="text-[#888]">구조화일</span>
                        <span className="ml-2 font-medium">{curriculum.structured_at.slice(0,10)}</span>
                        {curriculum.edited_at && (
                          <span className="ml-3 text-amber-600">수정: {curriculum.edited_at.slice(0,10)}</span>
                        )}
                        {curriculum.reviewed_at && (
                          <span className="ml-3 text-green-700">승인: {curriculum.reviewed_at.slice(0,10)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Levels */}
                  <div className="space-y-2">
                    {curriculum.levels.map((level) => (
                      <div key={level.id} className="border border-[#e5e5e5] rounded">
                        <div
                          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#fafafa]"
                          onClick={() => {
                            if (editingLevel === level.level_order) {
                              setEditingLevel(null); setLevelEdits({});
                            } else {
                              setEditingLevel(level.level_order);
                              // Seed edits from current values
                              const seed: Record<string, string> = {};
                              LEVEL_TEXT_FIELDS.forEach((f) => { seed[f as string] = (level[f] as string) ?? ""; });
                              setLevelEdits(seed);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-[#002F5F] w-6">{level.level_order}</span>
                            {level.level_color && (
                              <span className="w-3 h-3 rounded-full border border-[#ddd]" style={{ backgroundColor: level.level_color }} />
                            )}
                            <span className="text-[12px] font-medium text-[#111]">{level.level_name ?? "(이름 없음)"}</span>
                          </div>
                          <span className="text-[11px] text-[#aaa]">{editingLevel === level.level_order ? "▲" : "▼"}</span>
                        </div>

                        {editingLevel === level.level_order && (
                          <div className="border-t border-[#f0f0f0] p-3 space-y-2">
                            {curriculum.status !== "APPROVED" ? (
                              <>
                                {LEVEL_TEXT_FIELDS.map((field) => (
                                  <div key={field as string}>
                                    <label className="block text-[10px] text-[#888] mb-0.5">
                                      {field as string}
                                    </label>
                                    <textarea
                                      rows={2}
                                      className="w-full text-[11px] border border-[#e5e5e5] rounded px-2 py-1 font-mono resize-y"
                                      value={levelEdits[field as string] ?? ""}
                                      onChange={(e) => setLevelEdits((prev) => ({ ...prev, [field as string]: e.target.value }))}
                                    />
                                  </div>
                                ))}
                                <div className="flex gap-2 pt-1">
                                  <button
                                    onClick={() => handleSaveLevel(level)}
                                    disabled={levelSaving}
                                    className={btnGreen}
                                  >
                                    {levelSaving ? "저장 중..." : "저장"}
                                  </button>
                                  <button
                                    onClick={() => { setEditingLevel(null); setLevelEdits({}); }}
                                    className={btnSecondary}
                                  >취소</button>
                                </div>
                              </>
                            ) : (
                              /* Read-only when APPROVED */
                              <div className="space-y-1">
                                {LEVEL_TEXT_FIELDS.map((field) => (
                                  (level[field] as string | null) ? (
                                    <div key={field as string} className="flex gap-2 text-[11px]">
                                      <span className="text-[#888] w-28 shrink-0">{field as string}</span>
                                      <span className="text-[#111] whitespace-pre-wrap">{level[field] as string}</span>
                                    </div>
                                  ) : null
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Curriculum approve */}
                  {canApproveCurriculum && curriculum.status !== "APPROVED" && (
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => handleApprove("curriculum")} disabled={approving} className={btnGreen}>
                        {approving ? "승인 중..." : "커리큘럼 승인"}
                      </button>
                    </div>
                  )}
                  {curriculum.status === "APPROVED" && (
                    <p className="text-[11px] text-green-700 font-semibold">✅ 커리큘럼 승인됨</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── WEBSITE TAB ── */}
          {tab === "website" && (
            <div className="space-y-3">
              {!website ? (
                <p className="text-[12px] text-[#bbb]">홈페이지 구조화 데이터 없음</p>
              ) : (
                <>
                  {website.parse_error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded text-[11px] text-red-600">
                      파싱 오류: {website.parse_error}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
                    <div className="bg-[#f9f9f9] rounded p-2">
                      <span className="text-[#888]">버전</span>
                      <span className="ml-2 font-medium">{website.template_version ?? "—"}</span>
                    </div>
                    <div className="bg-[#f9f9f9] rounded p-2">
                      <span className="text-[#888]">상태</span>
                      <span className="ml-2"><StatusBadge status={website.status} /></span>
                    </div>
                    {website.reviewed_at && (
                      <div className="bg-[#f9f9f9] rounded p-2 col-span-2 text-green-700">
                        승인: {website.reviewed_at.slice(0,10)}
                      </div>
                    )}
                    {website.edited_at && (
                      <div className="bg-[#f9f9f9] rounded p-2 col-span-2 text-amber-600">
                        수정: {website.edited_at.slice(0,10)}
                      </div>
                    )}
                  </div>

                  {/* JSONB fields */}
                  {[...WEBSITE_JSONB_FIELDS, "restricted_information" as const, "free_notes" as const].map((field) => {
                    const rawVal = website[field as keyof WebsiteProfile];
                    const isEmpty = rawVal == null || (typeof rawVal === "object" && Object.keys(rawVal).length === 0);
                    const isEditing = editingWsField === field;
                    const isJsonb = WEBSITE_JSONB_FIELDS.includes(field as any);

                    return (
                      <div key={field} className="border border-[#f0f0f0] rounded">
                        <div className="flex items-center justify-between px-3 py-2 bg-[#fafafa]">
                          <span className="text-[11px] font-semibold text-[#555]">
                            {WEBSITE_FIELD_LABELS[field] ?? field}
                          </span>
                          <div className="flex items-center gap-2">
                            {isEmpty && <span className="text-[10px] text-[#ccc]">비어있음</span>}
                            {website.status !== "APPROVED" && (
                              <button
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingWsField(null); setWsFieldEdit("");
                                  } else {
                                    setEditingWsField(field);
                                    setWsFieldEdit(
                                      isJsonb
                                        ? JSON.stringify(rawVal ?? {}, null, 2)
                                        : String(rawVal ?? "")
                                    );
                                  }
                                }}
                                className="text-[10px] text-[#002F5F] hover:underline"
                              >
                                {isEditing ? "취소" : "수정"}
                              </button>
                            )}
                          </div>
                        </div>

                        {!isEditing && !isEmpty && (
                          <div className="px-3 py-2">
                            <pre className="text-[10px] text-[#555] font-mono whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
                              {isJsonb ? JSON.stringify(rawVal, null, 2) : String(rawVal)}
                            </pre>
                          </div>
                        )}

                        {isEditing && (
                          <div className="px-3 py-2 border-t border-[#f0f0f0] space-y-2">
                            <textarea
                              rows={6}
                              className="w-full text-[11px] border border-[#e5e5e5] rounded px-2 py-1 font-mono resize-y"
                              value={wsFieldEdit}
                              onChange={(e) => setWsFieldEdit(e.target.value)}
                            />
                            {isJsonb && (
                              <p className="text-[10px] text-[#aaa]">JSON 형식으로 입력하세요.</p>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveWsField(field)}
                                disabled={wsSaving}
                                className={btnGreen}
                              >
                                {wsSaving ? "저장 중..." : "저장"}
                              </button>
                              <button
                                onClick={() => { setEditingWsField(null); setWsFieldEdit(""); }}
                                className={btnSecondary}
                              >취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Website approve + generate package */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {canApproveWebsite && website.status !== "APPROVED" && (
                      <button onClick={() => handleApprove("website")} disabled={approving} className={btnGreen}>
                        {approving ? "승인 중..." : "홈페이지 프로필 승인"}
                      </button>
                    )}
                    {canGeneratePackage && (
                      <button onClick={handleGeneratePackage} disabled={generating} className={btnPrimary}>
                        {generating ? "패키지 생성 중..." : "📦 홈페이지 제작 패키지 생성"}
                      </button>
                    )}
                    {website.status === "APPROVED" && (
                      <span className="self-center text-[11px] text-green-700 font-semibold">✅ 승인됨</span>
                    )}
                  </div>

                  {canGeneratePackage && (
                    <p className="text-[10px] text-[#aaa]">
                      패키지에는 website_spec.md · website_data.json · source_manifest.json · 원본 자료 · 로고 · 사진(최대 10장)이 포함됩니다.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── PACKAGES TAB ── */}
          {tab === "packages" && (
            <div className="space-y-2">
              {packages.length === 0 ? (
                <p className="text-[12px] text-[#bbb]">생성된 패키지 없음</p>
              ) : (
                packages.map((pkg) => (
                  <div key={pkg.id} className="flex items-center gap-3 py-2.5 border-b border-[#f5f5f5] last:border-0">
                    <span className="text-[11px] font-bold text-[#002F5F] w-8">v{pkg.package_version}</span>
                    <span className="flex-1 text-[11px] text-[#555] truncate">{pkg.package_name}</span>
                    <span className="text-[10px] text-[#aaa]">{pkg.generated_at.slice(0,10)}</span>
                    <button
                      onClick={() => handleDownload(pkg.id, pkg.package_name)}
                      className="text-[10px] text-[#002F5F] hover:underline font-semibold"
                    >
                      ↓ 다운로드
                    </button>
                  </div>
                ))
              )}

              {canGeneratePackage && (
                <div className="pt-2">
                  <button onClick={handleGeneratePackage} disabled={generating} className={btnPrimary}>
                    {generating ? "패키지 생성 중..." : "📦 새 버전 생성"}
                  </button>
                  <p className="mt-1 text-[10px] text-[#aaa]">기존 패키지는 덮어쓰지 않습니다. 버전 이력이 보존됩니다.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────── X Plan defs ────────────────────
const X_PLANS = [
  { key: "x300",  label: "X300",  memberLimit: 300,  priceLabel: "₩129,000/월" },
  { key: "x500",  label: "X500",  memberLimit: 500,  priceLabel: "₩199,000/월" },
  { key: "x1000", label: "X1000", memberLimit: 1000, priceLabel: "₩359,000/월" },
];

// ──────────────────── Component ────────────────────
export default function SuperPoolDetail() {
  const [, params] = useRoute("/super/pools/:poolId");
  const [, navigate] = useLocation();
  const poolId = params?.poolId;

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // X manual grant/revoke UI state
  const [grantModal, setGrantModal]   = useState(false);
  const [grantPlan, setGrantPlan]     = useState("x300");
  const [grantLoading, setGrantLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [xMsg, setXMsg]               = useState<{ ok: boolean; text: string } | null>(null);

  const [aiTraces, setAiTraces] = useState<AiTrace[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const loadPool = useCallback(() => {
    if (!poolId) return;
    api.get<{ pool: PoolDetail; support: Support }>(`/super/operators/${poolId}`)
      .then((d) => { setPool(d.pool); setSupport(d.support ?? null); })
      .catch((e) => setError(e?.data?.error || "수영장 정보를 불러올 수 없습니다."))
      .finally(() => setLoading(false));
  }, [poolId]);

  // X manual grant handler
  const handleGrant = useCallback(async () => {
    if (!poolId) return;
    setGrantLoading(true); setXMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, {
        xmode_entitlement: true,
        xmode_config_status: "READY",
        x_plan_key: grantPlan,
        bypass_readiness_check: true,
        reason: `Super Admin manual grant — ${grantPlan}`,
      });
      setGrantModal(false);
      setXMsg({ ok: true, text: `X모드 직접 부여 완료 (${grantPlan})` });
      loadPool();
    } catch (e: any) {
      setXMsg({ ok: false, text: e?.data?.error || "부여 실패" });
    } finally {
      setGrantLoading(false);
    }
  }, [poolId, grantPlan, loadPool]);

  // X manual revoke handler
  const handleRevoke = useCallback(async () => {
    if (!poolId || !window.confirm(`${pool?.name}의 X모드 manual 권한을 회수합니다. 계속하시겠습니까?`)) return;
    setRevokeLoading(true); setXMsg(null);
    try {
      await api.patch(`/super/operators/${poolId}/xmode`, {
        xmode_entitlement: false,
        x_plan_key: null,
        reason: "Super Admin manual revoke",
      });
      setXMsg({ ok: true, text: "X모드 manual 권한 회수 완료" });
      loadPool();
    } catch (e: any) {
      setXMsg({ ok: false, text: e?.data?.error || "회수 실패" });
    } finally {
      setRevokeLoading(false);
    }
  }, [poolId, pool?.name, loadPool]);

  useEffect(() => {
    if (!poolId) return;
    setLoading(true); setError("");
    loadPool();

    api.get<{ traces: AiTrace[] }>(`/super/ai-traces?pool_id=${poolId}&limit=5`)
      .then((r) => setAiTraces(r.traces ?? [])).catch(() => setAiTraces([]));

    api.get<{ incidents: Incident[] }>(`/super/incidents?pool_id=${poolId}&limit=5`)
      .then((r) => setIncidents(r.incidents ?? [])).catch(() => setIncidents([]));
  }, [poolId]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;
  if (error)   return <div className="p-6 text-[13px] text-red-500">{error}</div>;
  if (!pool)   return null;

  const xActive = pool.x_paid_entitlement || pool.x_manual_entitlement || pool.xmode_entitlement;

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/super/pools")}
          className="text-[12px] text-[#888] hover:text-[#111] flex items-center gap-1">
          ← 수영장 관리
        </button>
        <span className="text-[#ddd]">/</span>
        <span className="text-[14px] font-bold text-[#111]">{pool.name}</span>
        {xActive && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#002F5F] text-white">X</span>
        )}
      </div>

      <div className="space-y-4">
        {/* ── A. 기본 상태 ── */}
        <SectionCard title="A. 기본 상태">
          <Row label="pool_id" value={pool.id} />
          <Row label="수영장명" value={pool.name} />
          <Row label="주소" value={pool.address} />
          <Row label="전화번호" value={pool.phone} />
          <Row label="운영자명" value={pool.owner_name} />
          <Row label="승인 상태" value={pool.approval_status} />
          <Row label="생성일" value={pool.created_at?.slice(0, 10)} />
          <Row label="최근 수정" value={pool.updated_at?.slice(0, 16)} />
        </SectionCard>

        {/* ── B. Basic 구독 ── */}
        <SectionCard title="B. Basic 구독">
          <Row label="구독 상태" value={pool.subscription_status} />
          <Row label="플랜" value={pool.plan_name ?? pool.subscription_tier} />
          <Row label="시작일" value={pool.subscription_starts_at?.slice(0, 10)} />
          <Row label="만료일" value={pool.subscription_ends_at?.slice(0, 10)} />
          <Row label="Trial 만료" value={pool.trial_ends_at?.slice(0, 10)} />
          <Row label="회원 한도" value={pool.member_limit} />
          <Row label="저장공간" value={pool.display_storage} />
        </SectionCard>

        {/* ── C. X 구독 ── */}
        <SectionCard
          title="C. SWIMNOTE X 권한"
          badge={xActive ? <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#002F5F] text-white rounded">X ACTIVE</span> : undefined}
        >
          {/* Status rows */}
          <Row label="현재 X 상태" value={xActive ? "활성" : "비활성"} valueClass={xActive ? "text-green-700 font-bold" : "text-[#bbb]"} />
          <Row label="권한 출처"
            value={pool.x_paid_entitlement ? "결제" : pool.x_manual_entitlement ? "슈퍼관리자 직접부여" : "없음"}
            valueClass={pool.x_manual_entitlement ? "text-[#7c3aed]" : pool.x_paid_entitlement ? "text-green-700" : "text-[#bbb]"}
          />
          <Row label="현재 플랜" value={pool.x_plan_key?.toUpperCase() ?? "—"} />
          <Row label="회원 한도" value={pool.member_limit} />
          <Row label="Paid entitlement" value={pool.x_paid_entitlement} valueClass={pool.x_paid_entitlement ? "text-green-700" : "text-[#bbb]"} />
          <Row label="Manual entitlement" value={pool.x_manual_entitlement} valueClass={pool.x_manual_entitlement ? "text-green-700" : "text-[#bbb]"} />
          <Row label="Force disabled" value={pool.x_force_disabled} valueClass={pool.x_force_disabled ? "text-red-600" : "text-[#bbb]"} />

          {/* Feedback */}
          {xMsg && (
            <div className={`mt-3 px-3 py-2 rounded text-[12px] font-medium ${xMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {xMsg.text}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-2 flex-wrap">
            {/* Grant / Change plan */}
            <button
              onClick={() => { setGrantModal(true); setXMsg(null); setGrantPlan(pool.x_plan_key ?? "x300"); }}
              disabled={grantLoading || revokeLoading}
              className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[#002F5F] text-white hover:bg-[#00214a] disabled:opacity-50"
            >
              {pool.x_manual_entitlement ? "X 플랜 변경" : "X모드 직접 부여"}
            </button>

            {/* Revoke — only shown when manual is active */}
            {pool.x_manual_entitlement && (
              <button
                onClick={handleRevoke}
                disabled={grantLoading || revokeLoading}
                className="px-3 py-1.5 text-[12px] font-semibold rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {revokeLoading ? "처리 중..." : "X모드 회수"}
              </button>
            )}
          </div>

          {/* Grant Modal */}
          {grantModal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setGrantModal(false)}>
              <div className="bg-white rounded-xl shadow-2xl p-6 w-[340px]" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[15px] font-bold text-[#111] mb-1">X모드 직접 부여</h3>
                <p className="text-[12px] text-[#888] mb-4">결제 없이 즉시 적용. 슈퍼관리자 전용.</p>

                {/* Plan selector */}
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#555] mb-2">플랜 선택</p>
                  <div className="space-y-2">
                    {X_PLANS.map((plan) => (
                      <label key={plan.key}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          grantPlan === plan.key ? "border-[#002F5F] bg-[#f0f4ff]" : "border-[#e5e7eb] hover:border-[#002F5F]/40"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio" name="grantPlan" value={plan.key}
                            checked={grantPlan === plan.key}
                            onChange={() => setGrantPlan(plan.key)}
                            className="accent-[#002F5F]"
                          />
                          <span className="text-[13px] font-semibold text-[#111]">{plan.label}</span>
                          <span className="text-[11px] text-[#888]">최대 {plan.memberLimit.toLocaleString()}명</span>
                        </div>
                        <span className="text-[11px] text-[#6b7280]">{plan.priceLabel}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <p className="text-[11px] text-amber-600 mb-4">⚠ 청구 없음. 슈퍼관리자 직접부여로 감사 기록됩니다.</p>

                <div className="flex gap-2">
                  <button onClick={handleGrant} disabled={grantLoading}
                    className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-[#002F5F] text-white hover:bg-[#00214a] disabled:opacity-50">
                    {grantLoading ? "처리 중..." : "확인 — 즉시 적용"}
                  </button>
                  <button onClick={() => setGrantModal(false)} disabled={grantLoading}
                    className="px-4 py-2 text-[13px] rounded-lg border border-[#e5e7eb] text-[#555] hover:bg-[#f5f5f5]">
                    취소
                  </button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── D. X Setup ── */}
        <SectionCard title="D. X Setup">
          <Row label="Setup 상태" value={xConfigLabel(pool.xmode_config_status)} />
          <Row label="자료 제출일" value={pool.x_submission_submitted_at?.slice(0, 10)} />
          <Row label="검토일" value={pool.x_submission_reviewed_at?.slice(0, 10)} />
          <Row label="제출 결과" value={pool.x_submission_status} />
          <div className="mt-3">
            <button
              onClick={() => navigate("/super/x-mode")}
              className="text-[11px] text-[#002F5F] hover:underline"
            >
              X MODE 관리 페이지에서 검토 →
            </button>
          </div>
        </SectionCard>

        {/* ── E. X04 구조화 (FULL) ── */}
        <SectionCard title="E. X04 구조화">
          {poolId ? <X04Section poolId={poolId} /> : <p className="text-[12px] text-[#bbb]">poolId 없음</p>}
        </SectionCard>

        {/* ── F. AI Traces (최근 5) ── */}
        <SectionCard title="F. 최근 AI 호출 (5건)">
          {aiTraces.length === 0 ? (
            <p className="text-[12px] text-[#bbb]">AI 호출 기록 없음</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0f0f0]">
                  <th className="text-left py-1.5 text-[10px] text-[#bbb] font-semibold">Feature</th>
                  <th className="text-left py-1.5 text-[10px] text-[#bbb] font-semibold">Status</th>
                  <th className="text-right py-1.5 text-[10px] text-[#bbb] font-semibold">Tokens</th>
                  <th className="text-right py-1.5 text-[10px] text-[#bbb] font-semibold">응답</th>
                </tr>
              </thead>
              <tbody>
                {aiTraces.map((t) => (
                  <tr key={t.id} className="border-b border-[#f5f5f5] last:border-0">
                    <td className="py-2 text-[#555] max-w-[100px] truncate">{t.feature ?? "—"}</td>
                    <td className="py-2">
                      <span className={`px-1 py-0.5 text-[10px] font-bold rounded ${
                        t.status === "SUCCESS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>{t.status}</span>
                    </td>
                    <td className="py-2 text-right text-[#888]">{t.total_tokens?.toLocaleString() ?? "—"}</td>
                    <td className={`py-2 text-right font-medium ${(t.latency_ms ?? 0) > 5000 ? "text-amber-600" : "text-[#888]"}`}>
                      {t.latency_ms != null ? `${(t.latency_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2">
            <button onClick={() => navigate("/super/ai")} className="text-[11px] text-[#002F5F] hover:underline">
              AI 운영 전체 보기 →
            </button>
          </div>
        </SectionCard>

        {/* ── G. 고객센터 ── */}
        <SectionCard title="G. 고객센터">
          {support ? (
            <>
              <Row label="전체 티켓" value={support.total_count} />
              <Row label="미처리" value={support.open_count} valueClass={support.open_count > 0 ? "text-amber-600" : undefined} />
              <Row label="해결됨" value={support.resolved_count} valueClass="text-green-700" />
            </>
          ) : (
            <p className="text-[12px] text-[#bbb]">지원 데이터 없음</p>
          )}
          <div className="mt-3">
            <button onClick={() => navigate("/super/support")} className="text-[11px] text-[#002F5F] hover:underline">
              고객센터 전체 보기 →
            </button>
          </div>
        </SectionCard>

        {/* ── H. 장애 ── */}
        <SectionCard title="H. 관련 장애">
          {incidents.length === 0 ? (
            <p className="text-[12px] text-[#bbb]">이 수영장에 영향을 미친 장애 없음</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => (
                <div key={inc.id} className="flex items-center gap-2 py-1.5 border-b border-[#f5f5f5] last:border-0">
                  <SevBadge sev={inc.severity} />
                  <span className="flex-1 text-[12px] text-[#111] truncate">{inc.title}</span>
                  <span className="text-[11px] text-[#bbb]">{inc.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <button onClick={() => navigate("/super/incidents")} className="text-[11px] text-[#002F5F] hover:underline">
              장애 관리 →
            </button>
          </div>
        </SectionCard>

        {/* ── I. 사용자 현황 ── */}
        <SectionCard title="I. 사용자 현황">
          <Row label="활성 회원" value={pool.active_member_count} valueClass="text-green-700" />
          <Row label="전체 회원" value={pool.total_member_count} />
          <Row label="수업 수" value={pool.total_class_count} />
          <Row label="강사 수" value={pool.teacher_count} />
          <Row label="스태프 수" value={pool.staff_count} />
        </SectionCard>

        {/* ── 관리 도구 ── */}
        <SectionCard title="관리 도구">
          <div className="flex flex-wrap gap-2">
            <a
              href={`/pool/${pool.id}/admin`}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#002F5F] text-[#002F5F] hover:bg-[#002F5F] hover:text-white transition-colors"
            >
              PoolAdmin 전체 보기 →
            </a>
            {pool.homepage_slug && (
              <a
                href={`/${pool.homepage_slug}`}
                target="_blank" rel="noreferrer"
                className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] transition-colors"
              >
                홈페이지 보기 →
              </a>
            )}
            <button
              onClick={() => navigate(`/super/billing`)}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] transition-colors"
            >
              구독 현황 →
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
