/**
 * store/index.ts — 슈퍼관리자 공통 Zustand 스토어
 * 모든 화면이 이 스토어를 공유한다.
 */
import { create } from "zustand";

// ═══════════════════════════════════════════════
// 타입 정의
// ═══════════════════════════════════════════════

export interface Operator {
  id: string;
  name: string;
  owner_name: string;
  approval_status: string;
  subscription_status: string;
  subscription_tier: string;
  credit_balance: number;
  base_storage_gb: number;
  extra_storage_gb: number;
  used_storage_bytes: number;
  pool_type: string;
  active_member_count: number;
  next_billing_at: string | null;
  last_login_at: string | null;
  usage_pct: number;
  total_storage_gb: number;
  deletion_pending: boolean;
  is_readonly?: boolean;
  upload_blocked?: boolean;
}

export interface AuditLog {
  id: string;
  category: string;
  title?: string;
  description?: string;
  pool_id?: string;
  pool_name?: string;
  actor_name?: string;
  actor_id?: string;
  impact?: string;
  reason?: string;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier_key: string;
  min_members: number;
  max_members: number;
  base_storage_gb: number;
  extra_storage_unit_price: number;
  monthly_price: number;
  annual_price: number;
  upgrade_policy: string;
  downgrade_policy: string;
  credit_policy: string;
  cancel_policy: string;
  auto_delete_policy: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupportTicket {
  id: string;
  ticket_type: string;
  requester_name: string;
  pool_id?: string;
  pool_name?: string;
  subject: string;
  description?: string;
  status: string;
  assignee?: string;
  sla_hours: number;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  is_overdue?: boolean;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description?: string;
  category: string;
  global_enabled: boolean;
  updated_at: string;
  updated_by?: string;
  override_count?: number;
}

export interface RiskSummary {
  payment_risk: number;
  storage_risk: number;
  deletion_pending: number;
  policy_unsigned: number;
  sla_overdue: number;
  security_events: number;
  feature_errors: number;
  external_services: number;
  backup_failures: number;
  abuse_detected: number;
}

export interface BackupRecord {
  id: string;
  operator_id?: string;
  operator_name?: string;
  backup_type: "operator" | "platform";
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
  completed_at?: string;
  size_bytes?: number;
  note?: string;
  is_snapshot?: boolean;
}

// ═══════════════════════════════════════════════
// operatorsStore
// ═══════════════════════════════════════════════

interface OperatorsState {
  operators: Operator[];
  loading: boolean;
  filter: string;
  search: string;
  sort: string;
  selectedIds: string[];
  setOperators: (ops: Operator[]) => void;
  setLoading: (v: boolean) => void;
  setFilter: (f: string) => void;
  setSearch: (s: string) => void;
  setSort: (s: string) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  updateOperator: (id: string, patch: Partial<Operator>) => void;
  removeOperator: (id: string) => void;
}

export const useOperatorsStore = create<OperatorsState>((set) => ({
  operators: [],
  loading: false,
  filter: "all",
  search: "",
  sort: "created_at",
  selectedIds: [],
  setOperators: (operators) => set({ operators }),
  setLoading:   (loading)   => set({ loading }),
  setFilter:    (filter)    => set({ filter }),
  setSearch:    (search)    => set({ search }),
  setSort:      (sort)      => set({ sort }),
  toggleSelected: (id) => set((s) => ({
    selectedIds: s.selectedIds.includes(id)
      ? s.selectedIds.filter((x) => x !== id)
      : [...s.selectedIds, id],
  })),
  clearSelected: () => set({ selectedIds: [] }),
  updateOperator: (id, patch) => set((s) => ({
    operators: s.operators.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  })),
  removeOperator: (id) => set((s) => ({
    operators: s.operators.filter((o) => o.id !== id),
  })),
}));

// ═══════════════════════════════════════════════
// billingStore
// ═══════════════════════════════════════════════

interface BillingState {
  plans: SubscriptionPlan[];
  loadingPlans: boolean;
  setPlans: (plans: SubscriptionPlan[]) => void;
  setLoadingPlans: (v: boolean) => void;
  addPlan: (plan: SubscriptionPlan) => void;
  updatePlan: (id: string, patch: Partial<SubscriptionPlan>) => void;
  removePlan: (id: string) => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  plans: [],
  loadingPlans: false,
  setPlans:       (plans)      => set({ plans }),
  setLoadingPlans:(loadingPlans) => set({ loadingPlans }),
  addPlan: (plan) => set((s) => ({ plans: [plan, ...s.plans] })),
  updatePlan: (id, patch) => set((s) => ({
    plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  })),
  removePlan: (id) => set((s) => ({ plans: s.plans.filter((p) => p.id !== id) })),
}));

// ═══════════════════════════════════════════════
// storageStore
// ═══════════════════════════════════════════════

