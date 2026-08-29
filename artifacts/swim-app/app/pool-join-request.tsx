/**
 * pool-join-request.tsx — 학부모 회원가입 (Pool-First 2.0.0)
 *
 * [2.0.0 POOL-FIRST] 수영장 선택이 필수입니다.
 * pool_id는 user가 직접 선택한 row의 id만 사용하며,
 * 이름·전화번호로 pool을 추측하거나 fallback하지 않습니다.
 *
 * 진입 경로:
 *  - signup-role.tsx (학부모 선택 → 다음)
 *  - kakao-link.tsx  (카카오/애플 소셜 학부모 신규가입)
 *  - parent-login.tsx (회원가입 버튼)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, safeJson, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Pool { id: string; name: string; address?: string; }
type PoolSearchState = "idle" | "loading" | "loaded" | "empty" | "error";

export default function ParentRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { setParentSession, finishLogin } = useAuth();
  const { phone: prefillPhone, kakaoId, appleId } = useLocalSearchParams<{
    phone?: string; kakaoId?: string; appleId?: string;
  }>();

  const isSocialSignup = !!(prefillPhone && (kakaoId || appleId));

  const [parentName, setParentName] = useState("");
  const [phone, setPhone]           = useState(prefillPhone || "");
  const [loginId, setLoginId]       = useState("");
  const [password, setPassword]     = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [childName, setChildName]   = useState("");
  const [termsAgreed, setTermsAgreed]   = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [refundAgreed, setRefundAgreed]   = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState("");

  // ── Pool 검색 상태 ─────────────────────────────────────────────────────
  const [poolSearch, setPoolSearch]         = useState("");
  const [pools, setPools]                   = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool]     = useState<Pool | null>(null);
  const [poolSearchState, setPoolSearchState] = useState<PoolSearchState>("idle");
  const [poolSearchError, setPoolSearchError] = useState("");
  const poolSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poolSearchAbortRef = useRef<AbortController | null>(null);

  // ── Pool 검색 (debounce 300ms) ─────────────────────────────────────────
  useEffect(() => {
    const q = poolSearch.trim();
    if (!q) {
      if (poolSearchAbortRef.current) { poolSearchAbortRef.current.abort(); poolSearchAbortRef.current = null; }
      if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
      setPools([]);
      setPoolSearchState("idle");
      setPoolSearchError("");
      return;
    }
    setPoolSearchState("loading");
    if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
    poolSearchTimerRef.current = setTimeout(async () => {
      if (poolSearchAbortRef.current) poolSearchAbortRef.current.abort();
      const ctrl = new AbortController();
      poolSearchAbortRef.current = ctrl;
      try {
        const res = await fetch(`${API_BASE}/auth/pools?search=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        const data = await res.json();
        if (ctrl.signal.aborted) return;
        const list: Pool[] = Array.isArray(data) ? data : (data?.data ?? []);
        setPools(list);
        setPoolSearchState(list.length > 0 ? "loaded" : "empty");
        setPoolSearchError("");
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setPools([]);
        setPoolSearchState("error");
        setPoolSearchError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      }
    }, 300);
    return () => {
      if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
    };
  }, [poolSearch]);

  // ── 수영장 row 선택 ────────────────────────────────────────────────────
  function handleSelectPool(p: Pool) {
    setSelectedPool(p);
    setPoolSearch("");
    setPools([]);
    setPoolSearchState("idle");
  }

  // ── 제출 ───────────────────────────────────────────────────────────────
  async function handleRegister() {
    setError("");

    if (!parentName.trim())  { setError("이름을 입력해주세요."); return; }
    if (!phone.trim())       { setError("전화번호를 입력해주세요."); return; }
    // [2.0.0 POOL-FIRST] pool_id 필수 — 미선택 시 400 사전 차단
    if (!selectedPool)       { setError("수영장을 검색하여 선택해주세요."); return; }
    if (!childName.trim())   { setError("우리 아이 이름을 입력해주세요."); return; }
    if (!password)           { setError("비밀번호를 입력해주세요."); return; }
    if (password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (!termsAgreed)   { setError("이용약관에 동의해주세요."); return; }
    if (!privacyAgreed) { setError("개인정보 처리방침에 동의해주세요."); return; }
    if (!refundAgreed)  { setError("환불 및 결제 정책에 동의해주세요."); return; }

    setSubmitting(true);
    try {
      // [2.0.0 POOL-FIRST] 반드시 selectedPool.id 사용.
      // 이름이나 전화번호로 pool을 추측하지 않음.
      const poolId = selectedPool.id;

      const res = await fetch(`${API_BASE}/auth/v2/parent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_name: parentName.trim(),
          phone: phone.trim().replace(/[-\s]/g, ""),
          password,
          pool_id: poolId,           // 선택한 pool의 id (불변)
          child_name: childName.trim(),
          loginId: loginId.trim() || undefined,
          ...(kakaoId ? { kakao_id: kakaoId } : {}),
          ...(appleId ? { apple_id: appleId } : {}),
        }),
      });
      const data = await safeJson(res);

      if (!res.ok) {
        const rawError = data?.error || data?.message || "";
        const isServerError = res.status >= 500
          || rawError.startsWith("Unexpected response")
          || rawError.startsWith("Internal Server Error");
        setError(isServerError
          ? "가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          : (rawError || "오류가 발생했습니다."));
        return;
      }

      if (data?.token) {
        await setParentSession(data.token, data.parent);
        finishLogin("parent", null, data.parent, data.token);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <LucideIcon name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>학부모 회원가입</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && (
          <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
            <LucideIcon name="alert-circle" size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        )}

        <View style={{ gap: 14 }}>
          {/* 이름 */}
          <Field label="이름 *">
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <LucideIcon name="user" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={parentName} onChangeText={setParentName}
                placeholder="홍길동" placeholderTextColor={C.textMuted}
              />
            </View>
          </Field>

          {/* 전화번호 */}
          <Field label="전화번호 *">
            <View style={[
              styles.inputRow,
              { borderColor: isSocialSignup ? C.brandStrong : C.border, backgroundColor: C.card },
            ]}>
              <LucideIcon name="phone" size={16} color={isSocialSignup ? C.brandStrong : C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={phone} onChangeText={setPhone}
                placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
                editable={!isSocialSignup}
              />
              {isSocialSignup && <LucideIcon name="check-circle" size={16} color={C.brandStrong} />}
            </View>
            {isSocialSignup && (
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.brandStrong, marginTop: 4 }}>
                ✓ 휴대폰 인증이 완료되었습니다.
              </Text>
            )}
          </Field>

          {/* ── 수영장 선택 (Pool-First 필수) ────────────────────────────── */}
          <Field label="수영장 선택 *">
            {selectedPool ? (
              /* 선택 완료 상태 */
              <View style={[styles.selectedPoolBox, { borderColor: C.brandStrong, backgroundColor: C.brandSoft }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selectedPoolName, { color: C.brandStrong }]}>{selectedPool.name}</Text>
                  {selectedPool.address ? (
                    <Text style={[styles.selectedPoolAddr, { color: C.textSecondary }]} numberOfLines={1}>
                      {selectedPool.address}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    setSelectedPool(null);
                    setPoolSearch("");
                    setPools([]);
                    setPoolSearchState("idle");
                  }}
                >
                  <LucideIcon name="x" size={18} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              /* 검색 상태 */
              <View>
                <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                  <LucideIcon name="search" size={16} color={C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={poolSearch} onChangeText={setPoolSearch}
                    placeholder="수영장 이름 검색 (예: 스윔노트)" placeholderTextColor={C.textMuted}
                    autoCorrect={false}
                  />
                  {poolSearchState === "loading" && <ActivityIndicator size="small" color={C.brandStrong} />}
                </View>

                {/* 검색 결과 목록 */}
                {poolSearchState === "loaded" && pools.length > 0 && (
                  <FlatList
                    data={pools}
                    keyExtractor={p => p.id}
                    scrollEnabled={false}
                    style={[styles.poolList, { borderColor: C.border }]}
                    renderItem={({ item: p }) => (
                      <Pressable
                        style={({ pressed }) => [styles.poolRow, { backgroundColor: pressed ? C.brandSoft : C.card }]}
                        onPress={() => handleSelectPool(p)}
                      >
                        <LucideIcon name="map-pin" size={14} color={C.brandStrong} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.poolName, { color: C.text }]}>{p.name}</Text>
                          {p.address ? (
                            <Text style={[styles.poolAddr, { color: C.textMuted }]} numberOfLines={1}>{p.address}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    )}
                  />
                )}
                {poolSearchState === "empty" && (
                  <Text style={[styles.poolMsg, { color: C.textMuted }]}>검색 결과가 없습니다.</Text>
                )}
                {poolSearchState === "error" && (
                  <Text style={[styles.poolMsg, { color: C.error }]}>{poolSearchError}</Text>
                )}
                <Text style={[styles.poolHint, { color: C.textMuted }]}>
                  수영장 이름을 입력하면 검색 결과가 표시됩니다.
                </Text>
              </View>
            )}
          </Field>

          {/* 우리 아이 이름 */}
          <Field label="우리 아이 이름 *">
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <LucideIcon name="baby" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={childName} onChangeText={setChildName}
                placeholder="자녀 이름" placeholderTextColor={C.textMuted}
              />
            </View>
            <Text style={[styles.fieldHint, { color: C.textMuted }]}>
              수영장에 등록된 이름과 동일하게 입력하면 자동으로 연결됩니다.
            </Text>
          </Field>

          {/* 아이디 (선택) */}
          <Field label="아이디 (선택 — 로그인에 사용)">
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <LucideIcon name="at-sign" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={loginId} onChangeText={setLoginId}
                placeholder="영문/숫자 3자 이상 (미입력 시 전화번호로 로그인)" placeholderTextColor={C.textMuted}
                autoCapitalize="none" autoCorrect={false}
              />
            </View>
          </Field>

          {/* 비밀번호 */}
          <Field label="비밀번호 * (4자리 이상)">
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
              <LucideIcon name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={password} onChangeText={setPassword}
                placeholder="비밀번호 설정" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                <LucideIcon name={showPw ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </Field>

          {/* 비밀번호 확인 */}
          <Field label="비밀번호 확인 *">
            <View style={[
              styles.inputRow,
              { borderColor: passwordConfirm && password !== passwordConfirm ? C.error : C.border, backgroundColor: C.card },
            ]}>
              <LucideIcon name="lock" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={passwordConfirm} onChangeText={setPasswordConfirm}
                placeholder="비밀번호 재입력" placeholderTextColor={C.textMuted}
                secureTextEntry={!showPw}
              />
            </View>
            {!!passwordConfirm && password !== passwordConfirm && (
              <Text style={{ color: C.error, fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 }}>
                비밀번호가 일치하지 않습니다
              </Text>
            )}
          </Field>
        </View>

        {/* 동의 항목 */}
        <View style={[styles.agreeBox, { borderColor: C.border, backgroundColor: C.card }]}>
          <Pressable
            style={styles.termsRow}
            onPress={() => {
              const all = termsAgreed && privacyAgreed && refundAgreed;
              setTermsAgreed(!all); setPrivacyAgreed(!all); setRefundAgreed(!all);
            }}
          >
            <CheckBox checked={termsAgreed && privacyAgreed && refundAgreed} />
            <Text style={[styles.termsTextBold, { color: C.text }]}>전체 동의</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <Pressable style={styles.termsRow} onPress={() => setTermsAgreed(v => !v)}>
            <CheckBox checked={termsAgreed} />
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>이용약관 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/terms" as any)}>
              <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>
          <Pressable style={styles.termsRow} onPress={() => setPrivacyAgreed(v => !v)}>
            <CheckBox checked={privacyAgreed} />
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>개인정보 처리방침 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/privacy" as any)}>
              <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>
          <Pressable style={styles.termsRow} onPress={() => setRefundAgreed(v => !v)}>
            <CheckBox checked={refundAgreed} />
            <Text style={[styles.termsText, { color: C.textSecondary, flex: 1 }]}>환불 및 결제 정책 동의 (필수)</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/refund" as any)}>
              <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          </Pressable>
        </View>

        {/* 가입 버튼 */}
        <Pressable
          style={[styles.submitBtn, { backgroundColor: C.primaryAction, opacity: submitting ? 0.7 : 1 }]}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitTxt}>가입하기</Text>
          }
        </Pressable>

        <Pressable style={styles.loginLink} onPress={() => router.replace("/parent-login" as any)}>
          <Text style={[styles.loginLinkTxt, { color: C.textMuted }]}>
            이미 계정이 있으신가요? <Text style={{ color: C.brandStrong }}>로그인</Text>
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

