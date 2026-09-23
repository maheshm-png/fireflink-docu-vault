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
        // Lightened from the raw ff.plum/plumDark pair below (#29102D ->
        // #1B0A1E) — that combination read as too heavy once used across
        // bigger surfaces (this nav bar, the login page's side panel, the
        // public share page's header/footer) rather than just accents.
        // Diagonal, not vertical — a top-to-bottom gradient barely reads on
        // a bar this short (64-80px tall); running it corner-to-corner
        // instead makes the light/dark mix actually visible across a wide
        // horizontal bar. Light end pulled toward the ff-accent magenta
        // rather than just a paler plum, so the two ends read as distinct
        // shades rather than one flat color with a faint vignette.
        "ff-plum-gradient": "linear-gradient(120deg, #7C3B74 0%, #4A2350 45%, #241026 100%)",
        // Every primary button app-wide (Save/Upload/Approve/Submit, admin
        // forms, the share modal, etc.) now points at the same plum gradient
        // as the nav bar rather than its own separate magenta one — was a
        // distinct linear-gradient(135deg, #8E2E7A, #A6398F) before; aliased
        // here (not just left to bit-rot as a second unused gradient) so the
        // two tokens can never drift apart again by editing only one of
        // them. ff.accent itself (the plain solid hex, used for text/links/
        // active pills — not this background-image) is intentionally left
        // alone: this only changes gradient FILLS, not the accent color as
        // a whole.
        "ff-accent-gradient": "linear-gradient(120deg, #7C3B74 0%, #4A2350 45%, #241026 100%)",
        "ff-surface-gradient": "linear-gradient(160deg, #FFFFFF 0%, #FBF5FA 100%)",
        // Same "lighten toward the hover shade" formula as ff-accent-gradient,
        // for every other semantic/status color — status pills, badges, and
        // stepper dots (app/dashboard/documents/[id]/ReviewTrail.tsx,
        // DocumentDetailTabs.tsx) instead of a flat fill.
        "ff-success-gradient": "linear-gradient(135deg, #2F9E44 0%, #45B85C 100%)",
        "ff-warning-gradient": "linear-gradient(135deg, #C9861A 0%, #E0A230 100%)",
        "ff-danger-gradient": "linear-gradient(135deg, #C23B3B 0%, #D95C5C 100%)",
        "ff-lavender-gradient": "linear-gradient(135deg, #F6ECF4 0%, #EEDCEB 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
