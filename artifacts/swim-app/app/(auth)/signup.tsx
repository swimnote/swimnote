/**
 * signup.tsx — 통합 회원가입 (4단계)
 * Step 1: 아이디 + 비밀번호
 * Step 2: 휴대폰 SMS 인증
 * Step 3: 역할 선택
 * Step 4: 역할별 추가정보 → 가입 → 자동 로그인
 */
import { ArrowLeft, Check, CircleAlert, CircleCheck, CircleX, Hash, MapPin, Search, Smartphone, Terminal } from "lucide-react-native";
import { toAsciiOnly } from "@/utils/koreanToQwerty";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, safeJson, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type Step = 1 | 2 | 3 | 4;
type Role = "admin" | "teacher" | "parent";
type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

interface Pool { id: string; name: string; address?: string; }
interface StudentInfo { id: string; name: string; birth_year?: string | null; }

const STEP_LABELS = ["기본정보", "휴대폰", "역할선택", "추가정보"];

const ROLE_CARDS: Array<{ role: Role; label: string; desc: string; icon: any; bg: string; color: string }> = [
  { role: "admin",   label: "수영장 대표",  desc: "수영장을 직접 운영하는 원장님·원감님\n선생님·학부모 관리 및 전체 운영 담당",     icon: "briefcase", bg: "#EFF4FF", color: "#4F6EF7" },
  { role: "teacher", label: "선생님",       desc: "수영장 대표로부터 초대코드를 받은\n선생님만 가입 가능합니다",                    icon: "award",     bg: "#DFF3EC", color: "#2E9B6F" },
  { role: "parent",  label: "학부모",       desc: "수영장에 회원 등록이 완료된\n학부모님만 가입 가능합니다",                    icon: "heart",     bg: "#FFF3E0", color: "#E4A93A" },
];

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { unifiedLogin, setParentSession, setAdminSession } = useAuth();

  const [step, setStep] = useState<Step>(1);

  /* ── Step 1 ── */
  const [loginId, setLoginId] = useState("");
  const [pw, setPw]           = useState("");
  const [pwc, setPwc]         = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [showPwc, setShowPwc] = useState(false);

  /* ── Step 2 ── */
  const [phone, setPhone]       = useState("");
  const [smsState, setSmsState] = useState<SmsState>("idle");
  const [smsCode, setSmsCode]   = useState("");
  const [smsError, setSmsError] = useState("");
  const [timer, setTimer]       = useState(0);
  const [devCode, setDevCode]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Step 3 ── */
  const [role, setRole] = useState<Role | null>(null);

  /* ── Step 4 ── */
  const [name, setName]             = useState("");
  const [poolSearch, setPoolSearch] = useState("");
  const [pools, setPools]           = useState<Pool[]>([]);
  const [allPools, setAllPools]     = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [poolsLoaded, setPoolsLoaded]   = useState(false);
  // Admin-only
  const [poolName, setPoolName]       = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [poolPhone, setPoolPhone]     = useState("");
  // Parent-only
  const [childName, setChildName]         = useState("");
  const [childBirthYear, setChildBirthYear] = useState("");
  const [parentStudentSearch, setParentStudentSearch]     = useState("");
  const [parentSearchResults, setParentSearchResults]     = useState<StudentInfo[] | null>(null);
  const [parentSearching, setParentSearching]             = useState(false);
  const [parentSelected, setParentSelected]               = useState<StudentInfo[]>([]);
  const parentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── General ── */
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [isPendingTeacher, setIsPendingTeacher] = useState(false);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  /* ──────────────────────────────────────────────── */
  /*  SMS helpers                                      */
  /* ──────────────────────────────────────────────── */
  function startTimer(seconds = 180) {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimer(seconds);
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          if (smsState !== "verified") { setSmsState("error"); setSmsError("인증시간이 만료되었습니다."); }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function fmtTimer(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

  async function handleSendSms() {
    setSmsError(""); setDevCode(null);
    const cleaned = phone.replace(/[-\s]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(cleaned)) { setSmsError("올바른 휴대폰 번호를 입력해주세요."); return; }
    setSmsState("sending");
    try {
      const res  = await fetch(`${API_BASE}/auth/send-sms-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: cleaned, purpose: "signup" }) });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "발송에 실패했습니다.");
      setSmsState("sent"); setSmsCode(""); startTimer(180);
      if (data.dev_code) setDevCode(data.dev_code);
    } catch (e: any) { setSmsState("error"); setSmsError(e.message?.includes("JSON") ? "서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요." : (e.message || "잠시 후 다시 시도해주세요.")); }
  }

  async function handleVerifySms() {
    setSmsError("");
    if (smsCode.trim().length !== 6) { setSmsError("6자리 인증번호를 입력해주세요."); return; }
    setSmsState("verifying");
    try {
      const cleaned = phone.replace(/[-\s]/g, "");
      const res  = await fetch(`${API_BASE}/auth/verify-sms-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: cleaned, code: smsCode.trim(), purpose: "signup" }) });
      const data = await safeJson(res);
      if (!res.ok) { setSmsState("sent"); setSmsError(data.message || "인증번호가 올바르지 않습니다."); return; }
      if (timerRef.current) clearInterval(timerRef.current);
      setSmsState("verified");
    } catch { setSmsState("sent"); setSmsError("인증에 실패했습니다. 다시 시도해주세요."); }
  }

  /* ──────────────────────────────────────────────── */
  /*  Pool search (teacher / parent)                   */
  /* ──────────────────────────────────────────────── */
  useEffect(() => {
    if (step === 4 && (role === "teacher" || role === "parent") && !poolsLoaded) {
      (async () => {
        try {
          const res = await fetch(`${API_BASE}/pools/public-search`);
          const d   = await res.json();
          if (d.success && Array.isArray(d.data)) { setAllPools(d.data); setPools(d.data); }
        } catch {}
        setPoolsLoaded(true);
      })();
    }
  }, [step, role, poolsLoaded]);

  async function doParentStudentSearch(q: string) {
    if (!q.trim() || !selectedPool) { setParentSearchResults(null); return; }
    setParentSearching(true);
    try {
      const res = await fetch(
        `${API_BASE}/auth/pool-student-search?pool_id=${encodeURIComponent(selectedPool.id)}&name=${encodeURIComponent(q.trim())}`
      );
      const data = await res.json();
      setParentSearchResults(Array.isArray(data) ? data : []);
    } catch { setParentSearchResults([]); }
    finally { setParentSearching(false); }
  }

  function onParentStudentSearchChange(q: string) {
    setParentStudentSearch(q);
    if (parentDebounceRef.current) clearTimeout(parentDebounceRef.current);
    if (!q.trim()) { setParentSearchResults(null); return; }
    parentDebounceRef.current = setTimeout(() => doParentStudentSearch(q), 400);
  }

  function addParentStudent(s: StudentInfo) {
    if (parentSelected.some(p => p.id === s.id)) return;
    if (parentSelected.length >= 4) return;
    setParentSelected(prev => [...prev, s]);
    setParentStudentSearch("");
    setParentSearchResults(null);
  }

  function removeParentStudent(id: string) {
    setParentSelected(prev => prev.filter(s => s.id !== id));
  }

  useEffect(() => {
    if (!poolSearch.trim()) { setPools(allPools); return; }
    const q = poolSearch.trim().toLowerCase();
    setPools(allPools.filter(p => p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q)));
  }, [poolSearch, allPools]);

  /* ──────────────────────────────────────────────── */
  /*  Step navigation                                  */
  /* ──────────────────────────────────────────────── */
  function goBack() {
    if (step === 1) { router.back(); return; }
    setError("");
    setStep((s) => (s - 1) as Step);
  }

  function validateStep1(): string | null {
    if (loginId.trim().length < 4) return "아이디는 4자 이상이어야 합니다.";
    if (pw.length < 4)             return "비밀번호는 4자 이상이어야 합니다.";
    if (pw !== pwc)                return "비밀번호가 일치하지 않습니다.";
    return null;
  }

  function validateStep2(): string | null {
    if (smsState !== "verified") return "휴대폰 인증을 완료해주세요.";
    return null;
  }

  function validateStep3(): string | null {
    if (!role) return "역할을 선택해주세요.";
    return null;
  }

  function nextStep() {
    setError("");
    if (step === 1) {
      const e = validateStep1(); if (e) { setError(e); return; }
      setStep(2); return;
    }
    if (step === 2) {
      const e = validateStep2(); if (e) { setError(e); return; }
      setStep(3); return;
    }
    if (step === 3) {
      const e = validateStep3(); if (e) { setError(e); return; }
      setStep(4); return;
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Submit                                           */
  /* ──────────────────────────────────────────────── */
  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("실명을 입력해주세요."); return; }

    if (role === "admin") {
      if (!poolName.trim())    { setError("수영장 이름을 입력해주세요."); return; }
      if (!poolAddress.trim()) { setError("수영장 주소를 입력해주세요."); return; }
      if (!poolPhone.trim())   { setError("수영장 전화번호를 입력해주세요."); return; }
    } else if (role === "teacher") {
      if (!selectedPool) { setError("수영장을 선택해주세요."); return; }
    } else if (role === "parent") {
      if (!selectedPool) { setError("수영장을 선택해주세요."); return; }
    }

    setLoading(true);
    try {
      const cleaned = phone.replace(/[-\s]/g, "");
      let res: Response;
      let data: any;

      if (role === "admin") {
        res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: loginId.trim().toLowerCase(),
            password: pw,
            name: name.trim(),
            phone: cleaned,
            role: "pool_admin",
            pool_name: poolName.trim(),
            pool_address: poolAddress.trim(),
            pool_phone: poolPhone.trim(),
            pool_owner_name: name.trim(),
          }),
        });
        data = await safeJson(res);
        if (!res.ok) { setError(data.error || data.message || "가입에 실패했습니다."); return; }

      } else if (role === "teacher") {
        res = await fetch(`${API_BASE}/auth/teacher-self-signup`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            loginId: loginId.trim().toLowerCase(),
            password: pw,
            phone: cleaned,
            pool_id: selectedPool!.id,
          }),
        });
        data = await safeJson(res);
        if (!res.ok) { setError(data.error || data.message || "가입에 실패했습니다."); return; }

        if (data.status === "pending_approval") {
          setIsPendingTeacher(true);
          setLoading(false);
          return;
        }

      } else if (role === "parent") {
        const childIds   = parentSelected.map(s => s.id);
        const childNames = parentSelected.length > 0
          ? parentSelected.map(s => s.name)
          : childName.trim() ? [childName.trim()] : [];
        res = await fetch(`${API_BASE}/auth/simple-parent-register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parent_name: name.trim(),
            phone: cleaned,
            loginId: loginId.trim().toLowerCase() || undefined,
            password: pw,
            pool_id: selectedPool!.id,
            child_ids: childIds.length > 0 ? childIds : undefined,
            child_names: childNames.length > 0 ? childNames : undefined,
          }),
        });
        data = await safeJson(res);
        if (!res.ok) {
          setError(data.error || data.message || "가입에 실패했습니다.");
          return;
        }
        if (data.token) {
          await setParentSession(data.token, data.parent);
          return;
        }
      }

      await unifiedLogin(loginId.trim().toLowerCase(), pw);
    } catch (e: any) {
      setError(e.message || "서버 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Render helpers                                   */
  /* ──────────────────────────────────────────────── */
  function StepDots() {
    return (
      <View style={styles.stepRow}>
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const active = n === step;
          const done   = n < step;
          return (
            <View key={n} style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: done ? C.tint : active ? C.tint : C.border }]}>
                {done
                  ? <Check size={12} color="#fff" />
                  : <Text style={[styles.stepNum, { color: active ? "#fff" : C.textMuted }]}>{n}</Text>}
              </View>
              <Text style={[styles.stepLabel, { color: active ? C.tint : C.textMuted }]}>{label}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  /* ──────────────────────────────────────────────── */
  /*  Step content                                     */
  /* ──────────────────────────────────────────────── */
  function renderStep1() {
    return (
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { color: C.text }]}>기본 정보 입력</Text>

        <InputField label="아이디" icon="user">
          <TextInput
            style={[styles.input, { color: C.text }]}
            placeholder="영문·숫자 4자 이상"
            placeholderTextColor={C.textMuted}
            value={loginId}
            onChangeText={v => setLoginId(toAsciiOnly(v))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            returnKeyType="next"
          />
        </InputField>

        <InputField label="비밀번호" icon="lock">
          <TextInput
            style={[styles.input, { color: C.text }]}
            placeholder="4자 이상"
            placeholderTextColor={C.textMuted}
            value={pw}
            onChangeText={v => setPw(toAsciiOnly(v))}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            returnKeyType="next"
          />
          <Pressable onPress={() => setShowPw(v => !v)}>
            <LucideIcon name={showPw ? "eye-off" : "eye"} size={18} color={C.textMuted} />
          </Pressable>
        </InputField>

        <InputField label="비밀번호 확인" icon="lock">
          <TextInput
            style={[styles.input, { color: C.text }]}
            placeholder="비밀번호 재입력"
            placeholderTextColor={C.textMuted}
            value={pwc}
            onChangeText={v => setPwc(toAsciiOnly(v))}
            secureTextEntry={!showPwc}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            returnKeyType="done"
          />
          <Pressable onPress={() => setShowPwc(v => !v)}>
            <LucideIcon name={showPwc ? "eye-off" : "eye"} size={18} color={C.textMuted} />
          </Pressable>
        </InputField>
      </View>
    );
  }

  function renderStep2() {
    const verified = smsState === "verified";
    return (
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { color: C.text }]}>휴대폰 인증</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: C.textSecondary }]}>휴대폰 번호</Text>
          <View style={styles.phoneRow}>
            <View style={[styles.inputBox, { flex: 1, borderColor: C.border, backgroundColor: C.background }]}>
              <Smartphone size={15} color={C.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                placeholder="010-0000-0000"
                placeholderTextColor={C.textMuted}
                value={phone}
                onChangeText={v => setPhone(v.replace(/[^0-9\-]/g, ""))}
                keyboardType="number-pad"
                autoCorrect={false}
                autoCapitalize="none"
                editable={!verified}
              />
            </View>
            <Pressable
              style={[styles.smsBtn, { backgroundColor: verified ? C.border : C.tint, opacity: smsState === "sending" ? 0.7 : 1 }]}
              onPress={handleSendSms}
              disabled={verified || smsState === "sending"}
            >
              {smsState === "sending"
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.smsBtnTxt}>{smsState === "sent" ? "재발송" : "인증"}</Text>}
            </Pressable>
          </View>
          {smsError ? <Text style={styles.smsErrTxt}>{smsError}</Text> : null}
        </View>

        {(smsState === "sent" || smsState === "verifying" || smsState === "verified") && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>인증번호</Text>
            <View style={styles.codeRow}>
              <View style={[styles.inputBox, { flex: 1, borderColor: verified ? C.tint : C.border, backgroundColor: C.background }]}>
                <Hash size={15} color={verified ? C.tint : C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  placeholder="6자리 입력"
                  placeholderTextColor={C.textMuted}
                  value={smsCode}
                  onChangeText={setSmsCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!verified}
                />
                {timer > 0 && !verified && (
                  <Text style={[styles.timerTxt, { color: C.tint }]}>{fmtTimer(timer)}</Text>
                )}
              </View>
              {!verified && (
                <Pressable
                  style={[styles.smsBtn, { backgroundColor: C.tint, opacity: smsState === "verifying" ? 0.7 : 1 }]}
                  onPress={handleVerifySms}
                  disabled={smsState === "verifying"}
                >
                  {smsState === "verifying"
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.smsBtnTxt}>확인</Text>}
                </Pressable>
              )}
            </View>
            {verified && (
              <View style={styles.verifiedRow}>
                <CircleCheck size={14} color={C.tint} />
                <Text style={[styles.verifiedTxt, { color: C.tint }]}>인증 완료</Text>
              </View>
            )}
          </View>
        )}

        {devCode && (
          <View style={styles.devCodeBox}>
            <Terminal size={13} color="#856404" />
            <Text style={styles.devCodeLabel}>개발용 코드:</Text>
            <Text style={styles.devCodeNum}>{devCode}</Text>
          </View>
        )}
      </View>
    );
  }

  function renderStep3() {
    return (
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { color: C.text }]}>역할 선택</Text>
        <Text style={[styles.cardDesc, { color: C.textSecondary }]}>어떤 역할로 가입하시겠어요?</Text>
        {ROLE_CARDS.map(r => (
          <Pressable
            key={r.role}
            style={[styles.roleCard, { borderColor: role === r.role ? C.tint : C.border, borderWidth: role === r.role ? 2 : 1.5 }]}
            onPress={() => setRole(r.role)}
          >
            <View style={[styles.roleIcon, { backgroundColor: r.bg }]}>
              <LucideIcon name={r.icon} size={22} color={r.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.roleLabel, { color: C.text }]}>{r.label}</Text>
              <Text style={[styles.roleDesc, { color: C.textSecondary }]}>{r.desc}</Text>
            </View>
            {role === r.role && <CircleCheck size={18} color={C.tint} />}
          </Pressable>
        ))}
      </View>
    );
  }

  function renderStep4() {
    return (
      <View style={{ gap: 16 }}>
        {/* 실명 */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: C.text }]}>
            {role === "admin" ? "운영자 정보" : role === "teacher" ? "선생님 정보" : "보호자 정보"}
          </Text>
          <InputField label="실명" icon="user">
            <TextInput
              style={[styles.input, { color: C.text }]}
              placeholder="실명을 입력해주세요 (한글)"
              placeholderTextColor={C.textMuted}
              value={name}
              onChangeText={v => setName(v.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ\s]/g, ""))}
              keyboardType="default"
              autoCorrect={false}
              autoCapitalize="none"
            />
          </InputField>
        </View>

        {/* 관리자: 수영장 정보 직접 입력 */}
        {role === "admin" && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 정보</Text>
            <InputField label="수영장 이름" icon="map-pin">
              <TextInput style={[styles.input, { color: C.text }]} placeholder="예: 스윔노트 수영장" placeholderTextColor={C.textMuted} value={poolName} onChangeText={setPoolName} />
            </InputField>
            <InputField label="수영장 주소" icon="map">
              <TextInput style={[styles.input, { color: C.text }]} placeholder="도로명 주소" placeholderTextColor={C.textMuted} value={poolAddress} onChangeText={setPoolAddress} />
            </InputField>
            <InputField label="수영장 전화번호" icon="phone">
              <TextInput style={[styles.input, { color: C.text }]} placeholder="02-0000-0000" placeholderTextColor={C.textMuted} value={poolPhone} onChangeText={setPoolPhone} keyboardType="phone-pad" />
            </InputField>
          </View>
        )}

        {/* 학부모: 수영장 선택 */}
        {role === "parent" && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 선택</Text>
            {selectedPool ? (
              <View style={styles.selectedPool}>
                <View style={[styles.poolIconSm, { backgroundColor: "#E6FAF8" }]}>
                  <Check size={14} color={C.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolNameSm, { color: C.text }]}>{selectedPool.name}</Text>
                  {selectedPool.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{selectedPool.address}</Text> : null}
                </View>
                <Pressable onPress={() => { setSelectedPool(null); setParentSelected([]); setParentSearchResults(null); setParentStudentSearch(""); }}>
                  <CircleX size={18} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <Search size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    placeholder="수영장 이름 검색"
                    placeholderTextColor={C.textMuted}
                    value={poolSearch}
                    onChangeText={setPoolSearch}
                  />
                </View>
                {!poolsLoaded && (
                  <ActivityIndicator size="small" color={C.tint} style={{ marginTop: 8 }} />
                )}
                {poolsLoaded && pools.length === 0 && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>검색 결과가 없습니다.</Text>
                )}
                {pools.slice(0, 6).map(p => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.poolItem, { backgroundColor: pressed ? "#F0FAF9" : C.background, borderColor: C.border }]}
                    onPress={() => setSelectedPool(p)}
                  >
                    <View style={[styles.poolIconSm, { backgroundColor: "#E6FAF8" }]}>
                      <MapPin size={13} color={C.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.poolNameSm, { color: C.text }]}>{p.name}</Text>
                      {p.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{p.address}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        )}

        {/* 학부모: 자녀 검색 (수영장 선택 후) */}
        {role === "parent" && selectedPool && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>자녀 선택</Text>
            <Text style={[styles.cardHint, { color: C.textSecondary }]}>
              {selectedPool.name}에 등록된 자녀를 검색해 선택하세요 (최대 4명)
            </Text>

            {/* 이미 선택된 자녀 칩 */}
            {parentSelected.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {parentSelected.map(s => (
                  <View key={s.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#E6FAF8", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 6 }}>
                    <Text style={{ fontSize: 13, color: C.text, fontFamily: "Pretendard-Regular" }}>{s.name}</Text>
                    {s.birth_year ? <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>{s.birth_year}년</Text> : null}
                    <Pressable onPress={() => removeParentStudent(s.id)} hitSlop={8}>
                      <CircleX size={15} color={C.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* 자녀 이름 검색 입력 */}
            {parentSelected.length < 4 && (
              <>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <Search size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    placeholder="자녀 이름 검색 (예: 홍길동)"
                    placeholderTextColor={C.textMuted}
                    value={parentStudentSearch}
                    onChangeText={onParentStudentSearchChange}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {parentSearching && <ActivityIndicator size="small" color={C.tint} />}
                </View>

                {/* 검색 결과 */}
                {parentSearchResults !== null && (
                  parentSearchResults.length === 0 ? (
                    <View style={{ paddingVertical: 10 }}>
                      <Text style={[styles.emptyTxt, { color: C.textMuted }]}>등록된 학생을 찾을 수 없습니다.</Text>
                      <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: 4 }}>
                        수영장 담당자에게 등록 확인 후 다시 시도해주세요.
                      </Text>
                    </View>
                  ) : (
                    parentSearchResults.slice(0, 5).map(s => (
                      <Pressable
                        key={s.id}
                        style={({ pressed }) => [styles.poolItem, { backgroundColor: pressed ? "#F0FAF9" : C.background, borderColor: C.border }]}
                        onPress={() => addParentStudent(s)}
                      >
                        <View style={[styles.poolIconSm, { backgroundColor: "#E6FAF8" }]}>
                          <LucideIcon name="user" size={13} color={C.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.poolNameSm, { color: C.text }]}>{s.name}</Text>
                          {s.birth_year ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{s.birth_year}년생</Text> : null}
                        </View>
                        <Text style={{ fontSize: 12, color: C.tint, fontFamily: "Pretendard-Regular" }}>선택</Text>
                      </Pressable>
                    ))
                  )
                )}
              </>
            )}

            {/* 자녀 없이 가입 안내 */}
            {parentSelected.length === 0 && (
              <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: 6 }}>
                자녀를 찾지 못해도 가입은 가능합니다. 가입 후 관리자에게 연결 요청하세요.
              </Text>
            )}
          </View>
        )}

        {/* 선생님: 수영장 검색 */}
        {role === "teacher" && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 선택</Text>
            {selectedPool ? (
              <View style={styles.selectedPool}>
                <View style={[styles.poolIconSm, { backgroundColor: "#E6FAF8" }]}>
                  <Check size={14} color={C.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolNameSm, { color: C.text }]}>{selectedPool.name}</Text>
                  {selectedPool.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{selectedPool.address}</Text> : null}
                </View>
                <Pressable onPress={() => setSelectedPool(null)}>
                  <CircleX size={18} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <Search size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    placeholder="수영장 이름 검색"
                    placeholderTextColor={C.textMuted}
                    value={poolSearch}
                    onChangeText={setPoolSearch}
                  />
                </View>
                {!poolsLoaded && (
                  <ActivityIndicator size="small" color={C.tint} style={{ marginTop: 8 }} />
                )}
                {poolsLoaded && pools.length === 0 && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>검색 결과가 없습니다.</Text>
                )}
                {pools.slice(0, 6).map(p => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.poolItem, { backgroundColor: pressed ? "#F0FAF9" : C.background, borderColor: C.border }]}
                    onPress={() => setSelectedPool(p)}
                  >
                    <View style={[styles.poolIconSm, { backgroundColor: "#E6FAF8" }]}>
                      <MapPin size={13} color={C.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.poolNameSm, { color: C.text }]}>{p.name}</Text>
                      {p.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{p.address}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        )}

      </View>
    );
  }

  /* ──────────────────────────────────────────────── */
  /*  Main render                                      */
  /* ──────────────────────────────────────────────── */
  const isLastStep = step === 4;

  /* ── 선생님 승인 대기 화면 ── */
  if (isPendingTeacher) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 아이콘 */}
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#E6FAF8", alignItems: "center", justifyContent: "center" }}>
              <CircleCheck size={42} color={C.tint} />
            </View>
          </View>

          {/* 텍스트 */}
          <Text style={{ fontSize: 22, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center", marginBottom: 12 }}>
            가입 요청 완료
          </Text>
          <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 24, marginBottom: 8 }}>
            수영장 관리자가 승인하면{"\n"}앱을 이용할 수 있습니다.
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 36 }}>
            승인 완료 후 로그인 화면에서{"\n"}가입하신 아이디로 로그인해 주세요.
          </Text>

          {/* 안내 카드 */}
          <View style={{ backgroundColor: C.card, borderRadius: 16, padding: 18, gap: 12, marginBottom: 32, borderWidth: 1, borderColor: C.border }}>
            {[
              "수영장 관리자가 가입 요청을 검토합니다.",
              "승인이 완료되면 로그인이 가능합니다.",
              "문의는 가입한 수영장에 직접 연락해 주세요.",
            ].map((txt, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#E6FAF8", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.tint }}>{i + 1}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 }}>{txt}</Text>
              </View>
            ))}
          </View>

          {/* 첫 화면으로 돌아가기 버튼 */}
          <Pressable
            style={({ pressed }) => ({ backgroundColor: C.tint, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}
            onPress={() => router.replace("/" as any)}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" }}>첫 화면으로 돌아가기</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={[styles.root, { backgroundColor: C.background }]}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={goBack}>
            <ArrowLeft size={22} color={C.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: C.text }]}>회원가입</Text>
          <View style={{ width: 30 }} />
        </View>

        <StepDots />

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}

        {/* 에러 */}
        {error ? (
          <View style={[styles.errBox, { backgroundColor: "#FFF0F0" }]}>
            <CircleAlert size={14} color="#D96C6C" />
            <Text style={styles.errTxt}>{error}</Text>
          </View>
        ) : null}

        {/* 버튼 */}
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.tint, opacity: pressed || loading ? 0.8 : 1 }]}
          onPress={isLastStep ? handleSubmit : nextStep}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnTxt}>{isLastStep ? "가입 완료" : "다음"}</Text>}
        </Pressable>

        <Pressable style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Text style={[styles.loginLinkTxt, { color: C.textSecondary }]}>
            이미 계정이 있으신가요?{" "}
            <Text style={{ color: C.tint, fontFamily: "Pretendard-Regular" }}>로그인</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ── Sub-component ── */
function InputField({ label, icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  const C = Colors.light;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
        <LucideIcon name={icon} size={15} color={C.textMuted} style={{ marginRight: 8 }} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  container:   { paddingHorizontal: 20, gap: 20 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },

  stepRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 0 },
  stepItem:  { alignItems: "center", gap: 4, flex: 1 },
  stepDot:   { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepNum:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  stepLabel: { fontSize: 10, fontFamily: "Pretendard-Regular" },

  card:      { borderRadius: 20, backgroundColor: "#fff", padding: 20, gap: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  cardDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: -8 },
  cardHint:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginBottom: 4 },

  field:    { gap: 6 },
  label:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  input:    { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },

  phoneRow:    { flexDirection: "row", gap: 8, alignItems: "center" },
  smsBtn:      { height: 48, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  smsBtnTxt:   { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  codeRow:     { flexDirection: "row", gap: 8, alignItems: "center" },
  timerTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", marginLeft: 4 },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  verifiedTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  smsErrTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 2 },
  devCodeBox:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF3CD", borderRadius: 8, padding: 10 },
  devCodeLabel:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#856404" },
  devCodeNum:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#856404", letterSpacing: 2 },

  roleCard:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, backgroundColor: "#fff" },
  roleIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  roleDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },

  selectedPool: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: "#F0FAF9" },
  poolItem:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  poolIconSm:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  poolNameSm:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  poolAddrSm:   { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  emptyTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 8 },

  hintTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", lineHeight: 16, marginTop: -4 },

  errBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12 },
  errTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C", flex: 1 },

  primaryBtn:    { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primaryBtnTxt: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  loginLink:     { alignItems: "center", paddingVertical: 4 },
  loginLinkTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
