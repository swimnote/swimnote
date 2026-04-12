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
import {
  AlertCircle, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Download,
  FileSpreadsheet, FileText, Upload,
} from "lucide-react-native";
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
const MAX_UPLOAD = 100; // 업로드 최대 인원

// ── 컬럼 헤더 별칭 매핑 (최대한 관대하게) ─────────────────────────
const COL_MAP: Record<string, string> = {
  "이름": "name",           "name": "name",           "성명": "name",
  "성함": "name",           "회원명": "name",         "학생명": "name",
  "회원이름": "name",       "학생이름": "name",       "자녀이름": "name",
  "출생년도": "birth_year", "birth_year": "birth_year", "생년": "birth_year",
  "출생연도": "birth_year", "태어난해": "birth_year", "출생일": "birth_year",
  "보호자이름": "parent_name", "parent_name": "parent_name", "보호자": "parent_name",
  "보호자성명": "parent_name", "학부모": "parent_name", "학부모이름": "parent_name",
  "부모이름": "parent_name", "부모": "parent_name",
  "보호자전화번호": "parent_phone", "parent_phone": "parent_phone",
  "보호자연락처": "parent_phone", "전화번호": "parent_phone",
  "연락처": "parent_phone", "학부모전화": "parent_phone",
  "학부모연락처": "parent_phone", "보호자휴대폰": "parent_phone",
  "휴대폰": "parent_phone", "휴대폰번호": "parent_phone",
  "핸드폰": "parent_phone", "핸드폰번호": "parent_phone",
  "전화": "parent_phone",   "hp": "parent_phone",     "phone": "parent_phone",
  "보호자 전화번호": "parent_phone", "보호자 연락처": "parent_phone",
  "주횟수": "weekly_count", "weekly_count": "weekly_count",
  "횟수": "weekly_count",  "주수업횟수": "weekly_count", "수업횟수": "weekly_count",
  "메모": "memo",           "memo": "memo",
  "비고": "memo",           "특이사항": "memo",        "참고": "memo",
};

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
  name: string;
  birth_year?: string;
  parent_name?: string;
  parent_phone?: string;
  weekly_count?: number;
  memo?: string;
  _rowError?: string;
  _rowWarn?: string;
  _isDuplicate?: boolean;
}

interface ServerErrors {
  missing_name?:       number[];
  missing_phone?:      number[];
  invalid_phone?:      number[];
  duplicate_phone?:    Array<{ phone: string; rows: number[] }>;
  db_duplicate_phone?: Array<{ phone: string; rows: number[] }>;
  member_limit?:       { available: number; limit: number; current: number; requested: number };
}
interface UploadResult {
  success: boolean;
  inserted?: number;
  code?: string;
  message?: string;
  errors?: ServerErrors;
}

