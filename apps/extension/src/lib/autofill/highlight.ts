export function highlightField(selector: string): boolean {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  const prevTransition = el.style.transition;
  const prevShadow = el.style.boxShadow;
  const prevRadius = el.style.borderRadius;
  const prevTransform = el.style.transform;
  const prevTransformOrigin = el.style.transformOrigin;
  el.style.transition = "outline 140ms ease, box-shadow 220ms ease, transform 220ms ease";
  el.style.borderRadius = "10px";
  el.style.outline = "2px solid #f59e0b";
  el.style.outlineOffset = "2px";
  el.style.boxShadow = "0 0 0 6px rgba(245,158,11,0.28), 0 0 0 14px rgba(245,158,11,0.12)";
  el.style.transformOrigin = "center center";
  // playful jiggle burst to make target field unmistakable
  const jiggleFrames = [
    "translateY(-1px) rotate(-0.7deg)",
    "translateY(-1px) rotate(0.8deg)",
    "translateY(-1px) rotate(-0.6deg)",
    "translateY(-1px) rotate(0.6deg)",
    "translateY(-1px) rotate(-0.3deg)",
    "translateY(-1px) rotate(0deg)",
  ];
  jiggleFrames.forEach((frame, index) => {
    window.setTimeout(() => {
      el.style.transform = frame;
    }, index * 75);
  });
  window.setTimeout(() => {
    el.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.18)";
  }, 260);
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    el.style.transition = prevTransition;
    el.style.boxShadow = prevShadow;
    el.style.borderRadius = prevRadius;
    el.style.transform = prevTransform;
    el.style.transformOrigin = prevTransformOrigin;
  }, 1500);
  return true;
}

