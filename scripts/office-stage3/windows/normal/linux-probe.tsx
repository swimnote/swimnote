import { useLayoutEffect } from "react";
import { useOfficeActions } from "../../../../artifacts/swimnote-dashboard/src/desktop/OfficeActionContext";
import { useOfficeNavigation } from "../../../../artifacts/swimnote-dashboard/src/desktop/OfficeNavigation";
import { api } from "../../../../artifacts/swimnote-dashboard/src/lib/api-client";
export function NormalProbe() {
  const actions = useOfficeActions(), navigation = useOfficeNavigation();
  useLayoutEffect(() => {
    (window as any).__normalProbe = { actions, navigation,
      readMembers: () => api.get("/students?pool_all=true"),
      receipt: (id: string) => api.get("/office/commands/" + encodeURIComponent(id)) };
  });
  return null;
}
