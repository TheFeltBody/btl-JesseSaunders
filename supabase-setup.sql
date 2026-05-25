-- ============================================================
-- BTL Deal Analyser — Supabase setup
-- Run this once in your Supabase project:
--   Dashboard → SQL Editor → New query → paste all of this → Run
-- ============================================================

-- ---------- PROPERTIES ----------
-- One shared list. Any signed-in (allowed) user can read/write all rows.
create table if not exists properties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'New property',
  area        text default '',
  type        text default '4-bed terrace',
  listing_url text default '',
  asking      numeric default 0,
  offer       numeric default 0,
  rent        numeric default 0,
  refurb      numeric default 3000,
  notes       text default '',
  sort_order  int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------- ASSUMPTIONS ----------
-- A single shared settings row. We keep one row, id = 1.
create table if not exists assumptions (
  id              int primary key default 1,
  data            jsonb not null,
  updated_at      timestamptz default now(),
  constraint single_row check (id = 1)
);

-- ---------- PHOTOS ----------
-- Metadata for uploaded images; the files live in Storage (bucket below).
create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid references properties(id) on delete cascade,
  storage_path text not null,
  created_at   timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Lock everything to authenticated users only. Combined with the
-- email allow-list in the app + Supabase Auth settings, only you and
-- your partner can sign in, and only signed-in users can touch data.
-- ============================================================
alter table properties  enable row level security;
alter table assumptions enable row level security;
alter table photos      enable row level security;

-- Properties: any authenticated user has full access (shared list)
drop policy if exists "auth full access properties" on properties;
create policy "auth full access properties" on properties
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access assumptions" on assumptions;
create policy "auth full access assumptions" on assumptions
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access photos" on photos;
create policy "auth full access photos" on photos
  for all to authenticated using (true) with check (true);

-- ============================================================
-- STORAGE BUCKET for photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload/read/delete in the bucket
drop policy if exists "auth read photos" on storage.objects;
create policy "auth read photos" on storage.objects
  for select to authenticated using (bucket_id = 'property-photos');

drop policy if exists "auth upload photos" on storage.objects;
create policy "auth upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'property-photos');

drop policy if exists "auth delete photos" on storage.objects;
create policy "auth delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'property-photos');

-- ============================================================
-- Seed the assumptions row with your defaults (only if empty)
-- ============================================================
insert into assumptions (id, data) values (1, '{
  "equityReleased": 30000, "extraSavings": 5000, "erMonthly": 150,
  "depositPct": 0.25, "rate": 0.055, "termYears": 25, "sdltRate": 0.05,
  "legal": 1500, "survey": 600, "arrangement": 999, "broker": 500, "misc": 500,
  "agentPct": 0.10, "insurance": 300, "maintPct": 0.08, "voidsPct": 0.05,
  "compliance": 200, "targetSelf": 200, "targetAgent": 100,
  "minYield": 0.08, "maxBudget": 100000
}')
on conflict (id) do nothing;
