import { createContext, useContext } from "react";
import type { OfficeActionCore } from "./OfficeActionCore";
import type { memberQuery } from "../pages/members/member-query";
import type { loadDashboardStats } from "../pages/HomePage";
import type { OfficeTask } from "./OfficeTaskContract";

export const OfficeActionContext = createContext<{
  core: OfficeActionCore;
  execute: OfficeActionCore["execute"];
  membersQuery: typeof memberQuery;
  homeQueryFn: typeof loadDashboardStats;
  notice: string;
  stage3Enabled: boolean;
  actorRole?: string;
  aiMode: "off" | "server" | "fixture";
  tasks: OfficeTask[];
  interpret: (text: string) => Promise<void>;
  confirmProposal: (id: string) => Promise<void>;
  openResult: (taskId: string, resultId: string) => Promise<void>;
  resolveWrite: (requestId: string) => Promise<void>;
} | null>(null);
export const useOfficeActions = () => useContext(OfficeActionContext);
