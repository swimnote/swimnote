/**
 * NoticeDatePicker — 공지 날짜/시간 선택 (순수 JS, OTA 가능)
 * native dependency 없음. ScrollView 기반 wheel picker.
 * 한국 표준시(KST) 기준 날짜/시간 선택 → Date 객체 반환 (로컬 시간 기반)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const { width: SW } = Dimensions.get("window");

const ITEM_H = 48;   // 각 아이템 높이
const VISIBLE = 5;   // 보이는 아이템 수
const WHEEL_H = ITEM_H * VISIBLE;

function range(start: number, end: number): number[] {
  const arr: number[] = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

const YEARS  = range(2020, 2035);
const MONTHS = range(1, 12);
const HOURS_12 = range(1, 12);
const MINUTES  = range(0, 59);
const MERIDIEM = ["오전", "오후"];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface WheelProps {
  items: (string | number)[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  width: number;
  formatItem?: (v: string | number) => string;
}

function Wheel({ items, selectedIndex, onSelect, width, formatItem }: WheelProps) {
  const scrollRef = useRef<ScrollView>(null);
  const isScrolling = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
  }, [selectedIndex]);

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    onSelect(clamped);
    isScrolling.current = false;
  };

  return (
    <View style={[wh.container, { width }]}>
      {/* 선택 영역 하이라이트 */}
      <View pointerEvents="none" style={[wh.highlight, { top: ITEM_H * 2 }]} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollBegin={() => { isScrolling.current = true; }}
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollEndDrag={(e) => {
          if (!isScrolling.current) handleMomentumEnd(e as any);
        }}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      >
        {items.map((item, i) => {
          const label = formatItem ? formatItem(item) : String(item);
          const isSel = i === selectedIndex;
          return (
            <Pressable key={i} onPress={() => {
              onSelect(i);
              scrollRef.current?.scrollTo({ y: i * ITEM_H, animated: true });
            }}>
              <View style={[wh.item, isSel && wh.itemSel]}>
                <Text style={[wh.txt, isSel && wh.txtSel]}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const wh = StyleSheet.create({
  container: { height: WHEEL_H, overflow: "hidden" },
  highlight: {
    position: "absolute",
    left: 0, right: 0,
    height: ITEM_H,
    backgroundColor: "#F5F0FF",
    borderRadius: 8,
    zIndex: 0,
  },
  item:    { height: ITEM_H, justifyContent: "center", alignItems: "center" },
  itemSel: {},
  txt:     { fontSize: 16, color: "#9CA3AF", fontFamily: "Pretendard-Regular" },
  txtSel:  { fontSize: 18, color: "#3B0764", fontFamily: "Pretendard-SemiBold" },
});

// ─── 메인 피커 ──────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  initialDate: Date;   // 초기 날짜 (로컬 시간 기준)
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

export function NoticeDatePicker({ visible, initialDate, onConfirm, onCancel }: Props) {
  const [year,   setYear]   = useState(initialDate.getFullYear());
  const [month,  setMonth]  = useState(initialDate.getMonth() + 1); // 1-12
  const [day,    setDay]    = useState(initialDate.getDate());
  const [hour12, setHour12] = useState(initialDate.getHours() % 12 || 12); // 1-12
  const [minute, setMinute] = useState(initialDate.getMinutes());
  const [pm,     setPm]     = useState(initialDate.getHours() >= 12);

  // modal이 열릴 때 초기화
  useEffect(() => {
    if (visible) {
      setYear(initialDate.getFullYear());
      setMonth(initialDate.getMonth() + 1);
      setDay(initialDate.getDate());
      setHour12(initialDate.getHours() % 12 || 12);
      setMinute(initialDate.getMinutes());
      setPm(initialDate.getHours() >= 12);
    }
  }, [visible]);

  // 날짜 유효성: 말일 보정
  const maxDay = daysInMonth(year, month);
  const effectiveDay = Math.min(day, maxDay);

  const days = range(1, maxDay);

  const handleConfirm = useCallback(() => {
    const hour24 = pm ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
    const d = new Date(year, month - 1, effectiveDay, hour24, minute, 0, 0);
    onConfirm(d);
  }, [year, month, effectiveDay, hour12, minute, pm, onConfirm]);

  const previewLabel = (() => {
    const hour24 = pm ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
    const d = new Date(year, month - 1, effectiveDay, hour24, minute, 0, 0);
    return d.toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={dp.overlay}>
        <View style={dp.sheet}>
          {/* 헤더 */}
          <View style={dp.header}>
            <Pressable onPress={onCancel} style={dp.headerBtn}>
              <Text style={dp.cancelTxt}>취소</Text>
            </Pressable>
            <Text style={dp.headerTitle}>날짜/시간 선택</Text>
            <Pressable onPress={handleConfirm} style={dp.headerBtn}>
              <Text style={dp.confirmTxt}>확인</Text>
            </Pressable>
          </View>

          {/* 미리보기 */}
          <Text style={dp.preview}>{previewLabel}</Text>

          {/* 날짜 행: 년 | 월 | 일 */}
          <Text style={dp.rowLabel}>날짜</Text>
          <View style={dp.wheelRow}>
            {/* 년 */}
            <Wheel
              items={YEARS}
              selectedIndex={YEARS.indexOf(year)}
              onSelect={i => setYear(YEARS[i])}
              width={90}
              formatItem={v => `${v}년`}
            />
            {/* 월 */}
            <Wheel
              items={MONTHS}
              selectedIndex={month - 1}
              onSelect={i => setMonth(MONTHS[i])}
              width={66}
              formatItem={v => `${String(v).padStart(2, "0")}월`}
            />
            {/* 일 */}
            <Wheel
              items={days}
              selectedIndex={Math.min(effectiveDay - 1, days.length - 1)}
              onSelect={i => setDay(days[i])}
              width={66}
              formatItem={v => `${String(v).padStart(2, "0")}일`}
            />
          </View>

          {/* 시간 행: 오전/오후 | 시 | 분 */}
          <Text style={dp.rowLabel}>시간</Text>
          <View style={dp.wheelRow}>
            {/* 오전/오후 */}
            <Wheel
              items={MERIDIEM}
              selectedIndex={pm ? 1 : 0}
              onSelect={i => setPm(i === 1)}
              width={72}
            />
            {/* 시 */}
            <Wheel
              items={HOURS_12}
              selectedIndex={hour12 - 1}
              onSelect={i => setHour12(HOURS_12[i])}
              width={66}
              formatItem={v => `${String(v).padStart(2, "0")}시`}
            />
            {/* 분 */}
            <Wheel
              items={MINUTES}
              selectedIndex={minute}
              onSelect={i => setMinute(MINUTES[i])}
              width={66}
              formatItem={v => `${String(v).padStart(2, "0")}분`}
            />
          </View>

          {/* 확인 버튼 */}
          <Pressable style={dp.confirmBtn} onPress={handleConfirm}>
            <Text style={dp.confirmBtnTxt}>이 시간으로 설정</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const dp = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32, paddingTop: 8,
  },
  header: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  headerBtn:   { minWidth: 48, paddingVertical: 4 },
  headerTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#111827" },
  cancelTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#6B7280" },
  confirmTxt:  { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#7C3AED", textAlign: "right" },
  preview: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: "#6D28D9",
    paddingVertical: 10,
    backgroundColor: "#F5F0FF",
  },
  rowLabel: {
    fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF",
    marginLeft: 24, marginTop: 14, marginBottom: 4,
  },
  wheelRow: {
    flexDirection: "row", justifyContent: "center",
    alignItems: "center", gap: 4,
    paddingHorizontal: 16,
  },
  confirmBtn: {
    marginHorizontal: 20, marginTop: 20,
    backgroundColor: "#7C3AED", borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
  },
  confirmBtnTxt: {
    fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff",
  },
});
