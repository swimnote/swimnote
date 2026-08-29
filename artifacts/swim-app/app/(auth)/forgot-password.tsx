import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useRef, useState, useEffect } from "react";
import {ActivityIndicator,
  Platform, Pressable, StyleSheet, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, safeJson, useAuth } from "@/context/AuthContext";

const C = Colors.light;
type Step = "phone" | "sms" | "select" | "pw";
type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

interface FoundAccount {
  type: "admin" | "parent";
  identifier: string;
  login_id?: string | null;
  name: string;
  role?: string;
  pool_id?: string | null;
  pool_name?: string | null;
  is_activated?: boolean;
  social_provider?: "kakao" | "apple" | null;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-***-${digits.slice(6)}`;
  }
  return phone;
}

function roleLabel(role?: string) {
  if (role === "teacher")    return "선생님";
  if (role === "pool_admin") return "대표";
  if (role === "sub_admin")  return "관리자";
  return "관리자";
}

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { adminLogin, parentLogin } = useAuth();
  const pw2Ref = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [smsState, setSmsState] = useState<SmsState>("idle");
  const [smsCode, setSmsCode] = useState("");
  const [smsError, setSmsError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [accounts, setAccounts] = useState<FoundAccount[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function startTimer(seconds = 180) {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimer(seconds);
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          if (smsState !== "verified") { setSmsState("error"); setSmsError("인증시간이 만료되었습니다. 다시 요청해주세요."); }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function fmtTimer(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function cleanedPhone() {
    return phone.replace(/[-\s]/g, "");
  }

  async function handleSendSms() {
    setSmsError(""); setDevCode(null);
    const cp = cleanedPhone();
    if (!/^01[016789]\d{7,8}$/.test(cp)) {
      setSmsError("올바른 휴대폰 번호를 입력해주세요."); return;
    }
    setSmsState("sending");
    try {
      const res = await fetch(`${API_BASE}/auth/send-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cp, purpose: "reset_password" }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "발송에 실패했습니다.");
      setSmsState("sent");
      setSmsCode("");
      startTimer(180);
      setStep("sms");
      if (data.dev_code) setDevCode(data.dev_code);
    } catch (e: any) {
      setSmsState("error");
      setSmsError(e.message || "잠시 후 다시 시도해주세요.");
    }
  }

  async function handleVerifySms() {
    setSmsError("");
    if (smsCode.trim().length !== 6) { setSmsError("6자리 인증번호를 입력해주세요."); return; }
    setSmsState("verifying");
    try {
      const cp = cleanedPhone();
      const res = await fetch(`${API_BASE}/auth/verify-sms-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cp, code: smsCode.trim(), purpose: "reset_password" }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "인증에 실패했습니다.");
      if (timerRef.current) clearInterval(timerRef.current);
      setSmsState("verified");

      // 이 전화번호로 등록된 모든 계정 조회
      const lookupRes = await fetch(`${API_BASE}/auth/find-identifier-by-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cp }),
      });
      const lookupData = await lookupRes.json();
      const found: FoundAccount[] = lookupData.accounts || [];
      setAccounts(found);
      setSelectedIdx(found.length === 1 ? 0 : null);
      setStep("select");
    } catch (e: any) {
      setSmsState("sent");
      setSmsError(e.message || "인증번호가 올바르지 않습니다.");
    }
  }

  async function resetPassword() {
    if (selectedIdx === null) return;
    const account = accounts[selectedIdx];
    if (!newPw || newPw.length < 4) { setError("비밀번호는 4자 이상이어야 합니다."); return; }
    if (newPw !== newPw2) { setError("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: account.identifier,
          new_password: newPw,
          // [2.0.0] pool-scoped 재설정: 동일 전화번호가 여러 pool에 있을 때 정확한 계정만 변경
          ...(account.pool_id ? { pool_id: account.pool_id } : {}),
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) { setError(data.error || data.message || "변경 실패"); return; }

      // 변경 완료 즉시 자동 로그인 — RootNav가 role에 맞게 자동 이동
      if (account.type === "admin") {
        await adminLogin(account.identifier, newPw);
      } else {
        await parentLogin(cleanedPhone(), newPw, account.pool_id ?? undefined);
      }
    } catch (e: any) {
      setError(e.message || "서버 오류가 발생했습니다.");
    } finally { setLoading(false); }
  }

  function goBack() {
    if (step === "sms") { setStep("phone"); setSmsState("idle"); setSmsCode(""); setSmsError(""); }
    else if (step === "select") setStep("sms");
    else if (step === "pw") setStep("select");
    else router.back();
  }

  const selectedAccount = selectedIdx !== null ? accounts[selectedIdx] : null;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={goBack}>
            <LucideIcon name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>비밀번호 찾기</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* ── 단계 1: 휴대폰 번호 입력 ── */}
        {step === "phone" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <LucideIcon name="phone" size={24} color={C.brandStrong} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>휴대폰 번호 입력</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              가입 시 등록한 휴대폰 번호로{"\n"}인증 문자를 보내드릴게요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>휴대폰 번호</Text>
              <View style={[styles.inputRow, { borderColor: phone ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                <LucideIcon name="phone" size={15} color={phone ? C.brandStrong : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={phone}
                  onChangeText={v => { setPhone(v); setSmsError(""); }}
                  placeholder="010-0000-0000"
                  placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleSendSms}
                />
              </View>
            </View>

            {!!smsError && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{smsError}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.primaryAction, opacity: pressed || smsState === "sending" ? 0.85 : 1 }]}
              onPress={handleSendSms}
              disabled={smsState === "sending"}
            >
              {smsState === "sending"
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>인증 문자 받기</Text>
              }
            </Pressable>
          </View>
        )}

        {/* ── 단계 2: SMS 인증 ── */}
        {step === "sms" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <LucideIcon name="hash" size={24} color={C.brandStrong} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>인증번호 입력</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              <Text style={{ color: C.text }}>{phone}</Text>
              {"\n"}로 발송된 6자리 번호를 입력해주세요.
            </Text>

            <View style={styles.field}>
              <View style={styles.phoneRow}>
                <View style={[styles.inputRow, { flex: 1, borderColor: smsCode ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="hash" size={15} color={smsCode ? C.brandStrong : C.textMuted} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    value={smsCode}
                    onChangeText={v => { setSmsCode(v.replace(/\D/g, "").slice(0, 6)); setSmsError(""); }}
                    placeholder="인증번호 6자리"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                  {timer > 0 && <Text style={[styles.timerTxt, { color: timer <= 30 ? C.error : C.textMuted }]}>{fmtTimer(timer)}</Text>}
                </View>
                <Pressable
                  style={[styles.smsBtn, { backgroundColor: C.primaryAction }]}
                  onPress={handleVerifySms}
                  disabled={smsState === "verifying"}
                >
                  {smsState === "verifying"
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.smsBtnTxt}>확인</Text>
                  }
                </Pressable>
              </View>
              {!!smsError && <Text style={{ fontSize: 12, color: C.error, marginTop: 2 }}>{smsError}</Text>}
            </View>

            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => { setSmsState("idle"); handleSendSms(); }}
            >
              <Text style={[styles.retryTxt, { color: C.textMuted }]}>문자가 오지 않나요? 재발송</Text>
            </Pressable>

            {devCode && (
              <View style={styles.devCodeBox}>
                <LucideIcon name="terminal" size={13} color="#856404" />
                <Text style={styles.devCodeLabel}>개발용 인증번호:</Text>
                <Text style={styles.devCodeNum}>{devCode}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── 단계 3: 계정 선택 ── */}
        {step === "select" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <LucideIcon name="user" size={24} color={C.brandStrong} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>계정 선택</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              이 번호로 등록된 계정이에요.{"\n"}비밀번호를 바꿀 계정을 선택해주세요.
            </Text>

            {accounts.length === 0 ? (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>이 번호로 등록된 계정이 없습니다.</Text>
              </View>
            ) : (
              <View style={styles.accountList}>
                {accounts.map((acc, idx) => {
                  const isSelected = selectedIdx === idx;
                  return (
                    <Pressable
                      key={idx}
                      style={[
                        styles.accountItem,
                        { borderColor: isSelected ? C.brandStrong : C.border, backgroundColor: isSelected ? "#EFF4FF" : C.background },
                      ]}
                      onPress={() => setSelectedIdx(idx)}
                    >
                      <View style={[styles.accountIcon, {
                        backgroundColor: acc.social_provider === "kakao" ? "#FEE500"
                          : acc.social_provider === "apple" ? "#000"
                          : isSelected ? C.brandStrong : C.border,
                      }]}>
                        {acc.social_provider === "kakao"
                          ? <Text style={{ fontSize: 16 }}>K</Text>
                          : acc.social_provider === "apple"
                            ? <Text style={{ fontSize: 16, color: "#fff" }}></Text>
                            : acc.type === "parent"
                              ? <LucideIcon name="user" size={16} color={isSelected ? "#fff" : C.textMuted} />
                              : acc.role === "teacher"
                                ? <LucideIcon name="graduation-cap" size={16} color={isSelected ? "#fff" : C.textMuted} />
                                : <LucideIcon name="building-2" size={16} color={isSelected ? "#fff" : C.textMuted} />
                        }
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.accountName, { color: C.text }]}>{acc.name}</Text>
                          <View style={[styles.roleBadge, { backgroundColor: isSelected ? "#D6E4FF" : "#F1F5F9" }]}>
                            <Text style={[styles.roleBadgeTxt, { color: isSelected ? C.brandStrong : C.textSecondary }]}>
                              {acc.type === "parent" ? "학부모" : roleLabel(acc.role)}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.accountSub, { color: C.textMuted }]}>
                          {acc.pool_name ? acc.pool_name + " · " : ""}
                          {acc.social_provider === "kakao" ? "카카오로 가입한 계정"
                            : acc.social_provider === "apple" ? "Apple로 가입한 계정"
                            : acc.type === "parent"
                              ? (acc.login_id ? `아이디: ${acc.login_id}` : maskPhone(acc.identifier))
                              : `아이디: ${acc.identifier}`
                          }
                        </Text>
                        {acc.social_provider && (
                          <Text style={[styles.socialNote, { color: "#D97706" }]}>
                            {acc.social_provider === "kakao" ? "카카오" : "Apple"} 앱으로 로그인해주세요
                          </Text>
                        )}
                      </View>
                      <View style={[styles.radioOuter, { borderColor: isSelected ? C.brandStrong : C.border }]}>
                        {isSelected && <View style={[styles.radioInner, { backgroundColor: C.brandStrong }]} />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {accounts.length > 0 && (
              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: selectedIdx !== null ? C.primaryAction : C.border, opacity: pressed ? 0.85 : 1 }
                ]}
                onPress={() => {
                  if (selectedIdx === null) return;
                  const acc = accounts[selectedIdx];
                  if (acc.social_provider) {
                    setError(
                      acc.social_provider === "kakao"
                        ? "카카오로 가입한 계정은 카카오 앱에서 로그인해주세요."
                        : "Apple로 가입한 계정은 Apple 로그인으로 접속해주세요."
                    );
                    return;
                  }
                  setError("");
                  setStep("pw");
                }}
                disabled={selectedIdx === null}
              >
                <Text style={styles.submitBtnText}>다음</Text>
              </Pressable>
            )}
            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#FEF3C7" }]}>
                <LucideIcon name="alert-circle" size={14} color="#D97706" />
                <Text style={[styles.errText, { color: "#92400E" }]}>{error}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── 단계 4: 새 비밀번호 설정 ── */}
        {step === "pw" && selectedAccount && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <LucideIcon name="lock" size={24} color={C.brandStrong} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>새 비밀번호 설정</Text>

            {/* 선택된 계정 표시 */}
            <View style={[styles.selectedBadge, { backgroundColor: C.background, borderColor: C.border }]}>
              <View style={[styles.accountIcon, { backgroundColor: "#F1F5F9", width: 28, height: 28, borderRadius: 8 }]}>
                {selectedAccount.type === "parent"
                  ? <LucideIcon name="user" size={14} color="#fff" />
                  : selectedAccount.role === "teacher"
                    ? <LucideIcon name="graduation-cap" size={14} color="#fff" />
                    : <LucideIcon name="building-2" size={14} color="#fff" />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountName, { color: C.text }]}>{selectedAccount.name}</Text>
                <Text style={[styles.accountSub, { color: C.textMuted }]}>{selectedAccount.identifier}</Text>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>새 비밀번호 (4자 이상)</Text>
              <View style={[styles.inputRow, { borderColor: newPw ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                <LucideIcon name="lock" size={15} color={newPw ? C.brandStrong : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={newPw}
                  onChangeText={v => { setNewPw(v); setError(""); }}
                  placeholder="4자 이상"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="next"
                  autoFocus
                  onSubmitEditing={() => pw2Ref.current?.focus()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                  <LucideIcon name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 확인</Text>
              <View style={[styles.inputRow, { borderColor: newPw2 ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                <LucideIcon name="lock" size={15} color={newPw2 ? C.brandStrong : C.textMuted} />
                <TextInput
                  ref={pw2Ref}
                  style={[styles.input, { color: C.text }]}
                  value={newPw2}
                  onChangeText={v => { setNewPw2(v); setError(""); }}
                  placeholder="비밀번호를 다시 입력"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="done"
                  onSubmitEditing={resetPassword}
                />
              </View>
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.primaryAction, opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={resetPassword}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>비밀번호 변경</Text>
              }
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  screenTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  cardDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20, marginTop: -6 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  phoneRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  smsBtn: { height: 52, paddingHorizontal: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", minWidth: 70 },
  smsBtnTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  timerTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  retryBtn: { alignSelf: "center", paddingVertical: 4 },
  retryTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  devCodeBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF3CD", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  devCodeLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#856404" },
  devCodeNum: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#856404" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  accountList: { gap: 10 },
  accountItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1.5, borderRadius: 16, padding: 14,
  },
  accountIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  accountName: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  accountSub: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  roleBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleBadgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  socialNote: { fontSize: 11 },
  selectedBadge: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderRadius: 14, padding: 12,
  },
});
