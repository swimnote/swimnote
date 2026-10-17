import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, "../..");
const dashboard = path.join(root, "artifacts/swimnote-dashboard");
const require = createRequire(path.join(dashboard, "package.json"));
// Runtime package imports preserve peer resolution and avoid bundling plugin-internal optional imports.
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
const fixture = JSON.parse(readFileSync(path.join(root, "generated-artifacts/office-stage3-isolated/fixture-session.json"), "utf8"));
const authFile = path.join(dashboard, "src/contexts/AuthContext.tsx");
export default {
  root: import.meta.dirname, base: "/", envPrefix: "__NO_ENV_IMPORT__",
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify("http://127.0.0.1:20411/api"),
    __FIXTURE_SESSION__: JSON.stringify(fixture.token), __OFFICE_VERIFICATION_ID__: JSON.stringify("ISOLATED-SYNTHETIC-NOT-PRODUCTION") },
  plugins: [{ name: "isolated-fixture-auth", enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/admin(?:\/[^.?]*)?(?:\?.*)?$/.test(req.url ?? "")) req.url = "/isolated-desktop.html";
        next();
      });
    }, load(id) {
    if (id === authFile) return `export const useAuth=()=>({state:{status:"authenticated",user:{id:"fixture_admin",role:"pool_admin",swimming_pool_id:"fixture_pool",poolName:"합成 전용"}},logout:()=>location.reload()});
      export const useRequireAuth=useAuth; export const AuthProvider=({children})=>children;`;
  } }, react(), tailwindcss()],
  resolve: { alias: { "@": path.join(dashboard, "src"),
    "react": path.join(dashboard, "node_modules/react"),
    "react-dom": path.join(dashboard, "node_modules/react-dom"),
    "@tanstack/react-query": path.join(dashboard, "node_modules/@tanstack/react-query"),
    "wouter": path.join(dashboard, "node_modules/wouter"),
  }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 20412, strictPort: true, allowedHosts: ["127.0.0.1"],
    fs: { allow: [root] } },
  build: { outDir: path.join(root, "generated-artifacts/office-stage3-isolated/renderer"),
    rollupOptions: { input: path.join(import.meta.dirname, "isolated-desktop.html") } },
};
