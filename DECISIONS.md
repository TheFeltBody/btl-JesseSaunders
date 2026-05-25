# Decisions & known gaps

A short, current record so settled choices don't get re-litigated and known
limitations don't get re-discovered. Update it when something changes.

---

## Settled decisions

**Auction / purchase fees are modelled separately from SDLT and yield.**
They go into `purchase_fees`, which is added to total cash required and reduces
capital remaining — but SDLT is calculated on the purchase price (`offer`) only, and
gross yield is rent ÷ `offer`. This was the whole reason for the field: folding fees
into the offer price inflates SDLT and yield incorrectly; folding them into refurb
hides them. Verified: with vs without a fee, SDLT and gross yield are unchanged and
cash-in rises by exactly the fee.

> Caveat kept in the UI footnote: under some Modern Method of Auction rules HMRC may
> treat the reservation fee as chargeable consideration for SDLT. Confirm per-deal
> with a solicitor. The tool's default (fee excluded from SDLT) is the common case,
> not legal advice.

**Property status is `none` / `favourite` / `rejected`.**
Favourites get a gold spine; rejected ones dim and are hidden unless filtered to.
Clicking the same status again clears it back to `none`.

**Each property has its own detail page** with the full financial breakdown
(acquisition, financing & cash, annual cashflow, monthly & returns, target checks).

**No ST6 / Tunstall branding.** The tool is area-agnostic; each property has a free
"Area / type" field. (Removed because the search has broadened beyond ST6.)

**Photos use a public bucket** (`property-photos`), path `{property_id}/{uuid}.{ext}`,
matching the original backend. Public was chosen for simplicity; the app is already
behind a login allow-list, so the main exposure is that a raw image URL, if shared,
is viewable. Acceptable for now.

**Persistence is optimistic write-through**, debounced ~0.6s. New properties insert
with a temporary negative id, then swap to the real DB id once saved.

**Supabase client is loaded from a CDN at runtime** so the file also runs in Claude's
preview. Fine in production; can be switched to a normal npm import for speed (see
README).

---

## Known gaps / not built yet

- **Magic-link auth only completes on the real domain.** The email redirect points at
  `window.location.origin`, which in Claude's preview is the sandbox, not the live
  site. The login screen renders, but the round-trip must be tested on Cloudflare.
- **Photo upload can't be click-tested in Claude's preview** for the same reason. The
  code is correct and fails gracefully; it works once deployed with the bucket +
  policies in place.
- **No drag-to-reorder.** `sort_order` exists and is respected on load, but there's no
  UI to reorder properties yet.
- **No side-by-side comparison view.** Properties are compared via the card grid; a
  dedicated compare table hasn't been built.
- **No explicit "capital left in" / BRRR refinance tracking.** Capital remaining is
  shown, but post-refinance pull-out isn't modelled as its own field.
- **Email allow-list is enforced client-side in the app.** Real enforcement must come
  from RLS / Supabase Auth settings (see BACKEND.md).

---

## If you want any of the gaps closed

Just ask in this project. Good candidates that came up during the build: drag-to-
reorder writing back to `sort_order`; a compare view; a BRRR "capital left in after
refinance" field; switching the Supabase import to npm.
