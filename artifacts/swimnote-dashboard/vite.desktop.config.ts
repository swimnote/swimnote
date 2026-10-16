import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

// Prepared from HEAD + tracked diff + untracked Desktop source, never from credentials.
export default defineConfig(({ mode }) => {
const fixed = mode === "f05-fix";
let verificationId = "개발 미지정";
try {
  const identity = JSON.parse(readFileSync(new URL(fixed
    ? "../../generated-artifacts/office-f05-fix/source-identity.json"
    : "../../generated-artifacts/office-f05/source-identity.json", import.meta.url), "utf8"));
  const pattern = fixed ? /^F05-FIX-[a-f0-9]{12}-[a-f0-9]{12}$/ : /^F05-[a-f0-9]{12}-[a-f0-9]{12}$/;
  if (pattern.test(identity.buildId)) verificationId = identity.buildId;
} catch { /* Ordinary renderer development has no frozen packaging identity. */ }

return {
  root: import.meta.dirname,
  base: "/admin/",
  envPrefix: "OFFICE_PUBLIC_",
  define: {
    __OFFICE_VERIFICATION_ID__: JSON.stringify(verificationId),
    // Approved canonical API only. Electron's allowlist restricts paths and methods further.
    "import.meta.env.VITE_API_BASE": JSON.stringify("https://swimnote-api.onrender.com/api"),
  },
  plugins: [
    {
      name: "office-local-fonts",
      enforce: "pre",
      transform(source, id) {
        if (id.split("?")[0].endsWith("/src/index.css")) {
          return source.replace(/^@import url\([^\n]+\);\r?\n/m, "");
        }
      },
    },
    react(), tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-desktop/app/renderer"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.resolve(import.meta.dirname, "desktop.html") },
  },
};
});
