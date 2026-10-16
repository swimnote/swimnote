import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  base: "/admin/",
  envPrefix: "OFFICE_PUBLIC_",
  define: {
    // Existing login component imports the API module; F02 blocks all requests.
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
});
