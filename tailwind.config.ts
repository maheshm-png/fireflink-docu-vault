import type { Config } from "tailwindcss";

// Palette matched to the internal Fireflink app (us-app.fireflink.com):
// deep plum nav, magenta-purple accent/links, soft lavender surfaces,
// green "active/open" status, near-black body text.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ff: {
          plum: "#29102D",       // official FireFlink brand color (theme-color meta on fireflink.com)
          plumDark: "#1B0A1E",   // nav hover / pressed
          accent: "#8E2E7A",     // buttons, active pill, links
          accentHover: "#A6398F",
          lavender: "#F6ECF4",   // table header stripe / hover row
          lavenderDeep: "#EEDCEB",
          surface: "#FFFFFF",
          border: "#E7DCE5",
          text: "#2B2033",
          textMuted: "#6B5D68",
          success: "#2F9E44",
          warning: "#C9861A",
          danger: "#C23B3B",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Segoe UI", "system-ui", "sans-serif"],
      },
      borderRadius: {
        ff: "8px",
      },
      boxShadow: {
        // Layered (soft ambient + tighter contact shadow) reads as real
        // depth instead of the single flat 1px line this used to be.
        ff: "0 2px 6px rgba(43,32,51,0.07), 0 1px 2px rgba(43,32,51,0.06)",
        "ff-md": "0 8px 20px rgba(43,32,51,0.10), 0 2px 6px rgba(43,32,51,0.07)",
        "ff-lg": "0 16px 40px rgba(43,32,51,0.16), 0 4px 12px rgba(43,32,51,0.08)",
        "ff-glow": "0 0 0 3px rgba(142,46,122,0.15)",
      },
      backgroundImage: {
        "ff-accent-gradient": "linear-gradient(135deg, #8E2E7A 0%, #A6398F 100%)",
        "ff-plum-gradient": "linear-gradient(180deg, #29102D 0%, #1B0A1E 100%)",
        "ff-surface-gradient": "linear-gradient(160deg, #FFFFFF 0%, #FBF5FA 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
