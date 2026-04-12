import type { Transition, Variants } from "framer-motion";

/** Standard product easing (cubic-bezier). */
export const motionEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const motionTransition: Transition = {
  duration: 0.45,
  ease: motionEase,
};

/** Fade + translate up; transform + opacity only. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: motionTransition,
  },
};

/** Hover scale; transform only. */
export const scaleHover = {
  whileHover: { scale: 1.03 },
  transition: { type: "spring", stiffness: 400, damping: 25 } as Transition,
};

/** Gentle vertical float loop; transform only. */
export const floating = {
  animate: { y: [-4, 4] },
  transition: {
    duration: 6,
    repeat: Infinity,
    repeatType: "mirror" as const,
    ease: "easeInOut" as const,
  } satisfies Transition,
};
