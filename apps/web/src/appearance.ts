export type Appearance = {
  theme: "system" | "light" | "dark";
  density: "compact" | "comfortable";
};

const storageKey = "roster.appearance";
const changeEvent = "roster:appearance";

export function readAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return {
      theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "system",
      density: value?.density === "comfortable" ? "comfortable" : "compact",
    };
  } catch {
    return { theme: "system", density: "compact" };
  }
}

export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  if (value.theme === "system") delete root.dataset.rosterTheme;
  else root.dataset.rosterTheme = value.theme;
  root.dataset.rosterDensity = value.density;
  window.dispatchEvent(new Event(changeEvent));
}

export function saveAppearance(value: Appearance) {
  applyAppearance(value);
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Private/restricted storage must not prevent changing the current appearance.
  }
}

export function isDarkAppearance() {
  const theme = document.documentElement.dataset.rosterTheme;
  return theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function subscribeAppearance(update: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", update);
  window.addEventListener(changeEvent, update);
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener(changeEvent, update);
  };
}

// Color functions in custom properties stay unresolved. A real color property
// resolves light-dark()/color-mix() into RGB before passing colors to Mermaid.
export function resolveColorTokens(names: string[]): string[] {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  try {
    return names.map((name) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    });
  } finally {
    probe.remove();
  }
}
