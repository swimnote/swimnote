import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, API_BASE, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { validateName, validateStudentBirthYear } from "@/utils/validation";

const C = Colors.light;

interface PoolResult { id: string; name: string; address: string | null; }
type Step = "pool" | "child" | "done" | "pending";

function DoneAutoRedirect({ linkedNames, poolName }: { linkedNames: string[]; poolName: string }) {
  const [countdown, setCountdown] = useState(2);
  useEffect(() => {
    const t = setTimeout(() => router.replace("/(parent)/home" as any), 2000);
    const c = setInterval(() => setCountdown(p => p - 1), 1000);
    return () => { clearTimeout(t); clearInterval(c); };
  }, []);
  const nameStr = linkedNames.join(", ");
  return (
    <View style={st.resultBox}>
      <View style={[st.resultIcon, { backgroundColor: C.brandMist }]}>
        <LucideIcon name="check-circle" size={44} color={C.brandStrong} />
      </View>
      <Text style={[st.resultTitle, { color: C.text }]}>연결 완료!</Text>
      <Text style={[st.resultSub, { color: C.textSecondary }]}>
        {nameStr}이(가) {poolName}과{"\n"}성공적으로 연결되었습니다.{"\n\n"}이제 자녀의 수업 기록을 확인할 수 있습니다.
      </Text>
      <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{countdown}초 후 홈으로 이동합니다</Text>
      <Pressable
        style={[st.submitBtn, { backgroundColor: C.primaryAction, alignSelf: "stretch", marginHorizontal: 32 }]}
        onPress={() => router.replace("/(parent)/home" as any)}
      >
        <Text style={st.submitTxt}>지금 홈으로 이동</Text>
      </Pressable>
    </View>
  );
}

