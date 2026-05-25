# BTL Deal Analyser — "The Ledger"

A private buy-to-let deal analyser. Compares properties side by side, nets the
equity-release carry cost, checks each deal against cashflow/yield targets, stores
photos, and persists everything to Supabase.

The editable source is **`btl-deal-analyser.jsx`** (stored in this project). It is the
`App` component. Everything in the live site is built from it — never hand-edit the
deployed bundle; change the source and let the build run.

---

## The goal of this setup

Make changes fast: ask Claude → Claude edits `btl-deal-analyser.jsx` → you commit →
the site rebuilds and deploys itself. No local `npm run build`, no manual file
uploads. This is the same feel as your CRM repo.

> NOTE: This is a ONE-TIME setup. So far this analyser has only been deployed by
> manually uploading `dist` files. The steps below switch it to auto-deploy, after
> which every change is just "edit the file, commit, done."

---

## One-time setup (do this once)

You already have the local project folder you ran `npm run build` in. That folder
has the scaffolding (`package.json`, `index.html`, the file that mounts `App`, etc.).
Use it — don't recreate it.

1. **Add the source file to the folder.** Put `btl-deal-analyser.jsx` into the
   project's source directory (usually `src/`). Make sure the entry file imports it.
   In a standard Vite setup the entry is `src/main.jsx` and should read:

   ```jsx
   import React from "react";
   import { createRoot } from "react-dom/client";
   import App from "./btl-deal-analyser.jsx";
   createRoot(document.getElementById("root")).render(<App />);
   ```

   (If your existing entry imports a differently-named `App` file, either rename this
   file to match, or point the import at this file. Tell Claude the entry filename and
   it will keep them consistent.)

2. **Push the whole folder to a GitHub repo** (a new repo, same as your CRM repo).

3. **Create a Cloudflare Pages project** connected to that repo, with:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Framework preset:** Vite (or "None" with the command above)

4. **Do the backend steps in `BACKEND.md`** (the `purchase_fees` column, the
   `property-photos` bucket, and the access policies). The app will load without them
   but saving fees and uploading photos will fail until they're done.

After this, the first push deploys the site, and you're on the fast path.

---

## Making a change (every time after setup)

1. Ask Claude in this project for the change.
2. Claude edits `btl-deal-analyser.jsx` and hands it back.
3. Replace the file in your repo and commit/push.
4. Cloudflare Pages rebuilds and deploys automatically.

Claude is not a live editor of the deployed site — each change is an edit you push.
What the stored files buy you is that Claude starts from the exact current code
instead of reverse-engineering the built bundle, which is the difference between a
few minutes and a long rebuild.

---

## Supabase client import — worth knowing

The source currently loads Supabase from a CDN at runtime:

```js
import("https://esm.sh/@supabase/supabase-js@2")
```

This was done so the file also runs in Claude's preview. It works in production too.
If you'd prefer the faster, offline-safe normal import, run `npm install
@supabase/supabase-js` in the project and ask Claude to switch the source to a static
`import { createClient } from "@supabase/supabase-js"`. Either is fine; just keep it
consistent.

---

## Deploy facts (fill in once confirmed)

- **GitHub repo:** _(TODO: URL)_
- **Cloudflare Pages project:** _(TODO: name)_
- **Live URL:** _(TODO)_
- **Entry file that imports App:** _(TODO: e.g. `src/main.jsx`)_

---

## See also

- `BACKEND.md` — Supabase URL/key, schema, auth allow-list, and every manual step
  you run yourself (SQL + dashboard): the `purchase_fees` column, the photo bucket,
  and the access policies.
- `DECISIONS.md` — settled design decisions and known gaps, so they don't get
  re-litigated or re-discovered each time.
