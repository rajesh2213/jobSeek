import type { CSSProperties } from "react";
import type { FieldState } from "./store";

function cleanLabel(raw: string): string {
  const noUuid = raw
    .replace(/\b[0-9a-f]{8}\s+[0-9a-f]{4}\s+[0-9a-f]{4}\s+[0-9a-f]{4}\s+[0-9a-f]{12}\b/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ");
  const normalized = noUuid
    .replace(/type here\.\.\./gi, " ")
    .replace(/systemfield/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "Field";
}

function statusIcon(field: FieldState): string {
  if (field.status === "queued") return "\u25D4";
  if (field.status === "ai_generating") return "\u26A1";
  if (field.status === "loading") return field.source === "ai" || field.isOpenEnded ? "\u26A1" : "\u25F4";
  if (field.status === "filled") return "\u2705";
  if (field.status === "skipped") return "\u23ED";
  if (field.status === "manual_required") return "\u270D";
  if (field.status === "failed") return "\u274C";
  return field.isOpenEnded ? "\u26A1" : "\u25CB";
}

export function FieldItem(props: {
  field: FieldState;
  selected: boolean;
  onClick: () => void;
  /** Sidebar-only: optional “Fill with AI” control. */
  showGenerateAi?: boolean;
  disableGenerateAi?: boolean;
  onGenerateAi?: () => void;
}) {
  const isAttention =
    props.field.status === "failed" ||
    props.field.status === "manual_required" ||
    props.field.status === "skipped";
  const statusColor = isAttention ? "#c2410c" : "#9a3412";
  const shell: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: props.selected ? "#fff7ed" : "#fffdf9",
    border: props.selected ? "1px solid #fb923c" : "1px solid #fed7aa",
    borderRadius: 14,
    padding: "8px 10px",
    transition: "border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, background 140ms ease",
    boxShadow: props.selected ? "0 0 0 3px rgba(251,146,60,0.2), 0 8px 18px rgba(194,65,12,0.12)" : "none",
    lineHeight: 1.35,
  };
  const rowBtn: CSSProperties = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    border: "none",
    background: "transparent",
    padding: "4px 6px",
    margin: 0,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    lineHeight: 1.35,
    borderRadius: 10,
  };
  return (
    <div style={shell}>
      <button type="button" onClick={props.onClick} style={rowBtn}>
        <span style={{ width: 18, textAlign: "center", fontSize: 15, color: statusColor, flexShrink: 0 }}>
          {statusIcon(props.field)}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textAlign: "left", minWidth: 0 }}>
          <span
            style={{
              display: "block",
              color: "#7c2d12",
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {cleanLabel(props.field.label)}
          </span>
          <span style={{ display: "block", marginTop: 2, color: statusColor, fontSize: 11 }}>
            {props.field.status === "ai_generating" ? "generating" : props.field.status}
            {props.field.source ? ` · ${props.field.source}` : ""}
            {props.field.reason ? ` · ${props.field.reason}` : ""}
          </span>
        </span>
      </button>
      {props.showGenerateAi ? (
        <button
          type="button"
          aria-label="Fill with AI"
          title="Generate an answer with AI and insert it into this field"
          disabled={props.disableGenerateAi}
          onClick={(e) => {
            e.stopPropagation();
            props.onGenerateAi?.();
          }}
          style={{
            flexShrink: 0,
            maxWidth: 118,
            padding: "6px 8px",
            borderRadius: 10,
            border: "1px solid #fdba74",
            background: props.disableGenerateAi ? "#fff7ed" : "#fff",
            color: "#c2410c",
            fontSize: 10,
            fontWeight: 800,
            lineHeight: 1.2,
            cursor: props.disableGenerateAi ? "not-allowed" : "pointer",
            opacity: props.disableGenerateAi ? 0.65 : 1,
            fontFamily: "inherit",
            whiteSpace: "normal",
            textAlign: "center",
          }}
        >
          Fill with AI
        </button>
      ) : null}
    </div>
  );
}
