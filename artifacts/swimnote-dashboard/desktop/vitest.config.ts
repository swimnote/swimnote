import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";

export default defineConfig({
  plugins: [{
    name: "office-cts-tests",
    enforce: "pre",
    transform(source, id) {
      if (id.endsWith(".cts")) return transformWithEsbuild(source, id, { loader: "ts", format: "esm" });
    },
  }],
  test: { environment: "node", include: ["desktop/*.test.ts", "src/desktop/*.test.tsx",
    // Canonical OFFICE writes must not change the existing Web multi-class editing contract.
    "src/pages/members/multi-class-assignment.test.tsx"] },
  resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
});
