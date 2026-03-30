"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext({
  theme: "purple",
  setTheme: () => { },
});

export const themes = {
  purple: {
    name: "Purple",
    primary: "#8b5cf6",
    glow: "rgba(139, 92, 246, 0.4)",
  },
  indigo: {
    name: "Indigo",
    primary: "#6366f1",
    glow: "rgba(99, 102, 241, 0.4)",
  },
  blue: {
    name: "Blue",
    primary: "#3b82f6",
    glow: "rgba(59, 130, 246, 0.4)",
  },
  cyan: {
    name: "Cyan",
    primary: "#06b6d4",
    glow: "rgba(6, 182, 212, 0.4)",
  },
  teal: {
    name: "Teal",
    primary: "#14b8a6",
    glow: "rgba(20, 184, 166, 0.4)",
  },
  green: {
    name: "Green",
    primary: "#4ade80",
    glow: "rgba(74, 222, 128, 0.4)",
  },
  lime: {
    name: "Lime",
    primary: "#84cc16",
    glow: "rgba(132, 204, 22, 0.4)",
  },
  yellow: {
    name: "Yellow",
    primary: "#facc15",
    glow: "rgba(250, 204, 21, 0.4)",
  },
  orange: {
    name: "Orange",
    primary: "#f97316",
    glow: "rgba(249, 115, 22, 0.4)",
  },
  pink: {
    name: "Pink",
    primary: "#ff007f",
    glow: "rgba(255, 0, 127, 0.4)",
  },
  red: {
    name: "Red",
    primary: "#ef4444",
    glow: "rgba(239, 68, 68, 0.4)",
  },
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState("purple");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("app-theme");
    if (saved && themes[saved]) {
      setThemeState(saved);
    }
    setMounted(true);
  }, []);

  const setTheme = (newTheme) => {
    if (themes[newTheme]) {
      setThemeState(newTheme);
      localStorage.setItem("app-theme", newTheme);
    }
  };

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    const currentTheme = themes[theme];

    // Update CSS variables for the theme
    root.style.setProperty("--primary", currentTheme.primary);
    root.style.setProperty("--sidebar-primary", currentTheme.primary);
    root.style.setProperty("--ring", currentTheme.primary);
    root.style.setProperty("--primary-glow", currentTheme.glow);

    // Add a transition class to html element for smooth overall changes
    root.classList.add("theme-transitioning");
    const timer = setTimeout(() => {
      root.classList.remove("theme-transitioning");
    }, 400); // Match CSS transition duration

    return () => clearTimeout(timer);
  }, [theme, mounted]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
