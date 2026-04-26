# JobLoom — Chrome Web Store (listing + review pack)

> No Chrome Web Store submission is ever **guaranteed** to pass. This document is written for **high** approval odds: clear single purpose, least-privilege story, and honest data disclosures.

## Project structure (summary)

| Area | Path / notes |
|------|--------------|
| Manifest | `manifest.json` (MV3) |
| Build | Webpack 5, TypeScript, React (popup bundle) |
| Background | `src/background.ts` → `dist/background.js` (service worker) |
| Content | `src/content.ts` → `dist/content.js` (`all_frames: true` for iframe-heavy ATS) |
| Popup (built) | `src/popup/` → `dist/popup.js` + `popup.html` (bundled; **not** the toolbar entry in this product — there is no `action.default_popup`) |
| Options | None |
| Assets | `icons/*` → `dist/assets/*` at build |
| API default | `https://jobseek-server.up.railway.app` (build override: `EXTENSION_API_BASE`) |

**Scripts (from `apps/extension`):** `build:ext` (clean + production bundle), `check:ext`, `zip:ext` → `extension.zip` (files at zip root, not a parent folder). Root `package.json` forwards `build:ext` / `zip:ext` / `check:ext` to the workspace.

---

## Store listing (copy-ready)

### Short description (max 132 characters)

Helps you fill online job application forms with your saved JobLoom profile. You review and submit. Optional drafts for long questions.

(Adjust length to fit; aim under 132 characters.)

### Full description (clear, non-spam)

JobLoom is for people applying to jobs on the web. On supported job application pages, it can detect form fields, fill common answers from the profile and resume you store in your JobLoom account, and help draft text for longer questions. The extension does not submit applications for you. You should review every field before you click submit on the employer’s site.

**How you open the product:** The extension is opened from the **Chrome toolbar** — **clicking the JobLoom icon toggles the in-page sidebar** on supported application pages. The manifest does **not** set `action.default_popup`; a separate `popup.html` bundle is included for possible future use or sideloading, but the primary UX is the **in-page** sidebar, not a toolbar popup. Say this clearly so reviewers are not left looking for a missing default popup.

**What connects where:** When you are signed in, the extension uses your account on JobLoom’s servers to load your profile, usage limits, and optional Smart Apply features. The extension is not for advertising and does not sell your data to data brokers. Use the **privacy policy URL** in this listing (must be a public HTTPS page you control) for full detail.

**Permissions:** The listing’s **Data usage** and **justification** fields should match the “Permission justification (reviewer-friendly)” section below. Screenshots should show a real job application page, not a generic home page.

---

## Permission justification (reviewer-friendly)

Use this in **single-purpose explanation**, **permission justifications** (if the form asks), and **in-app/FAQ** if you link one.

| Permission / pattern | Why it is needed | Tighter alternative (tradeoffs) |
|---------------------|------------------|----------------------------------|
| **activeTab** | Confirms the extension is driven by the user on the current tab (toolbar / extension surfaces), without the broader **`tabs`** permission. | `tabs` would be *broader* (more visible URL access across all tabs). **Keep `activeTab`.** |
| **storage** | Stores session material and optional settings (e.g. API base) in `chrome.storage.local` on the device. | `sessionStorage` is not available in the service worker; cloud sync is a different product. **Keep** unless you move auth to cookie-only (usually not for extensions). |
| **webNavigation** | **Store-ready line:** *“Used to detect embedded job application frames (e.g. Greenhouse, Lever) so the extension attaches only to relevant job application content.”* In code, it enumerates frames in the active tab for scan, fill, and undo across **iframes** (many ATS embed the form in frames). | The only stricter options are to drop iframe support (breaks many sites) or **user-invoked** `scripting` per frame (heavier, worse UX). **Keep** for this architecture. |
| **host_permissions: `https://*/*`** | The service worker fetches your **JobLoom backend over HTTPS** (any host you configure as `https://...`). This pattern is **not** the same as `<all_urls>` (e.g. excludes `file://`), but is still a **broad** pattern. Reviewers expect a clear, accurate justification. | **Narrower:** ship only `https://jobseek-server.up.railway.app/*` (or your final API host) and **remove** `apiBase` overrides from storage in production. That reduces scope at the cost of flexibility for self-hosted/staging. |
| **content_scripts: `https://*/*` and `http://*/*`** | Injects the content script on standard web pages so the extension can work on **employer career sites and ATS** (including some non-ATS hostnames with Greenhouse-style query params). | **Narrower:** a large explicit match list of ATS and known embed patterns. **Many career pages would break** (unknown subdomains, new ATS). The honest listing line: “Runs on public https/http pages; job-related UI is shown when the page looks like an application flow.” **Optional high-ROI later:** `declarativeContent` + `scripting` to inject only on user click or on allowlisted domains (more code, new permission story). |

