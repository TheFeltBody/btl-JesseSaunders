# Backend — Supabase

Everything here lives OUTSIDE the app code. The `.jsx` expects these to exist; you
run them yourself in the Supabase dashboard. Claude can't (and shouldn't) make schema
or permission changes for you.

---

## Project

- **URL:** `https://pfbzfybdmhurzzotjzfd.supabase.co`
- **Publishable key (client-side, safe to ship):**
  `sb_publishable_2olAga7yVfZE-mWJg4Shxw_P5BPvRM2`
- **Auth:** magic-link (email one-time link). Restricted to the allow-list below.

> The publishable key is meant to be in client code. Its safety depends entirely on
> Row Level Security (RLS) being enabled and correctly scoped. Check that before
> sharing the live URL with anyone.

### Allow-listed emails
```
sdsproperty26@gmail.com
chaim@btinternet.com
moveme@jessesaunders.net
```
The app checks this list client-side, but the real enforcement must be your RLS
policies / Supabase Auth settings. Client checks can be bypassed; policies cannot.

---

## Tables

### `properties`
App columns (camelCase in code → snake_case in DB):

| DB column      | type    | notes                                  |
|----------------|---------|----------------------------------------|
| id             | bigint  | primary key, auto                      |
| name           | text    |                                        |
| area           | text    | "Area / type" in the UI                |
| listing_url    | text    |                                        |
| asking         | numeric |                                        |
| offer          | numeric | purchase price; SDLT & yield use this  |
| rent           | numeric | pcm                                    |
| refurb         | numeric |                                        |
| **purchase_fees** | numeric | **NEW — auction/buyer fees** (see below) |
| notes          | text    |                                        |
| status         | text    | `none` \| `favourite` \| `rejected`    |
| sort_order     | int     | ordering                               |
| created_at     | timestamptz |                                    |
| updated_at     | timestamptz | app sets this on each write        |

### `assumptions`
Single row, `id = 1`, with a JSON `data` column holding the whole assumptions object
(deposit %, rate, SDLT rate, targets, etc.). App `upsert`s it.

### `photos`
| DB column     | type    | notes                          |
|---------------|---------|--------------------------------|
| id            | bigint  | primary key, auto              |
| property_id   | bigint  | FK → properties.id             |
| storage_path  | text    | path within the photo bucket   |
| created_at    | timestamptz |                            |

---

## MANUAL STEP 1 — add the `purchase_fees` column

Run in **SQL Editor**. The app saves auction/buyer fees here; without it, saving a
property errors.

```sql
alter table properties add column if not exists purchase_fees numeric default 0;
```

Why a separate column (not folded into refurb): fees must be added to cash required
WITHOUT inflating SDLT or gross yield. SDLT is charged on `offer` only; gross yield is
rent ÷ `offer`. Keeping fees separate is the whole point — see `DECISIONS.md`.

---

## MANUAL STEP 2 — create the photo storage bucket

The app uploads to a **public** bucket named exactly:

```
property-photos
```

Dashboard → **Storage** → **New bucket**:
- Name: `property-photos`
- **Public bucket: ON** (you chose public — image URLs are viewable by anyone who has
  the link; that's expected)
- Save.

Upload path pattern the app uses: `{property_id}/{uuid}.{ext}`.

---

## MANUAL STEP 3 — storage policies (uploads & deletes)

A public bucket makes *reading* public automatically, but *uploading* and *deleting*
still need policies. Simplest working setup: allow any signed-in user to upload/delete
in this bucket. Run in **SQL Editor**:

```sql
-- allow authenticated users to upload to the property-photos bucket
create policy "auth upload property-photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'property-photos');

-- allow authenticated users to delete from the property-photos bucket
create policy "auth delete property-photos"
on storage.objects for delete to authenticated
using (bucket_id = 'property-photos');
```

(Public read is handled by the bucket being public; no select policy needed for
viewing.)

---

## MANUAL STEP 4 — table RLS policies

Confirm RLS is enabled on `properties`, `assumptions`, and `photos`, and that your
signed-in users can read/write. The simplest version — any authenticated user — is:

```sql
alter table properties  enable row level security;
alter table assumptions enable row level security;
alter table photos      enable row level security;

create policy "auth all properties"  on properties  for all to authenticated using (true) with check (true);
create policy "auth all assumptions" on assumptions for all to authenticated using (true) with check (true);
create policy "auth all photos"      on photos      for all to authenticated using (true) with check (true);
```

> This trusts any authenticated user. Because sign-up is gated to the three
> allow-listed emails, that's usually acceptable for a private tool. If you want
> stricter (e.g. lock to specific email addresses at the DB level), tell Claude and it
> can write an email-scoped policy instead. Don't widen these without thinking about
> who can authenticate.

If any of these policies already exist from the original build, you'll get a "policy
already exists" error — that's fine, it means the step is already done.

---

## Quick verification checklist

- [ ] `purchase_fees` column exists on `properties`
- [ ] `property-photos` bucket exists and is public
- [ ] storage insert + delete policies exist
- [ ] RLS on for all three tables, with read/write for authenticated users
- [ ] you can sign in with an allow-listed email on the LIVE site (magic link does
      not complete inside Claude's preview — only on the real domain)
