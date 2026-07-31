import { createContext, useContext } from "react";

export const PoolModeContext = createContext(false);

export function usePoolMode() {
  return useContext(PoolModeContext);
}
