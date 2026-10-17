import { createContext, useContext } from "react";
import type { OfficeActionCore } from "./OfficeActionCore";
import type { memberQuery } from "../pages/members/member-query";
import type { loadDashboardStats } from "../pages/HomePage";

export const OfficeActionContext = createContext<{
  core: OfficeActionCore;
  execute: OfficeActionCore["execute"];
  membersQuery: typeof memberQuery;
  homeQueryFn: typeof loadDashboardStats;
  notice: string;
} | null>(null);
export const useOfficeActions = () => useContext(OfficeActionContext);
