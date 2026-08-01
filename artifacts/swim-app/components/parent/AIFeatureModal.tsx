/**
 * AIFeatureModal — AI 커리큘럼 / AI 성장 리포트 안내 모달
 *
 * - type prop으로 두 기능 분기
 * - fixedHeader + ScrollView(flex:1) + fixedFooter 구조
 * - modalContainer에 position:absolute 없음 (flex 레이아웃)
 * - 모달 열릴 때 스크롤 최상단 초기화
 */
import React, { useRef } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";

const C = Colors.light;
const TEAL = "#2EC4B6";

export type AIModalType = "curriculum" | "report";

interface Props {
  visible: boolean;
  type: AIModalType;
  onClose: () => void;
}

// ── 인라인 강조 헬퍼 ─────────────────────────────────────────────────────────
function Em({ children }: { children: string }) {
  return <Text style={m.emText}>{children}</Text>;
}

// ── 단락 헬퍼 ────────────────────────────────────────────────────────────────
function Para({
  children,
  bold,
  first,
}: {
  children: React.ReactNode;
  bold?: boolean;
  first?: boolean;
}) {
  return (
    <Text style={[m.bodyText, bold && m.bodyBold, first && { marginTop: 0 }]}>
      {children}
    </Text>
  );
}

// ── AI 커리큘럼 본문 ─────────────────────────────────────────────────────────
function CurriculumContent() {
  return (
    <>
      <Para bold first>
        세계 최초 수영 전문 AI 엔진 <Em>SWIMNOTE AI</Em>와{" "}
        <Em>OpenAI GPT</Em>가 결합된 차세대 AI 검색 서비스입니다.
      </Para>
      <Para>
        우리 수영장의 실제 교육 커리큘럼과 수영 전문 데이터베이스를 기반으로
        영법, 진도, 레벨 기준, 연습 방법 등을 쉽고 빠르게 검색할 수 있습니다.
      </Para>
      <Para>
        현재 토이키즈스윔클럽에서 SWIMNOTE AI와 OpenAI GPT{" "}
        <Em>독점 시범 서비스</Em>를 준비 중이며, 정식 출시 후 순차적으로
        확대될 예정입니다.
      </Para>
    </>
  );
}

// ── AI 성장 리포트 본문 ──────────────────────────────────────────────────────
function ReportContent() {
  return (
    <>
      <Para bold first>
        세계 최초 수영 전문 AI 엔진 <Em>SWIMNOTE AI</Em>와{" "}
        <Em>OpenAI GPT</Em>가 결합된 차세대 AI 성장 분석 서비스입니다.
      </Para>
      <Para>
        수영 학습 데이터를 분석하여{" "}
        <Em>130개의 평가 데이터</Em>로 구성된 종합 성장 리포트를 제공합니다.
      </Para>
      <Para>
        수영 과정에서 축적된 다양한 학습 데이터를 바탕으로 운동 능력뿐 아니라
        일반 학습과 관련된 <Em>집중력</Em>, <Em>논리적 사고</Em>,{" "}
        <Em>문제 해결 과정</Em> 등{" "}
        <Em>학습에도 도움이 될 수 있는 성장 지표</Em>를 함께 분석하여 아이의
        강점과 성장 방향을 확인할 수 있습니다.
      </Para>
      <Para>
        SWIMNOTE AI의 수영 전문 분석 기술과 OpenAI GPT 빅데이터 분석 결합을
        통해 부모님이 이해하기 쉬운 최종 분석 보고서를 제공합니다.
      </Para>
      <Para>
        성장평가분석 리포트 라이센스 최종 체결 후 서비스가 제공됩니다.
      </Para>
      <Para>
        현재 토이키즈스윔클럽에서 SWIMNOTE AI와 OpenAI GPT{" "}
        <Em>독점 시범 서비스</Em>를 준비 중이며, 정식 출시 후 순차적으로
        확대될 예정입니다.
      </Para>
    </>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function AIFeatureModal({ visible, type, onClose }: Props) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const isCurriculum = type === "curriculum";

  function handleShow() {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={handleShow}
    >
      {/* backdrop — 터치 시 닫기 */}
      <Pressable style={m.backdrop} onPress={onClose}>
        {/* modalContainer — 내부 터치 흡수 */}
        <Pressable
          style={[m.container, { maxHeight: screenHeight * 0.85 }]}
          onPress={() => {}}
        >
          {/* ── 고정 헤더 ── */}
          <View style={m.header}>
            <Image
              source={
                isCurriculum
                  ? require("@/assets/images/ai-curriculum-icon.png")
                  : require("@/assets/images/ai-report-icon.png")
              }
              style={m.headerIcon}
              resizeMode="contain"
            />
            <Text style={m.title} numberOfLines={1}>
              {isCurriculum ? "AI 커리큘럼 검색" : "AI 성장 리포트"}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [m.closeBtn, { opacity: pressed ? 0.5 : 1 }]}
            >
              <LucideIcon name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* ── 스크롤 본문 ── */}
          <ScrollView
            ref={scrollRef}
            style={m.scroll}
            contentContainerStyle={m.scrollContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {isCurriculum ? <CurriculumContent /> : <ReportContent />}
            <Text style={m.powered}>
              Powered by SWIMNOTE AI + OpenAI GPT
            </Text>
          </ScrollView>

          {/* ── 고정 푸터 ── */}
          <View
            style={[
              m.footer,
              { paddingBottom: Math.max(insets.bottom + 4, 20) },
            ]}
          >
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                m.confirmBtn,
                { backgroundColor: pressed ? "#27B8AC" : TEAL },
              ]}
            >
              <Text style={m.confirmTxt}>확인</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  container: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    // position:absolute 없음 — flex 레이아웃으로 높이 결정
  },
  // ── 헤더 ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    flexShrink: 0,
  },
  headerIcon: {
    width: 32,
    height: 32,
    marginRight: 10,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Pretendard-Bold",
    color: "#111827",
  },
  closeBtn: {
    marginLeft: 8,
    padding: 4,
  },
  // ── 본문 ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
  },
  bodyText: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: "#374151",
    lineHeight: 25,
    marginTop: 16,
  },
  bodyBold: {
    fontFamily: "Pretendard-SemiBold",
    color: "#111827",
  },
  emText: {
    fontFamily: "Pretendard-SemiBold",
    color: TEAL,
  },
  powered: {
    marginTop: 28,
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: "#AAAAAA",
    textAlign: "center",
  },
  // ── 푸터 ──
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    flexShrink: 0,
  },
  confirmBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmTxt: {
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
});
