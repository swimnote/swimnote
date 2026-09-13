# TRANSIENT UI DISMISSAL CONSTITUTION
## SWIMNOTE — 전역 UX 헌법 (2026-09-14 확정)

> 이 문서는 홈페이지(SiteHeader ⋯ 메뉴)를 첫 적용 사례로,
> 향후 PC Dashboard 모든 transient UI에 동일하게 적용되는 전역 규칙이다.
> 기존 메뉴/드롭다운 UX 규칙은 이 문서로 완전히 교체한다.

---

## 0. 핵심 원칙

> "사용자의 다음 행동이 시작되면, 이전의 임시 UI는 자동으로 사라진다."

사용자가 닫기를 별도로 학습할 필요가 없어야 한다.
같은 버튼을 다시 눌러야만 닫히는 구조를 기본 동작으로 사용하지 말 것.

**적용 대상 UI:**
- ⋯ 확장 메뉴 / navigation mega-menu
- dropdown
- popover
- context menu
- profile menu
- filter menu
- select-like custom menu
- floating action menu
- temporary navigation panel
- 알림 panel
- 설정 quick menu

---

## 1. NAVIGATION 발생 시 즉시 닫힘

```
메뉴 item 클릭 → state 즉시 close → route navigation → 새 페이지는 닫힌 상태
```

- route/location pathname/search/hash 변경 → open=false (안전장치)
- 브라우저 back/forward, programmatic navigation으로 페이지가 바뀌어도 transient menu 잔존 금지

---

## 2. DESKTOP — 포인터가 interaction region 밖으로 이동하면 자동 닫힘

"유효 interaction region" = **SiteHeader + Expanded Panel** (둘을 하나의 영역으로 취급)

| 포인터 이동 | 동작 |
|---|---|
| Header → Menu | **유지** |
| Menu → Header | **유지** |
| Header/Menu → 페이지 본문 | **자동 CLOSE** |
| Menu item 클릭 | **즉시 CLOSE** |
| 외부 mousedown | **즉시 CLOSE** |

사용자가 본문을 클릭할 필요 없이, 마우스 이동만으로 닫힌다.

---

## 3. HOVER CLOSE 구현 안정성

`onMouseLeave` 를 각 요소에 개별로 붙이지 말 것. Header→Panel 이동 순간 flicker 발생.

**권장 구현 (relatedTarget 방식):**
```
header.onMouseLeave: event.relatedTarget이 header 또는 panel 안에 있으면 → timer 취소
panel.onMouseLeave:  event.relatedTarget이 header 또는 panel 안에 있으면 → timer 취소
둘 다 outside → scheduleClose()
header/panel.onMouseEnter: → cancelClose()
```

새 package 설치 금지.

---

## 4. DISMISS DELAY

- Desktop pointer-leave → **80~150ms delay** (flicker 방지용, 애니메이션 아님)
- delay 안에 header/panel 영역으로 re-enter → timer 취소
- **300ms 이상 delay 절대 금지**

---

## 5. OUTSIDE POINTER / CLICK

- 페이지 본문 클릭 → 즉시 close
- 다른 interactive element 클릭 → 즉시 close
- header/menu 외부 mousedown → 즉시 close

Desktop: "마우스 이동만으로도 닫힘" + "외부 클릭으로도 닫힘" 둘 다 지원.

---

## 6. MOBILE / TOUCH

hover 개념 적용 안 함.

| 액션 | 동작 |
|---|---|
| ⋯ 버튼 tap | OPEN |
| 메뉴 item tap | 즉시 CLOSE + navigation |
| 메뉴 외부 tap | CLOSE |
| ESC (가능한 환경) | CLOSE |
| browser navigation 발생 | CLOSE |

메뉴 item 탭 후 새 페이지 위에 메뉴가 남아 있으면 FAIL.

---

## 7. ESC / KEYBOARD

- ESC → close → ⋯ trigger로 focus 복귀
- keyboard Enter/Space로 item 실행 → close + navigation
- Tab/Shift+Tab 접근성 유지
- 닫힌 뒤 invisible panel 안에 focus 잔존 금지

---

## 8. ⋯ TRIGGER 동작

- CLOSED → click → OPEN
- OPEN → click → CLOSED (toggle 허용)

단, toggle은 추가 닫기 방법일 뿐.
메뉴를 닫기 위해 반드시 ⋯ 버튼을 다시 눌러야 하는 UX 금지.

---

## 9. ROUTE CHANGE = TRANSIENT UI RESET

```
Page A에서 Dropdown OPEN → Page B 이동 → Dropdown CLOSED
```

페이지 또는 주요 view가 전환되면, 이전 화면에서 열린 transient UI는 기본적으로 reset.

예외: 명시적으로 persistent UI라고 설계된 경우만.

---

## 10. PC DASHBOARD 적용 대상 (향후)

PC Dashboard X모드 재구성 시 동일 원칙 적용:
- 프로필 메뉴, 더보기 메뉴, 회원/반 액션 메뉴
- 필터 popover, 정렬 menu
- 알림 panel, 설정 quick menu, context menu

```
ACTION COMPLETE → CLOSE
NAVIGATION      → CLOSE
OUTSIDE CLICK   → CLOSE
POINTER LEAVES INTERACTION REGION (Desktop) → CLOSE
ESC             → CLOSE
```

---

## 11. 애니메이션

- route 선택 시 state는 즉시 close 처리
- 시각 transition은 0.15~0.18s 수준 유지 가능
- exit 애니메이션 중 `pointer-events: none` 필수 (새 페이지 차단 금지)
- route가 바뀐 뒤 panel이 오래 남는 구조 금지

---

*최초 적용: SiteHeader.tsx ⋯ 메뉴 (2026-09-14)*
*적용 범위: swimnote-web 홈페이지 + 향후 PC Dashboard*
