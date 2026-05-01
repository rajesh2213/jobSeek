/**
 * Primary column left inset at `lg+` while the desktop rail is `position: fixed`.
 * Must stay aligned with collapsed rail width in `SiteSideRail.tsx` (`w-[112px]` → 112px).
 */
export const DESKTOP_RAIL_INSET_CLASS = "lg:pl-[112px]";

/**
 * Apply inside an element that already uses {@link DESKTOP_RAIL_INSET_CLASS}: shifts `mx-auto`
 * columns left by half the rail width so their midpoint matches the viewport midpoint (the rail
 * no longer biases centering to the right-hand pane only).
 */
export const DESKTOP_RAIL_OPTICAL_CENTER_SHIFT_CLASS =
  "lg:relative lg:z-[1] lg:-translate-x-[calc(112px/2)]";
