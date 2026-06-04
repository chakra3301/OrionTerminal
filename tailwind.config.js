/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Map the existing Tailwind palette onto the new design tokens so all
        // existing `bg-bg`, `text-fg-muted`, `border-border`, `text-accent` etc.
        // classes pick up the Phase A look without a mass rename.
        bg: {
          DEFAULT: "var(--bg-0)",
          panel: "var(--bg-1)",
          elevated: "var(--bg-2)",
          hover: "var(--bg-3)",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.16)",
        },
        fg: {
          DEFAULT: "var(--t-primary)",
          muted: "var(--t-secondary)",
          subtle: "var(--t-tertiary)",
        },
        accent: {
          DEFAULT: "var(--neon-cyan)",
          dim: "rgba(0, 224, 255, 0.5)",
        },
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
        sans: [
          "Space Grotesk",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
