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
        "brand-gray": brand.backgroundColor,
      },
    },
  },
  plugins: [],
} satisfies Config;
