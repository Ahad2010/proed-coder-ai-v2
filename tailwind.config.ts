import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#F2F5F1",
          panel: "#FBFCFA",
        },
        ink: {
          DEFAULT: "#12211D",
          soft: "#4A5750",
          faint: "#7C8A82",
        },
        line: {
          DEFAULT: "#D8DED5",
          soft: "#E6EAE3",
        },
        brand: {
          50: "#E9F2F0",
          100: "#D2E5E1",
          200: "#9FC7BF",
          500: "#12766C",
          600: "#0E5C53",
          700: "#0A423B",
        },
        amber: {
          50: "#FAF0E3",
          100: "#F1DBB6",
          500: "#C48534",
          600: "#B8752E",
          700: "#8F5A22",
        },
        brick: {
          50: "#F6E9E6",
          100: "#EBCCC5",
          500: "#B34C3C",
          600: "#9C3B2E",
          700: "#752A20",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        label: "0.08em",
      },
    },
  },
  plugins: [],
};

export default config;
