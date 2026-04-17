import { FieldItem } from "./FieldItem";
import type { FieldState, SidebarState } from "./store";
import {
  brand,
  fontDisplay,
  fontSans,
  headerInsetGlow,
  ink,
  panelBg,
  panelBgDeep,
  panelBorder,
  textMuted,
  textStrong,
} from "./smartApplyTheme";

function groupedRows(fields: FieldState[]): FieldState[] {
  const groups = new Map<string, FieldState[]>();
  for (const field of fields) {
    const isChoice = field.inputType === "radio" || field.inputType === "checkbox";
    const key =
      isChoice && field.groupKey
        ? `group:${field.frameId ?? 0}:${field.groupKey}`
        : `field:${field.id}`;
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }
  const priority: Array<FieldState["status"]> = [
    "loading",
    "ai_generating",
    "failed",
    "manual_required",
    "skipped",
    "filled",
    "queued",
    "idle",
  ];
  return Array.from(groups.values()).map((rows) => {
    if (rows.length === 1) return rows[0] as FieldState;
    const rep = rows[0] as FieldState;
    const chosenStatus = priority.find((s) => rows.some((r) => r.status === s)) ?? rep.status;
    const source = rows.find((r) => r.source === "ai")?.source ?? rows.find((r) => r.source)?.source;
    const reason = rows.find((r) => r.reason)?.reason;
    return {
      ...rep,
      status: chosenStatus,
      source,
      reason,
    };
  });
}

export function Sidebar(props: {
  state: SidebarState;
  onClose: () => void;
  onAutofill: () => void;
  onFieldClick: (fieldId: string, selector: string) => void;
}) {
  const rows = groupedRows(props.state.fields);
  const statusSummary = props.state.fields.reduce(
    (acc, field) => {
      acc[field.status] = (acc[field.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        transform: props.state.isOpen ? "translateX(0)" : "translateX(100%)",
        width: 420,
        height: "100vh",
        zIndex: 2147483647,
        background: panelBg,
        borderLeft: `1px solid ${panelBorder}`,
        boxShadow: "0 18px 40px rgba(124,45,18,0.22)",
        transition: "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        lineHeight: 1.3,
        willChange: "transform",
      }}
    >
      <div
        style={{
          padding: "14px 16px 16px",
          borderBottom: `1px solid ${panelBorder}`,
          background: panelBgDeep,
          boxShadow: headerInsetGlow,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 4,
                fontFamily: fontDisplay,
                fontStyle: "italic",
                fontSize: 22,
                fontWeight: 400,
                color: ink,
                lineHeight: 1,
              }}
            >
              <span>jobseek</span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: brand,
                  flexShrink: 0,
                  marginBottom: 2,
                }}
                aria-hidden
              />
            </div>
            <div
              style={{
                fontFamily: fontSans,
                fontSize: 11,
                fontWeight: 700,
                color: textMuted,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                marginTop: 6,
                lineHeight: 1.2,
              }}
            >
              Smart Apply
            </div>
            <div style={{ fontFamily: fontSans, fontSize: 12, color: textMuted, marginTop: 4 }}>
              {props.state.progress.completed}/{props.state.progress.total} processed
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close sidebar"
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              border: `1px solid ${panelBorder}`,
              background: panelBgDeep,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              color: textStrong,
              boxShadow: "-2px 2px 12px rgba(124, 45, 18, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <button
          type="button"
          onClick={props.onAutofill}
          disabled={props.state.isRunning}
          style={{
            marginTop: 14,
            width: "100%",
            border: `1px solid ${props.state.isRunning ? panelBorder : "transparent"}`,
            borderRadius: 12,
            background: props.state.isRunning ? "#fdba74" : "linear-gradient(135deg, #fb923c 0%, #ea580c 100%)",
            color: "#fff",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 800,
            fontFamily: fontSans,
            cursor: props.state.isRunning ? "not-allowed" : "pointer",
            boxShadow: props.state.isRunning ? "none" : "0 10px 22px rgba(194,65,12,0.28)",
          }}
        >
          {props.state.isRunning
            ? `Autofilling ${props.state.progress.completed}/${props.state.progress.total}`
            : "Autofill all"}
        </button>
        {props.state.error ? (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{props.state.error}</div>
        ) : null}
        {!props.state.error && props.state.isRunning ? (
          <div
            style={{
              marginTop: 8,
              borderRadius: 10,
              border: "1px solid #fdba74",
              background: "#fff7ed",
              color: "#9a3412",
              fontSize: 12,
              padding: "8px 10px",
            }}
          >
            Working through fields from top to bottom...
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid #ffedd5",
          background: "#fff7ed",
        }}
      >
        {["filled", "failed", "skipped", "manual_required"].map((key) => (
          <span
            key={key}
            style={{
              fontSize: 11,
              color: "#9a3412",
              border: "1px solid #fdba74",
              borderRadius: 999,
              padding: "3px 8px",
              background: "#fff",
            }}
          >
            {key}: {statusSummary[key] ?? 0}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((field) => (
          <FieldItem
            key={field.id}
            field={field}
            selected={props.state.selectedFieldId === field.id}
            onClick={() => props.onFieldClick(field.id, field.selector)}
          />
        ))}
      </div>
    </aside>
  );
}

