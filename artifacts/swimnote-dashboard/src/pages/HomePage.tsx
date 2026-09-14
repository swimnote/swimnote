import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import {
  UserPlus, BookOpen, Calendar, TrendingUp,
  FileText, Settings, AlertCircle,
} from "lucide-react";

type QuickAction = {
  icon: React.ReactNode;
  label: string;
  description: string;
  path: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: <UserPlus size={20} />,
    label: "회원 등록",
    description: "신규 회원 정보를 등록합니다.",
    path: "/admin/members/new",
  },
  {
    icon: <BookOpen size={20} />,
    label: "커리큘럼 등록",
    description: "수영장 교육과정을 등록합니다.",
    path: "/admin/curriculum/new",
  },
  {
    icon: <Calendar size={20} />,
    label: "스케줄 관리",
    description: "전체 수업 일정을 관리합니다.",
    path: "/admin/schedule",
  },
  {
    icon: <TrendingUp size={20} />,
    label: "리포트 발행 관리",
    description: "성장리포트를 검수하고 발행합니다.",
    path: "/admin/growth-reports/publish",
  },
  {
    icon: <FileText size={20} />,
    label: "일지 · 피드",
    description: "수업 피드를 확인합니다.",
    path: "/admin/diary",
  },
  {
    icon: <Settings size={20} />,
    label: "설정",
    description: "수영장 운영 설정을 관리합니다.",
    path: "/admin/settings",
  },
];

// Shape from GET /admin/dashboard-stats
type DashboardStats = {
  total_members?: number;
  today_present?: number;
  pending_makeups?: number;
  pending_requests?: number;
};

type StatCard = {
  label: string;
  value: number | undefined;
  description: string;
};

export default function HomePage() {
  const { state } = useAuth();
  const [, navigate] = useLocation();

  const poolId =
    state.status === "authenticated" ? state.user.swimming_pool_id : null;

  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats", poolId],
    queryFn: () => api.get<DashboardStats>("/admin/dashboard-stats"),
    enabled: !!poolId,
    staleTime: 60_000,
  });

  const today = new Date();
  const dateStr = today.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const statCards: StatCard[] = [
    {
      label: "재원 회원",
      value: stats?.total_members,
      description: "현재 재원 중인 전체 회원 수",
    },
    {
      label: "오늘 출석",
      value: stats?.today_present,
      description: "오늘 출석 체크된 회원 수",
    },
    {
      label: "미배정 보강",
      value: stats?.pending_makeups,
      description: "배정 대기 중인 보강 수업",
    },
    {
      label: "검수·요청 대기",
      value: stats?.pending_requests,
      description: "처리 대기 중인 검수/요청",
    },
  ];

  return (
    <div style={{ padding: "32px", maxWidth: "1100px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "var(--text-heading)",
            margin: "0 0 4px",
          }}
        >
          {state.status === "authenticated" &&
            `안녕하세요, ${state.user.name}님`}
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: 0 }}>
          {dateStr}
          {state.status === "authenticated" && state.user.poolName && (
            <> · {state.user.poolName}</>
          )}
        </p>
      </div>

      {/* Stats */}
      <section style={{ marginBottom: "36px" }}>
        <h2
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: "0 0 12px",
          }}
        >
          오늘 현황
        </h2>

        {isError ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "16px",
              background: "#FEF2F2",
              borderRadius: "10px",
              fontSize: "14px",
              color: "#DC2626",
            }}
          >
            <AlertCircle size={16} />
            현황 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "12px",
            }}
          >
            {statCards.map((card) => (
              <div
                key={card.label}
                style={{
                  background: "#fff",
                  border: "1px solid var(--border-default, #E5E7EB)",
                  borderRadius: "12px",
                  padding: "20px",
                }}
              >
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    margin: "0 0 8px",
                    fontWeight: 500,
                  }}
                >
                  {card.label}
                </p>
                {isLoading ? (
                  <div
                    style={{
                      height: "32px",
                      width: "60px",
                      background: "#F3F4F6",
                      borderRadius: "6px",
                      animation: "pulse 1.5s ease-in-out infinite",
                    }}
                  />
                ) : card.value === undefined ? (
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#EF4444",
                      margin: "0 0 4px",
                      fontWeight: 500,
                    }}
                  >
                    불러오지 못했습니다
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: "28px",
                      fontWeight: 700,
                      color: "var(--text-heading)",
                      margin: "0 0 4px",
                      lineHeight: 1.1,
                    }}
                  >
                    {card.value.toLocaleString()}
                  </p>
                )}
                <p
                  style={{
                    fontSize: "11px",
                    color: "var(--text-muted)",
                    margin: 0,
                  }}
                >
                  {card.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <section>
        <h2
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: "0 0 12px",
          }}
        >
          빠른 실행
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px",
          }}
        >
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "18px",
                background: "#fff",
                border: "1px solid var(--border-default, #E5E7EB)",
                borderRadius: "12px",
                cursor: "pointer",
                textAlign: "left",
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "0 2px 8px rgba(0,0,0,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <span
                style={{
                  color: "var(--x-primary, #1E6FD9)",
                  flexShrink: 0,
                  marginTop: "1px",
                }}
              >
                {action.icon}
              </span>
              <div>
                <p
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "var(--text-heading)",
                    margin: "0 0 3px",
                  }}
                >
                  {action.label}
                </p>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    margin: 0,
                  }}
                >
                  {action.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
