/**
 * bulk-register — CSV 파일로 회원 일괄 등록
 * 지원 형식: CSV (쉼표/세미콜론/탭 구분)
 * 엑셀에서 "CSV (UTF-8)" 로 저장 후 업로드
 */
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, FileText, Upload, X } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

// ── 컬럼 헤더 별칭 매핑 ─────────────────────────────────────────
const COL_MAP: Record<string, string> = {
  "이름": "name",         "name": "name",
  "출생년도": "birth_year", "birth_year": "birth_year", "생년": "birth_year", "출생연도": "birth_year",
  "보호자이름": "parent_name", "parent_name": "parent_name", "보호자": "parent_name",
  "보호자전화번호": "parent_phone", "parent_phone": "parent_phone",
  "보호자연락처": "parent_phone", "전화번호": "parent_phone", "연락처": "parent_phone",
  "주횟수": "weekly_count", "weekly_count": "weekly_count", "횟수": "weekly_count",
  "메모": "memo",          "memo": "memo",
};

interface ParsedRow {
  name: string;
  birth_year?: string;
  parent_name?: string;
  parent_phone?: string;
  weekly_count?: number;
  memo?: string;
  _rowError?: string;
}

// ── CSV 파서 ────────────────────────────────────────────────────
function parseCsv(text: string): ParsedRow[] {
  // BOM 제거
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // 구분자 감지 (첫 줄 기준)
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === delim && !inQ) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map(h => h.replace(/"/g, "").trim());
  const colKeys = headers.map(h => COL_MAP[h] ?? null);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const obj: any = {};
    colKeys.forEach((key, ci) => {
      if (key && cells[ci] !== undefined) {
        const val = cells[ci].replace(/"/g, "").trim();
        if (val) obj[key] = val;
      }
    });
    if (!obj.name && !Object.keys(obj).length) continue; // 빈 줄 무시
    const row: ParsedRow = {
      name: obj.name ?? "",
      birth_year: obj.birth_year ?? undefined,
      parent_name: obj.parent_name ?? undefined,
      parent_phone: obj.parent_phone ?? undefined,
      weekly_count: obj.weekly_count ? Number(obj.weekly_count) : undefined,
      memo: obj.memo ?? undefined,
    };
    if (!row.name) row._rowError = "이름 없음";
    rows.push(row);
  }
  return rows;
}

// ── 결과 타입 ───────────────────────────────────────────────────
interface BatchResult {
  succeeded: number;
  failed: Array<{ name: string; reason: string }>;
}

// ────────────────────────────────────────────────────────────────
export default function BulkRegisterScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [step, setStep]         = useState<"pick" | "preview" | "done">("pick");
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<BatchResult | null>(null);
  const [showTemplate, setShowTemplate] = useState(true);

  // ── 파일 선택 ─────────────────────────────────────────────────
  async function pickFile() {
    setParseError("");
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/plain", "application/vnd.ms-excel",
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;

      const asset = res.assets[0];
      const uri   = asset.uri;
      const name  = asset.name ?? "file";
      setFileName(name);

      const content = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const parsed = parseCsv(content);
      if (!parsed.length) {
        setParseError("파일에서 데이터를 찾을 수 없습니다. CSV 형식과 헤더를 확인해주세요.");
        return;
      }
      setRows(parsed);
      setStep("preview");
    } catch (e: any) {
      setParseError("파일을 읽는 중 오류가 발생했습니다: " + (e?.message ?? ""));
    }
  }

  // ── 배치 등록 요청 ─────────────────────────────────────────────
  async function handleSubmit() {
    const validRows = rows.filter(r => !r._rowError && r.name.trim());
    if (!validRows.length) {
      Alert.alert("오류", "등록할 수 있는 유효한 회원이 없습니다.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("/api/students/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRows),
      }, token ?? "");

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Alert.alert("등록 실패", body?.error ?? "서버 오류가 발생했습니다.");
        return;
      }
      const data: BatchResult = await res.json();
      setResult(data);
      setStep("done");
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const validCount   = rows.filter(r => !r._rowError && r.name.trim()).length;
  const invalidCount = rows.filter(r => !!r._rowError).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="명단 한번에 올리기" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── STEP: 파일 선택 ───────────────────────────────────── */}
        {step === "pick" && (
          <>
            {/* 템플릿 안내 */}
            <Pressable
              style={[s.templateBox, { backgroundColor: C.card }]}
              onPress={() => setShowTemplate(v => !v)}
            >
              <View style={s.templateHeader}>
                <FileText size={16} color={C.tint} />
                <Text style={[s.templateTitle, { color: C.text }]}>CSV 파일 형식 안내</Text>
                {showTemplate
                  ? <ChevronUp size={16} color={C.textMuted} />
                  : <ChevronDown size={16} color={C.textMuted} />}
              </View>
              {showTemplate && (
                <>
                  <Text style={[s.templateDesc, { color: C.textSecondary }]}>
                    엑셀(Excel)에서 파일을 작성한 후 {"\n"}
                    <Text style={{ fontWeight: "bold" }}>다른 이름으로 저장 → CSV (UTF-8)</Text>
                    {"\n"}로 저장해서 업로드해주세요.
                  </Text>
                  <View style={[s.colTable, { borderColor: C.border }]}>
                    {[
                      { col: "이름",          req: true,  ex: "홍길동" },
                      { col: "출생년도",       req: false, ex: "2015" },
                      { col: "보호자이름",     req: false, ex: "홍부모" },
                      { col: "보호자전화번호", req: false, ex: "01012345678" },
                      { col: "주횟수",         req: false, ex: "3" },
                      { col: "메모",           req: false, ex: "특이사항" },
                    ].map((item, i, arr) => (
                      <View
                        key={item.col}
                        style={[
                          s.colRow,
                          i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                        ]}
                      >
                        <View style={s.colNameWrap}>
                          <Text style={[s.colName, { color: C.text }]}>{item.col}</Text>
                          {item.req && (
                            <View style={s.reqBadge}>
                              <Text style={s.reqTxt}>필수</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[s.colEx, { color: C.textMuted }]}>예: {item.ex}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[s.templateNote, { color: C.textMuted }]}>
                    * 첫 번째 행은 반드시 위 열 이름을 그대로 사용해주세요.{"\n"}
                    * 이름이 없는 행은 자동으로 건너뜁니다.
                  </Text>
                </>
              )}
            </Pressable>

            {parseError ? (
              <View style={[s.errorBox, { backgroundColor: "#FEE2E2" }]}>
                <AlertCircle size={15} color="#DC2626" />
                <Text style={[s.errorTxt, { color: "#DC2626" }]}>{parseError}</Text>
              </View>
            ) : null}

            <Pressable style={[s.pickBtn, { backgroundColor: C.tint }]} onPress={pickFile}>
              <Upload size={18} color="#fff" />
              <Text style={s.pickBtnTxt}>CSV 파일 선택</Text>
            </Pressable>
          </>
        )}

        {/* ── STEP: 미리보기 ───────────────────────────────────── */}
        {step === "preview" && (
          <>
            <View style={[s.fileRow, { backgroundColor: C.card }]}>
              <FileText size={14} color={C.tint} />
              <Text style={[s.fileNameTxt, { color: C.text }]} numberOfLines={1}>{fileName}</Text>
              <Pressable
                style={s.changeBtn}
                onPress={() => { setStep("pick"); setRows([]); setFileName(""); }}
              >
                <Text style={[s.changeBtnTxt, { color: C.tint }]}>다시 선택</Text>
              </Pressable>
            </View>

            <View style={[s.summaryRow, { backgroundColor: C.card }]}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryNum, { color: "#16A34A" }]}>{validCount}</Text>
                <Text style={[s.summaryLabel, { color: C.textSecondary }]}>등록 가능</Text>
              </View>
              {invalidCount > 0 && (
                <View style={[s.summaryItem, { borderLeftWidth: 1, borderLeftColor: C.border }]}>
                  <Text style={[s.summaryNum, { color: "#DC2626" }]}>{invalidCount}</Text>
                  <Text style={[s.summaryLabel, { color: C.textSecondary }]}>오류 (건너뜀)</Text>
                </View>
              )}
            </View>

            {/* 미리보기 테이블 */}
            <View style={[s.tableWrap, { backgroundColor: C.card }]}>
              {/* 헤더 */}
              <View style={[s.tableHeader, { borderBottomColor: C.border }]}>
                {["이름", "출생", "보호자", "연락처", "주횟수"].map(h => (
                  <Text key={h} style={[s.thTxt, { color: C.textSecondary }]}>{h}</Text>
                ))}
              </View>
              {rows.map((row, i) => (
                <View
                  key={i}
                  style={[
                    s.tableRow,
                    i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                    row._rowError && { backgroundColor: "#FEF2F2" },
                  ]}
                >
                  <Text
                    style={[s.tdTxt, { color: row._rowError ? "#DC2626" : C.text }]}
                    numberOfLines={1}
                  >
                    {row.name || "(없음)"}
                  </Text>
                  <Text style={[s.tdTxt, { color: C.textSecondary }]} numberOfLines={1}>
                    {row.birth_year ?? "-"}
                  </Text>
                  <Text style={[s.tdTxt, { color: C.textSecondary }]} numberOfLines={1}>
                    {row.parent_name ?? "-"}
                  </Text>
                  <Text style={[s.tdTxt, { color: C.textSecondary }]} numberOfLines={1}>
                    {row.parent_phone ?? "-"}
                  </Text>
                  <Text style={[s.tdTxt, { color: C.textSecondary }]} numberOfLines={1}>
                    {row.weekly_count ?? 1}회
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              style={[s.submitBtn, { backgroundColor: validCount > 0 ? C.tint : C.border }]}
              onPress={handleSubmit}
              disabled={loading || validCount === 0}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Upload size={16} color="#fff" />
                    <Text style={s.submitBtnTxt}>{validCount}명 회원 등록하기</Text>
                  </>
              }
            </Pressable>
          </>
        )}

        {/* ── STEP: 완료 ───────────────────────────────────────── */}
        {step === "done" && result && (
          <View style={{ alignItems: "center", paddingTop: 24 }}>
            <CheckCircle2 size={56} color="#16A34A" />
            <Text style={[s.doneTitle, { color: C.text }]}>등록 완료</Text>

            <View style={[s.doneCard, { backgroundColor: C.card }]}>
              <View style={s.doneStatRow}>
                <Text style={[s.doneStatLabel, { color: C.textSecondary }]}>등록 성공</Text>
                <Text style={[s.doneStatNum, { color: "#16A34A" }]}>{result.succeeded}명</Text>
              </View>
              {result.failed.length > 0 && (
                <View style={[s.doneStatRow, { borderTopWidth: 1, borderTopColor: C.border }]}>
                  <Text style={[s.doneStatLabel, { color: C.textSecondary }]}>실패</Text>
                  <Text style={[s.doneStatNum, { color: "#DC2626" }]}>{result.failed.length}명</Text>
                </View>
              )}
            </View>

            {result.failed.length > 0 && (
              <View style={[s.failList, { backgroundColor: "#FEF2F2", width: "100%" }]}>
                <Text style={[s.failListTitle, { color: "#DC2626" }]}>실패 항목</Text>
                {result.failed.map((f, i) => (
                  <Text key={i} style={[s.failItem, { color: "#DC2626" }]}>
                    • {f.name}: {f.reason}
                  </Text>
                ))}
              </View>
            )}

            <Pressable
              style={[s.doneBtn, { backgroundColor: C.tint }]}
              onPress={() => router.back()}
            >
              <Text style={s.doneBtnTxt}>회원 목록으로 이동</Text>
            </Pressable>
            <Pressable
              style={[s.doneBtnOutline, { borderColor: C.border }]}
              onPress={() => { setStep("pick"); setRows([]); setFileName(""); setResult(null); }}
            >
              <Text style={[s.doneBtnOutlineTxt, { color: C.textSecondary }]}>추가 업로드</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  templateBox:    { borderRadius: 14, padding: 14, marginBottom: 14 },
  templateHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 0 },
  templateTitle:  { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  templateDesc:   { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 10, marginBottom: 10, lineHeight: 20 },
  templateNote:   { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 10, lineHeight: 17 },
  colTable:       { borderRadius: 8, borderWidth: 1, overflow: "hidden" },
  colRow:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7 },
  colNameWrap:    { flexDirection: "row", alignItems: "center", gap: 5, width: 120 },
  colName:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  colEx:          { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },
  reqBadge:       { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  reqTxt:         { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  errorBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, marginBottom: 12 },
  errorTxt:       { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  pickBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, marginTop: 4 },
  pickBtnTxt:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  fileRow:        { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, marginBottom: 12 },
  fileNameTxt:    { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  changeBtn:      { paddingHorizontal: 8, paddingVertical: 4 },
  changeBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  summaryRow:     { flexDirection: "row", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  summaryItem:    { flex: 1, alignItems: "center", paddingVertical: 12 },
  summaryNum:     { fontSize: 22, fontFamily: "Pretendard-Regular" },
  summaryLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  tableWrap:      { borderRadius: 12, overflow: "hidden", marginBottom: 16 },
  tableHeader:    { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1 },
  thTxt:          { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center" },
  tableRow:       { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 9 },
  tdTxt:          { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },
  submitBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  submitBtnTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  doneTitle:      { fontSize: 20, fontFamily: "Pretendard-Regular", marginTop: 16, marginBottom: 20 },
  doneCard:       { width: "100%", borderRadius: 12, padding: 4, marginBottom: 16 },
  doneStatRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  doneStatLabel:  { fontSize: 14, fontFamily: "Pretendard-Regular" },
  doneStatNum:    { fontSize: 18, fontFamily: "Pretendard-Regular" },
  failList:       { borderRadius: 10, padding: 12, marginBottom: 16 },
  failListTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  failItem:       { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  doneBtn:        { width: "100%", alignItems: "center", padding: 14, borderRadius: 12, marginBottom: 10 },
  doneBtnTxt:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  doneBtnOutline: { width: "100%", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1 },
  doneBtnOutlineTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
