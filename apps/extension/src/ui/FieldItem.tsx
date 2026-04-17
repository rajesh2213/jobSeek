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
}) {
  const isAttention =
    props.field.status === "failed" ||
    props.field.status === "manual_required" ||
    props.field.status === "skipped";
  const statusColor = isAttention ? "#c2410c" : "#9a3412";
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: props.selected ? "#fff7ed" : "#fffdf9",
    border: props.selected ? "1px solid #fb923c" : "1px solid #fed7aa",
    borderRadius: 14,
    padding: "10px 12px",
    textAlign: "left",
    cursor: "pointer",
    transition: "border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, background 140ms ease",
    boxShadow: props.selected ? "0 0 0 3px rgba(251,146,60,0.2), 0 8px 18px rgba(194,65,12,0.12)" : "none",
    lineHeight: 1.35,
  };
  return (
    <button type="button" onClick={props.onClick} style={base}>
      <span style={{ width: 18, textAlign: "center", fontSize: 15, color: statusColor }}>
        {statusIcon(props.field)}
      </span>
      <span style={{ flex: 1, overflow: "hidden" }}>
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
  );
}

