/**
 * signup.tsx — 통합 회원가입 (최대 4단계)
 * 일반: Step1(기본정보) → Step2(휴대폰) → Step3(역할선택) → Step4(추가정보)
 * 소셜(카카오 전화있음): Step3(역할선택) → Step4(추가정보)
 * 소셜(애플·전화없음): Step2(휴대폰) → Step3(역할선택) → Step4(추가정보)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { CircleAlert } from "lucide-react-native";
import { validateName, validatePhone } from "@/utils/validation";
import { toAsciiOnly } from "@/utils/koreanToQwerty";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, safeJson, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type Step = 1 | 2 | 3 | 4;
type Role = "admin" | "teacher" | "parent";
type SmsState = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

interface Pool { id: string; name: string; address?: string; }

const STEP_LABELS = ["기본정보", "휴대폰", "역할선택", "추가정보"];

const ROLE_CARDS: Array<{ role: Role; label: string; desc: string; condition: string | null; icon: any; bg: string; color: string }> = [
  { role: "admin",   label: "수영장 대표", desc: "수영장을 직접 운영하는 원장/관리자\n또는 1인 레슨 팀을 운영하는 선생님",           condition: null,                                   icon: "briefcase", bg: "#EFF4FF", color: "#4F6EF7" },
  { role: "teacher", label: "선생님",      desc: "스윔노트에 가입된 수영장에서 근무 중인 선생님",                                    condition: "(수영장 대표의 초대 후 가입 가능)",    icon: "award",     bg: "#DFF3EC", color: "#2E9B6F" },
  { role: "parent",  label: "학부모",      desc: "스윔노트에 가입된 수영장에 자녀가 등록된 학부모",                                  condition: "(회원 등록 완료 후 이용 가능)",        icon: "heart",     bg: "#FFF3E0", color: "#E4A93A" },
];

function genRandomPassword() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "Aa1!";
}

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const { unifiedLogin, setParentSession, setAdminSession, finishLogin } = useAuth();

  // 소셜 가입 파라미터 (Apple 또는 카카오 인증 후 전달됨)
  const params = useLocalSearchParams<{
    appleId?: string; appleEmail?: string; appleName?: string;
    kakaoId?: string; kakaoPhone?: string; kakaoName?: string;
    kakaoPhoneMissing?: string;  // "1" = 카카오 전화번호 scope 미동의 → 직접 입력 안내
  }>();
  const appleId    = params.appleId    || "";
  const appleEmail = params.appleEmail || "";
  const appleName  = params.appleName  || "";
  const kakaoId    = params.kakaoId    || "";
  const kakaoPhone = params.kakaoPhone || "";
  const kakaoName  = params.kakaoName  || "";
  // phone_missing=true이면 카카오 scope 미동의 → Step2에서 "카카오 전화번호를 확인할 수 없어 직접 입력합니다" 안내
  const kakaoPhoneMissing = params.kakaoPhoneMissing === "1";

  const isSocial       = !!(appleId || kakaoId);
  const socialPhone    = kakaoPhone || "";              // 카카오는 전화번호 제공, 애플은 없음
  const hasSocialPhone = isSocial && !!socialPhone;    // 전화 이미 알면 Step2 건너뜀
  const socialName     = appleName || kakaoName || "";  // 이름 미리채움용

  // 소셜: 전화있으면 Step3, 전화없으면 Step2, 일반은 Step1
  const initialStep: Step = isSocial ? (hasSocialPhone ? 3 : 2) : 1;

  const [step, setStep] = useState<Step>(initialStep);

  /* ── Step 1 ── */
  const [loginId, setLoginId] = useState("");
  const [pw, setPw]           = useState("");
  const [pwc, setPwc]         = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [showPwc, setShowPwc] = useState(false);

  /* ── Step 2 ── */
  const [phone, setPhone]       = useState(socialPhone);  // 카카오 전화번호 미리 채움
  const [smsState, setSmsState] = useState<SmsState>(hasSocialPhone ? "verified" : "idle");
  const [smsCode, setSmsCode]   = useState("");
  const [smsError, setSmsError] = useState("");
  const [timer, setTimer]       = useState(0);
  const [devCode, setDevCode]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Step 3 ── */
  const [role, setRole] = useState<Role | null>(null);

  /* ── Step 4 ── */
  const [name, setName]             = useState(socialName);  // 소셜 이름 미리채움
  const [childName, setChildName]   = useState("");   // V2: 학부모 자녀 이름
  const [poolSearch, setPoolSearch] = useState("");
  const [pools, setPools]           = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  type PoolSearchState = "idle" | "loading" | "loaded" | "empty" | "error";
  const [poolSearchState, setPoolSearchState] = useState<PoolSearchState>("idle");
  const [poolSearchError, setPoolSearchError] = useState("");
  const poolSearchAbortRef = useRef<AbortController | null>(null);
  const poolSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Admin-only
  const [poolName, setPoolName]       = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [poolPhone, setPoolPhone]     = useState("");

  /* ── General ── */
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [isPendingTeacher, setIsPendingTeacher] = useState(false);

  /* ── Kakao Migration Notice (1.6.3 임시) ── */
  const [kakaoMigrationNotice, setKakaoMigrationNotice] = useState(false);
  // 마이그레이션 notice 확인 후 실제 migration 호출 시 사용할 대기 resolve
  const migrationConfirmRef = useRef<(() => void) | null>(null);
  const [fieldErrors, setFieldErrors] = useState({ pw: "", pwc: "", name: "", poolName: "" });
  const scrollRef = useRef<any>(null);
  const hasFieldErrors = Object.values(fieldErrors).some(v => !!v);

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
  /*  Pool search (teacher & parent) — debounce + 전방일치 */
  /* ──────────────────────────────────────────────── */
  useEffect(() => {
    if (step !== 4 || (role !== "teacher" && role !== "parent")) return;

    const q = poolSearch.trim();

    // 검색어 없음 → idle 상태, API 호출 금지
    if (!q) {
      if (poolSearchAbortRef.current) { poolSearchAbortRef.current.abort(); poolSearchAbortRef.current = null; }
      if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
      setPools([]);
      setPoolSearchState("idle");
      setPoolSearchError("");
      return;
    }

    // 새 검색어 입력 → 즉시 loading 전환 (이전 결과 보이지 않도록)
    setPoolSearchState("loading");

    if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
    poolSearchTimerRef.current = setTimeout(async () => {
      if (poolSearchAbortRef.current) poolSearchAbortRef.current.abort();
      const ctrl = new AbortController();
      poolSearchAbortRef.current = ctrl;
      try {
        const res = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        const d = await res.json();
        if (ctrl.signal.aborted) return;
        if (d.success && Array.isArray(d.data)) {
          setPools(d.data);
          setPoolSearchState(d.data.length > 0 ? "loaded" : "empty");
          setPoolSearchError("");
        } else {
          setPools([]);
          setPoolSearchState("error");
          setPoolSearchError("검색 결과를 불러오지 못했습니다.");
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setPools([]);
        setPoolSearchState("error");
        setPoolSearchError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      }
    }, 300);

    return () => {
      if (poolSearchTimerRef.current) clearTimeout(poolSearchTimerRef.current);
      if (poolSearchAbortRef.current) { poolSearchAbortRef.current.abort(); poolSearchAbortRef.current = null; }
    };
  }, [poolSearch, step, role]);

  /* ──────────────────────────────────────────────── */
  /*  Step navigation                                  */
  /* ──────────────────────────────────────────────── */
  function goBack() {
    if (step === initialStep) { router.back(); return; }
    setError("");
    setStep((s) => (s - 1) as Step);
  }

  function validateStep1(): boolean {
    setError("");
    const errs = { pw: "", pwc: "", name: "", poolName: "" };
    let hasError = false;

    if (loginId.trim().length < 4) {
      setError("아이디는 4자 이상이어야 합니다.");
      hasError = true;
    }
    if (pw.length < 6) {
      errs.pw = "비밀번호는 6자 이상이어야 합니다";
      hasError = true;
    }
    if (!errs.pw && pw !== pwc) {
      errs.pwc = "비밀번호가 일치하지 않습니다";
      hasError = true;
    }

    setFieldErrors(errs);
    return !hasError;
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
      if (!validateStep1()) { scrollRef.current?.scrollTo({ y: 0, animated: true }); return; }
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
    const errs = { pw: "", pwc: "", name: "", poolName: "" };

    if (!validateName(name)) {
      errs.name = "이름을 입력해주세요";
    }

    if (role === "admin") {
      if (!validateName(poolName)) {
        errs.poolName = "수영장명을 입력해주세요";
      }
    }

    setFieldErrors(errs);
    if (errs.name || errs.poolName) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    if (role === "admin") {
      if (!poolAddress.trim()) { setError("수영장 주소를 입력해주세요."); return; }
      if (poolPhone && !validatePhone(poolPhone)) { setError("수영장 전화번호 형식이 올바르지 않습니다."); return; }
      if (!poolPhone.trim())   { setError("수영장 전화번호를 입력해주세요."); return; }
    } else if (role === "teacher") {
      if (!selectedPool) { setError("검색 결과에서 수영장을 선택해 주세요."); return; }
    } else if (role === "parent") {
      // V2: 가입 시 수영장 + 자녀 이름 필수
      if (!selectedPool) { setError("검색 결과에서 수영장을 선택해 주세요."); return; }
      if (!childName.trim()) { setError("우리 아이 이름을 입력해주세요."); return; }
    }

    setLoading(true);
    try {
      const cleaned = phone.replace(/[-\s]/g, "");

      // 소셜 가입 시 loginId/password 자동 생성
      const effectiveLoginId = isSocial
        ? (appleEmail || `user_${Date.now().toString(36)}`)
        : loginId.trim().toLowerCase();
      const effectivePw = isSocial ? genRandomPassword() : pw;

      // 소셜 ID 파라미터
      const socialBody = appleId ? { apple_id: appleId } : kakaoId ? { kakao_id: kakaoId } : {};

      let res: Response;
      let data: any;

      if (role === "admin") {
        res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: effectiveLoginId,
            password: effectivePw,
            name: name.trim(),
            phone: cleaned,
            role: "pool_admin",
            pool_name: poolName.trim(),
            pool_address: poolAddress.trim(),
            pool_phone: poolPhone.trim(),
            pool_owner_name: name.trim(),
            ...socialBody,
          }),
        });
        data = await safeJson(res);
        if (!res.ok) { setError(data.error || data.message || "가입에 실패했습니다."); return; }

      } else if (role === "teacher") {
        res = await fetch(`${API_BASE}/auth/teacher-self-signup`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            loginId: effectiveLoginId,
            password: effectivePw,
            phone: cleaned,
            pool_id: selectedPool!.id,
            ...socialBody,
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
        // V2: pool_id + child_name 포함하여 가입 시 즉시 자동연결 시도
        res = await fetch(`${API_BASE}/auth/v2/parent-register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parent_name: name.trim(),
            phone: cleaned,
            loginId: isSocial ? undefined : (loginId.trim().toLowerCase() || undefined),
            password: effectivePw,
            pool_id: selectedPool!.id,
            child_name: childName.trim(),
            ...socialBody,
          }),
        });
        data = await safeJson(res);

        // ── KAKAO_MIGRATION_REQUIRED (1.6.3 임시 전환 flow) ──────────────
        if (!res.ok && data?.error_code === "KAKAO_MIGRATION_REQUIRED") {
          setLoading(false);
          // 안내 모달 표시 후 사용자가 [계속] 누르면 migration 호출
          await new Promise<void>(resolve => {
            migrationConfirmRef.current = resolve;
            setKakaoMigrationNotice(true);
          });
          setLoading(true);
          setKakaoMigrationNotice(false);

          // migration endpoint 호출
          const migRes = await fetch(`${API_BASE}/auth/kakao-migration-register`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: cleaned,
              pool_id: selectedPool!.id,
              name: name.trim(),
              pin: effectivePw,
              login_id: isSocial ? undefined : (loginId.trim().toLowerCase() || undefined),
            }),
          });
          const migData = await safeJson(migRes);
          if (!migRes.ok) {
            const rawErr = migData?.error || "";
            setError(rawErr || "계정 전환 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
            return;
          }
          if (migData.token) {
            if (childName.trim()) await AsyncStorage.setItem("@swimnote:pending_child_name", childName.trim()).catch(() => {});
            await setParentSession(migData.token, migData.parent);
            finishLogin("parent", null, migData.parent, migData.token);
            return;
          }
          setError("계정 전환 처리 중 오류가 발생했습니다.");
          return;
        }
        // ─────────────────────────────────────────────────────────────────

        if (!res.ok) {
          // HTTP 5xx 또는 raw 기술 오류 메시지는 사용자 친화적 메시지로 교체
          const rawError = data.error || data.message || "";
          const isServerError = res.status >= 500
            || rawError.startsWith("Unexpected response")
            || rawError.startsWith("Internal Server Error");
          setError(isServerError
            ? "가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
            : (rawError || "가입에 실패했습니다."));
          return;
        }
        // 자녀 이름을 호칭 화면에서 자동 불러오기 위해 임시 저장
        if (childName.trim()) {
          await AsyncStorage.setItem("@swimnote:pending_child_name", childName.trim()).catch(() => {});
        }
        if (data.token) {
          await setParentSession(data.token, data.parent);
          finishLogin("parent", null, data.parent, data.token);
          return;
        }
      }

      // 서버가 token을 바로 반환하면 바로 세션 설정, 아니면 일반 로그인
      if (data?.token && data?.user) {
        await setAdminSession(data.token, data.user);
        finishLogin("admin", data.user, null, data.token);
      } else {
        await unifiedLogin(effectiveLoginId, effectivePw);
      }
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
    // 소셜: 보여줄 스텝만 필터링
    const visibleSteps: Array<{ n: Step; label: string }> = isSocial
      ? hasSocialPhone
        ? [{ n: 3, label: "역할선택" }, { n: 4, label: "추가정보" }]
        : [{ n: 2, label: "휴대폰" }, { n: 3, label: "역할선택" }, { n: 4, label: "추가정보" }]
      : [
          { n: 1, label: "기본정보" }, { n: 2, label: "휴대폰" },
          { n: 3, label: "역할선택" }, { n: 4, label: "추가정보" },
        ];
    return (
      <View style={styles.stepRow}>
        {visibleSteps.map(({ n, label }) => {
          const active = n === step;
          const done   = n < step;
          return (
            <View key={n} style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: done ? C.brandStrong : active ? C.brandStrong : C.border }]}>
                {done
                  ? <LucideIcon name="check" size={12} color="#fff" />
                  : <Text style={[styles.stepNum, { color: active ? "#fff" : C.textMuted }]}>{visibleSteps.findIndex(s => s.n === n) + 1}</Text>}
              </View>
              <Text style={[styles.stepLabel, { color: active ? C.brandStrong : C.textMuted }]}>{label}</Text>
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

        <InputField label="비밀번호" icon="lock" error={fieldErrors.pw}>
          <TextInput
            style={[styles.input, { color: C.text }]}
            placeholder="6자 이상"
            placeholderTextColor={C.textMuted}
            value={pw}
            onChangeText={v => { setPw(toAsciiOnly(v)); setFieldErrors(e => ({ ...e, pw: "" })); }}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            returnKeyType="next"
            textContentType="oneTimeCode"
          />
          <Pressable onPress={() => setShowPw(v => !v)}>
            <LucideIcon name={showPw ? "eye-off" : "eye"} size={18} color={C.textMuted} />
          </Pressable>
        </InputField>

        <InputField label="비밀번호 확인" icon="lock" error={fieldErrors.pwc}>
          <TextInput
            style={[styles.input, { color: C.text }]}
            placeholder="비밀번호 재입력"
            placeholderTextColor={C.textMuted}
            value={pwc}
            onChangeText={v => { setPwc(toAsciiOnly(v)); setFieldErrors(e => ({ ...e, pwc: "" })); }}
            secureTextEntry={!showPwc}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="ascii-capable"
            returnKeyType="done"
            textContentType="oneTimeCode"
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

        {/* 카카오 phone scope 미동의 시 안내 배너 */}
        {kakaoPhoneMissing && (
          <View style={{ backgroundColor: "#FFF9E6", borderRadius: 8, padding: 10, marginBottom: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <LucideIcon name="info" size={14} color="#B45309" />
            <Text style={{ fontSize: 12, color: "#92400E", flex: 1, lineHeight: 18 }}>
              카카오 계정 전화번호를 확인할 수 없습니다.{"\n"}수영장에 등록된 전화번호를 직접 입력해주세요.
            </Text>
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: C.textSecondary }]}>휴대폰 번호</Text>
          <View style={styles.phoneRow}>
            <View style={[styles.inputBox, { flex: 1, borderColor: C.border, backgroundColor: C.background }]}>
              <LucideIcon name="smartphone" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
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
              style={[styles.smsBtn, { backgroundColor: verified ? C.border : C.primaryAction, opacity: smsState === "sending" ? 0.7 : 1 }]}
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
              <View style={[styles.inputBox, { flex: 1, borderColor: verified ? C.brandStrong : C.border, backgroundColor: C.background }]}>
                <LucideIcon name="hash" size={15} color={verified ? C.brandStrong : C.textMuted} style={{ marginRight: 8 }} />
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
                  <Text style={[styles.timerTxt, { color: C.brandStrong }]}>{fmtTimer(timer)}</Text>
                )}
              </View>
              {!verified && (
                <Pressable
                  style={[styles.smsBtn, { backgroundColor: C.primaryAction, opacity: smsState === "verifying" ? 0.7 : 1 }]}
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
                <LucideIcon name="check-circle" size={14} color={C.brandStrong} />
                <Text style={[styles.verifiedTxt, { color: C.brandStrong }]}>인증 완료</Text>
              </View>
            )}
          </View>
        )}

        {devCode && (
          <View style={styles.devCodeBox}>
            <LucideIcon name="terminal" size={13} color="#856404" />
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
        <View style={{ gap: 12, marginTop: 4 }}>
          {ROLE_CARDS.map(r => {
            const selected = role === r.role;
            return (
              <Pressable
                key={r.role}
                style={[
                  styles.roleCard,
                  selected
                    ? { backgroundColor: C.brandStrong, borderColor: "#0099AA", borderWidth: 2 }
                    : { backgroundColor: "#fff", borderColor: "#E5E5E5", borderWidth: 1.5 },
                ]}
                onPress={() => setRole(r.role)}
              >
                {/* 우측 상단 체크 */}
                {selected && (
                  <View style={styles.roleCheckBadge}>
                    <LucideIcon name="check-circle" size={18} color="#fff" />
                  </View>
                )}
                <View style={[styles.roleIcon, { backgroundColor: selected ? "rgba(255,255,255,0.25)" : r.bg }]}>
                  <LucideIcon name={r.icon as any} size={22} color={selected ? "#fff" : r.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roleLabel, { color: selected ? "#fff" : C.text }]}>{r.label}</Text>
                  <Text style={[styles.roleDesc, { color: selected ? "rgba(255,255,255,0.85)" : C.textSecondary }]}>{r.desc}</Text>
                  {r.condition && (
                    <Text style={[styles.roleCond, { color: selected ? "rgba(255,255,255,0.7)" : "#999" }]}>{r.condition}</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function renderStep4() {
    return (
      <View style={{ gap: 16 }}>
        {/* 실명 */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: C.text }]}>
            {role === "admin" ? "운영자 정보" : role === "teacher" ? "선생님 정보" : "학부모 정보"}
          </Text>
          <InputField label="실명" icon="user" error={fieldErrors.name}>
            <TextInput
              style={[styles.input, { color: C.text }]}
              placeholder="실명을 입력해주세요 (한글)"
              placeholderTextColor={C.textMuted}
              value={name}
              onChangeText={v => { setName(v); setFieldErrors(e => ({ ...e, name: "" })); }}
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
            <InputField label="수영장 이름" icon="map-pin" error={fieldErrors.poolName}>
              <TextInput style={[styles.input, { color: C.text }]} placeholder="예: 스윔노트 수영장" placeholderTextColor={C.textMuted} value={poolName} onChangeText={v => { setPoolName(v); setFieldErrors(e => ({ ...e, poolName: "" })); }} />
            </InputField>
            <InputField label="수영장 주소" icon="map">
              <TextInput style={[styles.input, { color: C.text }]} placeholder="도로명 주소" placeholderTextColor={C.textMuted} value={poolAddress} onChangeText={setPoolAddress} />
            </InputField>
            <InputField label="수영장 전화번호" icon="phone">
              <TextInput style={[styles.input, { color: C.text }]} placeholder="02-0000-0000" placeholderTextColor={C.textMuted} value={poolPhone} onChangeText={setPoolPhone} keyboardType="phone-pad" />
            </InputField>
          </View>
        )}

        {/* 학부모 V2: 수영장 선택 + 자녀 이름 입력 (가입 시 즉시 자동연결 시도) */}
        {role === "parent" && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 선택</Text>
            {selectedPool ? (
              <View style={styles.selectedPool}>
                <View style={[styles.poolIconSm, { backgroundColor: "#FFF3E0" }]}>
                  <LucideIcon name="check" size={14} color="#E4A93A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolNameSm, { color: C.text }]}>{selectedPool.name}</Text>
                  {selectedPool.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{selectedPool.address}</Text> : null}
                </View>
                <Pressable onPress={() => setSelectedPool(null)}>
                  <LucideIcon name="x-circle" size={18} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="search" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    placeholder="수영장 이름 검색"
                    placeholderTextColor={C.textMuted}
                    value={poolSearch}
                    onChangeText={setPoolSearch}
                  />
                </View>
                {poolSearchState === "idle" && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>등록된 수영장 이름을 입력해 주세요.</Text>
                )}
                {poolSearchState === "loading" && (
                  <ActivityIndicator size="small" color="#E4A93A" style={{ marginTop: 8 }} />
                )}
                {poolSearchState === "empty" && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>일치하는 수영장이 없습니다.</Text>
                )}
                {poolSearchState === "error" && (
                  <View style={{ marginTop: 8, gap: 6 }}>
                    <Text style={[styles.emptyTxt, { color: C.error }]}>{poolSearchError}</Text>
                    <Pressable onPress={() => { setPoolSearchState("idle"); setPoolSearch(p => p + " "); setTimeout(() => setPoolSearch(p => p.trimEnd()), 0); }}>
                      <Text style={{ fontSize: 12, color: "#E4A93A", fontFamily: "Pretendard-Regular", textDecorationLine: "underline" }}>다시 시도</Text>
                    </Pressable>
                  </View>
                )}
                {poolSearchState === "loaded" && pools.map(p => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.poolItem, { backgroundColor: pressed ? "#FFF8F0" : C.background, borderColor: C.border }]}
                    onPress={() => { setSelectedPool(p); setPoolSearch(""); setPools([]); setPoolSearchState("idle"); }}
                  >
                    <View style={[styles.poolIconSm, { backgroundColor: "#FFF3E0" }]}>
                      <LucideIcon name="map-pin" size={13} color="#E4A93A" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.poolNameSm, { color: C.text }]}>{p.name}</Text>
                      {p.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{p.address}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* 자녀 이름 입력 */}
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, marginBottom: 8 }}>
                우리 아이 이름 (수영장 등록명)
              </Text>
              <View style={[styles.inputBox, { borderColor: childName ? "#E4A93A" : C.border, backgroundColor: C.background }]}>
                <LucideIcon name="user" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  placeholder="수영장에 등록된 자녀 이름"
                  placeholderTextColor={C.textMuted}
                  value={childName}
                  onChangeText={setChildName}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: 6, lineHeight: 17 }}>
                수영장에 등록된 이름과 정확히 일치해야 자동 연결됩니다.
              </Text>
            </View>
          </View>
        )}

        {/* 선생님: 수영장 검색 */}
        {role === "teacher" && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 선택</Text>
            {selectedPool ? (
              <View style={styles.selectedPool}>
                <View style={[styles.poolIconSm, { backgroundColor: C.brandSoft }]}>
                  <LucideIcon name="check" size={14} color={C.brandStrong} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.poolNameSm, { color: C.text }]}>{selectedPool.name}</Text>
                  {selectedPool.address ? <Text style={[styles.poolAddrSm, { color: C.textSecondary }]}>{selectedPool.address}</Text> : null}
                </View>
                <Pressable onPress={() => setSelectedPool(null)}>
                  <LucideIcon name="x-circle" size={18} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                  <LucideIcon name="search" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    style={[styles.input, { color: C.text }]}
                    placeholder="수영장 이름 검색"
                    placeholderTextColor={C.textMuted}
                    value={poolSearch}
                    onChangeText={setPoolSearch}
                  />
                </View>
                {poolSearchState === "idle" && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>등록된 수영장 이름을 입력해 주세요.</Text>
                )}
                {poolSearchState === "loading" && (
                  <ActivityIndicator size="small" color={C.brandStrong} style={{ marginTop: 8 }} />
                )}
                {poolSearchState === "empty" && (
                  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>일치하는 수영장이 없습니다.</Text>
                )}
                {poolSearchState === "error" && (
                  <View style={{ marginTop: 8, gap: 6 }}>
                    <Text style={[styles.emptyTxt, { color: C.error }]}>{poolSearchError}</Text>
                    <Pressable onPress={() => { setPoolSearchState("idle"); setPoolSearch(p => p + " "); setTimeout(() => setPoolSearch(p => p.trimEnd()), 0); }}>
                      <Text style={{ fontSize: 12, color: C.brandStrong, fontFamily: "Pretendard-Regular", textDecorationLine: "underline" }}>다시 시도</Text>
                    </Pressable>
                  </View>
                )}
                {poolSearchState === "loaded" && pools.map(p => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.poolItem, { backgroundColor: pressed ? "#F0FAF9" : C.background, borderColor: C.border }]}
                    onPress={() => { setSelectedPool(p); setPoolSearch(""); setPools([]); setPoolSearchState("idle"); }}
                  >
                    <View style={[styles.poolIconSm, { backgroundColor: C.brandSoft }]}>
                      <LucideIcon name="map-pin" size={13} color={C.brandStrong} />
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
        <KeyboardAwareScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 아이콘 */}
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <LucideIcon name="check-circle" size={42} color={C.brandStrong} />
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
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.brandStrong }}>{i + 1}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 }}>{txt}</Text>
              </View>
            ))}
          </View>

          {/* 로그인 화면으로 이동 */}
          <Pressable
            style={({ pressed }) => ({ backgroundColor: pressed ? C.textStrong : C.primaryAction, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" })}
            onPress={() => router.replace("/" as any)}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" }}>로그인 화면으로 이동</Text>
          </Pressable>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={[styles.root, { backgroundColor: C.background }]}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 에러 요약 배너 (필드 오류 있을 때) */}
        {hasFieldErrors && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", padding: 12, borderRadius: 10 }}>
            <CircleAlert size={15} color="#DC2626" />
            <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#DC2626" }}>
              입력 오류가 있습니다. 아래 항목을 확인해주세요.
            </Text>
          </View>
        )}
        {/* 헤더 */}
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={goBack}>
            <LucideIcon name="arrow-left" size={22} color={C.text} />
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
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: (step === 3 && !role) ? "#CCC" : (pressed || loading) ? C.textStrong : C.primaryAction },
          ]}
          onPress={isLastStep ? handleSubmit : nextStep}
          disabled={loading || (step === 3 && !role)}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnTxt}>{isLastStep ? "가입 완료" : "다음"}</Text>}
        </Pressable>

        <Pressable style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Text style={[styles.loginLinkTxt, { color: C.textSecondary }]}>
            이미 계정이 있으신가요?{" "}
            <Text style={{ color: C.brandStrong, fontFamily: "Pretendard-Regular" }}>로그인</Text>
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>

      {/* ── Kakao 마이그레이션 안내 모달 (1.6.3 임시 기능) ── */}
      {kakaoMigrationNotice && (
        <View style={styles.migrationOverlay}>
          <View style={styles.migrationCard}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#EFF4FF", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <LucideIcon name="info" size={26} color="#4F6EF7" />
              </View>
              <Text style={styles.migrationTitle}>기존 이용정보가 확인되었습니다</Text>
            </View>
            <Text style={styles.migrationDesc}>
              기존 카카오 계정의 학생정보와 이용기록이 확인되었습니다.{"\n"}
              일반회원 가입을 계속하면 기존 이용정보가{"\n"}
              새 일반계정으로 자동으로 이전됩니다.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.migrationBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => {
                if (migrationConfirmRef.current) {
                  const fn = migrationConfirmRef.current;
                  migrationConfirmRef.current = null;
                  fn();
                }
              }}
            >
              <Text style={styles.migrationBtnTxt}>계속</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/* ── Sub-component ── */
function InputField({ label, icon, children, error }: { label: string; icon: any; children: React.ReactNode; error?: string }) {
  const C = Colors.light;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: error ? "#D96C6C" : C.border, backgroundColor: C.background }]}>
        <LucideIcon name={icon} size={15} color={C.textMuted} style={{ marginRight: 8 }} />
        {children}
      </View>
      {error ? <Text style={styles.fieldErrTxt}>{error}</Text> : null}
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
  devCodeNum:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#856404" },

  roleCard:       { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 16, position: "relative" },
  roleCheckBadge: { position: "absolute", top: 10, right: 10 },
  roleIcon:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:      { fontSize: 15, fontFamily: "Pretendard-SemiBold", fontWeight: "600" },
  roleDesc:       { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 3, lineHeight: 20 },
  roleCond:       { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 4 },

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
  fieldErrTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 2 },

  /* ── Kakao Migration Notice overlay ── */
  migrationOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 24,
    zIndex: 999,
  },
  migrationCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  migrationTitle: { fontSize: 17, fontFamily: "Pretendard-SemiBold", fontWeight: "600", color: "#0a2540", textAlign: "center" },
  migrationDesc:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#475569", lineHeight: 22, textAlign: "center", marginBottom: 20 },
  migrationBtn:   { backgroundColor: "#0a2540", borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  migrationBtnTxt:{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold", fontWeight: "600" },
});