/* ── 소형 컴포넌트 ──────────────────────────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <View style={[
      styles.checkbox,
      { borderColor: checked ? C.brandStrong : C.border, backgroundColor: checked ? C.brandStrong : "transparent" },
    ]}>
      {checked && <LucideIcon name="check" size={12} color="#fff" />}
    </View>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:      { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle:  { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular" },
  content:      { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  errBox:       { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow:     { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  input:        { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  fieldHint:    { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 4 },

  // Pool 선택 관련
  selectedPoolBox:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  selectedPoolName: { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  selectedPoolAddr: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  poolList:         { borderWidth: 1, borderRadius: 10, marginTop: 6, overflow: "hidden" },
  poolRow:          { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5E5" },
  poolName:         { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  poolAddr:         { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  poolMsg:          { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 8, textAlign: "center" },
  poolHint:         { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 6 },

  // 동의 관련
  agreeBox:     { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  divider:      { height: 1, marginVertical: 2 },
  termsRow:     { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox:     { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, justifyContent: "center", alignItems: "center" },
  termsText:    { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  termsTextBold:{ fontSize: 14, fontFamily: "Pretendard-Regular" },

  submitBtn:    { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  submitTxt:    { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  loginLink:    { alignItems: "center", paddingTop: 8 },
  loginLinkTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
