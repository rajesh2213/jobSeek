import { useState } from "react";
import { JOBLOOM_WEB_ORIGIN } from "../jobloomWeb";
import { FieldItem } from "./FieldItem";
import type { FieldState, SidebarState } from "./store";
import { extensionLogoPrimUrl } from "../lib/extensionAssets";
import {
  fontSans,
  headerInsetGlow,
  panelBg,
  panelBgDeep,
  panelBorder,
  textMuted,
  textStrong,
} from "./smartApplyTheme";
import { SIDEBAR_PANEL_WIDTH_PX, SIDEBAR_TRANSITION } from "./uiMotion";

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
  const [autofillHover, setAutofillHover] = useState(false);
  const [accountInfoOpen, setAccountInfoOpen] = useState(false);

  const rows = groupedRows(props.state.fields);

  /** No `tabs` permission — opening from a click uses the page’s window (allowed in content scripts). */
  function openJobloomTab(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  const statusSummary = props.state.fields.reduce(
    (acc, field) => {
      acc[field.status] = (acc[field.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const st = props.state.smartApplyStatus;
  const tok = props.state.hasAuthToken;
  const loaded = props.state.accountDataLoaded;
  const email = props.state.profile?.email?.trim();
  const displayName =
    props.state.profile?.fullName?.trim() ||
    [props.state.profile?.firstName, props.state.profile?.lastName].filter(Boolean).join(" ").trim() ||
    "";
  const limitReached = st != null && typeof st.jobsRemaining === "number" && st.jobsRemaining <= 0;
  const profileIncomplete = st != null && st.profileComplete === false;
  const autofillBlocked = props.state.isRunning || limitReached || profileIncomplete;

  /** Do not show “Signed in” without name/email — stale storage tokens can exist without a live session. */
  const accountPrimary =
    tok === false
      ? "Not signed in"
      : tok === null
        ? "Checking session…"
        : !loaded
          ? "Loading account…"
          : displayName ||
            email ||
            (!props.state.profile && !st
              ? "Not signed in"
              : "Add your name or email under Account on the website");

  /** One place for sign-in guidance — avoids repeating jobloom.tech / popup across three lines. */
  const needsWebsiteHint =
    tok === false || (loaded && tok === true && st == null);

  const planSummary =
    tok === false
      ? "Plan —"
      : tok === null || !loaded
        ? "Plan …"
        : st?.plan?.trim()
          ? `Plan: ${st.plan.trim()}`
          : "Plan —";

  const usageSummary =
    tok === false
      ? "Usage —"
      : tok === null || !loaded
        ? "Usage …"
        : st != null
          ? `Usage: ${st.jobsRemaining} / ${st.jobsLimit} Smart Apply uses today`
          : "Usage —";

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        transform: props.state.isOpen ? "translateX(0)" : "translateX(100%)",
        width: SIDEBAR_PANEL_WIDTH_PX,
        height: "100vh",
        zIndex: 2147483647,
        background: panelBg,
        borderLeft: `1px solid ${panelBorder}`,
        boxShadow: "0 18px 40px rgba(124,45,18,0.22)",
        transition: `transform ${SIDEBAR_TRANSITION}`,
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
              <img
                src={extensionLogoPrimUrl()}
                alt="JobLoom"
                style={{
                  display: "block",
                  height: 36,
                  width: "auto",
                  maxWidth: "min(100%, 200px)",
                  objectFit: "contain",
                  objectPosition: "left center",
                  flexShrink: 1,
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
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                Smart Apply
              </div>
            </div>
            <div style={{ fontFamily: fontSans, fontSize: 12, color: textMuted, marginTop: 8 }}>
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

        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${panelBorder}`,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              aria-expanded={accountInfoOpen}
              onClick={() => setAccountInfoOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid ${accountInfoOpen ? "#fb923c" : panelBorder}`,
                background: accountInfoOpen ? "#fff7ed" : panelBgDeep,
                fontFamily: fontSans,
                fontSize: 11,
                fontWeight: 800,
                color: textStrong,
                cursor: "pointer",
              }}
            >
              Account info
              <span aria-hidden style={{ fontSize: 10, opacity: 0.75 }}>
                {accountInfoOpen ? "▼" : "▶"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openJobloomTab(`${JOBLOOM_WEB_ORIGIN}/smart-apply`)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid #fdba74`,
                background: "#fff",
                fontFamily: fontSans,
                fontSize: 11,
                fontWeight: 800,
                color: "#c2410c",
                cursor: "pointer",
              }}
            >
              Smart Apply page →
            </button>
          </div>

          {accountInfoOpen ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${panelBorder}`,
                background: "#fffdf9",
                fontFamily: fontSans,
              }}
            >
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: textStrong,
                  lineHeight: 1.35,
                  wordBreak: "break-word",
                }}
              >
                {accountPrimary}
              </p>
              {email && displayName ? (
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 11,
                    color: textMuted,
                    wordBreak: "break-all",
                  }}
                >
                  {email}
                </p>
              ) : null}
              {needsWebsiteHint ? (
                <p style={{ margin: "0 0 8px", fontSize: 10, color: textMuted, lineHeight: 1.45 }}>
                  Use Open website account below or visit jobloom.tech to sign in.
                </p>
              ) : null}
              <p style={{ margin: "0 0 6px", fontSize: 10, color: textMuted, lineHeight: 1.45 }}>
                {planSummary}
              </p>
              <p style={{ margin: "0 0 8px", fontSize: 10, color: textMuted, lineHeight: 1.45 }}>
                {usageSummary}
                {st?.resetsAt ? (
                  <>
                    <br />
                    <span style={{ opacity: 0.9 }}>Resets {st.resetsAt}</span>
                  </>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => openJobloomTab(`${JOBLOOM_WEB_ORIGIN}/account`)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid #fdba74`,
                  background: "#fff",
                  fontFamily: fontSans,
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#c2410c",
                  cursor: "pointer",
                }}
              >
                Open website account →
              </button>
            </div>
          ) : null}
        </div>

        {profileIncomplete ? (
          <div
            style={{
              marginTop: 10,
              borderRadius: 10,
              border: "1px solid #fdba74",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 12,
              padding: "8px 10px",
              fontFamily: fontSans,
            }}
          >
            Complete your Smart Apply profile on the website before using autofill.
          </div>
        ) : null}
        {limitReached ? (
          <div
            style={{
              marginTop: 10,
              borderRadius: 10,
              border: "1px solid #fdba74",
              background: "#fff7ed",
              color: "#9a3412",
              fontSize: 12,
              padding: "8px 10px",
              fontFamily: fontSans,
            }}
          >
            Daily Smart Apply limit reached{st?.resetsAt ? `. Resets at ${st.resetsAt}.` : "."}
          </div>
        ) : null}
        <button
          type="button"
          onClick={props.onAutofill}
          disabled={autofillBlocked}
          onMouseEnter={() => !autofillBlocked && setAutofillHover(true)}
          onMouseLeave={() => setAutofillHover(false)}
          style={{
            marginTop: 14,
            width: "100%",
            border: `1px solid ${autofillBlocked ? panelBorder : "transparent"}`,
            borderRadius: 12,
            background: autofillBlocked ? "#fdba74" : "linear-gradient(135deg, #fb923c 0%, #ea580c 100%)",
            color: "#fff",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 800,
            fontFamily: fontSans,
            cursor: autofillBlocked ? "not-allowed" : "pointer",
            boxShadow:
              autofillBlocked
                ? "none"
                : autofillHover
                  ? "0 14px 30px rgba(194,65,12,0.38)"
                  : "0 10px 22px rgba(194,65,12,0.28)",
            transform: !autofillBlocked && autofillHover ? "translateY(-1px)" : "none",
            filter: !autofillBlocked && autofillHover ? "brightness(1.05)" : "none",
            transition: "transform 160ms ease, box-shadow 160ms ease, filter 160ms ease, opacity 160ms ease",
            opacity: autofillBlocked && !props.state.isRunning ? 0.85 : 1,
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

