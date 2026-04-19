import { useState } from "react";
import type { CSSProperties } from "react";
import { extensionLogoPrimUrl } from "../lib/extensionAssets";
import {
  fontSans,
  panelBg,
  panelBgDeep,
  panelBorder,
  peekShadowInset,
  textMuted,
  textStrong,
} from "./smartApplyTheme";

const ease = "cubic-bezier(0.33, 0.86, 0.36, 1)";
const duration = "340ms";

/** Full-height peek: fixed to the viewport’s right edge; never transformed */
const PEEK_RAIL_W = 32;

/** Applied only to the tab on hover — rail does not use this */
const HOVER_TRIGGER_SLIDE_PX = 32;

const Z_PEEK = 2147483645;
const Z_TAB = 2147483646;

export function FloatingTrigger(props: { open: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const active = hover && !props.open;
  const slidePx = active ? -HOVER_TRIGGER_SLIDE_PX : 0;
  const hidden = props.open;

  /** Sibling of the tab wrapper — not nested under a fixed shell (avoids fixed/containing-block quirks) */
  const peekRail: CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    height: "100vh",
    width: PEEK_RAIL_W,
    background: panelBg,
    borderLeft: `1px solid ${panelBorder}`,
    boxShadow: peekShadowInset,
    zIndex: Z_PEEK,
    opacity: hidden ? 0 : active ? 1 : 0,
    transition: `opacity ${duration} ${ease}`,
    pointerEvents: "none",
    transform: "none",
  };

  /**
   * Flush to the viewport’s right edge when idle. The peek rail is behind (`Z_PEEK`); it’s
   * invisible until hover, then the tab slides left (`HOVER_TRIGGER_SLIDE_PX` ≥ rail width) so the
   * rail shows beside the card without covering it.
   */
  const btnSlot: CSSProperties = {
    position: "fixed",
    right: 0,
    top: "clamp(140px, 22vh, 240px)",
    zIndex: Z_TAB,
    opacity: hidden ? 0 : 1,
    transition: `opacity 220ms ease`,
    pointerEvents: hidden ? "none" : "auto",
  };

  const btn: CSSProperties = {
    position: "relative",
    transform: `translate3d(${slidePx}px, 0, 0)`,
    border: `1px solid ${panelBorder}`,
    borderRight: "none",
    background: panelBgDeep,
    color: textStrong,
    borderRadius: "14px 0 0 14px",
    padding: "12px 14px 14px 16px",
    minWidth: 56,
    boxShadow: active
      ? "-8px 6px 28px rgba(124, 45, 18, 0.14)"
      : "-4px 4px 20px rgba(124, 45, 18, 0.1)",
    cursor: "pointer",
    transition: `transform ${duration} ${ease}, box-shadow ${duration} ${ease}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 8,
    WebkitFontSmoothing: "antialiased",
    textAlign: "left",
  };

  return (
    <>
      <div aria-hidden style={peekRail} />
      <div style={btnSlot} aria-hidden={hidden}>
        <button
          type="button"
          aria-label="Open JobLoom Smart Apply"
          onClick={props.onClick}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={btn}
        >
          <img
            src={extensionLogoPrimUrl()}
            alt="JobLoom"
            style={{
              display: "block",
              height: 28,
              width: "auto",
              maxWidth: 140,
              objectFit: "contain",
              objectPosition: "left center",
            }}
          />
          <div
            style={{
              fontFamily: fontSans,
              fontSize: 11,
              fontWeight: 700,
              color: textMuted,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}
          >
            Smart Apply
          </div>
        </button>
      </div>
    </>
  );
}
