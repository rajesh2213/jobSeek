import type { Config } from "tailwindcss";

/**
 * Design tokens from Komposo screen (1-screen-2.html).
 * Semantic names: canvas, ink, surface, brand (coral CTA), teal / rose / amber accents.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F4EFE6",
        ink: {
          DEFAULT: "#1A1A1A",
          muted: "#6B7280",
        },
        surface: "#FFFFFF",
        line: "rgba(26, 26, 26, 0.06)",
        brand: {
          DEFAULT: "#E87A5D",
          hover: "#d66d52",
          soft: "#FBEDEA",
        },
        teal: {
          DEFAULT: "#8AB8B6",
          soft: "rgba(138, 184, 182, 0.12)",
        },
        rose: {
          DEFAULT: "#D47A8E",
          soft: "rgba(212, 122, 142, 0.12)",
        },
        amber: {
          DEFAULT: "#F3B05A",
          soft: "rgba(243, 176, 90, 0.12)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      fontWeight: {
        /** Matches loaded DM Sans weights (no separate 800 file). */
        extrabold: "700",
      },
      maxWidth: {
        content: "56rem",
        readable: "64rem",
        /** Primary jobs listing column — wider than legacy Komposo 4xl. */
        jobs: "80rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "card-hover": "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        "tab-pulse": {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(3px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        /** Sticky jobs filter bar — narrow capsule, left → right (uses `left` %) */
        "jobs-filter-sweep": {
          "0%": { left: "-40%" },
          "100%": { left: "100%" },
        },
      },
      animation: {
        "tab-pulse": "tab-pulse 0.4s ease-in-out",
        shimmer: "shimmer 1.35s ease-in-out infinite",
        "jobs-filter-sweep": "jobs-filter-sweep 1.65s linear infinite",
      },
      transitionTimingFunction: {
        chip: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
