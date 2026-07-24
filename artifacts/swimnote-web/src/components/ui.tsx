/**
 * Shared UI primitives for SWIMNOTE AI Admin
 */
import React from "react";
import { Info, Zap, Lock, TestTube } from "lucide-react";

// ── Status Badge ──────────────────────────────────────────────────────────

export type StatusBadgeKind = "LIVE" | "PROTOTYPE" | "PLANNED" | "LOCKED" | "REVIEW" | "NEW" |
  "new" | "review_required" | "verified" | "supported" | "conditional" |
  "rejected" | "harmful" | "pending" | "disputed" | "terminology_only" |
  "high" | "medium" | "low";

const STATUS_STYLES: Record<string, string> = {
  LIVE:               "bg-emerald-100 text-emerald-700 border-emerald-200",
  PROTOTYPE:          "bg-purple-100 text-purple-700 border-purple-200",
  PLANNED:            "bg-amber-100 text-amber-700 border-amber-200",
  LOCKED:             "bg-gray-100 text-gray-500 border-gray-200",
  REVIEW:             "bg-blue-100 text-blue-700 border-blue-200",
  NEW:                "bg-blue-100 text-blue-700 border-blue-200",
  new:                "bg-sky-100 text-sky-700 border-sky-200",
  review_required:    "bg-orange-100 text-orange-700 border-orange-200",
  verified:           "bg-emerald-100 text-emerald-700 border-emerald-200",
  supported:          "bg-teal-100 text-teal-700 border-teal-200",
  conditional:        "bg-yellow-100 text-yellow-700 border-yellow-200",
  rejected:           "bg-red-100 text-red-700 border-red-200",
  harmful:            "bg-rose-100 text-rose-800 border-rose-200",
  pending:            "bg-slate-100 text-slate-500 border-slate-200",
  disputed:           "bg-purple-100 text-purple-700 border-purple-200",
  terminology_only:   "bg-indigo-100 text-indigo-700 border-indigo-200",
  high:               "bg-red-50 text-red-600 border-red-200",
  medium:             "bg-amber-50 text-amber-600 border-amber-200",
  low:                "bg-slate-50 text-slate-500 border-slate-200",
};

const STATUS_LABELS: Record<string, string> = {
  new: "신규", review_required: "검토 필요", verified: "검증 완료",
  supported: "지지됨", conditional: "조건부", rejected: "반려",
  harmful: "위험", pending: "보류", disputed: "논쟁중",
  terminology_only: "용어만", high: "높음", medium: "중간", low: "낮음",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-500 border-gray-200";
  const text = label ?? STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${style}`}>
      {text}
    </span>
  );
}

// ── Feature Badge ─────────────────────────────────────────────────────────

export function FeatureBadge({ kind }: { kind: "LIVE" | "PROTOTYPE" | "PLANNED" | "LOCKED" }) {
  const cfg = {
    LIVE:      { icon: <Zap size={10} />, label: "LIVE",      style: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    PROTOTYPE: { icon: <TestTube size={10} />, label: "PROTOTYPE", style: "bg-purple-100 text-purple-700 border-purple-200" },
    PLANNED:   { icon: <Info size={10} />, label: "PLANNED",   style: "bg-amber-100 text-amber-700 border-amber-200" },
    LOCKED:    { icon: <Lock size={10} />, label: "LOCKED",    style: "bg-gray-100 text-gray-400 border-gray-200" },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${cfg.style}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────

export function PageHeader({
  title, subtitle, badge, actions
}: {
  title: string; subtitle?: string; badge?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[#0a2540]">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────

export function StatCard({
  label, value, sub, color = "slate"
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    slate: "bg-white border-slate-200",
    blue:  "bg-blue-50 border-blue-200",
    green: "bg-emerald-50 border-emerald-200",
    red:   "bg-red-50 border-red-200",
    amber: "bg-amber-50 border-amber-200",
    purple: "bg-purple-50 border-purple-200",
  };
  const valColorMap: Record<string, string> = {
    slate: "text-[#0a2540]", blue: "text-blue-700", green: "text-emerald-700",
    red: "text-red-700", amber: "text-amber-700", purple: "text-purple-700",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] ?? colorMap.slate}`}>
      <div className="text-xs text-slate-500 mb-1 font-medium">{label}</div>
      <div className={`text-2xl font-bold ${valColorMap[color] ?? valColorMap.slate}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────

export function SectionCard({
  title, children, className = "", actions
}: {
  title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Coming Soon Modal ─────────────────────────────────────────────────────

export function ComingSoonModal({
  isOpen, onClose, feature
}: {
  isOpen: boolean;
  onClose: () => void;
  feature: {
    name: string;
    purpose: string;
    inputs: string[];
    process: string[];
    outputs: string[];
    engine: string;
  };
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
            <Info size={16} className="text-amber-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#0a2540]">{feature.name}</div>
            <FeatureBadge kind="PLANNED" />
          </div>
        </div>
        <p className="text-sm text-slate-600 mb-4">{feature.purpose}</p>
        <div className="space-y-3 text-xs">
          <div>
            <div className="font-semibold text-slate-700 mb-1">향후 입력 데이터</div>
            <ul className="list-disc list-inside text-slate-500 space-y-0.5">
              {feature.inputs.map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-1">처리 과정</div>
            <ul className="list-disc list-inside text-slate-500 space-y-0.5">
              {feature.process.map((p, idx) => <li key={idx}>{p}</li>)}
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-1">출력 결과</div>
            <ul className="list-disc list-inside text-slate-500 space-y-0.5">
              {feature.outputs.map((o, idx) => <li key={idx}>{o}</li>)}
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2">
            <span className="font-semibold text-slate-600">연결 엔진: </span>
            <span className="text-slate-500">{feature.engine}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2 rounded-lg bg-[#0a2540] text-white text-sm font-semibold hover:bg-[#154a6d] transition-colors"
        >
          확인
        </button>
      </div>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, onClick, className = "" }: {
  children: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <tr
      className={`border-b border-slate-50 hover:bg-slate-50/80 transition-colors ${onClick ? "cursor-pointer" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 text-xs text-slate-600 ${className}`}>{children}</td>;
}

// ── Button ────────────────────────────────────────────────────────────────

export function Button({
  children, onClick, variant = "primary", size = "sm", disabled = false, className = ""
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "planned";
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const variantStyles = {
    primary:  "bg-[#0a2540] text-white hover:bg-[#154a6d]",
    secondary:"bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
    ghost:    "bg-transparent text-slate-600 hover:bg-slate-100",
    danger:   "bg-red-600 text-white hover:bg-red-700",
    planned:  "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100",
  };
  const sizeStyles = {
    xs: "px-2 py-1 text-[11px]",
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors
        ${variantStyles[variant]} ${sizeStyles[size]}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${className}`}
    >
      {children}
    </button>
  );
}
