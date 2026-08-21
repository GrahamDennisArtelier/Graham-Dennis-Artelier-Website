-- Collection-category management for the Graham Dennis Artelier admin panel.
-- Safe to run against an existing project that already has these objects.

create extension if not exists pgcrypto;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.collections add column if not exists description text;
alter table public.collections add column if not exists featured boolean not null default false;
alter table public.collections add column if not exists sort_order integer not null default 0;
alter table public.artworks add column if not exists collection_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.artworks'::regclass
      and conname = 'artworks_collection_id_fkey'
  ) then
    alter table public.artworks
      add constraint artworks_collection_id_fkey
      foreign key (collection_id) references public.collections(id) on delete set null;
  end if;
end $$;

alter table public.collections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'collections'
      and policyname = 'public reads collections'
  ) then
    create policy "public reads collections"
      on public.collections for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'collections'
      and policyname = 'staff manages collections'
  ) then
    create policy "staff manages collections"
      on public.collections for all to authenticated
      using (public.is_staff()) with check (public.is_staff());
  end if;
end $$;

grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;

create index if not exists artworks_collection_id_idx
  on public.artworks(collection_id);
