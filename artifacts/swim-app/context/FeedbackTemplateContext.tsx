/**
 * FeedbackTemplateContext — 선생님 개인 피드백 문장 템플릿 관리
 *
 * - AsyncStorage로 선생님 계정별(userId) 로컬 저장
 * - 변경 사항이 SentencePicker에 즉시 반영
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

export type SentenceLevel = "beginner" | "intermediate" | "advanced" | "custom";

export interface FeedbackTemplate {
  id: string;
  level: SentenceLevel;
  template_text: string;
}

export type CategoryLabels = Record<SentenceLevel, string>;

interface FeedbackTemplateContextType {
  templates: FeedbackTemplate[];
  labels: CategoryLabels;
  loaded: boolean;
  addTemplate: (level: SentenceLevel, text: string) => void;
  updateTemplate: (id: string, text: string) => void;
  deleteTemplate: (id: string) => void;
  updateLabel: (level: SentenceLevel, label: string) => void;
  resetCategory: (level: SentenceLevel) => void;
  resetAll: () => void;
}

/* ─── 기본 내장 문장 세트 ─────────────────────────────────────────── */
export const DEFAULT_TEMPLATES: FeedbackTemplate[] = [
  { id: "b01", level: "beginner",     template_text: "물에 대한 적응력이 빠르게 늘고 있습니다." },
  { id: "b02", level: "beginner",     template_text: "킥 동작을 차분하게 연습했습니다." },
  { id: "b03", level: "beginner",     template_text: "호흡 연습이 잘 이루어졌습니다." },
  { id: "b04", level: "beginner",     template_text: "발차기 자세가 점점 안정되고 있습니다." },
  { id: "b05", level: "beginner",     template_text: "물 속에서 눈을 뜨는 연습을 했습니다." },
  { id: "b06", level: "beginner",     template_text: "벽 잡고 킥 연습을 반복했습니다." },
  { id: "b07", level: "beginner",     template_text: "물 위에서 몸의 균형을 잡는 연습을 했습니다." },
  { id: "b08", level: "beginner",     template_text: "배영 자세의 기초를 연습했습니다." },
  { id: "b09", level: "beginner",     template_text: "자유형 팔 동작 기초를 배웠습니다." },
  { id: "b10", level: "beginner",     template_text: "수업 중 적극적으로 참여해 주었습니다." },
  { id: "b11", level: "beginner",     template_text: "물을 무서워하지 않고 잘 따라와 주었습니다." },
  { id: "b12", level: "beginner",     template_text: "오늘은 물 익히기와 호흡에 집중했습니다." },
  { id: "b13", level: "beginner",     template_text: "누워 뜨기 자세가 점점 안정적으로 변하고 있습니다." },
  { id: "b14", level: "beginner",     template_text: "입수 자세를 익히는 연습을 했습니다." },
  { id: "b15", level: "beginner",     template_text: "다음 수업에서는 자유형 기초를 이어갈 예정입니다." },

  { id: "i01", level: "intermediate", template_text: "자유형 25m를 안정적으로 수영했습니다." },
  { id: "i02", level: "intermediate", template_text: "호흡 타이밍을 맞추는 연습에 집중했습니다." },
  { id: "i03", level: "intermediate", template_text: "배영 50m 구간 연습을 진행했습니다." },
  { id: "i04", level: "intermediate", template_text: "평영 킥 동작의 정확도를 높였습니다." },
  { id: "i05", level: "intermediate", template_text: "턴 동작 연습을 시작했습니다." },
  { id: "i06", level: "intermediate", template_text: "팔과 발 동작의 타이밍을 맞추는 훈련을 했습니다." },
  { id: "i07", level: "intermediate", template_text: "지구력 향상을 위해 100m 인터벌 훈련을 했습니다." },
  { id: "i08", level: "intermediate", template_text: "자유형 풀링 동작을 집중 교정했습니다." },
  { id: "i09", level: "intermediate", template_text: "배영 팔 동작의 궤적을 교정했습니다." },
  { id: "i10", level: "intermediate", template_text: "평영 글라이드 동작이 많이 향상되었습니다." },
  { id: "i11", level: "intermediate", template_text: "오늘은 접영 기초 동작을 처음 연습했습니다." },
  { id: "i12", level: "intermediate", template_text: "수업 집중도가 매우 높았습니다." },
  { id: "i13", level: "intermediate", template_text: "체력이 꾸준히 향상되고 있습니다." },
  { id: "i14", level: "intermediate", template_text: "다음 수업에서는 평영 완성도를 높일 예정입니다." },
  { id: "i15", level: "intermediate", template_text: "앞으로도 꾸준한 연습을 부탁드립니다." },

  { id: "a01", level: "advanced",     template_text: "접영 200m 인터벌 훈련을 완료했습니다." },
  { id: "a02", level: "advanced",     template_text: "개인혼영 순서로 400m 완주를 목표로 했습니다." },
  { id: "a03", level: "advanced",     template_text: "출발 반응 속도와 다이빙 각도를 교정했습니다." },
  { id: "a04", level: "advanced",     template_text: "턴 후 유선형 자세를 집중 훈련했습니다." },
  { id: "a05", level: "advanced",     template_text: "페이스 조절 능력이 크게 향상되었습니다." },
  { id: "a06", level: "advanced",     template_text: "자유형 스트로크 효율을 높이는 드릴을 진행했습니다." },
  { id: "a07", level: "advanced",     template_text: "평영 킥 타이밍을 정밀하게 교정했습니다." },
  { id: "a08", level: "advanced",     template_text: "접영 리듬과 호흡 타이밍이 안정되었습니다." },
  { id: "a09", level: "advanced",     template_text: "목표 기록에 근접한 훌륭한 수영을 보여줬습니다." },
  { id: "a10", level: "advanced",     template_text: "대회를 대비한 페이스 분배 연습을 했습니다." },
  { id: "a11", level: "advanced",     template_text: "탄력 훈련으로 전반적 스피드를 향상시켰습니다." },
  { id: "a12", level: "advanced",     template_text: "고강도 훈련에도 집중력을 잃지 않았습니다." },
  { id: "a13", level: "advanced",     template_text: "체계적인 훈련 계획에 잘 따라오고 있습니다." },
  { id: "a14", level: "advanced",     template_text: "유연성 강화 운동을 병행했습니다." },
  { id: "a15", level: "advanced",     template_text: "다음 목표를 설정하고 전략적으로 준비 중입니다." },
];

