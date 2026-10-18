// Applies the theme before the first paint, as next-themes' inline script
// does on the web: the CSP allows no inline scripts (ADR-0044). Reads the
// choice next-themes stores, and follows the system setting without one.
(() => {
  let theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch {
    // Storage unavailable: follow the system setting.
  }
  if (theme !== "light" && theme !== "dark") {
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
})();
