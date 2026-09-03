---
name: WP4 완료 상태
description: WP4 학부모 초대 모달 + App Store URL 수정 + OTA 배포 완료
---

## WP4 완료

**APP BRANCH**: release/v2.0.0
**HEAD**: df51d7cd563ca560d57b3f48190da683e262ea13

### 커밋 순서
1. `bf8e3082` — fix(wp4): correct parent invite app store links and add verification marker
   - growth-report.tsx: id6738888898 → id6761360360
   - InviteModal.tsx: WP4 VERIFY · PARENT-INVITE · 0903 marker 추가
2. `a6d461d3` — fix(wp4): correct app store URL in diaryShare.ts
   - diaryShare.ts: id6738888898 → id6761360360
3. `df51d7cd` — chore(app): bump version 2.0.1 → 2.1.0, buildNumber 254 → 255
   - app.json: version + buildNumber 동기화
   - _layout.tsx: startsWith('2.0') → startsWith('2.')

### URL 수정 완료
| 파일 | 수정 전 | 수정 후 |
|---|---|---|
| growth-report.tsx | id6738888898 | id6761360360 |
| diaryShare.ts | id6738888898 | id6761360360 |
| InviteModal.tsx | 이미 id6761360360 | 변경 없음 |

### WP4 기능 확인
- Kakao: kakaotalk:// deeplink 전용, SDK/OAuth 없음 ✅
- SMS / Copy / Share: 정상 ✅
- Auto-link: auto-link-v2.ts phone+child_name normalized match ✅
- Normal/X shared: InviteModal 공통 ✅

### OTA
- Update group ID: 0495bc7f-0e62-433a-aaa9-c7d818ee7885
- iOS update ID: 01a06775-ba13-7b09-bea2-efa7ba76fd31
- Runtime: 2.1.0
- Channel: production-v2 → production-v2 branch
- Platform: ios only

### 주의
- 잘못된 OTA (runtime 2.0.1): da109cbb — 무시됨 (2.1.0 기기에 전달 안 됨)
- 올바른 OTA (runtime 2.1.0): 0495bc7f — 실기기 수신 대상
