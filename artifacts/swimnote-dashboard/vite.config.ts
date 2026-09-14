import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;
const isBuild = process.env.NODE_ENV === "production" || process.argv.includes("build");

if (!rawPort && !isBuild) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = rawPort ? Number(rawPort) : 3000;

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: isBuild ? 3000 : port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port: isBuild ? 3000 : port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
