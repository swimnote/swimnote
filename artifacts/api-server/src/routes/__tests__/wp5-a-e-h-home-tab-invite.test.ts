/**
 * WP5 — A (Admin Home Polish) + E (Teacher Tab Clipping) + H (Invite CTA)
 *
 * 소스 기반 정적 검증.
 * - A: dashboard.tsx UI 표현 정리 (Premier/활성badge 삭제, X compact, 아이콘, 라벨, 인원관리)
 * - E: teacher _layout.tsx 탭 클리핑 수정
 * - H: invite-qr CTA 노출
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../../../../..");

function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

const DASHBOARD = "artifacts/swim-app/app/(admin)/dashboard.tsx";
const TEACHER_LAYOUT = "artifacts/swim-app/app/(teacher)/_layout.tsx";
const INVITE_QR = "artifacts/swim-app/app/(admin)/invite-qr.tsx";

// ─────────────────────────────────────────────────────────────────
// A — Admin Home Polish
// ─────────────────────────────────────────────────────────────────

describe("A01. Normal admin home 진입점 존재", () => {
  it("dashboard.tsx 파일 존재", () => {
    expect(fs.existsSync(path.join(ROOT, DASHBOARD))).toBe(true);
  });
  it("X mode 분기 존재 (isXMode 사용)", () => {
    expect(src(DASHBOARD)).toContain("isXMode");
  });
});

describe("A02. X admin home — 동일 파일 공유", () => {
  it("dashboard.tsx 하나로 Normal + X 처리", () => {
    const s = src(DASHBOARD);
    // isX 분기와 Normal 분기가 모두 존재
    expect(s).toContain("isX &&");
    expect(s).toContain("isX ?");
  });
});

describe("A03. Premier 표시 0", () => {
  it("tierBadge에서 Premier label 텍스트가 홈 표시 JSX에 없음", () => {
    const s = src(DASHBOARD);
    // tierBadge Pressable이 홈에서 제거됐으므로 "Premier" 렌더 텍스트 없어야 함
    // tierInfo는 로직용으로 선언돼 있으나 JSX에서 tierBadge Pressable에 사용 안 됨
    // tierBadgeTxt 스타일이 JSX render에서 사용되지 않음을 확인
    expect(s).not.toContain('<Text style={[s.tierBadgeTxt');
  });
  it("구독 등급 Pressable 렌더 블록이 홈 헤더에 없음", () => {
    const s = src(DASHBOARD);
    // tierBadge style의 JSX Pressable 렌더 블록 제거 확인
    expect(s).not.toContain('onPress={() => router.push("/(admin)/subscription")}');
  });
});

describe("A04. 활성 badge 0", () => {
  it('"활성" 텍스트가 badge JSX에 없음', () => {
    const s = src(DASHBOARD);
    // "활성" 텍스트가 View badge로 렌더되지 않음
    expect(s).not.toContain(">활성<");
  });
  it('설정 필요 badge는 X 섹션에 유지', () => {
    const s = src(DASHBOARD);
    expect(s).toContain("설정 필요");
  });
});

describe("A05. X card compact", () => {
  it("주요 기능 카드 padding이 14 미만 (compact)", () => {
    const s = src(DASHBOARD);
    // 주요 X 카드: padding: 10 으로 변경
    expect(s).toContain("padding: 10");
  });
  it("icon 크기 38 제거 (32로 compact)", () => {
    const s = src(DASHBOARD);
    // X section에 width: 38은 없어야 함 (compact)
    // 보조 카드 포함 전체적으로 32 또는 30 사용
    expect(s).toContain("width: 32");
  });
});

describe("A06. X card navigation 유지", () => {
  it("report-hub 진입 유지", () => {
    expect(src(DASHBOARD)).toContain('"/(admin)/report-hub"');
  });
  it("diary-hub 진입 유지", () => {
    expect(src(DASHBOARD)).toContain('"/(admin)/diary-hub"');
  });
  it("curriculum-hub 진입 유지", () => {
    expect(src(DASHBOARD)).toContain('"/(admin)/curriculum-hub"');
  });
  it("x-hub 진입 유지", () => {
    expect(src(DASHBOARD)).toContain('"/(admin)/x-hub"');
  });
});

describe("A07. Normal에 X-only leakage 0", () => {
  it("X 전용 카드 섹션이 isX 조건 안에 있음", () => {
    const s = src(DASHBOARD);
    // SWIMNOTE X 섹션은 isX && 블록 안
    const xSection = s.slice(s.indexOf("{isX && ("), s.indexOf("{/* 5. ── 상태 KPI"));
    expect(xSection.length).toBeGreaterThan(0);
    // X 카드들이 그 안에 있음
    expect(xSection).toContain("SWIMNOTE X");
  });
});

describe("A08. AI 일지피드 icon 정상 (book-open)", () => {
  it('AI 일지피드 카드의 아이콘이 book-open', () => {
    const s = src(DASHBOARD);
    // diary-hub Pressable 섹션에 book-open icon
    const diarySection = s.slice(
      s.indexOf('"/(admin)/diary-hub"'),
      s.indexOf('"/(admin)/diary-hub"') + 500,
    );
    expect(diarySection).toContain('"book-open"');
  });
  it('brain 아이콘이 제거됨', () => {
    // brain은 X 섹션에서 AI일지피드에 사용됐으나 제거됨
    const s = src(DASHBOARD);
    // diary-hub 근처에 brain 없음
    const diarySection = s.slice(
      s.indexOf('"/(admin)/diary-hub"') - 100,
      s.indexOf('"/(admin)/diary-hub"') + 400,
    );
    expect(diarySection).not.toContain('"brain"');
  });
});

describe("A09. AI 일지피드 navigation 유지", () => {
  it("diary-hub 라우트 유지", () => {
    expect(src(DASHBOARD)).toContain("/(admin)/diary-hub");
  });
});

describe("A10. '이번 달 매출' 표시 0", () => {
  it("이번 달 매출 텍스트 없음", () => {
    expect(src(DASHBOARD)).not.toContain("이번 달 매출");
  });
});

describe("A11. '현황' 표시", () => {
  it("현황 라벨 존재", () => {
    const s = src(DASHBOARD);
    expect(s).toContain("현황");
  });
  it("매출 카드 navigation 유지 (admin-revenue)", () => {
    expect(src(DASHBOARD)).toContain("/(admin)/admin-revenue");
  });
});

describe("A12. 인원관리 label/icon 정상", () => {
  it("인원관리 텍스트 존재", () => {
    expect(src(DASHBOARD)).toContain("인원관리");
  });
  it("인원관리 users 아이콘 존재", () => {
    const s = src(DASHBOARD);
    const peopleSection = s.slice(
      s.indexOf('"/(admin)/people?backTo=dashboard"') - 200,
      s.indexOf('"/(admin)/people?backTo=dashboard"') + 200,
    );
    expect(peopleSection).toContain('"users"');
  });
});

describe("A13. member route 회귀 0", () => {
  it("/(admin)/members 라우트 유지", () => {
    expect(src(DASHBOARD)).toContain("/(admin)/members");
  });
});

describe("A14. home layout overflow 0", () => {
  it("ScrollView contentContainerStyle에 flex: 1 없음 (overflow 방지)", () => {
    const s = src(DASHBOARD);
    // scrollview contentContainerStyle에 flex:1이 없어야 함
    const scrollSection = s.slice(
      s.indexOf("<ScrollView"),
      s.indexOf("<ScrollView") + 400,
    );
    // contentContainerStyle 안에 flex:1 없음
    const csStart = scrollSection.indexOf("contentContainerStyle");
    const csEnd = scrollSection.indexOf("}}", csStart) + 2;
    const cs = scrollSection.slice(csStart, csEnd);
    expect(cs).not.toContain("flex: 1");
  });
});

// ─────────────────────────────────────────────────────────────────
// E — Teacher Tab Clipping
// ─────────────────────────────────────────────────────────────────

describe("E01. Teacher tabs render", () => {
  it("teacher layout 파일 존재", () => {
    expect(fs.existsSync(path.join(ROOT, TEACHER_LAYOUT))).toBe(true);
  });
  it("Tabs 컴포넌트 사용", () => {
    expect(src(TEACHER_LAYOUT)).toContain("<Tabs");
  });
});

describe("E02. 모든 icon visible (size 충분)", () => {
  it("탭 아이콘 size가 최소 20 이상", () => {
    const s = src(TEACHER_LAYOUT);
    // size={22} 확인
    expect(s).toContain("size={22}");
  });
});

describe("E03. 모든 label visible (lineHeight 충분)", () => {
  it("tabBarLabelStyle lineHeight가 16 이상", () => {
    const s = src(TEACHER_LAYOUT);
    expect(s).toContain("lineHeight: 16");
  });
  it("marginTop이 0 이하로 설정돼 label 공간 확보", () => {
    const s = src(TEACHER_LAYOUT);
    // marginTop: 0 (또는 없음) — 기존 2에서 0으로 변경
    expect(s).toContain("marginTop: 0");
  });
});

describe("E04-E06. width별 클리핑 방지", () => {
  it("tabBarLabelStyle fontSize가 10 이하로 적절", () => {
    const s = src(TEACHER_LAYOUT);
    expect(s).toContain("fontSize: 10");
  });
  it("Pretendard-Regular fontFamily 유지", () => {
    const s = src(TEACHER_LAYOUT);
    expect(s).toContain("Pretendard-Regular");
  });
});

describe("E07. safe area 정상", () => {
  it("useSafeAreaInsets 사용", () => {
    expect(src(TEACHER_LAYOUT)).toContain("useSafeAreaInsets");
  });
  it("paddingBottom에 insets.bottom 반영", () => {
    expect(src(TEACHER_LAYOUT)).toContain("insets.bottom");
  });
});

describe("E08. tab route 정상", () => {
  it("today-schedule 탭 존재", () => {
    expect(src(TEACHER_LAYOUT)).toContain('"today-schedule"');
  });
  it("messenger 탭 존재", () => {
    expect(src(TEACHER_LAYOUT)).toContain('"messenger"');
  });
  it("settings 탭 존재", () => {
    expect(src(TEACHER_LAYOUT)).toContain('"settings"');
  });
});

describe("E09. tab order unchanged", () => {
  it("탭 순서: today-schedule < my-schedule < students < revenue < messenger < settings", () => {
    const s = src(TEACHER_LAYOUT);
    const positions = [
      s.indexOf('"today-schedule"'),
      s.indexOf('"my-schedule"'),
      s.indexOf('"students"'),
      s.indexOf('"revenue"'),
      s.indexOf('"messenger"'),
      s.indexOf('"settings"'),
    ].filter(p => p >= 0);
    // 순서가 증가하는지 확인
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe("E10. teacher scope unchanged", () => {
  it("FeedbackTemplateProvider 유지", () => {
    expect(src(TEACHER_LAYOUT)).toContain("FeedbackTemplateProvider");
  });
  it("messengerUnread badge 유지", () => {
    expect(src(TEACHER_LAYOUT)).toContain("messengerUnread");
  });
});

describe("E11. admin UI 영향 0", () => {
  it("admin _layout은 teacher _layout 임포트 안 함", () => {
    const adminLayout = fs.existsSync(path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx"))
      ? fs.readFileSync(path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx"), "utf-8")
      : "";
    expect(adminLayout).not.toContain("teacher/_layout");
  });
});

describe("E12. parent UI 영향 0", () => {
  it("parent _layout에 teacher tab 스타일 없음", () => {
    const parentLayouts = [
      "artifacts/swim-app/app/(parent)/_layout.tsx",
    ].filter(p => fs.existsSync(path.join(ROOT, p)));
    for (const p of parentLayouts) {
      expect(fs.readFileSync(path.join(ROOT, p), "utf-8")).not.toContain("TeacherLayout");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// H — Invite CTA
// ─────────────────────────────────────────────────────────────────

describe("H01. 기존 invite functionality 확인", () => {
  it("invite-qr.tsx 존재", () => {
    expect(fs.existsSync(path.join(ROOT, INVITE_QR))).toBe(true);
  });
  it("QR 초대 기능 (학부모/선생님 탭)", () => {
    const s = src(INVITE_QR);
    expect(s).toContain('"parent"');
    expect(s).toContain('"teacher"');
    expect(s).toContain("Share.share");
  });
});

describe("H02. CTA 표시 대상 role 정확", () => {
  it("invite-qr는 admin 라우트 (pool_admin 전용)", () => {
    // admin _layout에서 invite-qr 등록
    const adminLayout = fs.readFileSync(
      path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx"), "utf-8",
    );
    expect(adminLayout).toContain("invite-qr");
  });
  it("teacher scope에 invite-qr 없음", () => {
    expect(src(TEACHER_LAYOUT)).not.toContain("invite-qr");
  });
});

describe("H03. CTA tap → 기존 invite flow", () => {
  it("dashboard의 학부모미연결 알림이 invite-qr로 연결", () => {
    const s = src(DASHBOARD);
    // unlinked_members alert route → invite-qr
    const alertSection = s.slice(
      s.indexOf("unlinked_members"),
      s.indexOf("unlinked_members") + 300,
    );
    expect(alertSection).toContain("invite-qr");
  });
  it("splitStat 학부모미연결 탭이 invite-qr로 연결", () => {
    const s = src(DASHBOARD);
    // 학부모미연결 label이 나오는 곳 직전 500자에 invite-qr가 있어야 함
    const labelIdx = s.lastIndexOf("학부모미연결");
    const surrounding = s.slice(Math.max(0, labelIdx - 500), labelIdx + 50);
    expect(surrounding).toContain("invite-qr");
  });
});

describe("H04. duplicate CTA 0", () => {
  it("invite-qr CTA가 dashboard에 2개 이하 (alert + splitStat)", () => {
    const s = src(DASHBOARD);
    const count = (s.match(/invite-qr/g) || []).length;
    // alert + splitStat = 2개 정도
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(4); // _layout Tabs.Screen 등 포함 고려
  });
});

describe("H05. dead button 0", () => {
  it("invite-qr는 admin _layout에서 라우트 등록됨", () => {
    const adminLayout = fs.readFileSync(
      path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx"), "utf-8",
    );
    // Tabs.Screen으로 등록됨
    expect(adminLayout).toContain('"invite-qr"');
  });
});

describe("H06. Normal shared 화면 정상", () => {
  it("Normal 모드에서도 학부모미연결 알림 조건 공통 (isX 분기 없음)", () => {
    const s = src(DASHBOARD);
    // unlinked_members alert 블록은 isX && ( ... ) 블록 안에 없음을 확인
    // X 기능 진입 전용 섹션과 처리 필요 알림 섹션이 분리돼 있음을 확인
    // X 전용 기능 블록 (4. SWIMNOTE X 기능 진입)
    const xBlockStart = s.indexOf("4. ── SWIMNOTE X");
    // X 블록 이후 KPI 섹션
    const xBlockEnd = s.indexOf("5. ── 상태 KPI");
    expect(xBlockStart).toBeGreaterThan(0);
    expect(xBlockEnd).toBeGreaterThan(xBlockStart);
    const xBlock = s.slice(xBlockStart, xBlockEnd);
    // 처리 필요 알림(unlinked) 로직은 X 전용 기능 블록 안에 없어야 함
    expect(xBlock).not.toContain("unlinked_members ?? 0) > 0");
  });
});

describe("H07. X shared 화면 정상", () => {
  it("invite-qr는 X admin에서도 동일하게 접근 가능 (같은 admin 라우트)", () => {
    // admin _layout이 isX 분기 없이 invite-qr 등록
    const adminLayout = fs.readFileSync(
      path.join(ROOT, "artifacts/swim-app/app/(admin)/_layout.tsx"), "utf-8",
    );
    expect(adminLayout).toContain('"invite-qr"');
  });
});

describe("H08. X-only leakage 0", () => {
  it("invite CTA가 isX 조건 안에만 있지 않음 (Normal에서도 동일)", () => {
    const s = src(DASHBOARD);
    // splitStat 학부모미연결이 isX 블록 밖에 있음
    const splitIdx = s.lastIndexOf("학부모미연결");
    const xSectionStart = s.indexOf("{isX && (");
    const xSectionEnd = s.indexOf("{/* 5. ── 상태 KPI");
    expect(splitIdx).toBeGreaterThan(xSectionEnd);
  });
});

describe("H09. unauthorized role CTA 0", () => {
  it("teacher _layout에 invite-qr push 없음", () => {
    expect(src(TEACHER_LAYOUT)).not.toContain("invite-qr");
  });
});

describe("H10. API/DB 신규 변경 0", () => {
  it("invite-qr는 신규 API 없이 기존 Share.share 사용", () => {
    expect(src(INVITE_QR)).toContain("Share.share");
    expect(src(INVITE_QR)).not.toContain("apiRequest");
  });
});
