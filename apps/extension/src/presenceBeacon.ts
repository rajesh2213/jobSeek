/**
 * Runs in the page's MAIN world (see manifest) so site JS can read window.__JOBSEEK_EXTENSION__.
 * Standard isolated content scripts cannot expose globals to the host page.
 */
declare global {
  interface Window {
    __JOBSEEK_EXTENSION__?: boolean;
  }
}

try {
  window.__JOBSEEK_EXTENSION__ = true;
  window.dispatchEvent(new Event("jobseek-extension-ready"));
} catch {
  /* ignore */
}
