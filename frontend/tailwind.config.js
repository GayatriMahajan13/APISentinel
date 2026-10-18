/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0B101A",
        sidebar: "#0E1624",
        panel: "#172132",
        accent: "#4FD1C5",
        "text-primary": "#F1F5F9",
        "text-muted": "#94A3B8",
        line: "rgba(148, 163, 184, 0.14)",
      },
      boxShadow: {
        panel: "0 16px 40px rgba(0, 0, 0, 0.18)",
      },
    },
  },
  plugins: [],
};