// ── 전화번호 정규화 ──────────────────────────────────────────────
function normalizePhone(raw: string): string {
  // ="010..." 엑셀 수식 형식 제거
  const stripped = raw.replace(/^="?|"?$/g, "").replace(/^=/, "");
  let n = stripped.replace(/[^0-9]/g, "");
  // 엑셀이 앞 0을 제거한 경우 복원: 10자리이고 10/11/16/17/18/19 시작이면 0 추가
  if (n.length === 10 && /^1[0-9]/.test(n)) {
    n = "0" + n;
  }
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
  for (let i = 0; i < Math.min(6, raw.length); i++) {
    const score = raw[i].filter((c: any) => COL_MAP[String(c ?? "").trim()]).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }

  const firstRowSample = (raw[0] || []).slice(0, 3).map((c: any) => JSON.stringify(String(c ?? ""))).join(", ");
  if (bestScore === 0) {
    return {
      rows: [],
      debugInfo: `헤더 미인식. 총 ${raw.length}행. 첫 행: [${firstRowSample}]`,
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
  const colKeys = headers.map(h => COL_MAP[h] ?? null);

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
    const normPhone = rawPhone ? normalizePhone(rawPhone) : "";
    const byear = obj.birth_year?.replace(/[^0-9]/g, "") ?? "";

    const row: ParsedRow = {
      _idx: rows.length,
      name: rawName,
      birth_year: byear || undefined,
      parent_name: obj.parent_name || undefined,
      parent_phone: normPhone || undefined,
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

  // 파일 내 전화번호 중복 → 오류 처리
  const phoneCnt: Record<string, number> = {};
  rows.forEach(r => {
    if (r.parent_phone) phoneCnt[r.parent_phone] = (phoneCnt[r.parent_phone] ?? 0) + 1;
  });
  rows.forEach(r => {
    if (r.parent_phone && phoneCnt[r.parent_phone] > 1) {
      const dupMsg = "파일 내 전화번호 중복";
      r._rowError = r._rowError ? `${r._rowError} · ${dupMsg}` : dupMsg;
      r._isDuplicate = true;
    }
  });

  // 파일 내 이름 중복 표시 (오류는 아님, 시각적 구분만)
  const nameCnt: Record<string, number> = {};
  rows.forEach(r => { if (r.name) nameCnt[r.name] = (nameCnt[r.name] ?? 0) + 1; });
  rows.forEach(r => { if (r.name && nameCnt[r.name] > 1 && !r._isDuplicate) r._isDuplicate = true; });

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
  try {
    const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
    const path = baseDir + "스윔노트_회원등록_양식.csv";
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
  }
}

// ────────────────────────────────────────────────────────────────
export default function BulkRegisterScreen() {
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<"pick" | "preview" | "processing" | "done">("pick");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const validRows = rows.filter(r => !r._rowError);
  const errorRows = rows.filter(r => !!r._rowError);
  const warnRows  = rows.filter(r => !r._rowError && !!r._rowWarn);
  const overLimit = rows.length > MAX_UPLOAD;
  const canUpload = rows.length > 0 && errorRows.length === 0 && !overLimit;

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
        // UTF-8 BOM (EF BB BF) 또는 일반 텍스트 = CSV
        if (isExcel) {
          wb = XLSX.read(bytes, { type: "array" });
        } else {
          // 텍스트 파일: UTF-8 디코딩
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(bytes).replace(/^\uFEFF/, "");
          wb = XLSX.read(text, { type: "string" });
        }
      } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        // 네이티브 Excel: base64로 읽어 SheetJS 파싱
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        wb = XLSX.read(b64, { type: "base64" });
      } else {
        // 네이티브 CSV: UTF-8 먼저, 실패 시 base64로 SheetJS 처리
        try {
          const text = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          wb = XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string" });
        } catch {
          const b64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          wb = XLSX.read(b64, { type: "base64" });
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
    } catch (e: any) {
      setParseError(
        "파일을 읽는 중 오류가 발생했습니다.\n지원 형식: xlsx, xls, csv\n" +
        (e?.message ?? "")
      );
    } finally {
      setLoadingFile(false);
    }
  }, []);

  // ── 등록 실행 (전체 한 번에 전송, 전체 거부 방식) ──────────────
  const handleSubmit = useCallback(async () => {
    if (!canUpload) {
      if (overLimit) {
        Alert.alert(
          "인원 초과",
          `엑셀 업로드는 최대 ${MAX_UPLOAD}명까지 가능합니다.\n${MAX_UPLOAD}명을 초과할 경우 파일을 나누어 업로드해주세요.`
        );
      } else {
        Alert.alert("오류 수정 필요", "빨간색 오류 항목을 모두 수정한 후 다시 업로드해주세요.");
      }
      return;
    }

    setUploadResult(null);
    setStep("processing");

    try {
      const apiRes = await apiRequest(token, "/students/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRows.map(r => ({
          name:         r.name,
          birth_year:   r.birth_year   ?? null,
          parent_name:  r.parent_name  ?? null,
          parent_phone: r.parent_phone ?? null,
          weekly_count: r.weekly_count ?? 1,
          memo:         r.memo         ?? null,
        }))),
      });

      const data: UploadResult = await apiRes.json().catch(() => ({
        success: false, message: "서버 응답을 파싱할 수 없습니다.",
      }));
      setUploadResult(data);
      setStep("done");
    } catch (e: any) {
      setUploadResult({ success: false, message: "네트워크 오류가 발생했습니다." });
      setStep("done");
    }
  }, [canUpload, overLimit, validRows, token]);

  const resetAll = () => {
    setStep("pick");
    setRows([]);
    setFileName("");
    setParseError("");
    setUploadResult(null);
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
            {/* 업로드 전 필수 안내 */}
            <View style={[s.noticeCard, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B30" }]}>
              <View style={[s.cardRow, { marginBottom: 6 }]}>
                <AlertTriangle size={15} color="#D97706" />
                <Text style={[s.cardTitle, { color: "#92400E" }]}>엑셀 업로드 전 반드시 확인하세요</Text>
              </View>
              {[
                "한 학생당 전화번호는 1개만 입력 가능합니다",
                "동일한 전화번호를 여러 학생에 입력할 수 없습니다",
                "이름, 전화번호는 필수 입력입니다",
                `${MAX_UPLOAD}명 초과 시 업로드가 불가능합니다`,
                "오류가 1개라도 있으면 전체 업로드가 실패합니다",
              ].map((txt, i) => (
                <Text key={i} style={[s.noticeLine, { color: "#92400E" }]}>• {txt}</Text>
              ))}
            </View>

            {/* 양식 다운로드 */}
            <View style={[s.card, {
              backgroundColor: themeColor + "10",
              borderWidth: 1, borderColor: themeColor + "30",
            }]}>
              <View style={s.cardRow}>
                <FileSpreadsheet size={22} color={themeColor} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: C.text }]}>
                    양식 파일을 먼저 다운로드하세요
                  </Text>
                  <Text style={[s.cardDesc, { color: C.textMuted }]}>
                    양식에 이름·연락처 입력 후 그대로 업로드하면 자동 등록됩니다.
                    엑셀에서 저장하거나 CSV 그대로 사용하세요.
                  </Text>
                </View>
              </View>
              <Pressable
                style={[s.downloadBtn, { backgroundColor: themeColor }]}
                onPress={downloadTemplate}
              >
                <Download size={15} color="#fff" />
                <Text style={s.downloadBtnTxt}>양식 다운로드 (.csv)</Text>
              </Pressable>
            </View>

            {/* 형식 안내 (접기/펼치기) */}
            <Pressable
              style={[s.card, { backgroundColor: C.card }]}
              onPress={() => setShowGuide(v => !v)}
            >
              <View style={[s.cardRow, { marginBottom: 0 }]}>
                <FileText size={16} color={C.tint} />
                <Text style={[s.cardTitle, { flex: 1, color: C.text }]}>
                  파일 형식 및 열 이름 안내
                </Text>
                {showGuide
                  ? <ChevronUp size={16} color={C.textMuted} />
                  : <ChevronDown size={16} color={C.textMuted} />}
              </View>

              {showGuide && (
                <>
                  {/* 지원 형식 뱃지 */}
                  <View style={[s.badgeRow, { marginTop: 12 }]}>
                    {[".xlsx", ".xls", ".csv"].map(f => (
                      <View key={f} style={[s.badge, { backgroundColor: C.tint + "15" }]}>
                        <Text style={[s.badgeTxt, { color: C.tint }]}>{f}</Text>
                      </View>
                    ))}
                    <Text style={[s.badgeNote, { color: C.textMuted }]}>
                      UTF-8 / EUC-KR 모두 자동 처리
                    </Text>
                  </View>

                  {/* 열 안내 테이블 */}
                  <View style={[s.colTable, { borderColor: C.border, marginTop: 10 }]}>
                    {[
                      { col: "이름",          req: true,  alt: "성명",                   ex: "홍길동" },
                      { col: "보호자전화번호", req: true,  alt: "전화번호, 보호자연락처", ex: "01012345678" },
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
                          <View style={[s.reqBadge, { backgroundColor: "#FEE2E2" }]}>
                            <Text style={[s.reqTxt, { color: "#DC2626" }]}>필수</Text>
                          </View>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.colEx, { color: C.text }]}>예: {item.ex}</Text>
                          <Text style={[s.colAlt, { color: C.textMuted }]}>또는: {item.alt}</Text>
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
                <AlertCircle size={15} color="#DC2626" />
                <Text style={s.errorTxt}>{parseError}</Text>
              </View>
            ) : null}

            {/* 파일 선택 버튼 */}
            <Pressable
              style={[s.uploadBtn, { backgroundColor: C.tint, opacity: loadingFile ? 0.7 : 1 }]}
              onPress={pickFile}
              disabled={loadingFile}
            >
              {loadingFile
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <Upload size={18} color="#fff" />
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
              <FileSpreadsheet size={16} color={C.tint} />
              <Text style={[s.cardTitle, { flex: 1, color: C.text }]} numberOfLines={1}>
                {fileName}
              </Text>
              <Pressable onPress={resetAll} style={s.changeBtn}>
                <Text style={[s.changeBtnTxt, { color: C.tint }]}>다시 선택</Text>
              </Pressable>
            </View>

            {/* 100명 초과 오류 */}
            {overLimit && (
              <View style={[s.alertBanner, { backgroundColor: "#FEE2E2" }]}>
                <AlertCircle size={14} color="#DC2626" />
                <Text style={[s.alertTxt, { color: "#DC2626" }]}>
                  {rows.length}명 감지 — 최대 {MAX_UPLOAD}명까지 업로드 가능합니다. 파일을 나누어 업로드해주세요.
                </Text>
              </View>
            )}

            {/* 요약 통계 */}
            <View style={[s.summaryRow, { backgroundColor: C.card }]}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryNum, { color: "#16A34A" }]}>{validRows.length}</Text>
                <Text style={[s.summaryLabel, { color: C.textSecondary }]}>등록 가능</Text>
              </View>
              {warnRows.length > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#D97706" }]}>{warnRows.length}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>확인 필요</Text>
                </View>
              )}
              {errorRows.length > 0 && (
                <View style={[s.summaryItem, s.summaryDivider]}>
                  <Text style={[s.summaryNum, { color: "#DC2626" }]}>{errorRows.length}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>오류</Text>
                </View>
              )}
            </View>

            {/* 오류 존재 시 전체 차단 배너 */}
            {errorRows.length > 0 && !overLimit && (
              <View style={[s.alertBanner, { backgroundColor: "#FEE2E2" }]}>
                <AlertCircle size={14} color="#DC2626" />
                <Text style={[s.alertTxt, { color: "#DC2626" }]}>
                  오류 {errorRows.length}건이 있습니다. 빨간 항목을 수정 후 다시 업로드해주세요.{"\n"}오류가 1개라도 있으면 전체 업로드가 실패합니다.
                </Text>
              </View>
            )}

            {/* 출생년도 경고 */}
            {warnRows.length > 0 && (
              <View style={[s.alertBanner, { backgroundColor: "#FFFBEB" }]}>
                <AlertTriangle size={14} color="#D97706" />
                <Text style={[s.alertTxt, { color: "#D97706" }]}>
                  출생년도 확인이 필요한 항목 {warnRows.length}명 (등록은 가능)
                </Text>
              </View>
            )}

            {/* 미리보기 테이블 */}
            <View style={[s.tableWrap, { backgroundColor: C.card }]}>
              <View style={[s.tableHeader, { borderBottomColor: C.border }]}>
                <Text style={[s.thTxt, { flex: 2, textAlign: "left", paddingLeft: 4 }]}>이름</Text>
                <Text style={[s.thTxt, { flex: 3 }]}>보호자 전화번호</Text>
              </View>

              {rows.map((row, i) => {
                const hasErr  = !!row._rowError;
                const hasWarn = !hasErr && !!row._rowWarn;
                const bg = hasErr ? "#FEF2F2" : hasWarn ? "#FFFBEB" : "transparent";

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
                          color: hasErr ? "#DC2626" : C.text,
                          textAlign: "left",
                        }]}
                        numberOfLines={1}
                      >
                        {row.name || "(없음)"}
                      </Text>
                      {hasErr && (
                        <Text style={[s.tdSub, { color: "#DC2626" }]}>{row._rowError}</Text>
                      )}
                      {!hasErr && hasWarn && (
                        <Text style={[s.tdSub, { color: "#D97706" }]}>{row._rowWarn}</Text>
                      )}
                    </View>
                    <Text style={[s.tdTxt, { flex: 3, color: C.textSecondary }]} numberOfLines={1}>
                      {row.parent_phone ? formatPhone(row.parent_phone) : "-"}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* 등록 버튼 */}
            <Pressable
              style={[
                s.uploadBtn,
                { backgroundColor: canUpload ? themeColor : C.border },
              ]}
              onPress={handleSubmit}
              disabled={!canUpload}
            >
              <Upload size={16} color="#fff" />
              <Text style={s.uploadBtnTxt}>
                {canUpload ? `${validRows.length}명 일괄 등록하기` : "오류 수정 후 업로드 가능"}
              </Text>
            </Pressable>
          </>
        )}

        {/* ═══ STEP 3: 처리 중 ═════════════════════════════════ */}
        {step === "processing" && (
          <View style={[s.card, {
            backgroundColor: C.card, alignItems: "center", paddingVertical: 40,
          }]}>
            <ActivityIndicator size="large" color={themeColor} />
            <Text style={[s.processingTitle, { color: C.text }]}>등록 처리 중...</Text>
            <Text style={[s.processingCount, { color: C.textSecondary }]}>
              서버에서 전체 유효성 검사 후 일괄 등록합니다
            </Text>
          </View>
        )}

        {/* ═══ STEP 4: 완료 ════════════════════════════════════ */}
        {step === "done" && uploadResult && (
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            {uploadResult.success
              ? <CheckCircle2 size={64} color="#16A34A" />
              : <AlertCircle size={64} color="#DC2626" />}

            <Text style={[s.doneTitle, { color: C.text }]}>
              {uploadResult.success
                ? `${uploadResult.inserted ?? 0}명 등록 완료!`
                : "업로드 실패"}
            </Text>

            {/* 성공 결과 카드 */}
            {uploadResult.success && (
              <View style={[s.doneCard, { backgroundColor: C.card, width: "100%" }]}>
                <View style={s.doneRow}>
                  <Text style={[s.doneLabel, { color: C.textSecondary }]}>등록 완료</Text>
                  <Text style={[s.doneVal, { color: "#16A34A" }]}>{uploadResult.inserted}명</Text>
                </View>
              </View>
            )}

            {/* 실패: 서버 오류 상세 */}
            {!uploadResult.success && (
              <View style={[s.failList, { width: "100%", backgroundColor: "#FEF2F2" }]}>
                <Text style={s.failListTitle}>
                  {uploadResult.message ?? "업로드에 실패했습니다. 아래 오류를 확인하세요."}
                </Text>

                {uploadResult.errors?.missing_name && (
                  <Text style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    이름 없음 — {uploadResult.errors.missing_name.length}건 (행: {uploadResult.errors.missing_name.join(", ")})
                  </Text>
                )}
                {uploadResult.errors?.missing_phone && (
                  <Text style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    전화번호 없음 — {uploadResult.errors.missing_phone.length}건 (행: {uploadResult.errors.missing_phone.join(", ")})
                  </Text>
                )}
                {uploadResult.errors?.invalid_phone && (
                  <Text style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    전화번호 형식 오류 — {uploadResult.errors.invalid_phone.length}건 (행: {uploadResult.errors.invalid_phone.join(", ")})
                  </Text>
                )}
                {uploadResult.errors?.duplicate_phone?.map((d, i) => (
                  <Text key={i} style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    파일 내 전화번호 중복: {formatPhone(d.phone)} (행: {d.rows.join(", ")})
                  </Text>
                ))}
                {uploadResult.errors?.db_duplicate_phone?.map((d, i) => (
                  <Text key={i} style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    이미 등록된 전화번호: {formatPhone(d.phone)} (행: {d.rows.join(", ")})
                  </Text>
                ))}
                {uploadResult.errors?.member_limit && (
                  <Text style={[s.failReason, { color: "#DC2626", marginBottom: 4 }]}>
                    회원 수 한도 초과 — 현재 {uploadResult.errors.member_limit.current}명 / 최대 {uploadResult.errors.member_limit.limit}명
                    (등록 요청 {uploadResult.errors.member_limit.requested}명, 가능 {uploadResult.errors.member_limit.available}명)
                  </Text>
                )}
                {!uploadResult.errors && uploadResult.message && (
                  <Text style={[s.failReason, { color: "#DC2626" }]}>{uploadResult.message}</Text>
                )}
              </View>
            )}

            {uploadResult.success ? (
              <Pressable
                style={[s.uploadBtn, { backgroundColor: themeColor, width: "100%", marginTop: 8 }]}
                onPress={() => router.push("/(admin)/members?backTo=ops-hub" as any)}
              >
                <Text style={s.uploadBtnTxt}>회원 목록 확인하기</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[s.outlineBtn, { borderColor: C.border, width: "100%", marginTop: uploadResult.success ? 10 : 8 }]}
              onPress={resetAll}
            >
              <Text style={[s.outlineBtnTxt, { color: C.textSecondary }]}>
                {uploadResult.success ? "추가 파일 올리기" : "파일 수정 후 다시 업로드"}
              </Text>
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