export const DEFAULT_LABELS: CategoryLabels = {
  beginner:     "초급",
  intermediate: "중급",
  advanced:     "상급",
  custom:       "커스텀",
};

const MAX_PER_CATEGORY = 100;

function storageKey(userId: string, type: "templates" | "labels") {
  return `feedback_${type}_${userId}`;
}

function genId(): string {
  return `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ─── Context ─────────────────────────────────────────────────── */
const FeedbackTemplateContext = createContext<FeedbackTemplateContextType>({
  templates: DEFAULT_TEMPLATES,
  labels: DEFAULT_LABELS,
  loaded: false,
  addTemplate: () => {},
  updateTemplate: () => {},
  deleteTemplate: () => {},
  updateLabel: () => {},
  resetCategory: () => {},
  resetAll: () => {},
});

export function useFeedbackTemplates() {
  return useContext(FeedbackTemplateContext);
}

/* ─── Provider ────────────────────────────────────────────────── */
export function FeedbackTemplateProvider({ children }: { children: React.ReactNode }) {
  const { adminUser } = useAuth();
  const userId: string = adminUser?.id || "anon";

  const [templates, setTemplates] = useState<FeedbackTemplate[]>(DEFAULT_TEMPLATES);
  const [labels,    setLabels]    = useState<CategoryLabels>(DEFAULT_LABELS);
  const [loaded,    setLoaded]    = useState(false);

  /* ── 초기 로드 ── */
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [tRaw, lRaw] = await Promise.all([
          AsyncStorage.getItem(storageKey(userId, "templates")),
          AsyncStorage.getItem(storageKey(userId, "labels")),
        ]);
        if (tRaw) setTemplates(JSON.parse(tRaw));
        if (lRaw) setLabels(JSON.parse(lRaw));
      } catch {}
      setLoaded(true);
    })();
  }, [userId]);

  /* ── 저장 헬퍼 ── */
  const persist = useCallback((t: FeedbackTemplate[], l: CategoryLabels) => {
    if (!userId) return;
    AsyncStorage.setItem(storageKey(userId, "templates"), JSON.stringify(t)).catch(() => {});
    AsyncStorage.setItem(storageKey(userId, "labels"),    JSON.stringify(l)).catch(() => {});
  }, [userId]);

  /* ── CRUD ── */
  const addTemplate = useCallback((level: SentenceLevel, text: string) => {
    setTemplates(prev => {
      const count = prev.filter(t => t.level === level).length;
      if (count >= MAX_PER_CATEGORY) return prev;
      const next = [...prev, { id: genId(), level, template_text: text }];
      persist(next, labels);
      return next;
    });
  }, [labels, persist]);

  const updateTemplate = useCallback((id: string, text: string) => {
    setTemplates(prev => {
      const next = prev.map(t => t.id === id ? { ...t, template_text: text } : t);
      persist(next, labels);
      return next;
    });
  }, [labels, persist]);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates(prev => {
      const next = prev.filter(t => t.id !== id);
      persist(next, labels);
      return next;
    });
  }, [labels, persist]);

  const updateLabel = useCallback((level: SentenceLevel, label: string) => {
    setLabels(prev => {
      const next = { ...prev, [level]: label };
      persist(templates, next);
      return next;
    });
  }, [templates, persist]);

  const resetCategory = useCallback((level: SentenceLevel) => {
    setTemplates(prev => {
      const others = prev.filter(t => t.level !== level);
      const defaults = level === "custom" ? [] : DEFAULT_TEMPLATES.filter(t => t.level === level);
      const next = [...others, ...defaults];
      persist(next, labels);
      return next;
    });
    setLabels(prev => {
      const next = { ...prev, [level]: DEFAULT_LABELS[level] };
      persist(templates, next);
      return next;
    });
  }, [labels, templates, persist]);

  const resetAll = useCallback(() => {
    setTemplates(DEFAULT_TEMPLATES);
    setLabels(DEFAULT_LABELS);
    persist(DEFAULT_TEMPLATES, DEFAULT_LABELS);
  }, [persist]);

  return (
    <FeedbackTemplateContext.Provider value={{
      templates, labels, loaded,
      addTemplate, updateTemplate, deleteTemplate,
      updateLabel, resetCategory, resetAll,
    }}>
      {children}
    </FeedbackTemplateContext.Provider>
  );
}
