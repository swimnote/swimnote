import { api } from "../lib/api-client";
import { OFFICE_STAGE3_ACTIVE } from "../lib/office-stage3-policy";
export { OFFICE_STAGE3_ACTIVE } from "../lib/office-stage3-policy";
/** Release gate, not a user preference. No renderer switch can enable a new production write. */
export type OfficeWriteReceipt = {
  requestId: string; memberId: string; revision: string; action: "update" | "move";
  changes: { field: string; before: string; after: string }[]; assignedClassIds: string[];
};
export type OfficeStage3Transport = {
  mode?: "server" | "fixture";
  prepare?: (command: unknown) => Promise<{ requestId: string }>;
  write: (command: unknown) => Promise<OfficeWriteReceipt>;
  status: (requestId: string) => Promise<OfficeWriteReceipt>;
  interpret: (input: { text: string; memberId?: string }) => Promise<unknown>;
};
export const productionStage3Transport: OfficeStage3Transport | undefined = OFFICE_STAGE3_ACTIVE ? {
  mode: "server",
  prepare: command => api.post("/office/requests", command),
  write: command => api.post("/office/command", command),
  status: id => api.get(`/office/commands/${encodeURIComponent(id)}`),
  interpret: input => api.post("/office/interpret", input),
} : undefined;
