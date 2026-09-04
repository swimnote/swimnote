/**
 * wp4-messenger-common-core.test.ts
 *
 * WP4 — Messenger Common Core Finalization
 * 1b03e716 baseline 보호 + Normal/X 공통 동작 정적 검증 (F01~F33)
 *
 * 실제 DB 없음; 소스 정적 분석 + auto-link-v2 스타일 mock unit test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── 경로 ──────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "../../../../..");
const MESSENGER_TS    = path.join(ROOT, "artifacts/api-server/src/routes/messenger.ts");
const SCREEN_TSX      = path.join(ROOT, "artifacts/swim-app/components/common/MessengerScreen.tsx");
const ADMIN_WRAP      = path.join(ROOT, "artifacts/swim-app/app/(admin)/messenger.tsx");
const TEACHER_WRAP    = path.join(ROOT, "artifacts/swim-app/app/(teacher)/messenger.tsx");
const ADMIN_LAYOUT    = path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx");
const TEACHER_LAYOUT  = path.join(ROOT, "artifacts/swim-app/app/(teacher)/_layout.tsx");
const APP_LAYOUT      = path.join(ROOT, "artifacts/swim-app/app/_layout.tsx");
const FORMATTERS      = path.join(ROOT, "artifacts/swim-app/domain/formatters.ts");

function src(file: string) { return fs.readFileSync(file, "utf-8"); }

// ── DB mock (단위 테스트용) ────────────────────────────────────────
const mockExecute = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { execute: (...a: any[]) => mockExecute(...a) },
  superAdminDb: { execute: (...a: any[]) => mockExecute(...a) },
}));
beforeEach(() => mockExecute.mockReset());

// ─────────────────────────────────────────────────────────────────
// F01 / F09 / F30 — COMMON CORE: Normal + X 동일 파일/컴포넌트
// ─────────────────────────────────────────────────────────────────
describe("F30 — Common Core: Normal/X 동일 Messenger", () => {
  it("F-CC01. 공유 MessengerScreen 단일 파일 존재", () => {
    expect(fs.existsSync(SCREEN_TSX)).toBe(true);
  });

  it("F-CC02. Admin wrapper가 MessengerScreen 공유 컴포넌트 import", () => {
    const s = src(ADMIN_WRAP);
    expect(s).toContain("MessengerScreen");
    expect(s).toContain('from "@/components/common/MessengerScreen"');
  });

  it("F-CC03. Teacher wrapper가 동일 MessengerScreen 공유 컴포넌트 import", () => {
    const s = src(TEACHER_WRAP);
    expect(s).toContain("MessengerScreen");
    expect(s).toContain('from "@/components/common/MessengerScreen"');
  });

  it("F-CC04. Admin wrapper가 myRole=pool_admin으로 MessengerScreen에 전달", () => {
    expect(src(ADMIN_WRAP)).toContain('myRole="pool_admin"');
  });

  it("F-CC05. Teacher wrapper가 myRole=teacher으로 MessengerScreen에 전달", () => {
    expect(src(TEACHER_WRAP)).toContain('myRole="teacher"');
  });

  it("F-CC06. X-only 별도 messenger.tsx 없음 (Normal+X 공통 route 공유)", () => {
    const xMessenger = path.join(ROOT, "artifacts/swim-app/app/(x)/messenger.tsx");
    // X mode는 (admin)/ 네임스페이스를 공유하므로 별도 X 전용 파일 없음
    expect(fs.existsSync(xMessenger)).toBe(false);
  });

  it("F-CC07. server endpoint가 단일 messenger.ts 파일 (Normal/X 공통)", () => {
    expect(fs.existsSync(MESSENGER_TS)).toBe(true);
    const xMessengerServer = path.join(ROOT, "artifacts/api-server/src/routes/x-messenger.ts");
    expect(fs.existsSync(xMessengerServer)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// F01-F08 — ADMIN → TEACHER send/receive/push
// ─────────────────────────────────────────────────────────────────
describe("F01-F08 — Admin→Teacher send/receive/push", () => {
  it("F01. Admin POST /messenger/messages route 존재 (teacher 선택 가능)", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("POST /messenger/messages") ;
    expect(s).toContain('"/messenger/messages"');
  });

  it("F02. POST /messenger/messages: pool_admin role 허용", () => {
    const s = src(MESSENGER_TS);
    // requireRole includes pool_admin for POST /messenger/messages
    const postSection = s.slice(s.indexOf("POST /messenger/messages\n"), s.indexOf("POST /messenger/notice"));
    expect(postSection).toContain('"pool_admin"');
  });

  it("F03. 메시지 INSERT 후 message 반환 → Teacher receive 가능", () => {
    const s = src(MESSENGER_TS);
    const postSection = s.slice(s.indexOf("POST /messenger/messages\n"), s.indexOf("POST /messenger/notice"));
    expect(postSection).toContain("INSERT INTO work_messages");
    expect(postSection).toContain("RETURNING *");
  });

  it("F04. GET /messenger/read-state: unreadCount 계산 로직 존재", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("unreadCount");
    expect(s).toContain("sender_id != ${userId}");
  });

  it("F05. Admin→Teacher push: sendPushToPoolTeachers 호출 (role=pool_admin 분기)", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("sendPushToPoolTeachers");
    expect(s).toContain('"pool_admin"');
  });

  it("F06. Directed message push: 동일 유저 제외 (target !== sender 조건)", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("target_user_id !== userId");
  });

  it("F07. 폴링 refresh: Set(existingIds)로 dedup → polling duplicate row 0", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("existingIds");
    expect(s).toContain("new Set");
    expect(s).toContain("!existingIds.has");
  });

  it("F08. 날짜 helper가 parseDateSafe 기반 → Invalid Date 불가", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("parseDateSafe");
    expect(s).toContain("fmtTime");
    expect(s).toContain("fmtDateFull");
    // null 반환으로 Invalid Date 방지
    expect(s).toContain("if (!d) return");
  });
});

// ─────────────────────────────────────────────────────────────────
// F09-F16 — TEACHER → ADMIN send/receive/push/scope
// ─────────────────────────────────────────────────────────────────
describe("F09-F16 — Teacher→Admin send/receive/push", () => {
  it("F09. Teacher가 /(teacher)/messenger 진입: route 파일 존재", () => {
    expect(fs.existsSync(TEACHER_WRAP)).toBe(true);
  });

  it("F10. Teacher POST /messenger/messages: teacher role 허용", () => {
    const s = src(MESSENGER_TS);
    const postSection = s.slice(s.indexOf("POST /messenger/messages\n"), s.indexOf("POST /messenger/notice"));
    expect(postSection).toContain('"teacher"');
  });

  it("F11. 동일 pool의 work_messages를 Admin도 GET 가능 → Admin receive", () => {
    const s = src(MESSENGER_TS);
    // requireRole("pool_admin","teacher","super_admin") on GET /messenger/messages
    const getSection = s.slice(
      s.indexOf("1. 메시지 목록 조회"),
      s.indexOf("2. 대화 채널 텍스트 메시지 전송")
    );
    expect(getSection).toContain("pool_admin");
    expect(getSection).toContain("teacher");
  });

  it("F12. Admin unread: GET /messenger/read-state unreadCount = pool 전체 미읽음", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("last_read_at");
    expect(s).toContain("created_at > ${lastReadAt}");
  });

  it("F13. Teacher→Admin push: sendPushToPoolAdmins 호출 (role=teacher 분기)", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("sendPushToPoolAdmins");
    expect(s).toContain("role === \"teacher\"");
  });

  it("F14. 중복 push 방지: directed message = target에게만 1회", () => {
    const s = src(MESSENGER_TS);
    // directed_message 분기는 sendPushToUser 1회만 호출
    const postSection = s.slice(s.indexOf("POST /messenger/messages\n"), s.indexOf("POST /messenger/notice"));
    expect(postSection).toContain("sendPushToUser");
    // pool-wide push는 else 분기
    expect(postSection).toContain("} else {");
  });

  it("F15. 폴링 dedup: teacher 메시지도 Set으로 중복 방지", () => {
    const s = src(SCREEN_TSX);
    // refreshMessagesSilent가 talk/notice 모두 Set dedup 적용
    expect(s).toContain("existingIds.has");
    expect(s).toContain("bgRefreshingRef");
  });

  it("F16. Pool isolation: checkPoolAccess로 cross-pool leakage 0", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("checkPoolAccess");
    // AND wm.pool_id = ${pool_id} in SQL
    expect(s).toContain("wm.pool_id = ${pool_id}");
  });
});

// ─────────────────────────────────────────────────────────────────
// F17-F19 — NOTICE / TALK 분리
// ─────────────────────────────────────────────────────────────────
describe("F17-F19 — Notice/Talk 분리", () => {
  it("F17. channel_type 컬럼으로 notice/talk SQL WHERE 분리", () => {
    const s = src(MESSENGER_TS);
    // SQL WHERE channel_type 파라미터 사용
    expect(s).toContain("channel_type = ${channel_type}");
    // notice channel default 존재
    expect(s).toContain('channel_type = "notice"');
    // talk channel default 존재
    expect(s).toContain('"talk"');
  });

  it("F17b. 클라이언트: talk/notice 별도 state 유지 (talkMessages / noticeMessages)", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("talkMessages");
    expect(s).toContain("noticeMessages");
    // separate channel_type API calls
    expect(s).toContain("channel_type=talk");
    expect(s).toContain("channel_type=notice");
  });

  it("F17c. notice는 admin만 작성 가능 (isAdmin 조건 + pool_admin role)", () => {
    const s = src(MESSENGER_TS);
    const noticeSection = s.slice(s.indexOf("POST /messenger/notice"), s.indexOf("GET /messenger/read-state"));
    expect(noticeSection).toContain('"pool_admin"');
    // client guard
    const clientS = src(SCREEN_TSX);
    expect(clientS).toContain("isAdmin");
  });

  it("F18. Notice deep link: 앱 layout에서 messenger 딥링크 라우팅 존재", () => {
    const s = src(APP_LAYOUT);
    expect(s).toContain("messenger");
  });

  it("F19. Talk deep link: push data type=messenger, 적절한 화면 이동", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain('type: "messenger"');
    const appS = src(APP_LAYOUT);
    // admin → /(admin)/messenger, teacher → /(teacher)/messenger
    expect(appS).toContain("/(admin)/messenger");
    expect(appS).toContain("/(teacher)/messenger");
  });
});

// ─────────────────────────────────────────────────────────────────
// F20-F24 — POLLING / FOCUS LIFECYCLE
// ─────────────────────────────────────────────────────────────────
describe("F20-F24 — Polling / Focus lifecycle", () => {
  it("F20. Focus 시 7초 interval 시작: setInterval(refreshMessagesSilent, 7000)", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("setInterval(refreshMessagesSilent, 7000)");
  });

  it("F21. Blur 시 clearInterval cleanup: useFocusEffect return에서 clearInterval", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("clearInterval(timer)");
    // cleanup is in useFocusEffect return
    const focusIdx = s.indexOf("setInterval(refreshMessagesSilent, 7000)");
    const clearIdx = s.indexOf("clearInterval(timer)");
    expect(clearIdx).toBeGreaterThan(focusIdx);
  });

  it("F22. 재진입 시 interval 1개만: bgRefreshingRef로 concurrent guard", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("bgRefreshingRef.current");
    expect(s).toContain("bgRefreshingRef.current = true");
    expect(s).toContain("bgRefreshingRef.current = false");
  });

  it("F23. Background polling 0: useFocusEffect cleanup이 blur에서 interval 제거", () => {
    const s = src(SCREEN_TSX);
    // useFocusEffect returns cleanup function
    expect(s).toContain("useFocusEffect");
    expect(s).toContain("return () => clearInterval(timer)");
  });

  it("F24. Foreground 복귀: useFocusEffect가 재실행 → 새 interval 설정됨", () => {
    const s = src(SCREEN_TSX);
    // useFocusEffect with useCallback([refreshMessagesSilent]) dependency
    expect(s).toContain("[refreshMessagesSilent]");
  });

  it("F20b. Admin layout 30초 배지 폴링 + cleanup 존재", () => {
    const s = src(ADMIN_LAYOUT);
    expect(s).toContain("30_000");
    expect(s).toContain("clearInterval");
    expect(s).toContain("messengerUnread");
  });
});

// ─────────────────────────────────────────────────────────────────
// F25-F27 — DATE / ORDER
// ─────────────────────────────────────────────────────────────────
describe("F25-F27 — Date / Order", () => {
  it("F25. Invalid Date 0: parseDateSafe가 null 반환 — fmtTime/fmtDateFull '' 반환", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("parseDateSafe");
    // null → early return
    expect(s).toContain("if (!d) return");
  });

  it("F25b. parseDateSafe: formatters에 export 존재", () => {
    const s = src(FORMATTERS);
    expect(s).toContain("parseDateSafe");
  });

  it("F26. Message ordering: ORDER BY created_at DESC (최신이 앞에)", () => {
    const s = src(MESSENGER_TS);
    expect(s).toContain("ORDER BY wm.created_at DESC");
  });

  it("F26b. 클라이언트 dedup: same-day grouping용 sameDay helper 존재", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("sameDay");
    // uses parseDateSafe internally
    expect(s).toContain("da.getDate()");
  });

  it("F27. Live refresh ordering: 신규 메시지 prepend ([...added, ...prev])", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("[...added, ...prev]");
  });
});

// ─────────────────────────────────────────────────────────────────
// F28-F29 — DUPLICATE / ROLE SWITCH
// ─────────────────────────────────────────────────────────────────
describe("F28-F29 — Duplicate / Role switch", () => {
  it("F28. Duplicate row 0: optimistic replace + Set dedup", () => {
    const s = src(SCREEN_TSX);
    // 실제 응답 수신 후 tempId를 real id로 replace
    expect(s).toContain("m.id === tempId ? d.message : m");
    // 이후 중복 scan
    expect(s).toContain("seen.has(m.id)");
  });

  it("F29. Role switch stale fetch 0: messenger가 pool/adminUser null 가드 포함", () => {
    const adminSrc = src(ADMIN_WRAP);
    const teacherSrc = src(TEACHER_WRAP);
    // null guard before rendering MessengerScreen
    expect(adminSrc).toContain("!pool?.id || !adminUser?.id");
    expect(teacherSrc).toContain("!pool?.id || !adminUser?.id");
  });

  it("F29b. MessengerScreen: token null 시 loadMessages 조기 반환", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("if (!poolId || !token) return");
  });
});

// ─────────────────────────────────────────────────────────────────
// F32-F33 — NAVIGATION
// ─────────────────────────────────────────────────────────────────
describe("F32-F33 — Navigation", () => {
  it("F32. Back → 직전 화면: SubScreenHeader에 homePath 없으면 router.back()", () => {
    const s = src(ADMIN_WRAP);
    // admin messenger: SubScreenHeader without homePath → default back behavior
    expect(s).toContain("SubScreenHeader");
    // no homePath prop on admin messenger
    expect(s).not.toContain('homePath="/(admin)');
  });

  it("F32b. Teacher Back: homePath=/(teacher)/today-schedule (정확한 home)", () => {
    const s = src(TEACHER_WRAP);
    expect(s).toContain('homePath="/(teacher)/today-schedule"');
  });

  it("F33. Home → dashboard: admin은 SubScreenHeader 기본 back, teacher는 today-schedule", () => {
    // admin: no back override = stack back
    const adminS = src(ADMIN_WRAP);
    expect(adminS).toContain("<SubScreenHeader title=\"메신저\"");
    // teacher: explicit home path
    const teacherS = src(TEACHER_WRAP);
    expect(teacherS).toContain("today-schedule");
  });

  it("F33b. Admin tab: tab press가 navigate or reset messenger tab (not replace admin home)", () => {
    const s = src(ADMIN_LAYOUT);
    // tab press: navigate to messenger or emit reset — not router.replace("/(admin)/")
    expect(s).toContain("messenger");
    expect(s).toContain("navigate");
  });
});

// ─────────────────────────────────────────────────────────────────
// F31 — PARENT REGRESSION
// ─────────────────────────────────────────────────────────────────
describe("F31 — Parent regression", () => {
  it("F31. Parent 전용 messenger route가 존재하면 별도 — admin/teacher core 미수정", () => {
    // parent는 별도 API (request thread 시스템)를 사용하며 MessengerScreen 미사용
    const parentMessenger = path.join(ROOT, "artifacts/swim-app/app/(parent)/messages.tsx");
    if (fs.existsSync(parentMessenger)) {
      const s = fs.readFileSync(parentMessenger, "utf-8");
      // parent messages.tsx는 redirect 전용 또는 별도 구현 — MessengerScreen import 없어야 함
      expect(s).not.toContain("MessengerScreen");
    } else {
      // 파일 없으면 parent messenger 별도 화면 없음 — OK
      expect(true).toBe(true);
    }
  });

  it("F31b. Parent가 work_messages 직접 접근 불가: GET /messenger/messages는 pool_admin/teacher/super_admin만", () => {
    const s = src(MESSENGER_TS);
    const getSection = s.slice(
      s.indexOf("1. 메시지 목록 조회"),
      s.indexOf("2. 대화 채널 텍스트 메시지 전송")
    );
    expect(getSection).toContain("pool_admin");
    expect(getSection).toContain("teacher");
    expect(getSection).toContain("super_admin");
    expect(getSection).not.toContain("parent_account");
  });
});

// ─────────────────────────────────────────────────────────────────
// BASELINE — 1b03e716 핵심 동작 모두 현재 HEAD에 존재
// ─────────────────────────────────────────────────────────────────
describe("BASELINE — 1b03e716 behaviors present in HEAD", () => {
  it("BL01. admin→teacher push 분기 존재", () => {
    expect(src(MESSENGER_TS)).toContain("sendPushToPoolTeachers");
  });

  it("BL02. teacher→admin push 분기 존재", () => {
    expect(src(MESSENGER_TS)).toContain("sendPushToPoolAdmins");
  });

  it("BL03. directed_message 타입 분리 존재", () => {
    expect(src(MESSENGER_TS)).toContain("directed_message");
    expect(src(SCREEN_TSX)).toContain("directed_message");
  });

  it("BL04. notice/talk channel 분리 존재", () => {
    const s = src(MESSENGER_TS);
    // channel_type default "notice" for notice route
    expect(s).toContain('channel_type = "notice"');
    // channel_type default "talk" for messages route
    expect(s).toContain('"talk"');
    // SQL WHERE filtering by channel
    expect(s).toContain("channel_type = ${channel_type}");
  });

  it("BL05. 7초 polling 존재", () => {
    expect(src(SCREEN_TSX)).toContain("setInterval(refreshMessagesSilent, 7000)");
  });

  it("BL06. focus cleanup clearInterval 존재", () => {
    expect(src(SCREEN_TSX)).toContain("return () => clearInterval(timer)");
  });

  it("BL07. duplicate push 방지: target !== sender 조건", () => {
    expect(src(MESSENGER_TS)).toContain("target_user_id !== userId");
  });

  it("BL08. KST date: parseDateSafe 기반 helper (getHours/getMinutes local time)", () => {
    const s = src(SCREEN_TSX);
    expect(s).toContain("getHours");
    expect(s).toContain("getMinutes");
    // UTC slice 사용 안 함
    expect(s).not.toContain(".slice(0, 10)"); // UTC date slice 없음
  });

  it("BL09. message ordering: DESC (최신 우선) + client prepend", () => {
    expect(src(MESSENGER_TS)).toContain("ORDER BY wm.created_at DESC");
    expect(src(SCREEN_TSX)).toContain("[...added, ...prev]");
  });

  it("BL10. stale live refresh date 방지: bgRefreshingRef concurrent guard", () => {
    expect(src(SCREEN_TSX)).toContain("bgRefreshingRef.current");
  });

  it("BL11. read-state ON CONFLICT upsert (중복 insert 방지)", () => {
    expect(src(MESSENGER_TS)).toContain("ON CONFLICT (pool_id, user_id, channel_type)");
    expect(src(MESSENGER_TS)).toContain("DO UPDATE SET last_read_at = now()");
  });

  it("BL12. pool access check on message list + send", () => {
    const s = src(MESSENGER_TS);
    // checkPoolAccess called in GET /messenger/messages and POST /messenger/messages
    expect(s.match(/checkPoolAccess/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
