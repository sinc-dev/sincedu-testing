import animate from "tailwindcss-animate";

const colorToken = (name) => ({ opacityValue }) => {
  if (opacityValue === undefined) return `var(${name})`;
  return `color-mix(in oklch, var(${name}) calc(${opacityValue} * 100%), transparent)`;
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: colorToken("--border"),
        input: colorToken("--border"),
        ring: colorToken("--primary"),
        background: colorToken("--background"),
        foreground: colorToken("--foreground"),
        primary: {
          DEFAULT: colorToken("--primary"),
          foreground: colorToken("--primary-foreground"),
        },
        muted: {
          DEFAULT: colorToken("--muted"),
          foreground: colorToken("--muted-foreground"),
        },
        accent: {
          DEFAULT: colorToken("--accent"),
          foreground: colorToken("--accent-foreground"),
        },
        destructive: {
          DEFAULT: colorToken("--destructive"),
          foreground: colorToken("--primary-foreground"),
        },
        warning: colorToken("--warning"),
        success: colorToken("--success"),
        secondary: {
          DEFAULT: colorToken("--muted"),
          foreground: colorToken("--foreground"),
        },
        popover: {
          DEFAULT: colorToken("--card"),
          foreground: colorToken("--foreground"),
        },
        card: {
          DEFAULT: colorToken("--card"),
          foreground: colorToken("--foreground"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Montserrat", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["Source Code Pro", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [animate],
};
