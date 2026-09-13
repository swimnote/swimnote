import { Link } from "wouter";
import { TabbedFAQ, type FAQGroup } from "@/components/site/Accordion";

const BASE = import.meta.env.BASE_URL;

// ── FAQ 데이터 (코드 기반 확인 항목만 포함) ───────────────────────────────────
const FAQ_GROUPS: FAQGroup[] = [
  {
    label: "관리자",
    items: [
      {
        q: "회원은 어떻게 등록하나요?",
        a: "PC 대시보드의 회원 메뉴에서 이름, 생년월일, 연락처를 입력해 등록합니다. 등록 후 반 배정 및 보호자 연결을 진행할 수 있습니다.",
      },
      {
        q: "반은 어떻게 만들고 회원을 배정하나요?",
        a: "반 관리 메뉴에서 반 이름과 담당 선생님을 지정해 반을 생성합니다. 생성된 반에 회원을 개별 또는 일괄로 배정할 수 있습니다.",
      },
      {
        q: "보호자는 어떻게 연결하나요?",
        a: "회원 상세 페이지에서 보호자 연결 버튼을 통해 보호자의 전화번호로 초대 메시지를 발송합니다. 보호자가 앱에서 수락하면 해당 자녀와 연결됩니다. 추가 보호자도 동일 방법으로 등록할 수 있습니다.",
      },
      {
        q: "출결은 어디서 관리하나요?",
        a: "출결 관리 메뉴에서 날짜별 출결 현황을 확인하고 수정할 수 있습니다. 선생님이 앱에서 처리한 출결은 PC 대시보드에 실시간으로 반영됩니다.",
      },
      {
        q: "보강은 어떻게 처리하나요?",
        a: "보강 관리 메뉴에서 발생한 결석에 대해 보강을 신청하거나 일정을 지정할 수 있습니다. 보강 처리 결과는 학부모 앱에 알림으로 전달됩니다.",
      },
      {
        q: "선생님 계정은 어떻게 만드나요?",
        a: "선생님 관리 메뉴에서 이름과 전화번호를 입력하면 앱 초대 메시지가 발송됩니다. 선생님이 앱에서 초대를 수락하면 계정이 활성화됩니다.",
      },
      {
        q: "공지와 앨범은 어떻게 사용하나요?",
        a: "공지 메뉴에서 수영장 전체 또는 특정 반을 대상으로 공지를 작성할 수 있습니다. 이미지를 첨부하면 앨범으로도 활용됩니다. 학부모 앱에 알림으로 전달됩니다.",
      },
      {
        q: "레벨 설정은 어디서 하나요?",
        a: "설정 > 레벨 관리 메뉴에서 수영장에서 사용할 레벨 단계와 이름을 설정할 수 있습니다. 설정된 레벨은 회원 정보와 수업일지에 연동됩니다.",
      },
      {
        q: "AI 성장리포트와 SWIMNOTE X는 어떤 관계인가요?",
        a: "AI 성장리포트는 SWIMNOTE X 기능입니다. SWIMNOTE X를 구독하면 커리큘럼 기반 성장 데이터와 AI 리포트를 사용할 수 있습니다.",
        // Redirecting to X page for details
      },
    ],
  },
  {
    label: "선생님",
    items: [
      {
        q: "스케줄은 어떻게 확인하나요?",
        a: "앱 메인 화면에서 일/주/월 보기를 전환해 담당 반의 수업 일정을 확인할 수 있습니다. 날짜를 탭하면 해당 날의 수업 상세가 표시됩니다.",
      },
      {
        q: "출석 처리는 어떻게 하나요?",
        a: "스케줄에서 해당 수업을 선택한 뒤 학생 이름을 탭해 출석/결석/지각을 표시합니다. 처리 결과는 관리자와 학부모에게 자동으로 공유됩니다.",
      },
      {
        q: "수업일지는 어떻게 작성하나요?",
        a: "수업 후 수업일지 메뉴에서 공통 내용과 학생별 내용을 각각 입력할 수 있습니다. 작성된 일지는 학부모 앱 피드에 전달됩니다.",
      },
      {
        q: "AI 일지 기능은 무엇인가요?",
        a: "수업 내용을 간단히 입력하면 AI가 일지 초안을 생성해줍니다. 선생님이 내용을 확인하고 수정한 뒤 최종 저장하면 학부모에게 전달됩니다.",
      },
      {
        q: "사진과 앨범은 어떻게 올리나요?",
        a: "일지 작성 화면 또는 앨범 메뉴에서 촬영하거나 갤러리에서 선택해 업로드합니다. 업로드된 사진은 학부모 앱 앨범에서 확인할 수 있습니다.",
      },
      {
        q: "보강 일정은 어디서 확인하나요?",
        a: "앱의 보강 메뉴에서 담당 학생의 보강 일정을 확인할 수 있습니다. 보강 수업도 일반 수업과 동일하게 출석 처리 및 일지 작성이 가능합니다.",
      },
      {
        q: "학부모 요청은 어디서 확인하나요?",
        a: "앱의 요청 메뉴에서 학부모가 보낸 문의나 요청을 확인하고 답변할 수 있습니다.",
      },
    ],
  },
  {
    label: "학부모",
    items: [
      {
        q: "자녀를 어떻게 연결하나요?",
        a: "수영장 관리자가 보호자 연결을 신청하면 등록된 전화번호로 초대 메시지가 옵니다. 앱에서 초대를 수락하면 자녀와 연결됩니다.",
      },
      {
        q: "수업일지는 어디서 확인하나요?",
        a: "앱 홈 피드에서 선생님이 작성한 수업일지를 날짜 순으로 확인할 수 있습니다. 공통 내용과 자녀별 내용이 구분되어 표시됩니다.",
      },
      {
        q: "사진과 앨범은 어떻게 보나요?",
        a: "앱의 앨범 메뉴에서 선생님이 업로드한 수업 사진을 날짜별로 볼 수 있습니다. 사진을 저장하거나 공유할 수 있습니다.",
      },
      {
        q: "보강 알림은 어떻게 받나요?",
        a: "자녀가 결석하면 보강 관련 알림이 자동으로 전달됩니다. 앱의 보강 메뉴에서 보강 일정을 직접 확인할 수 있습니다.",
      },
      {
        q: "추가 보호자는 어떻게 등록하나요?",
        a: "자녀 등록 후 관리자에게 추가 보호자의 전화번호를 알려주면 관리자가 추가 초대를 발송합니다. 이후 동일한 방법으로 연결됩니다.",
      },
      {
        q: "AI 성장리포트는 어디서 확인하나요?",
        a: "수영장이 SWIMNOTE X를 사용하고 관리자가 리포트를 발송하면 앱 내 성장 리포트 메뉴에서 확인할 수 있습니다. 발급 여부는 수영장의 X 구독 여부에 따라 다릅니다.",
      },
    ],
  },
];

