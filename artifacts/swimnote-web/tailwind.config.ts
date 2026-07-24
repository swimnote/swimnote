import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#0a2540",
          blue: "#1a6eb5",
          light: "#e8f0f9",
          accent: "#1a90d6",
        },
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans KR", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
