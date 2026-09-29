/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./palette.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cipher: {
          bg: "#08080c",
          panel: "#0d0d14",
          edge: "rgba(255,255,255,0.07)",
          text: "#e9e9f0",
          dim: "#8b8b9e",
          faint: "#55556a",
          accent: "#6d5cff",
          accentsoft: "rgba(109,92,255,0.14)",
          blue: "#5aa2ff",
          green: "#3ecf8e",
          red: "#ff5d5d",
          amber: "#f5b04d",
          cyan: "#4fd8e0",
        },
      },
      fontFamily: {
        sans: [
          '"Segoe UI Variable Display"',
          '"Segoe UI"',
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ['"Cascadia Code"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "14px",
      },
      animation: {
        "breathe": "breathe 4s ease-in-out infinite",
        "pulse-soft": "pulseSoft 2.2s ease-in-out infinite",
        "spin-slow": "spin 3.2s linear infinite",
        "ripple": "ripple 2s ease-out infinite",
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-up": "slideUp 0.28s ease-out",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.045)", opacity: "1" },
        },
        pulseSoft: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.75" },
          "50%": { transform: "scale(1.08)", opacity: "1" },
        },
        ripple: {
          "0%": { transform: "scale(0.85)", opacity: "0.55" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