export default function LinkChildScreen() {
  const insets = useSafeAreaInsets();
  const { token, updateParentProfile } = useAuth();
  const { refresh } = useParent();

  const [step, setStep]               = useState<Step>("pool");
  const [query, setQuery]             = useState("");
  const [results, setResults]         = useState<PoolResult[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selectedPool, setSelectedPool] = useState<PoolResult | null>(null);

  const [childNames, setChildNames]   = useState<string[]>([""]);
  const [childPhone4s, setChildPhone4s] = useState<string[]>([""]);
  const [birthYear, setBirthYear]     = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [linkedNames, setLinkedNames] = useState<string[]>([]);
  const [pendingStudentName, setPendingStudentName] = useState<string>("");
  const [pendingReason, setPendingReason] = useState<string>("");
  const [error, setError]             = useState("");
  const [nameError, setNameError]     = useState("");
  const [birthYearError, setBirthYearError] = useState("");

  const childScrollRef  = useRef<any>(null);
  const submittingGuard = useRef(false);  // 중복 제출 방지

  async function searchPools() {
    if (!query.trim()) return;
    setSearching(true); setError("");
    try {
      const r = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(query)}`);
      const d = await r.json();
      if (d.success) setResults(d.data ?? []);
      else setError("검색 중 오류가 발생했습니다.");
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSearching(false); }
  }

  async function handleLink() {
    if (!selectedPool) return;
    if (submittingGuard.current) return;  // 중복 클릭 방지

    const validPairs = childNames
      .map((n, i) => ({ name: n.trim(), phone4: childPhone4s[i]?.replace(/[^0-9]/g, "").slice(-4) || "" }))
      .filter(p => p.name);
    if (validPairs.length === 0) {
      setNameError("자녀 이름을 최소 한 명 입력해주세요");
      childScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    if (birthYear && !validateStudentBirthYear(birthYear)) {
      setBirthYearError("출생년도 형식이 올바르지 않습니다");
      return;
    }

    submittingGuard.current = true;
    setSubmitting(true); setError(""); setNameError(""); setBirthYearError("");

    const successNames: string[] = [];
    let lastError = "";
    let pendingResult: { studentName: string; reason: string } | null = null;

    try {
      for (const { name, phone4 } of validPairs) {
        try {
          const r = await apiRequest(token, "/parent/link-child", {
            method: "POST",
            body: JSON.stringify({
              swimming_pool_id: selectedPool.id,
              child_name: name,
              child_phone_last4: phone4 || undefined,
              child_birth_year: birthYear ? Number(birthYear) : null,
            }),
          });
          const d = await r.json();
          if (r.ok && d.success && d.status === "linked") {
            successNames.push(d.student?.name || name);
          } else if (d.status === "pending") {
            // 전화번호 불일치 → 관리자 승인 대기
            pendingResult = {
              studentName: d.student?.name || name,
              reason: d.pending_reason || "phone_mismatch",
            };
          } else if (d.status === "not_found") {
            lastError = d.message || "수영장 회원 목록에 해당 이름이 없습니다.";
          } else {
            lastError = d.message || "일부 자녀 연결에 실패했습니다.";
          }
        } catch {
          lastError = "네트워크 오류가 발생했습니다.";
        }
      }

      if (successNames.length > 0) {
        updateParentProfile({ swimming_pool_id: selectedPool.id, pool_name: selectedPool.name });
        await refresh();
        setLinkedNames(successNames);
        setStep("done");
      } else if (pendingResult) {
        updateParentProfile({ swimming_pool_id: selectedPool.id, pool_name: selectedPool.name });
        setPendingStudentName(pendingResult.studentName);
        setPendingReason(pendingResult.reason);
        setStep("pending");
      } else {
        setError(lastError || "연결에 실패했습니다.");
      }
    } finally {
      setSubmitting(false);
      submittingGuard.current = false;
    }
  }

  function updateName(index: number, value: string) {
    setChildNames(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (index === 0) setNameError("");
  }

  function updatePhone4(index: number, value: string) {
    setChildPhone4s(prev => {
      const next = [...prev];
      next[index] = value.replace(/[^0-9]/g, "").slice(0, 4);
      return next;
    });
  }

  function addChild() {
    setChildNames(prev => [...prev, ""]);
    setChildPhone4s(prev => [...prev, ""]);
  }

  function removeChild(index: number) {
    setChildNames(prev => prev.filter((_, i) => i !== index));
    setChildPhone4s(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={st.backBtn} onPress={() => router.back()}>
          <LucideIcon name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[st.title, { color: C.text }]}>자녀 연결하기</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── 1단계: 수영장 검색 ─────────────────────────────────── */}
      {step === "pool" && (
        <KeyboardAwareScrollView
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[st.sectionTitle, { color: C.text }]}>자녀가 다니는 수영장을 찾아주세요</Text>

          <View style={[st.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
            <LucideIcon name="search" size={18} color={C.textMuted} />
            <TextInput
              style={[st.searchInput, { color: C.text }]}
              value={query} onChangeText={setQuery}
              placeholder="수영장 이름 입력..."
              placeholderTextColor={C.textMuted}
              returnKeyType="search"
              onSubmitEditing={searchPools}
            />
            {searching
              ? <ActivityIndicator size="small" color={C.brandStrong} />
              : <Pressable onPress={searchPools} style={[st.searchBtn, { backgroundColor: C.primaryAction }]}>
                  <Text style={st.searchBtnTxt}>검색</Text>
                </Pressable>
            }
          </View>

          {!!error && (
            <View style={[st.errBox, { backgroundColor: "#F9DEDA" }]}>
              <LucideIcon name="alert-circle" size={14} color={C.error} />
              <Text style={[st.errTxt, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {results.map(pool => (
            <Pressable
              key={pool.id}
              style={({ pressed }) => [st.poolCard, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
              onPress={() => { setSelectedPool(pool); setStep("child"); setError(""); }}
            >
              <View style={[st.poolIcon, { backgroundColor: C.brandMist }]}>
                <LucideIcon name="droplet" size={20} color={C.brandStrong} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.poolName, { color: C.text }]}>{pool.name}</Text>
                {pool.address && <Text style={[st.poolAddr, { color: C.textMuted }]}>{pool.address}</Text>}
              </View>
              <LucideIcon name="chevron-right" size={18} color={C.textMuted} />
            </Pressable>
          ))}

          {results.length === 0 && query && !searching && (
            <View style={st.emptyBox}>
              <LucideIcon name="search" size={28} color={C.textMuted} />
              <Text style={[st.emptyTxt, { color: C.textMuted }]}>검색 결과가 없습니다</Text>
              <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 }}>
                이름을 다르게 검색해보거나{"\n"}수영장에 SwimNote 등록 여부를 확인해주세요
              </Text>
            </View>
          )}
        </KeyboardAwareScrollView>
      )}

      {/* ── 2단계: 자녀 정보 입력 ─────────────────────────────── */}
      {step === "child" && selectedPool && (
        <KeyboardAwareScrollView
          ref={childScrollRef}
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 선택된 수영장 */}
          <View style={[st.selectedPool, { backgroundColor: C.brandMist, borderColor: C.brandStrong }]}>
            <LucideIcon name="droplet" size={16} color={C.brandStrong} />
            <Text style={[st.selectedPoolName, { color: C.brandStrong }]}>{selectedPool.name}</Text>
            <Pressable onPress={() => { setStep("pool"); setError(""); }}>
              <Text style={{ color: C.brandStrong, fontSize: 13, fontFamily: "Pretendard-Regular" }}>변경</Text>
            </Pressable>
          </View>

          <Text style={[st.sectionTitle, { color: C.text }]}>자녀 정보를 입력해주세요</Text>
          <Text style={[st.sectionSub, { color: C.textSecondary }]}>
            수영장에 등록된 이름과 일치하면 바로 연결됩니다.{"\n"}형제가 여러 명이면 이름을 모두 입력해주세요.
          </Text>

          {!!error && (
            <View style={[st.errBox, { backgroundColor: "#F9DEDA", flexDirection: "column", gap: 6 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={[st.errTxt, { color: C.error }]}>{error}</Text>
              </View>
              <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 17, paddingLeft: 22 }}>
                · 이름이 수영장 등록 정보와 정확히 일치하는지 확인하세요{"\n"}
                · 동명이인이라면 전화번호 뒷 4자리를 입력하세요{"\n"}
                · 모두 확인했다면 수영장에 직접 문의해주세요
              </Text>
            </View>
          )}

          <View style={{ gap: 12 }}>
            {childNames.map((name, i) => (
              <View key={i} style={[st.childCard, { borderColor: C.border, backgroundColor: C.card }]}>
                {/* 슬롯 헤더 */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={[st.label, { color: C.textSecondary }]}>자녀 {i + 1}{i === 0 ? " *" : ""}</Text>
                  {i > 0 && (
                    <Pressable onPress={() => removeChild(i)} style={[st.removeBtn, { backgroundColor: "#FEF2F2" }]} hitSlop={8}>
                      <LucideIcon name="minus" size={14} color="#DC2626" />
                    </Pressable>
                  )}
                </View>
                {/* 이름 */}
                <View style={[st.inputRow, { borderColor: i === 0 && nameError ? C.error : C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="user" size={16} color={C.textMuted} />
                  <TextInput
                    style={[st.input, { color: C.text }]}
                    value={name}
                    onChangeText={v => updateName(i, v)}
                    placeholder="이름 입력"
                    placeholderTextColor={C.textMuted}
                    returnKeyType="next"
                  />
                </View>
                {i === 0 && nameError ? <Text style={st.fieldErr}>{nameError}</Text> : null}
                {/* 전화번호 뒷 4자리 */}
                <View style={[st.inputRow, { borderColor: C.border, backgroundColor: C.background, marginTop: 8 }]}>
                  <Text style={{ fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>📞</Text>
                  <TextInput
                    style={[st.input, { color: C.text }]}
                    value={childPhone4s[i]}
                    onChangeText={v => updatePhone4(i, v)}
                    placeholder="전화번호 뒷 4자리 (동명이인 구분)"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={4}
                    returnKeyType="done"
                  />
                </View>
              </View>
            ))}
            {/* 자녀 추가 버튼 */}
            <Pressable style={[st.addBtn, { borderColor: C.brandStrong }]} onPress={addChild}>
              <LucideIcon name="plus" size={16} color={C.brandStrong} />
              <Text style={[st.addBtnTxt, { color: C.brandStrong }]}>자녀 추가</Text>
            </Pressable>

            {/* 출생 연도 (공통) */}
            <View style={{ gap: 4, marginTop: 4 }}>
              <Text style={[st.label, { color: C.textSecondary }]}>출생 연도 (선택)</Text>
              <View style={[st.inputRow, { borderColor: birthYearError ? C.error : C.border, backgroundColor: C.card }]}>
                <LucideIcon name="calendar" size={16} color={C.textMuted} />
                <TextInput
                  style={[st.input, { color: C.text }]}
                  value={birthYear}
                  onChangeText={v => { setBirthYear(v); setBirthYearError(""); }}
                  placeholder="예: 2015"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
              {birthYearError ? <Text style={st.fieldErr}>{birthYearError}</Text> : null}
            </View>
          </View>

          <Pressable
            style={[st.submitBtn, { backgroundColor: C.primaryAction, opacity: submitting ? 0.7 : 1 }]}
            onPress={handleLink}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={st.submitTxt}>연결하기</Text>
            }
          </Pressable>
        </KeyboardAwareScrollView>
      )}

      {/* ── 완료: 자동 연결 ───────────────────────────────────── */}
      {step === "done" && (
        <DoneAutoRedirect linkedNames={linkedNames} poolName={selectedPool?.name ?? ""} />
      )}

      {/* ── 승인 대기 중 ─────────────────────────────────── */}
      {step === "pending" && (
        <View style={[st.resultBox, { paddingHorizontal: 24, gap: 16 }]}>
          <View style={[st.resultIcon, { backgroundColor: "#FFF7ED" }]}>
            <LucideIcon name="clock" size={44} color="#F59E0B" />
          </View>
          <Text style={[st.resultTitle, { color: C.text }]}>추가 보호자 승인 대기</Text>

          {!!pendingStudentName && (
            <View style={[st.pendingInfoBox, { backgroundColor: C.brandMist, borderColor: C.brandStrong }]}>
              <LucideIcon name="user" size={16} color={C.brandStrong} />
              <Text style={[st.pendingInfoTxt, { color: C.brandStrong }]}>{pendingStudentName}</Text>
            </View>
          )}

          <Text style={[st.resultSub, { color: C.textSecondary }]}>
            아직 보호자 연결이 완료되지 않았습니다.
          </Text>

          {/* 연결 방법 안내 박스 */}
          <View style={{ backgroundColor: "#EFF6FF", borderRadius: 14, padding: 16, gap: 10, alignSelf: "stretch" }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <LucideIcon name="info" size={15} color="#2563EB" />
              <Text style={{ fontSize: 13, color: "#1D4ED8", fontFamily: "Pretendard-Bold" }}>연결 방법</Text>
            </View>
            <Text style={{ fontSize: 13, color: "#1E40AF", lineHeight: 22 }}>
              가족 중 이미 연결된 보호자가{"\n"}
              <Text style={{ fontFamily: "Pretendard-Bold" }}>설정 → 추가 보호자 관리</Text>
              {"\n"}에서 현재 가입한{" "}
              <Text style={{ fontFamily: "Pretendard-Bold" }}>전화번호를 등록</Text>
              하면{"\n"}별도의 승인 없이{" "}
              <Text style={{ fontFamily: "Pretendard-Bold" }}>즉시 연결</Text>
              됩니다.
            </Text>
          </View>

          {/* 연결 안내 보내기 버튼 */}
          <Pressable
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              gap: 8, paddingVertical: 14, borderRadius: 12,
              backgroundColor: "#2563EB", alignSelf: "stretch",
              opacity: pressed ? 0.8 : 1,
            }]}
            onPress={() => {
              Share.share({
                message:
                  "[SwimNote 추가 보호자 연결 안내]\n\n" +
                  "제가 먼저 SwimNote에 가입했습니다.\n\n" +
                  "설정 → 추가 보호자 관리에서\n" +
                  "제 전화번호를 등록해주시면\n" +
                  "별도의 승인 없이 자동으로 연결됩니다.\n\n" +
                  "전화번호 등록 후 바로 사용할 수 있습니다.",
              });
            }}
          >
            <LucideIcon name="share-2" size={16} color="#fff" />
            <Text style={{ fontSize: 15, color: "#fff", fontFamily: "Pretendard-SemiBold" }}>연결 안내 보내기</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [st.submitBtn, { backgroundColor: C.primaryAction, alignSelf: "stretch", opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.replace("/(parent)/home" as any)}
          >
            <Text style={st.submitTxt}>홈으로 이동</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  header:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:          { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  title:            { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular" },
  content:          { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  sectionTitle:     { fontSize: 17, fontFamily: "Pretendard-Regular" },
  sectionSub:       { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  searchRow:        { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput:      { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  searchBtn:        { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  searchBtnTxt:     { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  errBox:           { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errTxt:           { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  poolCard:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  poolIcon:         { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  poolName:         { fontSize: 15, fontFamily: "Pretendard-Regular" },
  poolAddr:         { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  emptyBox:         { alignItems: "center", gap: 10, marginTop: 40 },
  emptyTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular" },
  selectedPool:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  selectedPoolName: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  label:            { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow:         { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  input:            { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  submitBtn:        { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  submitTxt:        { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  resultBox:        { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, gap: 20 },
  resultIcon:       { width: 88, height: 88, borderRadius: 44, justifyContent: "center", alignItems: "center" },
  resultTitle:      { fontSize: 22, fontFamily: "Pretendard-Regular" },
  resultSub:        { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  fieldErr:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 2 },
  childCard:        { borderWidth: 1, borderRadius: 12, padding: 14 },
  removeBtn:        { width: 28, height: 28, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  addBtn:           { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 12, paddingVertical: 12 },
  addBtnTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular" },
  pendingInfoBox:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  pendingInfoTxt:   { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  pendingTipBox:    { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, alignSelf: "stretch" },
  pendingTipTxt:    { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});