**About `https://*/*` vs `http://*/*`:**  
- **host_permissions** only includes **`https://*/*`**, so the background cannot fetch arbitrary **HTTP** origins in production.  
- **content_scripts** still include **http** for rare legacy or misconfigured **HTTP** job pages, so the script can run there. The extension does not execute remote JavaScript; it ships a fixed bundle. The in-page UI uses **system / web-safe font stacks** in the content script (no Google Fonts or other third-party font URLs).

**Misleading UX (avoid in review and UI):** Do not claim “one-click apply” or “we submit for you” if the user must still submit. Your description already says the user reviews and submits.

---

## Privacy policy (template — host at public HTTPS, replace all `[brackets]`)

**Last updated: [date]**

**Controller / operator:** [legal entity name]  
**Contact (privacy):** [email]  
**Service:** JobLoom browser extension and website at [https://jobseek.app] (or your production URL)

### 1. What the extension is for

The extension helps you complete job application forms in your browser. It is not a generic browsing tool. It is intended for use on job application and career pages.

### 2. Data we process

- **Account and authentication:** If you are signed in, authentication material is used to reach your account. **Authentication tokens are stored locally on your device using Chrome extension storage and are never shared with third parties** (only used between the extension and JobLoom’s own servers as part of the service). They may be sent in **Authorization** headers to our servers. Do **not** claim tokens are “stored securely” in a way that implies encryption beyond what Chrome provides; the accurate story is local extension storage, not a separate vault.  
- **Profile, resume, and Smart Apply:** The extension may request your application profile, resume, usage limits, and optional **draft** answers for long-form questions from our servers, so it can help fill the page.  
- **Page context (forms):** To fill a form, the extension reads the **structure and content of the application page** (e.g. fields, labels) in the tab where you use it. It does this so it can place answers in the right fields. It does not operate silently on unrelated tabs.  
- **Product usage events:** The extension may send **limited event data** to our servers (e.g. that a supported page was detected or a fill was started) to run limits and improve the product, as defined by our API and your account. Do **not** claim “no analytics” if you send any events—describe what you send in aggregate terms.

### 3. What we do not do (unless true—edit carefully)

- We do not sell your personal information to data brokers.  
- We do not use the extension to inject **third-party advertising** in web pages.  
- We do not load or execute **remote code** in the extension (the published package is a fixed bundle; see your engineering review for CSP and build).

### 4. Local storage and security

**Authentication tokens are stored locally on your device using Chrome extension storage and are never shared with third parties** — they are used only so the extension can call JobLoom’s own APIs.  
This storage is **not** a separate encrypted vault beyond normal Chrome profile protections; someone with access to the unlocked device or a compromised profile could access stored extension data. Users should use a **password-protected** OS account, sign out from JobLoom when done, and avoid shared devices, or remove the extension on machines they do not control.

### 5. Your choices and rights

Users may sign out, uninstall the extension, and exercise account rights (access, deletion, etc.) as offered on the **JobLoom website** and as required in your jurisdiction. Link to a **contact** and **DPA** if you serve businesses.

**Host this as a public HTTPS page and paste the exact URL in the store “Privacy policy” field. The URL must be reachable and match what you state.**

---

## Pre-launch checklist (internal)

- [ ] **Policy:** Single purpose is obvious (job application assistance); no policy surprises (e.g. undisclosed data sale).  
- [ ] **Minimal permissions:** Every permission in `manifest.json` is explained in the listing and in this file; remove unused before ship.  
- [ ] **No remote code:** Bundles are built from source; no `eval` of user/server strings.  
- [ ] **Clear user value:** Description matches what the extension does; no overclaim.  
- [ ] **Privacy policy valid:** Public HTTPS, accurate on auth, storage, and network.  
- [ ] **No debug:** Production build: `build:ext`, `check:ext`, no dev URLs, no `console` logging (Terser + checks).  
- [ ] **Secure API usage:** HTTPS in production, path allowlist for proxied API routes, `fetch` to resolved URL only.  
- [ ] **Screenshots & data safety:** No real PII in store images if avoidable.  
- [ ] **Test accounts:** If reviewers need login, provide limited test account instructions in a **private** support channel, not the public listing.  

---

## Security / review implementation notes (codebase)

- **API path allowlist** — The service worker only proxies **known** `path` values (see `src/lib/allowedApiPaths.ts`); all other paths are rejected. `api.ts` uses the same constants.  
- **URL resolution** — Requests use `new URL(path, base)` and **origin must match** the API base, blocking odd resolution edge cases.  
- **No `<all_urls>`** in manifest; content matches are explicit `https` and `http` page patterns.  
- **Remote code / fonts:** No dynamic `Function` or `import()` of remote URLs. The content-layer sidebar uses **system / web-safe font stacks** only (no third-party font CDNs in the content shadow root).

## Optional high-ROI (only if worth the work)

1. **Narrow `host_permissions`** to your production API host only, and **stop** honoring `apiBase` from storage in store builds, **or** add `optional_host_permissions` and `chrome.permissions` for a rare “self-hosted API” path (more UX complexity).  
2. **Remove `http://*/*` from `content_scripts`** if you can accept that **zero** HTTP job pages are supported.  
3. **If** you reintroduce custom webfonts, either self-host under `web_accessible_resources` + `assets/` or add an explicit **privacy** line (standard font request, no tracking beyond the host’s normal logs). The current build avoids that tradeoff.  
4. If you want a **toolbar popup** as the main entry, set `action.default_popup` to `popup.html` and **remove** the `onClicked` listener that toggles the sidebar (they are mutually exclusive in Chrome). Otherwise keep the current model and the **“How you open the product”** copy above.

## Residual risk (be honest in internal planning)

- **“Guaranteed” approval does not exist.** Broad **content** injection on `https`/`http` public pages is **common** for form assistants but is still a **frequent** review question. Success depends on **clear listing text** + **accurate** privacy disclosures + **no** behavior-policy surprises.  
- **Session in `chrome.storage.local`** is standard but is **not** as strong as short-lived or OS-keychain–backed tokens. Mitigate with good server-side session control and honest privacy text.

---

## Upload to Chrome Web Store (brief)

1. `npm run build:ext` and `npm run check:ext` (from monorepo root or `apps/extension`).  
2. `npm run zip:ext` in `apps/extension` → upload **`extension.zip`**.  
3. Developer Dashboard → new or updated item → **Upload** the zip.  
4. Complete **Data usage** (single purpose, categories you actually collect) and point **Privacy policy** to the hosted URL.  
5. If rejected, read the **cited** policy; fix the **smallest** thing (listing, permission, or behavior) and resubmit.

---

## Verdict (internal)

- **“Guaranteed”:** **No** — CWS and policies change; reviewers are human.  
- **“Likely to pass if honest and well-documented”:** **Yes**, provided listing, privacy, and permissions align with real behavior, and the broad **content** scope is explained.  
- **“Likely rejected”:** If the listing overclaims, omits data collection, or reviewers find a **sensitive** or **unexplained** behavior in testing.

When in doubt, **simplify the listing** and **narrow** permissions in the next version rather than fighting review with marketing language.
