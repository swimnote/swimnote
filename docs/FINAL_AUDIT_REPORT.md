# FINAL_AUDIT_REPORT.md — 최종 점검 보고서

> 작성일: 2026-04-01

---

## 1. 현재 프로젝트 Git 백업 가능 여부

**✅ 가능** — 코드 전체 Git 추적 중, 민감 파일 .gitignore 적용 완료

---

## 2. 민감정보 노출 위험 여부

| 항목 | 상태 | 조치 |
|------|------|------|
| `.env` 파일 | `.gitignore`에 포함 ✅ | |
| `google-service-account.json` | `.gitignore` 추가 완료 ✅ | |
| `*.pem`, `*.p8`, `*.key` | `.gitignore` 추가 완료 ✅ | |
| API 키 하드코딩 | 없음 ✅ | 모두 `process.env.*` 사용 |
| `artifacts/swim-app/.env` | Git 추적 여부 확인 필요 ⚠️ | 아래 확인 명령 실행 |

**수동 확인 필요:**
```bash
git status artifacts/swim-app/.env
# 결과가 "Changes not staged" 또는 "Untracked"이어야 정상
# 만약 tracked 상태라면:
git rm --cached artifacts/swim-app/.env
```

---

## 3. 다른 환경 이식 가능 여부

**🟡 조건부 가능**

| 컴포넌트 | 이식 가능 | 조건 |
|----------|----------|------|
| API 서버 | ✅ | 환경변수 주입 + Object Storage 대체 |
| 모바일 앱 | ✅ | API URL 변경 후 재빌드 |
| DB 스키마 | ✅ | `db:push` 또는 API 서버 자동 init |
| 파일 저장 | ⚠️ | Replit Object Storage → R2/S3 교체 필요 |
| 기존 파일 데이터 | ❌ | Replit 외부에서 마이그레이션 필요 |

---

## 4. 리플릿 의존도 평가

| 의존 요소 | 위험도 | 설명 | 대체 방법 |
|----------|--------|------|----------|
| `@replit/object-storage` | 🔴 높음 | 사진/영상 저장 — Replit 전용 | Cloudflare R2 또는 S3 |
| Replit Secrets | 🟡 중간 | 환경변수 보관 | 다른 플랫폼 환경변수 기능 |
| `swimnote-7.replit.app` URL | 🟡 중간 | eas.json + .env에 하드코딩 | 이관 시 URL 변경 필요 |
| `REPLIT_DEV_DOMAIN` | 🟢 낮음 | 개발 환경에서만 사용 | 다른 환경에선 무시됨 |
| Replit 배포 인프라 | 🟡 중간 | API 서버 호스팅 | Railway/Render/Fly.io 대체 가능 |

---

## 5. 당장 수정 필요한 항목

1. **`artifacts/swim-app/.env`가 Git에 올라가 있는지 확인** (가장 중요)
   ```bash
   git rm --cached artifacts/swim-app/.env 2>/dev/null
   ```

2. **환경변수 오프라인 백업** — `.env`의 실제 값을 패스워드 매니저에 저장

3. **Supabase 백업 활성화** — Supabase 콘솔에서 Point-in-Time Recovery 설정

---

## 6. 선택적 개선 항목

1. **Object Storage 이중화** — Replit 외에 R2/S3 미러링 설정
2. **GitHub Actions 연동** — 자동 배포 파이프라인 구축
3. **DB 마이그레이션 파일 생성** — `drizzle-kit generate`으로 SQL 파일 추출
4. **모니터링** — Sentry 또는 LogRocket 연동

---

## 7. 실제 사고 발생 시 복구 예상 난이도

| 시나리오 | 소요 시간 | 난이도 |
|----------|----------|--------|
| Replit 일시 장애 → 재시작 | 10분 | 쉬움 |
| Replit 영구 종료 → Railway 이관 | 2~4시간 | 중간 |
| DB 장애 → Supabase 복원 | 1~2시간 | 중간 |
| Object Storage 소실 → 파일 복구 | 복구 불가 | 어려움 ⚠️ |
| 전체 재구축 (코드+DB+파일) | 1~2일 | 어려움 |

---

## 8. 반드시 보관해야 하는 외부 자산 목록

```
필수 보관 목록 (패스워드 매니저 또는 암호화된 저장소):

[ ] Git 저장소 URL + 접근 권한
[ ] .env 파일 전체 (실제 값 포함)
[ ] Supabase 프로젝트 URL + Service Role Key
[ ] Expo 계정 (swimnote / EXPO_TOKEN)
[ ] Apple Developer 계정 (swimnote.admin@gmail.com / Team ID: 78G5C9G5Z4)
[ ] App Store Connect 앱 ID (6761360360)
[ ] Google Play 계정
[ ] 네이버 SENS 키 (SMS)
[ ] 포트원 API Secret
[ ] JWT_SECRET
```

---

## 생성된 문서 목록

| 파일 | 설명 |
|------|------|
| `docs/PROJECT_RECOVERY_AUDIT.md` | 프로젝트 구조 및 위험요소 분석 |
| `docs/ENVIRONMENT_SETUP.md` | 환경변수 전체 목록 및 설명 |
| `docs/DISASTER_RECOVERY_GUIDE.md` | 사고 발생 시 복구 순서 |
| `docs/DATABASE_RECOVERY_GUIDE.md` | DB 구조 복구 방법 |
| `.env.example` | 환경변수 예시 (실제 값 없음) |
| `.gitignore` | 업데이트 완료 |
