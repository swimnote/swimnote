---
name: Modal 안 ScrollView 스크롤 불가 패턴 모음
description: React Native Modal 안에서 ScrollView 스크롤이 안 되는 원인들과 올바른 패턴
---

## 규칙 1 — contentContainerStyle에 flexGrow:0 금지

ScrollView의 `contentContainerStyle`에 `flexGrow: 0`을 **절대 넣지 말 것**.

**Why:** React Native ScrollView는 contentContainerStyle의 flexGrow:0을 보고 스크롤 가능 높이를 0으로 계산한다.

## 규칙 2 — backdrop을 Pressable로 감싸지 말 것 (핵심)

모달 backdrop을 `Pressable`로 만들고 그 안에 ScrollView를 넣으면 스크롤 제스처가 막힌다.

**올바른 패턴 (absoluteFill backdrop):**
```tsx
<View style={m.backdrop}>
  {/* 모달 바깥 터치 → 닫기 — 반드시 모달 container보다 먼저 렌더(z-order 뒤) */}
  <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
  {/* 모달 container — 순수 View, 터치 핸들러 없음 */}
  <View style={m.container}>
    <View style={m.header}>...</View>
    <View style={m.bodyWrapper}>   {/* flex:1, minHeight:0 */}
      <ScrollView style={{flex:1}} contentContainerStyle={{paddingBottom:56}}>
        ...
      </ScrollView>
    </View>
    <View style={m.footer}>...</View>
  </View>
</View>
```

**Why:** Pressable이 화면 전체를 덮으면 ScrollView 스크롤 제스처를 Pressable이 먼저 소비한다. absoluteFill Pressable은 렌더 순서상 모달 뒤에 있어 모달 영역 터치는 모달 View가, 외부 터치만 Pressable이 받는다.

**금지 패턴:**
```tsx
// ❌ — Pressable이 전체를 감싸면 ScrollView 스크롤 불가
<Pressable style={{flex:1}} onPress={onClose}>
  <View style={m.container}>
    <ScrollView>...</ScrollView>
  </View>
</Pressable>
```

## 규칙 3 — 모달 container에 명시적 height 필수

modalContainer에 `height` 없이 `maxHeight`만 있으면 ScrollView(flex:1)가 height:0으로 붕괴.
반드시 `height: screenHeight * 0.82` + `minHeight` + `maxHeight` 셋 다 명시.
