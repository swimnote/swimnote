/**
 * bulk-register — 명단 한번에 올리기
 *
 * 지원 파일: Excel(.xlsx / .xls / .xlsm), CSV(UTF-8 / UTF-8 BOM / EUC-KR)
 * 기능:
 *   1. 양식 CSV 다운로드 (샘플 데이터 포함)
 *   2. 파일 파싱 (SheetJS — Excel/CSV 모두 처리)
 *   3. 미리보기: 등록 가능 / 오류 행 구분
 *   4. 전체 거부 방식 — 오류가 1개라도 있으면 전체 업로드 차단
 *   5. 서버 전체 유효성 검사 후 트랜잭션 INSERT
 *   6. 학부모 계정 자동 연결
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const MAX_UPLOAD = 1000; // 업로드 최대 인원

// ── 컬럼 헤더 별칭 매핑 (공백·대소문자 제거 후 비교) ───────────────
// 키: 공백·특수문자 제거 + 소문자 정규화 후 값
const COL_MAP_RAW: Array<[string[], string]> = [
  [["이름","name","성명","성함","회원명","학생명","회원이름","학생이름","자녀이름","자녀명",
    "이름보호가","이름보호자","이름(보호자)","이름(보호가)","학생이름(보호자)","자녀"],         "name"],
  [["출생년도","birth_year","생년","출생연도","태어난해","출생일","생년월일","birthyear"],         "birth_year"],
  [["보호자이름","parent_name","보호자","보호자성명","학부모","학부모이름","부모이름","부모","parentname"], "parent_name"],
  [["보호자전화번호","parent_phone","보호자연락처","전화번호","연락처","학부모전화","학부모연락처",
    "보호자휴대폰","휴대폰","휴대폰번호","핸드폰","핸드폰번호","전화","hp","phone","parentphone",
    "보호자전화","연락처(보호자)","보호자번호","보호자폰"],                                       "parent_phone"],
  [["주횟수","weekly_count","횟수","주수업횟수","수업횟수","weeklycount","주당횟수"],             "weekly_count"],
  [["메모","memo","비고","특이사항","참고","note","notes"],                                       "memo"],
];

// 정규화: 공백·특수문자 제거 + 소문자
function normHeader(h: string): string {
  return h.replace(/[\s\-_()（）·•,]/g, "").toLowerCase();
}

const COL_MAP: Record<string, string> = {};
for (const [aliases, field] of COL_MAP_RAW) {
  for (const alias of aliases) {
    COL_MAP[normHeader(alias)] = field;
  }
}

// ── 이름 셀에 전화번호가 섞인 경우 자동 분리 ─────────────────────
const PHONE_IN_TEXT_RE = /(?<![0-9])(0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4})(?![0-9])/;
function splitNamePhone(raw: string): { name: string; phone?: string } {
  const match = raw.match(PHONE_IN_TEXT_RE);
  if (!match) return { name: raw };
  const phone = match[1];
  const name = raw.replace(match[0], "").replace(/[\s,/|]+/g, " ").trim();
  return { name, phone };
}

interface ParsedRow {
  _idx: number;
  _row: number;  // Excel row number (header=1, data from 2)
  name: string;
  birth_year?: string;
  parent_name?: string;
  parent_phone?: string;
  parent_phone2?: string;
  parent_phone3?: string;
  weekly_count?: number;
  memo?: string;
  _rowError?: string;
  _rowWarn?: string;
  _isDuplicate?: boolean;
  _autoSkipped?: boolean;
}

interface BulkIssue {
  row: number;
  name: string;
  field: string;
  code: string;
  message: string;
}
interface ValidateResponse {
  total: number;
  valid: number;
  blocking_error_count: number;
  warning_count: number;
  errors: BulkIssue[];
  warnings: BulkIssue[];
  rows: Array<ParsedRow & { valid: boolean; class_group_id: string | null }>;
}
// legacy — unused after canonical API migration but kept for reference
interface UploadResult {
  success: boolean;
  inserted?: number;
  code?: string;
  message?: string;
}

// ── 전화번호 정규화 (+82 포함) ──────────────────────────────────
function normalizePhone(raw: string): string {
  // ="010..." 엑셀 수식 형식 제거
  const stripped = raw.replace(/^="?|"?$/g, "").replace(/^=/, "");
  let n = stripped.replace(/[^0-9]/g, "");
  // +82 → 0 (예: 821012345678 → 01012345678)
  if (n.startsWith("82") && n.length >= 11) n = "0" + n.slice(2);
  // 엑셀이 앞 0을 제거한 경우 복원: 10자리이고 10/11/16/17/18/19 시작이면 0 추가
  if (n.length === 10 && /^1[0-9]/.test(n)) n = "0" + n;
  return n;
}
function isValidPhone(phone: string): boolean {
  const n = normalizePhone(phone);
  return /^(010|011|016|017|018|019)\d{7,8}$/.test(n);
}
function formatPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (n.length === 11) return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return n;
}

// ── SheetJS 워크북 → ParsedRow[] (디버그 버전) ──────────────────
function parseWorkbookDebug(wb: XLSX.WorkBook): { rows: ParsedRow[]; debugInfo: string } {
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (raw.length < 2) {
    return { rows: [], debugInfo: `행 수: ${raw.length} (데이터 없음)` };
  }

  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const score = raw[i].filter((c: any) => COL_MAP[normHeader(String(c ?? ""))]).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }

  const firstRowSample = (raw[0] || []).slice(0, 4)
    .map((c: any) => `"${String(c ?? "").trim()}"`)
    .join(", ");
  if (bestScore === 0) {
    return {
      rows: [],
      debugInfo: `열 이름 미인식. 첫 행: [${firstRowSample}]\n→ 열 이름에 '이름', '보호자전화번호'(또는 '전화번호')가 있어야 합니다.`,
    };
  }

  const rows = parseRows(raw, headerIdx);
  return { rows, debugInfo: "ok" };
}

// ── SheetJS 워크북 → ParsedRow[] ───────────────────────────────
function parseWorkbook(wb: XLSX.WorkBook): ParsedRow[] {
  return parseWorkbookDebug(wb).rows;
}

function parseRows(raw: any[][], headerIdx: number): ParsedRow[] {
  const headers = (raw[headerIdx] as any[]).map(h => String(h ?? "").trim());
  const colKeys = headers.map(h => COL_MAP[normHeader(h)] ?? null);

  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const cells = raw[i] as any[];
    const obj: Record<string, string> = {};
    colKeys.forEach((key, ci) => {
      if (key && cells[ci] !== undefined && cells[ci] !== "") {
        const v = String(cells[ci]).trim();
        if (v) obj[key] = v;
      }
    });
    if (!Object.values(obj).some(Boolean)) continue; // 완전 빈 행
    const excelRow = i + 1; // Excel 행 번호 (header=1, 데이터는 2부터)

    // 이름 칸에 전화번호가 섞인 경우 자동 분리 (전화번호 열이 없을 때만)
    let rawName = obj.name ?? "";
    let rawPhone = obj.parent_phone ?? "";
    if (rawName && !rawPhone) {
      const split = splitNamePhone(rawName);
      if (split.phone) {
        rawName = split.name;
        rawPhone = split.phone;
      }
    }

    // 콤마 구분 전화번호 분배 (예: "01012341234,01056785678,01099990000")
    const phoneParts = rawPhone
      .split(",")
      .map((p: string) => normalizePhone(p.trim()))
      .filter((p: string) => p.length > 0);
    const normPhone  = phoneParts[0] || "";
    const normPhone2 = phoneParts[1] || undefined;
    const normPhone3 = phoneParts[2] || undefined;

    const byear = obj.birth_year?.replace(/[^0-9]/g, "") ?? "";

    const row: ParsedRow = {
      _idx: rows.length,
      _row: excelRow,
      name: rawName,
      birth_year: byear || undefined,
      parent_name: obj.parent_name || undefined,
      parent_phone: normPhone || undefined,
      parent_phone2: normPhone2,
      parent_phone3: normPhone3,
      weekly_count: obj.weekly_count ? Math.max(1, Math.min(7, Number(obj.weekly_count) || 1)) : undefined,
      memo: obj.memo || undefined,
    };

    // ── 오류 (업로드 차단) ──────────────────────────────────────
    const errors: string[] = [];
    if (!row.name) errors.push("이름 없음");
    if (!normPhone) {
      errors.push("전화번호 없음");
    } else if (!isValidPhone(normPhone)) {
      errors.push("전화번호 형식 오류");
    }

    // 경고 (업로드는 가능하나 확인 필요 — 출생년도만)
    const warns: string[] = [];
    if (byear) {
      const yr = Number(byear);
      if (isNaN(yr) || yr < 1990 || yr > 2025) warns.push("출생년도 확인 필요");
    }
    if (errors.length) row._rowError = errors.join(" · ");
    if (warns.length)  row._rowWarn  = warns.join(" · ");

    rows.push(row);
  }

  // 이름+전화번호 중복 → 첫 번째만 유지, 이후는 자동 제거
  const namePhoneSeen = new Set<string>();
  rows.forEach(r => {
    if (r.name && r.parent_phone) {
      const key = `${r.name.trim()}|${r.parent_phone}`;
      if (namePhoneSeen.has(key)) {
        r._autoSkipped = true;
      } else {
        namePhoneSeen.add(key);
      }
    }
  });
  // 이름만 중복(형제 가능) → 표시 없음

  return rows;
}

// ── 양식 CSV 생성 & 공유 ─────────────────────────────────────────
async function downloadTemplate() {
  const BOM = "\uFEFF";
  // 전화번호를 ="010..." 형식으로 감싸야 Excel이 앞자리 0을 유지함
  const lines = [
    "이름,보호자전화번호",
    `홍길동,="01012345678"`,
    `김수영,="01098765432"`,
    `이민준,="01033334444"`,
    `박서연,="01055556666"`,
    `최지우,="01066667777"`,
  ];
  const csv = BOM + lines.join("\n");

  if (Platform.OS === "web") {
    // 웹: 브라우저 다운로드
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "스윔노트_회원등록_양식.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      Alert.alert("안내", "브라우저에서 직접 다운로드를 지원하지 않습니다.\n앱에서 사용해주세요.");
    }
    return;
  }

  // 네이티브(iOS/Android): FileSystem + Sharing
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
  const path = baseDir + "스윔노트_회원등록_양식.csv";
  try {
    await FileSystem.writeAsStringAsync(path, csv);
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path, {
        mimeType: "text/csv",
        dialogTitle: "회원 등록 양식 저장",
        UTI: "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("양식 저장 완료", `파일이 저장됐습니다:\n${path}`);
    }
  } catch (e: any) {
    Alert.alert("오류", "양식 파일 생성에 실패했습니다.\n" + (e?.message ?? ""));
  } finally {
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {}); // temp cleanup
  }
}

// ────────────────────────────────────────────────────────────────
export default function BulkRegisterScreen() {
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<"pick" | "preview" | "validating" | "validated" | "committing" | "done">("pick");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showHowTo, setShowHowTo] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [capacity, setCapacity] = useState<{ limit: number; current: number; available: number } | null>(null);
  const [fileB64, setFileB64] = useState<string | null>(null); // R2 보관용 원본 파일 base64

  const errorRows   = rows.filter(r => !!r._rowError);
  const warnRows    = rows.filter(r => !r._rowError && !r._autoSkipped && !!r._rowWarn);
  const skippedRows = rows.filter(r => !!r._autoSkipped);
  const overLimit   = rows.length > MAX_UPLOAD;
  const overPlanLimit = capacity !== null && rows.filter(r => !r._rowError && !r._autoSkipped).length > capacity.available;
  const canValidate = rows.length > 0 && !overLimit;

  // ── 파일 선택 & 파싱 ────────────────────────────────────────
  const pickFile = useCallback(async () => {
    setParseError("");
    setLoadingFile(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv", "text/plain",
          "application/octet-stream", "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;

      const asset = res.assets[0];
      const uri   = asset.uri;
      const name  = asset.name ?? "파일";
      setFileName(name);

      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let wb: XLSX.WorkBook;

      if (Platform.OS === "web") {
        // 웹: 파일 바이트를 읽어 형식 자동 감지
        const nativeFile = (asset as any).file as File | undefined;
        const bytes: Uint8Array = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => {
            const ab = e.target?.result as ArrayBuffer;
            resolve(ab ? new Uint8Array(ab) : new Uint8Array(0));
          };
          reader.onerror = reject;
          if (nativeFile) {
            reader.readAsArrayBuffer(nativeFile);
          } else {
            fetch(uri).then(r => r.arrayBuffer()).then(ab => {
              reader.onload = null;
              resolve(new Uint8Array(ab));
            }).catch(reject);
          }
        });

        // PK magic bytes (50 4B) = ZIP = XLSX/XLS
        const isExcel = bytes[0] === 0x50 && bytes[1] === 0x4B;
        if (isExcel) {
          wb = XLSX.read(bytes, { type: "array" });
        } else {
          // CSV: UTF-8 먼저 시도, 헤더 미인식이면 EUC-KR 재시도
          const utfDecoder = new TextDecoder("utf-8");
          const utfText = utfDecoder.decode(bytes).replace(/^\uFEFF/, "");
          wb = XLSX.read(utfText, { type: "string" });
          if (parseWorkbookDebug(wb).rows.length === 0) {
            try {
              const euckrDecoder = new TextDecoder("euc-kr");
              const euckrText = euckrDecoder.decode(bytes);
              wb = XLSX.read(euckrText, { type: "string" });
            } catch { /* euc-kr 미지원 환경은 그냥 넘김 */ }
          }
        }
      } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        // 네이티브 Excel: base64로 읽어 SheetJS 파싱
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setFileB64(b64);
        wb = XLSX.read(b64, { type: "base64" });
      } else {
        // 네이티브 CSV: base64로 읽어 SheetJS 자동 감지 (UTF-8 BOM 처리)
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setFileB64(b64);
        wb = XLSX.read(b64, { type: "base64" });
        // 헤더 미인식이면 EUC-KR(codepage 949)로 재시도
        if (parseWorkbookDebug(wb).rows.length === 0) {
          wb = XLSX.read(b64, { type: "base64", codepage: 949 });
        }
      }

      const { rows: parsed, debugInfo } = parseWorkbookDebug(wb);
      if (!parsed.length) {
        setParseError(
          "파일에서 데이터를 읽을 수 없습니다.\n" +
          "열 이름(이름, 보호자전화번호)이 정확한지 확인해주세요.\n" +
          `[진단] ${debugInfo}`
        );
        return;
      }
      setRows(parsed);
      setStep("preview");
      // 플랜 회원 수 한도 조회
      try {
        const capRes = await apiRequest(token, "/students/capacity", { method: "GET" });
        if (capRes.ok) {
          const capData = await capRes.json();
          setCapacity(capData);
        }
      } catch { /* 한도 조회 실패 시 무시 */ }
    } catch (e: any) {
      const detail = e?.message ?? "";
      setParseError(
        "파일을 읽는 중 오류가 발생했습니다.\n지원 형식: xlsx, xls, csv\n" + detail
      );
      // 운영자 알림 (백그라운드, 실패 무시)
      apiRequest(token, "/admin/report-upload-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error_type: "parse", error_detail: detail }),
      }).catch(() => {});
    } finally {
      setLoadingFile(false);
    }
  }, [token]);

  // ── 서버 검증 ─────────────────────────────────────────────────
  const handleValidate = useCallback(async () => {
    if (!canValidate) return;
    setValidateResult(null);
    setStep("validating");
    setParseError("");
    try {
      const apiRes = await apiRequest(token, "/admin/members/bulk/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(r => ({
            _row:         r._row,
            name:         r.name,
            parent_phone: r.parent_phone  ?? null,
            parent_phone2:r.parent_phone2 ?? null,
            parent_phone3:r.parent_phone3 ?? null,
            birth_year:   r.birth_year    ?? null,
            parent_name:  r.parent_name   ?? null,
            weekly_count: r.weekly_count  ?? 1,
            memo:         r.memo          ?? null,
          })),
        }),
      });
      const data: ValidateResponse = await apiRes.json().catch(() => null);
      if (!apiRes.ok || !data) {
        const errData: any = data;
        setParseError(errData?.error ?? "서버 검증에 실패했습니다.");
        setStep("preview");
        return;
      }
      setValidateResult(data);
      setStep("validated");
    } catch {
      setParseError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setStep("preview");
    }
  }, [canValidate, rows, token]);

  // ── 최종 등록 ─────────────────────────────────────────────────
  const handleCommit = useCallback(async () => {
    if (!validateResult || validateResult.blocking_error_count > 0) return;
    const validRows = validateResult.rows.filter(r => r.valid);

    Alert.alert(
      "전체 등록 확인",
      `${validRows.length.toLocaleString()}명을 모두 등록하시겠습니까?\n수정이 필요한 행이 없으면 전원 등록됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "등록", onPress: async () => {
            setStep("committing");
            setParseError("");

            // ── 파일 R2 보관 (fire-and-forget) ──────────────────
            let fileId: string | null = null;
            if (fileB64 && fileName) {
              try {
                const uploadRes = await apiRequest(token, "/admin/upload-member-excel", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ filename: fileName, content_b64: fileB64 }),
                });
                if (uploadRes.ok) {
                  const d = await uploadRes.json().catch(() => ({}));
                  fileId = d.file_id ?? null;
                }
              } catch { /* 무시 */ }
            }

            try {
              const apiRes = await apiRequest(token, "/admin/members/bulk/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: validRows }),
              });
              const data = await apiRes.json().catch(() => ({ created: 0 }));

              if (fileId) {
                apiRequest(token, `/admin/member-files/${fileId}/status`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: apiRes.ok ? "success" : "failed", row_count: validRows.length }),
                }).catch(() => {});
              }

              if (!apiRes.ok) {
                const msg = data?.error ?? "등록 실패";
                setParseError(msg);
                setStep("validated");
              } else {
                setUploadResult({ success: true, inserted: data.created });
                setStep("done");
              }
            } catch {
              setParseError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
              setStep("validated");
            }
          },
        },
      ]
    );
  }, [validateResult, token, fileB64, fileName]);

  const resetAll = () => {
    setStep("pick");
    setRows([]);
    setFileName("");
    setParseError("");
    setUploadResult(null);
    setValidateResult(null);
    setCapacity(null);
    setFileB64(null);
  };

  // ══════════════════════════════════════════════════════════════
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="명단 한번에 올리기" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 16, paddingBottom: insets.bottom + 40, gap: 12,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ═══ STEP 1: 파일 선택 ════════════════════════════════ */}
        {step === "pick" && (
          <>
            {/* 사용 방법 (접기/펼치기) */}
            <Pressable
              style={[s.noticeCard, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}
              onPress={() => setShowHowTo(v => !v)}
            >
              <View style={[s.cardRow, { marginBottom: showHowTo ? 10 : 0 }]}>
                <LucideIcon name="info" size={15} color="#2563EB" />
                <Text style={[s.cardTitle, { flex: 1, color: "#1D4ED8" }]}>사용 방법</Text>
                {showHowTo
                  ? <LucideIcon name="chevron-up" size={15} color="#2563EB" />
                  : <LucideIcon name="chevron-down" size={15} color="#2563EB" />}
              </View>
              {showHowTo && (
                <>
                  <Text style={[s.howToLine, { color: "#1E3A8A" }]}>
                    기본 양식을 다운로드하고 이름과 보호자 연락처를 입력하세요.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A" }]}>
                    이름과 보호자 연락처만 필수이며, 학생 연락처·생년·보호자 이름·반 이름·메모는 선택사항입니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A", marginBottom: 8 }]}>
                    한 번에 최대 1,000명까지 등록할 수 있습니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A" }]}>
                    동명이인과 동일한 보호자 연락처를 사용하는 형제·자매도 등록할 수 있습니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A", marginBottom: 8 }]}>
                    기존 회원과 이름과 보호자 연락처가 같아도 중복 의심으로 안내만 하며 등록할 수 있습니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A", marginBottom: 8 }]}>
                    반 이름을 입력하지 않거나 등록된 반을 찾지 못하면 미배정 회원으로 등록됩니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A" }]}>
                    파일을 선택하면 등록 전에 전체 회원을 한 번에 검사합니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A" }]}>
                    수정이 필요한 항목이 있으면 엑셀 행 번호와 오류 이유를 모두 알려드립니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A", marginBottom: 8 }]}>
                    이 경우 파일을 수정해 다시 업로드하면 되며, 수정 전에는 아무 회원도 등록되지 않습니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E3A8A", marginBottom: 8 }]}>
                    중복 의심이나 반 미발견 같은 주의사항만 있는 경우에는 그대로 전체 등록할 수 있습니다.
                  </Text>
                  <Text style={[s.howToLine, { color: "#1E40AF", fontSize: 11 }]}>
                    기본 양식은 이름 / 보호자 연락처 2개 항목이며, 기존 7컬럼 파일도 그대로 업로드할 수 있습니다.
                  </Text>
                </>
              )}
            </Pressable>

            {/* 양식 다운로드 */}
            <View style={[s.card, {
              backgroundColor: themeColor + "10",
              borderWidth: 1, borderColor: themeColor + "30",
            }]}>
              <View style={s.cardRow}>
                <LucideIcon name="grid" size={22} color={themeColor} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: C.text }]}>
                    양식 파일을 먼저 다운로드하세요
                  </Text>
                  <Text style={[s.cardDesc, { color: C.textMuted }]}>
                    양식에 이름·보호자 연락처 입력 후 그대로 업로드하면 자동 등록됩니다.
                    엑셀에서 저장하거나 CSV 그대로 사용하세요.
                  </Text>
                </View>
              </View>
              <Pressable
                style={[s.downloadBtn, { backgroundColor: themeColor }]}
                onPress={downloadTemplate}
              >
                <LucideIcon name="download" size={15} color="#fff" />
                <Text style={s.downloadBtnTxt}>양식 다운로드 (.csv)</Text>
              </Pressable>
            </View>

            {/* 형식 안내 (접기/펼치기) */}
            <Pressable
              style={[s.card, { backgroundColor: C.card }]}
              onPress={() => setShowGuide(v => !v)}
            >
              <View style={[s.cardRow, { marginBottom: 0 }]}>
                <LucideIcon name="file-text" size={16} color={C.brandStrong} />
                <Text style={[s.cardTitle, { flex: 1, color: C.text }]}>
                  파일 형식 및 열 이름 안내
                </Text>
                {showGuide
                  ? <LucideIcon name="chevron-up" size={16} color={C.textMuted} />
                  : <LucideIcon name="chevron-down" size={16} color={C.textMuted} />}
              </View>

              {showGuide && (
                <>
                  {/* 지원 형식 뱃지 */}
                  <View style={[s.badgeRow, { marginTop: 12 }]}>
                    {[".xlsx", ".xls", ".csv"].map(f => (
                      <View key={f} style={[s.badge, { backgroundColor: C.brandMist }]}>
                        <Text style={[s.badgeTxt, { color: C.brandStrong }]}>{f}</Text>
                      </View>
                    ))}
                    <Text style={[s.badgeNote, { color: C.textMuted }]}>
                      UTF-8 / EUC-KR 모두 자동 처리
                    </Text>
                  </View>

                  {/* 열 안내 테이블 */}
                  <View style={[s.colTable, { borderColor: C.border, marginTop: 10 }]}>
                    {[
                      { col: "이름",         req: true,  ex: "홍길동" },
                      { col: "보호자 연락처", req: true,  ex: "01012345678" },
                      { col: "학생 연락처",  req: false, ex: "01011112222" },
                      { col: "생년",         req: false, ex: "2015" },
                      { col: "보호자 이름",  req: false, ex: "홍부모" },
                      { col: "반 이름",      req: false, ex: "월수금반" },
                      { col: "메모",         req: false, ex: "알레르기 있음" },
                    ].map((item, i, arr) => (
                      <View
                        key={item.col}
                        style={[
                          s.colRow,
                          i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                        ]}
                      >
                        <View style={s.colLeft}>
                          <Text style={[s.colName, { color: C.text }]}>{item.col}</Text>
                          {item.req
                            ? <View style={[s.reqBadge, { backgroundColor: "#FEE2E2" }]}>
                                <Text style={[s.reqTxt, { color: "#DC2626" }]}>필수</Text>
                              </View>
                            : <View style={[s.reqBadge, { backgroundColor: "#F3F4F6" }]}>
                                <Text style={[s.reqTxt, { color: "#6B7280" }]}>선택</Text>
                              </View>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.colEx, { color: C.text }]}>예: {item.ex}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  <Text style={[s.noteText, { color: C.textMuted, marginTop: 10 }]}>
                    • 전화번호: 010-1234-5678 또는 01012345678 모두 OK{"\n"}
                    • 빈 행은 자동으로 건너뜁니다{"\n"}
                    • 이름 + 전화번호가 일치하면 학부모 앱 가입 시 자동 승인됩니다
                  </Text>
                </>
              )}
            </Pressable>

            {/* 파싱 오류 메시지 */}
            {parseError ? (
              <View style={s.errorBox}>
                <LucideIcon name="alert-circle" size={15} color="#DC2626" />
                <Text style={s.errorTxt}>{parseError}</Text>
              </View>
            ) : null}

            {/* 파일 선택 버튼 */}
            <Pressable
              style={[s.uploadBtn, { backgroundColor: C.primaryAction, opacity: loadingFile ? 0.7 : 1 }]}
              onPress={pickFile}
              disabled={loadingFile}
            >
              {loadingFile
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <LucideIcon name="upload" size={18} color="#fff" />
                    <Text style={s.uploadBtnTxt}>파일 선택 (.xlsx / .xls / .csv)</Text>
                  </>
                )}
            </Pressable>
          </>
        )}

        {/* ═══ STEP 2: 미리보기 ════════════════════════════════ */}
        {step === "preview" && (
          <>
            {/* 파일명 + 다시선택 */}
            <View style={[s.card, s.cardRow, { backgroundColor: C.card }]}>
              <LucideIcon name="grid" size={16} color={C.brandStrong} />
              <Text style={[s.cardTitle, { flex: 1, color: C.text }]} numberOfLines={1}>
                {fileName}
              </Text>
              <Pressable onPress={resetAll} style={s.changeBtn}>
                <Text style={[s.changeBtnTxt, { color: C.brandStrong }]}>다시 선택</Text>
              </Pressable>
            </View>

            {/* 파일 인원 초과 */}
            {overLimit && (
              <View style={[s.alertBanner, { backgroundColor: "#FEE2E2" }]}>
                <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                <Text style={[s.alertTxt, { color: "#DC2626" }]}>
                  {rows.length.toLocaleString()}명 감지 — 최대 {MAX_UPLOAD.toLocaleString()}명까지 업로드 가능합니다. 파일을 나누어 업로드해주세요.
                </Text>
              </View>
            )}

            {/* 플랜 회원 수 한도 초과 */}
            {overPlanLimit && capacity && (
              <View style={[s.alertBanner, { backgroundColor: "#FEE2E2" }]}>
                <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                <Text style={[s.alertTxt, { color: "#DC2626" }]}>
                  플랜 한도 초과 — 현재 {capacity.current}명 / 최대 {capacity.limit}명{"\n"}
                  등록 가능 잔여: {capacity.available}명, 요청: {validRows.length}명{"\n"}
                  플랜을 변경하거나 기존 회원을 정리 후 다시 업로드해주세요.
                </Text>
              </View>
            )}

            {/* 요약 통계 */}
            <View style={[s.summaryRow, { backgroundColor: C.card }]}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryNum, { color: C.text }]}>{rows.length.toLocaleString()}</Text>
                <Text style={[s.summaryLabel, { color: C.textSecondary }]}>전체</Text>
              </View>
              {errorRows.length > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#DC2626" }]}>{errorRows.length}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>파일 오류</Text>
                </View>
              )}
              {skippedRows.length > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#6B7280" }]}>{skippedRows.length}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>중복 제거</Text>
                </View>
              )}
            </View>

            {/* 미리보기 테이블 */}
            <View style={[s.tableWrap, { backgroundColor: C.card }]}>
              <View style={[s.tableHeader, { borderBottomColor: C.border }]}>
                <Text style={[s.thTxt, { flex: 2, textAlign: "left", paddingLeft: 4 }]}>이름</Text>
                <Text style={[s.thTxt, { flex: 3 }]}>보호자 전화번호</Text>
              </View>

              {rows.map((row, i) => {
                const hasErr     = !!row._rowError;
                const isSkipped  = !!row._autoSkipped;
                const hasWarn    = !hasErr && !isSkipped && !!row._rowWarn;
                const bg = hasErr ? "#FEF2F2" : isSkipped ? "#F3F4F6" : hasWarn ? "#FFFBEB" : "transparent";

                return (
                  <View
                    key={row._idx}
                    style={[
                      s.tableRow,
                      i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                      { backgroundColor: bg },
                    ]}
                  >
                    <View style={{ flex: 2, justifyContent: "center", paddingLeft: 4 }}>
                      <Text
                        style={[s.tdTxt, {
                          color: hasErr ? "#DC2626" : isSkipped ? C.textMuted : C.text,
                          textAlign: "left",
                        }]}
                        numberOfLines={1}
                      >
                        {row.name || "(없음)"}
                      </Text>
                      {hasErr && (
                        <Text style={[s.tdSub, { color: "#DC2626" }]}>{row._rowError}</Text>
                      )}
                      {isSkipped && (
                        <Text style={[s.tdSub, { color: C.textMuted }]}>중복 자동 제거</Text>
                      )}
                      {!hasErr && !isSkipped && hasWarn && (
                        <Text style={[s.tdSub, { color: "#D97706" }]}>{row._rowWarn}</Text>
                      )}
                    </View>
                    <Text style={[s.tdTxt, { flex: 3, color: isSkipped ? C.textMuted : C.textSecondary }]} numberOfLines={1}>
                      {row.parent_phone ? formatPhone(row.parent_phone) : "-"}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* parseError 표시 */}
            {parseError ? (
              <View style={s.errorBox}>
                <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                <Text style={s.errorTxt}>{parseError}</Text>
              </View>
            ) : null}

            {/* 서버 검증 버튼 */}
            <Pressable
              style={[s.uploadBtn, { backgroundColor: canValidate ? themeColor : C.border }]}
              onPress={handleValidate}
              disabled={!canValidate}
            >
              <LucideIcon name="search" size={16} color="#fff" />
              <Text style={s.uploadBtnTxt}>
                {overLimit
                  ? `${MAX_UPLOAD.toLocaleString()}명 초과 — 파일 나누기 필요`
                  : `${rows.length.toLocaleString()}명 서버 검증`}
              </Text>
            </Pressable>
          </>
        )}

        {/* ═══ STEP 3: 검증 중 ═════════════════════════════════ */}
        {step === "validating" && (
          <View style={[s.card, { backgroundColor: C.card, alignItems: "center", paddingVertical: 40 }]}>
            <ActivityIndicator size="large" color={themeColor} />
            <Text style={[s.processingTitle, { color: C.text }]}>서버 검증 중...</Text>
            <Text style={[s.processingCount, { color: C.textSecondary }]}>
              전체 {rows.length.toLocaleString()}명 파일을 한 번에 검사합니다
            </Text>
          </View>
        )}

        {/* ═══ STEP 4: 검증 결과 ═══════════════════════════════ */}
        {step === "validated" && validateResult && (
          <>
            <View style={[s.card, s.cardRow, { backgroundColor: C.card }]}>
              <LucideIcon name="grid" size={16} color={C.brandStrong} />
              <Text style={[s.cardTitle, { flex: 1, color: C.text }]} numberOfLines={1}>{fileName}</Text>
              <Pressable onPress={resetAll} style={s.changeBtn}>
                <Text style={[s.changeBtnTxt, { color: C.brandStrong }]}>다시 선택</Text>
              </Pressable>
            </View>

            {/* 요약 */}
            <View style={[s.summaryRow, { backgroundColor: C.card }]}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryNum, { color: C.text }]}>{validateResult.total.toLocaleString()}</Text>
                <Text style={[s.summaryLabel, { color: C.textSecondary }]}>전체</Text>
              </View>
              <View style={[s.summaryItem, s.summaryDivider]}>
                <Text style={[s.summaryNum, { color: "#16A34A" }]}>{validateResult.valid.toLocaleString()}</Text>
                <Text style={[s.summaryLabel, { color: C.textSecondary }]}>등록 가능</Text>
              </View>
              {validateResult.blocking_error_count > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#DC2626" }]}>{validateResult.blocking_error_count}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>수정 필요</Text>
                </View>
              )}
              {validateResult.warning_count > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#D97706" }]}>{validateResult.warning_count}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>주의사항</Text>
                </View>
              )}
            </View>

            {/* blocking errors */}
            {validateResult.blocking_error_count > 0 && (
              <View style={[s.alertBanner, { backgroundColor: "#FEF2F2" }]}>
                <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.alertTxt, { color: "#991B1B", fontFamily: "Pretendard-Regular" }]}>
                    수정이 필요한 회원이 있어 아무 회원도 등록하지 않았습니다.{"\n"}파일을 수정한 뒤 다시 업로드해주세요.
                  </Text>
                  {validateResult.errors.slice(0, 10).map((e, i) => (
                    <Text key={i} style={{ fontSize: 11, color: "#DC2626", lineHeight: 17, marginTop: 2 }}>
                      {e.row}행 {e.name} — {e.message}
                    </Text>
                  ))}
                  {validateResult.errors.length > 10 && (
                    <Text style={{ fontSize: 11, color: "#9CA3AF" }}>… 외 {validateResult.errors.length - 10}건</Text>
                  )}
                </View>
              </View>
            )}

            {/* warnings */}
            {validateResult.warning_count > 0 && validateResult.blocking_error_count === 0 && (
              <View style={[s.alertBanner, { backgroundColor: "#FFFBEB" }]}>
                <LucideIcon name="alert-triangle" size={14} color="#D97706" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.alertTxt, { color: "#92400E" }]}>주의사항 {validateResult.warning_count}건 — 등록은 가능합니다.</Text>
                  {validateResult.warnings.slice(0, 5).map((w, i) => (
                    <Text key={i} style={{ fontSize: 11, color: "#D97706", lineHeight: 17, marginTop: 2 }}>
                      {w.row}행 {w.name}: {w.message}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {/* all valid */}
            {validateResult.blocking_error_count === 0 && (
              <View style={[s.alertBanner, { backgroundColor: "#F0FDF4" }]}>
                <LucideIcon name="check-circle" size={14} color="#16A34A" />
                <Text style={[s.alertTxt, { color: "#166534" }]}>
                  모든 행이 유효합니다. 아래 버튼을 눌러 {validateResult.valid.toLocaleString()}명을 전체 등록하세요.
                </Text>
              </View>
            )}

            {/* parseError */}
            {parseError ? (
              <View style={s.errorBox}>
                <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                <Text style={s.errorTxt}>{parseError}</Text>
              </View>
            ) : null}

            {/* 등록 버튼 */}
            <Pressable
              style={[s.uploadBtn, {
                backgroundColor: validateResult.blocking_error_count === 0 ? themeColor : C.border,
              }]}
              onPress={handleCommit}
              disabled={validateResult.blocking_error_count > 0}
            >
              <LucideIcon name="upload" size={16} color="#fff" />
              <Text style={s.uploadBtnTxt}>
                {validateResult.blocking_error_count > 0
                  ? "오류 수정 후 다시 업로드"
                  : `${validateResult.valid.toLocaleString()}명 전체 등록`}
              </Text>
            </Pressable>
          </>
        )}

        {/* ═══ STEP 5: 등록 중 ═════════════════════════════════ */}
        {step === "committing" && (
          <View style={[s.card, { backgroundColor: C.card, alignItems: "center", paddingVertical: 40 }]}>
            <ActivityIndicator size="large" color={themeColor} />
            <Text style={[s.processingTitle, { color: C.text }]}>등록 처리 중...</Text>
            <Text style={[s.processingCount, { color: C.textSecondary }]}>
              전원 등록 또는 전원 미등록 방식으로 처리합니다
            </Text>
          </View>
        )}

        {/* ═══ STEP 6: 완료 ════════════════════════════════════ */}
        {step === "done" && uploadResult && (
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <LucideIcon name="check-circle" size={64} color="#16A34A" />
            <Text style={[s.doneTitle, { color: C.text }]}>
              {(uploadResult.inserted ?? 0).toLocaleString()}명 등록 완료!
            </Text>
            <View style={[s.doneCard, { backgroundColor: C.card, width: "100%" }]}>
              <View style={s.doneRow}>
                <Text style={[s.doneLabel, { color: C.textSecondary }]}>등록 완료</Text>
                <Text style={[s.doneVal, { color: "#16A34A" }]}>{(uploadResult.inserted ?? 0).toLocaleString()}명</Text>
              </View>
            </View>
            <Pressable
              style={[s.uploadBtn, { backgroundColor: themeColor, width: "100%", marginTop: 8 }]}
              onPress={() => router.push("/(admin)/members?backTo=ops-hub" as any)}
            >
              <Text style={s.uploadBtnTxt}>회원 목록 확인하기</Text>
            </Pressable>
            <Pressable
              style={[s.outlineBtn, { borderColor: C.border, width: "100%", marginTop: 10 }]}
              onPress={resetAll}
            >
              <Text style={[s.outlineBtnTxt, { color: C.textSecondary }]}>추가 파일 올리기</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

    </View>
  );
}

const s = StyleSheet.create({
  noticeCard:     { borderRadius: 16, padding: 14, borderWidth: 1, marginBottom: 12 },
  noticeLine:     { fontSize: 12, lineHeight: 20, marginLeft: 4 },
  card:           { borderRadius: 16, padding: 14 },
  cardRow:        { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  cardTitle:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cardDesc:       { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2, lineHeight: 17 },
  downloadBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center",
                    gap: 6, paddingVertical: 10, borderRadius: 10, marginTop: 10 },
  downloadBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  badgeRow:       { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  badgeNote:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  colTable:       { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  colRow:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 9 },
  colLeft:        { flexDirection: "row", alignItems: "center", gap: 5, width: 130 },
  colName:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  colEx:          { fontSize: 12, fontFamily: "Pretendard-Regular" },
  colAlt:         { fontSize: 10, fontFamily: "Pretendard-Regular", marginTop: 1 },
  reqBadge:       { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  reqTxt:         { fontSize: 10, fontFamily: "Pretendard-Regular" },
  noteText:       { fontSize: 11, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  howToLine:      { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 20, marginBottom: 2 },
  errorBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    padding: 12, borderRadius: 10, backgroundColor: "#FEE2E2" },
  errorTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular",
                    color: "#DC2626", lineHeight: 18 },
  uploadBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: 15, borderRadius: 13 },
  uploadBtnTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  changeBtn:      { paddingHorizontal: 8, paddingVertical: 4 },
  changeBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  summaryRow:     { flexDirection: "row", borderRadius: 14, overflow: "hidden" },
  summaryItem:    { flex: 1, alignItems: "center", paddingVertical: 14 },
  summaryDivider: { borderLeftWidth: 1, borderLeftColor: Colors.light.border },
  summaryNum:     { fontSize: 26, fontFamily: "Pretendard-Regular" },
  summaryLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  alertBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 6,
                    padding: 10, borderRadius: 10 },
  alertTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  tableWrap:      { borderRadius: 14, overflow: "hidden" },
  tableHeader:    { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 8,
                    borderBottomWidth: 1 },
  thTxt:          { fontSize: 11, fontFamily: "Pretendard-Regular",
                    color: Colors.light.textMuted, textAlign: "center" },
  tableRow:       { flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 8, paddingVertical: 8 },
  tdTxt:          { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },
  tdSub:          { fontSize: 10, fontFamily: "Pretendard-Regular", marginTop: 1 },
  processingTitle:{ fontSize: 18, fontFamily: "Pretendard-Regular", marginTop: 16 },
  processingCount:{ fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 6 },
  doneTitle:      { fontSize: 22, fontFamily: "Pretendard-Regular", marginTop: 16, marginBottom: 20 },
  doneCard:       { borderRadius: 14, padding: 4, marginBottom: 14 },
  doneRow:        { flexDirection: "row", alignItems: "center",
                    justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  doneLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  doneVal:        { fontSize: 18, fontFamily: "Pretendard-Regular" },
  failList:       { borderRadius: 12, padding: 12, marginBottom: 14,
                    backgroundColor: "#FEF2F2" },
  failListTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular",
                    color: "#DC2626", marginBottom: 8 },
  failItem:       { flexDirection: "row", justifyContent: "space-between",
                    alignItems: "center", paddingVertical: 4 },
  failName:       { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  failReason:     { fontSize: 11, fontFamily: "Pretendard-Regular", maxWidth: "50%" },
  outlineBtn:     { alignItems: "center", padding: 14, borderRadius: 13,
                    borderWidth: 1, marginTop: 10 },
  outlineBtnTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