// ── Role Feature Grid ──────────────────────────────────────────────────────────
const ROLES = [
  {
    role: "관리자",
    icon: "🏢",
    items: ["회원관리", "반관리", "출결관리", "보강관리", "선생님관리", "레벨관리", "공지·앨범", "통계"],
  },
  {
    role: "선생님",
    icon: "🏊",
    items: ["수업 스케줄러", "출석 처리", "수업일지 작성", "AI 일지", "사진·앨범", "보강 확인", "학부모 소통"],
  },
  {
    role: "학부모",
    icon: "👨‍👩‍👧",
    items: ["수업일지 피드", "출결 알림", "사진·앨범", "보강 알림", "성장 기록 확인"],
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SwimnotePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-000)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px 0",
          }}
        >
          {/* Tag */}
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "#002F5F",
              marginBottom: 16,
            }}
            translate="no"
          >
            SWIMNOTE
          </p>

          {/* Headline */}
          <h1
            style={{
              fontSize: "clamp(30px, 4.5vw, 48px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.03em",
              color: "var(--ds-n-900)",
              marginBottom: 18,
              lineHeight: 1.15,
              maxWidth: 640,
            }}
          >
            수영장 운영의 모든 것.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 480,
              marginBottom: 32,
            }}
          >
            회원, 수업, 출결, 보강, 일지와 학부모 소통까지.
            <br />
            관리자, 선생님, 학부모가 하나의 앱으로 연결됩니다.
          </p>

          {/* CTA */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 48 }}>
            <a
              href="https://apps.apple.com/app/swimnote/id6744372480"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 40,
                padding: "0 20px",
                borderRadius: "var(--ds-radius-pill)",
                background: "var(--ds-n-900)",
                color: "var(--ds-n-000)",
                fontSize: "var(--ds-text-body-sm)",
                fontWeight: "var(--ds-fw-medium)",
                textDecoration: "none",
              }}
            >
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.swimnote.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 40,
                padding: "0 20px",
                borderRadius: "var(--ds-radius-pill)",
                background: "var(--ds-n-000)",
                color: "var(--ds-n-900)",
                border: "1px solid var(--ds-border-strong)",
                fontSize: "var(--ds-text-body-sm)",
                fontWeight: "var(--ds-fw-medium)",
                textDecoration: "none",
              }}
            >
              Google Play
            </a>
          </div>

          {/* Hero image */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", overflow: "hidden" }}>
            <img
              src={`${BASE}intro-overview.png`}
              alt="SWIMNOTE 관리자 화면"
              style={{
                width: "100%",
                maxWidth: 820,
                height: "auto",
                borderRadius: "var(--ds-radius-lg) var(--ds-radius-lg) 0 0",
                objectFit: "cover",
                display: "block",
              }}
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* ── Role Grid ─────────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-050)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px",
          }}
        >
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 12,
            }}
          >
            세 역할, 하나의 앱
          </p>
          <h2
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 36,
            }}
          >
            관리자, 선생님, 학부모가<br />
            같은 앱 안에서 연결됩니다.
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {ROLES.map((r) => (
              <div
                key={r.role}
                style={{
                  background: "var(--ds-n-000)",
                  borderRadius: "var(--ds-radius-md)",
                  border: "1px solid var(--ds-border-light)",
                  padding: "24px",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>{r.icon}</div>
                <p
                  style={{
                    fontSize: "var(--ds-text-body)",
                    fontWeight: "var(--ds-fw-semibold)",
                    color: "var(--ds-n-900)",
                    marginBottom: 14,
                  }}
                >
                  {r.role}
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {r.items.map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: "var(--ds-text-body-sm)",
                        color: "var(--ds-text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "var(--ds-n-400)",
                          flexShrink: 0,
                        }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── App Screenshots ────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-000)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 24,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: "1 1 300px" }}>
              <p
                style={{
                  fontSize: "var(--ds-text-label)",
                  fontWeight: "var(--ds-fw-semibold)",
                  letterSpacing: "var(--ds-ls-wider)",
                  textTransform: "uppercase",
                  color: "var(--ds-n-400)",
                  marginBottom: 12,
                }}
              >
                앱 화면
              </p>
              <h2
                style={{
                  fontSize: "clamp(20px, 2.5vw, 28px)",
                  fontWeight: "var(--ds-fw-bold)",
                  letterSpacing: "-0.02em",
                  color: "var(--ds-n-900)",
                  marginBottom: 14,
                  lineHeight: 1.25,
                }}
              >
                선생님과 학부모가<br />
                함께 사용하는 앱.
              </h2>
              <p
                style={{
                  fontSize: "var(--ds-text-body-sm)",
                  color: "var(--ds-text-secondary)",
                  lineHeight: 1.7,
                }}
              >
                선생님은 수업일지와 사진을 업로드하고,
                학부모는 자녀의 수업 현황을 실시간으로 확인합니다.
              </p>
            </div>

            <div
              style={{
                flex: "2 1 400px",
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <img
                src={`${BASE}app-teacher.jpeg`}
                alt="선생님 앱 화면"
                style={{
                  flex: "1 1 160px",
                  maxWidth: 260,
                  height: "auto",
                  borderRadius: "var(--ds-radius-md)",
                  objectFit: "cover",
                  border: "1px solid var(--ds-border-light)",
                }}
                loading="lazy"
              />
              <img
                src={`${BASE}app-parent.png`}
                alt="학부모 앱 화면"
                style={{
                  flex: "1 1 160px",
                  maxWidth: 260,
                  height: "auto",
                  borderRadius: "var(--ds-radius-md)",
                  objectFit: "cover",
                  border: "1px solid var(--ds-border-light)",
                }}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section style={{ background: "var(--ds-n-000)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px 72px",
          }}
        >
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 12,
            }}
          >
            사용팁
          </p>
          <h2
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 36,
            }}
          >
            자주 묻는 질문
          </h2>

          <div style={{ maxWidth: 720 }}>
            <TabbedFAQ groups={FAQ_GROUPS} />
          </div>
        </div>
      </section>

      {/* ── X Upsell strip ────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-050)",
          borderTop: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "40px 24px",
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <p
              style={{
                fontSize: "var(--ds-text-body-sm)",
                fontWeight: "var(--ds-fw-semibold)",
                color: "var(--ds-n-900)",
                marginBottom: 4,
              }}
              translate="no"
            >
              SWIMNOTE X
            </p>
            <p
              style={{
                fontSize: "var(--ds-text-body-sm)",
                color: "var(--ds-text-secondary)",
              }}
            >
              커리큘럼, 성장 데이터, AI 리포트가 필요하다면.
            </p>
          </div>
          <Link
            href="/swimnote-x"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 18px",
              borderRadius: "var(--ds-radius-pill)",
              background: "var(--ds-n-900)",
              color: "var(--ds-n-000)",
              fontSize: "var(--ds-text-body-sm)",
              fontWeight: "var(--ds-fw-medium)",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            알아보기
          </Link>
        </div>
      </section>
    </>
  );
}
