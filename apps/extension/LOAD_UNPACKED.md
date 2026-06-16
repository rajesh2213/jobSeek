# Load unpacked (local Chrome testing)

The extension always installs in **Chrome on your computer**, not on the VPS. The VPS only builds `dist/` and `extension.zip`.

## Correct folder

Chrome must load the folder that contains **`manifest.json` and `background.js` in the same directory**.

| Correct | Wrong |
|---------|--------|
| `.../JobLoom-Extension/manifest.json` | `.../apps/extension/` (source tree — no built JS at root) |
| `.../JobLoom-Extension/background.js` | `.../extension.zip` (zip file itself) |
| Unzipped zip root (files at top level) | Unzipped folder named `dist/` nested inside another folder |

After `npm run zip:ext`, unzip so you see `manifest.json`, `background.js`, `content.js`, and `assets/` **side by side**.

## Windows + WSL

Do **not** use **Load unpacked** on a path like `\\wsl$\Ubuntu\home\ubuntu\...`. Chrome on Windows often fails service worker registration (**Status code: 2**) on network/WSL paths while content scripts still work.

1. Copy the unzipped folder to a native Windows path, e.g. `C:\Users\You\jobloom-ext\`
2. In Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select that folder
3. Confirm **Service worker** shows **Active** (not Inactive). Click it — DevTools should open

## Verify before testing Ashby

1. Extension version matches the build you expect (sidebar footer)
2. Service worker is **Active**
3. On `jobloom.tech`, sign in — unpacked builds use a **different extension ID** than the Web Store; auth sync from the site may require the postMessage bridge (deployed website) or setting `NEXT_PUBLIC_JOBLOOM_EXTENSION_ID` to your unpacked ID

## Rebuild on VPS

```bash
cd /home/ubuntu/jobSeek/apps/extension
npm run build:ext && npm run check:ext && npm run zip:ext
```

Download `extension.zip`, unzip on your PC, load as above.
