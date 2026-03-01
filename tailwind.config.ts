import type { Config } from "tailwindcss";

// Single source: brand-colors.json (project root)
const brand = require("./brand-colors.json");

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: brand.primary,
        "brand-gray": {
          DEFAULT: brand.backgroundColor,
          100: "#9ca39c",
          300: "#6d6f6d",
        },
        cyan: {
          150: "#baf5fc", /* between Tailwind cyan-100 and cyan-200 */
        },
        coral: {
          100: "#ffddd6",
          200: "#f5a08c",
          300: "#e07c6a",
        },
        navy: {
          100: "#93c5fd",
          200: "#2563eb",
          300: "#1e40af",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
