/**
 * Split-flap text: when a value changes, every character flips over in
 * sequence (SPEC §6.4: 逐字翻牌動畫，≤400ms, off under prefers-reduced-motion).
 */
const STAGGER_MS = 16;
const MAX_DELAY_MS = 180;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function setFlipText(el: HTMLElement, text: string, animate = true): void {
  if (el.dataset.flipText === text) return;
  el.dataset.flipText = text;

  if (!animate || prefersReducedMotion()) {
    el.textContent = text;
    return;
  }

  el.textContent = "";
  let index = 0;
  for (const token of text.split(/(\s+)/)) {
    if (token === "") continue;
    if (/^\s+$/.test(token)) {
      el.append(document.createTextNode(" "));
      continue;
    }
    const word = document.createElement("span");
    word.className = "flip-word";
    for (const char of Array.from(token)) {
      const span = document.createElement("span");
      span.className = "flip-char";
      span.style.animationDelay = `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms`;
      span.textContent = char;
      word.append(span);
      index += 1;
    }
    el.append(word);
  }
}
