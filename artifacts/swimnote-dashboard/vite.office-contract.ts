import { transformWithEsbuild, type Plugin } from "vite";

/** The native CJS contract stays single-source; Vite's default TS filter excludes .cts. */
export function officeContractPlugin(): Plugin {
  return {
    name: "office-shared-contract",
    enforce: "pre",
    transform(source, id) {
      if (id.split("?")[0].endsWith("/desktop/office-access.cts")) {
        return transformWithEsbuild(source, id, { loader: "ts", format: "esm" });
      }
    },
  };
}
