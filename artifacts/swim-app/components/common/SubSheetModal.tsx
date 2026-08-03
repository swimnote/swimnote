/**
 * SubSheetModal — 서브모달 공통 바텀시트 껍데기
 *
 * ClassDetailSheet 내 반이동·보충수업·적용시점 등 서브모달에 사용.
 * ModalSheet(화면 75% 고정·Animated spring·드래그·KeyboardAvoiding)와는 별개 컴포넌트.
 *
 * 구조:
 *   Modal(animationType="slide") >
 *     View(modalRoot, flex:1, rgba backdrop) >
 *       Pressable(absoluteFill, onClose)   ← 외부 터치 닫기
 *       View(sheet, absolute bottom, onStartShouldSetResponder) ← iOS ScrollView responder 양보
 *         View(handle)
 *         View(sheetHeader)  ← title 이 있을 때만
 *         {children}
 *
 * 주의:
 *   - title 을 생략하면 기본 헤더(제목+X버튼)를 렌더링하지 않음.
 *     다단계 헤더(보충수업 step1/step2 등)는 children 으로 직접 제공할 것.
 *   - height 와 maxHeight 동시 지정 금지. height 가 우선.
 *   - ScrollView / 확인버튼 관련 props 없음 — children 으로 직접 관리.
 */
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface SubSheetModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * height 우선; height 가 없으면 maxHeight 사용.
   * 동시 지정 금지 (DEV 경고).
   */
  height?: `${number}%`;
  maxHeight?: `${number}%`;
  /**
   * 상단 제목. 생략하면 기본 헤더(제목+X버튼)를 렌더링하지 않음.
   * 다단계 헤더는 children 으로 직접 제공할 것.
   */
  title?: string;
  subtitle?: string;
  /**
   * sheetHeader paddingBottom override.
   * 기본: padding:16 그대로(별도 override 없음).
   * 예) 적용시점: headerPaddingBottom={12}
   */
  headerPaddingBottom?: number;
  children: React.ReactNode;
}

export function SubSheetModal({
  visible,
  onClose,
  height,
  maxHeight,
  title,
  subtitle,
  headerPaddingBottom,
  children,
}: SubSheetModalProps) {
  if (__DEV__ && height !== undefined && maxHeight !== undefined) {
    console.warn(
      "SubSheetModal: height와 maxHeight를 동시에 사용하지 마십시오. height가 우선 적용됩니다.",
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={s.modalRoot}>
        {/* backdrop — 시트 외부 터치 시 닫기 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* 시트 컨테이너 — Pressable 아닌 View (iOS ScrollView responder 양보) */}
        <View
          style={[
            s.sheet,
            height !== undefined
              ? { height }
              : maxHeight !== undefined
                ? { maxHeight }
                : null,
          ]}
          onStartShouldSetResponder={() => true}
        >
          {/* 드래그 핸들 */}
          <View style={s.handle} />

          {/* 기본 헤더 — title 이 있을 때만 렌더링 */}
          {title ? (
            <View
              style={[
                s.sheetHeader,
                headerPaddingBottom !== undefined
                  ? { paddingBottom: headerPaddingBottom }
                  : null,
              ]}
            >
              <View style={s.headerText}>
                <Text style={s.sheetTitle}>{title}</Text>
                {subtitle ? <Text style={s.sheetSub}>{subtitle}</Text> : null}
              </View>

              <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {children}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  /**
   * 전체화면 컨테이너. backdrop 색상 포함.
   * animationType="slide" 로 통째 슬라이드인.
   */
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  /**
   * 시트. absolute 배치로 화면 하단에 고정.
   * height / maxHeight 는 prop 으로 override.
   * paddingBottom: 32 유지 (기존 cds.sheet 와 동일).
   */
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    paddingTop: 8,
  },
  headerText: { flex: 1 },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Pretendard-Regular",
    color: C.text,
  },
  sheetSub: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginTop: 2,
  },
  closeBtn: { padding: 4 },
});
