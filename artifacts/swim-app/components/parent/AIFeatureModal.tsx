/**
 * AIFeatureModal — AI 커리큘럼 / AI 성장 리포트 안내 모달
 *
 * ▶ 진단된 원인
 *   이전 구현의 modalContainer(m.container)에 명시적 height가 없고
 *   maxHeight만 있었음. React Native에서 height 미지정 컨테이너 안
 *   ScrollView(flex:1)는 height:0으로 붕괴 → 본문 전체 미표시.
 *
 * ▶ 수정 핵심
 *   container에 width:"92%" + height:screenHeight*0.82 + min/maxHeight 명시
 *   Header(flexShrink:0) + BodyWrapper(flex:1, minHeight:0)
 *     └─ ScrollView(flex:1) + Footer(flexShrink:0) 구조 확립
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

// ── 강조 텍스트 헬퍼 ────────────────────────────────────────────────────────
function Em({ children }: { children: string }) {
  return <Text style={m.emText}>{children}</Text>;
}

// ── 단락 헬퍼 ───────────────────────────────────────────────────────────────
function Para({
  children,
  first,
}: {
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <Text style={[m.bodyText, first && m.bodyFirstPara]}>{children}</Text>
  );
}

// ── AI 커리큘럼 본문 ────────────────────────────────────────────────────────
function CurriculumContent() {
  return (
    <>
      <Para first>
        세계 최초 수영 전문 AI 엔진 <Em>SWIMNOTE AI</Em>와{" "}
        <Em>OpenAI GPT</Em>가 결합된 차세대 AI 검색 서비스입니다.
      </Para>
      <Para>
        우리 수영장의 실제 교육 커리큘럼과{" "}
        <Em>수영 전문 데이터베이스</Em>를 기반으로 영법, 진도, 레벨 기준,
        연습 방법 등을 쉽고 빠르게 검색할 수 있습니다.
      </Para>
      <Para>
        현재 토이키즈스윔클럽에서 SWIMNOTE AI와 OpenAI GPT의{" "}
        <Em>독점 시범 서비스</Em>를 준비 중이며, 정식 출시 후 순차적으로
        확대될 예정입니다.
      </Para>
    </>
  );
}

// ── AI 성장 리포트 본문 ─────────────────────────────────────────────────────
function ReportContent() {
  return (
    <>
      <Para first>
        세계 최초 수영 전문 AI 엔진 <Em>SWIMNOTE AI</Em>와{" "}
        <Em>OpenAI GPT</Em>가 결합된 차세대 AI 성장 분석 서비스입니다.
      </Para>
      <Para>
        수영 학습 데이터를 분석하여{" "}
        <Em>130개의 평가 데이터</Em>로 구성된 종합 성장 리포트를 제공합니다.
      </Para>
      <Para>
        수영 과정에서 축적된 다양한 학습 데이터를 바탕으로 운동 능력뿐 아니라
        일반학습과 관련된 <Em>집중력</Em>, <Em>논리적 사고</Em>,{" "}
        <Em>문제 해결 과정</Em> 등{" "}
        <Em>학습에도 도움이 될 수 있는 성장 지표</Em>를 함께 분석하여 아이의
        강점과 성장 방향을 확인할 수 있습니다.
      </Para>
      <Para>
        SWIMNOTE AI의 수영 전문 분석 기술과 OpenAI GPT 빅데이터 분석 결합을
        통해 부모님이 이해하기 쉬운 최종 분석 보고서를 제공합니다.
      </Para>
      <Para>
        성장분석평가 리포트 라이센스는 최종 체결 후 서비스 제공예정입니다.
      </Para>
      <Para>
        현재 토이키즈스윔클럽에서 SWIMNOTE AI와 OpenAI GPT의{" "}
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

  // Safe area 여백 고려한 실제 가용 높이
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  const availableHeight = screenHeight - safeTop - safeBottom;

  const containerHeight = Math.min(
    availableHeight * 0.88,       // 가용 높이 88%
    screenHeight * 0.82           // 화면 높이 82% 상한
  );
  const containerMinHeight = Math.max(
    availableHeight * 0.72,
    screenHeight * 0.68
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={handleShow}
    >
      {/*
        backdrop: 순수 View — Pressable 사용 금지 (ScrollView 스크롤 제스처 차단됨)
        닫기 터치는 absoluteFillObject Pressable을 모달 container 뒤에 배치해서 처리.
        모달 container는 렌더 순서상 나중(z-order 위)에 있으므로
        모달 위 터치는 container가, 모달 밖 터치는 뒤 Pressable이 받는다.
      */}
      <View style={m.backdrop}>
        {/* 모달 바깥 터치 → 닫기 (모달 뒤에 absolute로 배치) */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        {/* 모달 container — 순수 View, 터치 핸들러 없음 */}
        <View
          style={[
            m.container,
            {
              height: containerHeight,
              maxHeight: screenHeight * 0.85,
              minHeight: containerMinHeight,
            },
          ]}
        >
          {/* ── 고정 헤더 (flexShrink:0) ── */}
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
              hitSlop={16}
              style={({ pressed }) => [
                m.closeBtn,
                { opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <LucideIcon name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {/*
            BodyWrapper: flex:1 + minHeight:0
            - 헤더와 푸터 사이 남은 공간 전부 차지
            - minHeight:0 은 flex child가 content 크기로 수축하는 것 방지
          */}
          <View style={m.bodyWrapper}>
            <ScrollView
              ref={scrollRef}
              style={m.scroll}
              contentContainerStyle={m.scrollContent}
              showsVerticalScrollIndicator={true}
              bounces={true}
              alwaysBounceVertical={false}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
              {isCurriculum ? <CurriculumContent /> : <ReportContent />}
              <Text style={m.powered}>
                Powered by SWIMNOTE AI + OpenAI GPT
              </Text>
            </ScrollView>
          </View>

          {/* ── 고정 푸터 (flexShrink:0) ── */}
          <View
            style={[
              m.footer,
              { paddingBottom: Math.max(insets.bottom + 4, 16) },
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
        </View>
      </View>
    </Modal>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  // ── Backdrop ──
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.50)",
    justifyContent: "center",
    alignItems: "center",          // container 가로 중앙 정렬
  },

  // ── ModalContainer ──
  container: {
    width: "92%",
    // height는 인라인으로 (useWindowDimensions 값 사용)
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",       // 수직 배치 명시
  },

  // ── 헤더 (flexShrink:0, ~72-80px) ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    flexShrink: 0,
  },
  headerIcon: {
    width: 36,
    height: 36,
    marginRight: 10,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontFamily: "Pretendard-Bold",
    color: "#111827",
  },
  closeBtn: {
    marginLeft: 8,
    padding: 6,
    // 44px 터치 영역 확보 (hitSlop:16 추가로 처리)
  },

  // ── BodyWrapper (flex:1, minHeight:0) ──
  bodyWrapper: {
    flex: 1,
    minHeight: 0,                  // flex child 수축 방지 핵심
  },

  // ── ScrollView ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 56,
  },

  // ── 본문 텍스트 ──
  bodyText: {
    fontSize: 16,
    fontFamily: "Pretendard-Regular",
    color: "#1F2937",              // 진한 본문색 (너무 연하지 않게)
    lineHeight: 26,
    marginBottom: 22,
    textAlign: "left",
  },
  bodyFirstPara: {
    fontFamily: "Pretendard-Bold",
    color: "#111827",
  },
  emText: {
    fontFamily: "Pretendard-SemiBold",
    color: TEAL,
  },
  powered: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#AAAAAA",
    textAlign: "center",
  },

  // ── Footer (flexShrink:0, ~88-100px) ──
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    flexShrink: 0,
  },
  confirmBtn: {
    borderRadius: 12,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmTxt: {
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
});