interface StorageState {
  storageTab: string;
  setStorageTab: (tab: string) => void;
}

export const useStorageStore = create<StorageState>((set) => ({
  storageTab: "all",
  setStorageTab: (storageTab) => set({ storageTab }),
}));

// ═══════════════════════════════════════════════
// riskStore
// ═══════════════════════════════════════════════

interface RiskState {
  summary: RiskSummary;
  lastUpdated: string | null;
  setSummary: (s: RiskSummary) => void;
  setLastUpdated: (t: string) => void;
}

export const useRiskStore = create<RiskState>((set) => ({
  summary: {
    payment_risk: 0, storage_risk: 0, deletion_pending: 0,
    policy_unsigned: 0, sla_overdue: 0, security_events: 0,
    feature_errors: 0, external_services: 0, backup_failures: 0,
    abuse_detected: 0,
  },
  lastUpdated: null,
  setSummary:    (summary)     => set({ summary }),
  setLastUpdated:(lastUpdated) => set({ lastUpdated }),
}));

// ═══════════════════════════════════════════════
// supportStore
// ═══════════════════════════════════════════════

interface SupportState {
  tickets: SupportTicket[];
  loadingTickets: boolean;
  activeTab: string;
  setTickets: (tickets: SupportTicket[]) => void;
  setLoadingTickets: (v: boolean) => void;
  setActiveTab: (tab: string) => void;
  updateTicket: (id: string, patch: Partial<SupportTicket>) => void;
}

export const useSupportStore = create<SupportState>((set) => ({
  tickets: [],
  loadingTickets: false,
  activeTab: "open",
  setTickets:       (tickets)       => set({ tickets }),
  setLoadingTickets:(loadingTickets) => set({ loadingTickets }),
  setActiveTab:     (activeTab)     => set({ activeTab }),
  updateTicket: (id, patch) => set((s) => ({
    tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  })),
}));

// ═══════════════════════════════════════════════
// auditLogStore
// ═══════════════════════════════════════════════

interface AuditLogState {
  logs: AuditLog[];
  loadingLogs: boolean;
  setLogs: (logs: AuditLog[]) => void;
  setLoadingLogs: (v: boolean) => void;
  prependLog: (log: AuditLog) => void;
}

export const useAuditLogStore = create<AuditLogState>((set) => ({
  logs: [],
  loadingLogs: false,
  setLogs:       (logs)       => set({ logs }),
  setLoadingLogs:(loadingLogs) => set({ loadingLogs }),
  prependLog: (log) => set((s) => ({ logs: [log, ...s.logs].slice(0, 200) })),
}));

// ═══════════════════════════════════════════════
// featureFlagStore
// ═══════════════════════════════════════════════

interface FeatureFlagState {
  flags: FeatureFlag[];
  loadingFlags: boolean;
  setFlags: (flags: FeatureFlag[]) => void;
  setLoadingFlags: (v: boolean) => void;
  updateFlag: (key: string, patch: Partial<FeatureFlag>) => void;
}

export const useFeatureFlagStore = create<FeatureFlagState>((set) => ({
  flags: [],
  loadingFlags: false,
  setFlags:      (flags)      => set({ flags }),
  setLoadingFlags:(loadingFlags) => set({ loadingFlags }),
  updateFlag: (key, patch) => set((s) => ({
    flags: s.flags.map((f) => (f.key === key ? { ...f, ...patch } : f)),
  })),
}));

// ═══════════════════════════════════════════════
// readonlyStore
// ═══════════════════════════════════════════════

interface ReadonlyState {
  platformReadonly: boolean;
  platformReadonlyReason: string;
  setPlatformReadonly: (v: boolean, reason?: string) => void;
}

export const useReadonlyStore = create<ReadonlyState>((set) => ({
  platformReadonly: false,
  platformReadonlyReason: "",
  setPlatformReadonly: (platformReadonly, platformReadonlyReason = "") =>
    set({ platformReadonly, platformReadonlyReason }),
}));

// ═══════════════════════════════════════════════
// backupStore
// ═══════════════════════════════════════════════

interface BackupState {
  backups: BackupRecord[];
  loadingBackups: boolean;
  setBackups: (backups: BackupRecord[]) => void;
  setLoadingBackups: (v: boolean) => void;
  addBackup: (b: BackupRecord) => void;
  updateBackup: (id: string, patch: Partial<BackupRecord>) => void;
}

export const useBackupStore = create<BackupState>((set) => ({
  backups: [],
  loadingBackups: false,
  setBackups:       (backups)       => set({ backups }),
  setLoadingBackups:(loadingBackups) => set({ loadingBackups }),
  addBackup: (b) => set((s) => ({ backups: [b, ...s.backups] })),
  updateBackup: (id, patch) => set((s) => ({
    backups: s.backups.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  })),
}));
