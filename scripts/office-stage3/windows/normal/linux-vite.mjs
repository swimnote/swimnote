import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, "../../../..");
const require = createRequire(path.join(root, "artifacts/swimnote-dashboard/package.json"));
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
export default {
  root, base: "/", envPrefix: "__NO_INHERITED_ENV__",
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify("http://127.0.0.1:20411/api"), __OFFICE_VERIFICATION_ID__: JSON.stringify("NORMAL-AUTH-LINUX-NOT-WINDOWS") },
  plugins: [{
    name: "normal-auth-browser-observation-only",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/admin(?:\/[^.?]*)?(?:\?.*)?$/.test(req.url ?? "")) req.url = "/scripts/office-stage3/windows/normal/linux-browser.html";
        next();
      });
    },
    transform(source, id) {
      if (id.endsWith("/src/desktop/DesktopApp.tsx"))
        return source.replace("const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);",
          "const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot); (window as any).__normalController=controller;");
      if (id.endsWith("/src/desktop/OfficeActionProvider.tsx"))
        return 'import {NormalProbe} from "/scripts/office-stage3/windows/normal/linux-probe.tsx";\n' +
          source.replace("{children}</OfficeActionContext.Provider>", "{children}<NormalProbe /></OfficeActionContext.Provider>");
      if (id.endsWith("/src/lib/office-stage3-policy.ts")) return source.replace("OFFICE_STAGE3_ACTIVE = false", "OFFICE_STAGE3_ACTIVE = true");
      if (id.endsWith("/src/index.css")) return source.replace(/^@import url\([^\n]+\);\r?\n/m, "");
    },
  }, react(), tailwindcss()],
  resolve: { alias: { "@": path.join(root, "artifacts/swimnote-dashboard/src"),
    ...Object.fromEntries(["react","react-dom","@tanstack/react-query","wouter"].map(name =>
      [name, path.join(root, "artifacts/swimnote-dashboard/node_modules", name)])),
  }, dedupe: ["react","react-dom"] },
  server: { host: "127.0.0.1", port: 20412, strictPort: true, allowedHosts: ["127.0.0.1"], fs: { allow: [root] } },
};
