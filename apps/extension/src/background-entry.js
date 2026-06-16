"use strict";
/**
 * Thin bootstrap so Chrome loads a tiny classic script first, then pulls in the webpack bundle.
 * If the bundle fails to evaluate, chrome://extensions → Errors shows the message below.
 */
try {
  importScripts("background-main.js");
} catch (err) {
  const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  console.error("[JobLoom] background-main.js failed to load:", msg);
}
