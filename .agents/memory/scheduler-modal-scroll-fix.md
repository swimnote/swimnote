---
name: 스케줄러 반 상세 모달 스크롤 구조 수정
description: ClassDetailSheet / AdminClassDetailSheet ScrollView 스크롤 불가 원인과 확정 구조 패턴
---

## 원인
React Native Modal 내 absolutely-positioned sheet에서 `maxHeight`만 지정하면 Yoga가 confirmed size로 인식하지 않음.
ScrollView에 `flexShrink:1`을 쓰면 부모의 confirmed size가 없어 bounded height 계산 실패 → 스크롤 불가.

## 확정 구조 패턴 (Modal bottom sheet + ScrollView)
```tsx
// 시트 컨테이너
sheet: { position:"absolute", bottom:0, left:0, right:0,
         height:"75%"    // ← maxHeight 아닌 height (confirmed size)
         // paddingBottom 없음 → contentContainerStyle로 이동
}

// 스크롤 영역
<ScrollView
  style={{ flex:1, minHeight:0 }}           // flex:1 = 고정영역 제외 나머지 전체
  contentContainerStyle={{ paddingBottom:48 }} // 하단 여백은 scroll 내부에
  keyboardShouldPersistTaps="handled"
>
```

**Why:**
- `height:"X%"` → Yoga confirmed size → ScrollView flex:1 계산 안정
- `minHeight:0` → ScrollView 기본 content-sizing 경향 차단
- `paddingBottom`을 sheet가 아닌 contentContainerStyle에 → 학생 수 무관하게 일정 여백

## 서브모달 분리 패턴
같은 파일의 서브모달(반이동·보충수업 등)이 `cds.sheet`를 공유할 때:
- 메인 시트 전용 스타일 키(`cds.mainSheet`)를 별도 추가
- `cds.sheet`는 서브모달용으로 기존 maxHeight+paddingBottom 유지
- 메인 Pressable에만 `cds.mainSheet` 적용

## 수정 파일
- `components/teacher/my-schedule/ClassDetailSheet.tsx` — mainSheet 분리, studentScroll flex:1
- `components/admin/AdminClassDetailSheet.tsx` — height:"88%", ScrollView flex:1
