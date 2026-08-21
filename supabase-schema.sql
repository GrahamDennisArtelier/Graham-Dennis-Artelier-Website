-- Run once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'editor' check (role in ('admin','editor')),
  created_at timestamptz not null default now()
);
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  slug text not null unique, description text, featured boolean not null default false,
  sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(), title text not null, slug text unique,
  description text, category text, collection_id uuid references public.collections(id) on delete set null,
  medium text, dimensions text, year_created integer, price numeric(12,2) not null default 0,
  availability text not null default 'available' check (availability in ('available','sold','reserved')),
  featured boolean not null default false, inventory_quantity integer not null default 1,
  seo_title text, seo_description text, status text not null default 'draft' check (status in ('draft','published','archived')),
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.artwork_images (
  id uuid primary key default gen_random_uuid(), artwork_id uuid not null references public.artworks(id) on delete cascade,
  storage_path text not null, public_url text not null, alt_text text, is_hero boolean not null default false,
  crop_position text default '50% 50%', sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(), name text not null, email text not null,
  inquiry_type text not null default 'General', message text not null,
  status text not null default 'new' check (status in ('new','responded','archived')), created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), customer_email text not null, customer_name text,
  stripe_checkout_session_id text unique, amount_total integer, currency text default 'gbp',
  status text not null default 'pending', shipping_address jsonb, items jsonb not null default '[]', created_at timestamptz not null default now()
);
create table if not exists public.homepage_content (
  id integer primary key default 1 check (id = 1), headline text not null default 'The Art of Graham Dennis',
  hero_image_url text, artist_introduction text, updated_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id),
  action text not null, entity_type text, entity_id uuid, details jsonb, created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.artworks enable row level security;
alter table public.artwork_images enable row level security;
alter table public.enquiries enable row level security;
alter table public.orders enable row level security;
alter table public.homepage_content enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'));
$$;
create policy "public reads collections" on public.collections for select using (true);
create policy "public reads published artworks" on public.artworks for select using (status = 'published' or public.is_staff());
create policy "public reads artwork images" on public.artwork_images for select using (true);
create policy "public reads homepage" on public.homepage_content for select using (true);
create policy "staff manages collections" on public.collections for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manages artworks" on public.artworks for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manages images" on public.artwork_images for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manages homepage" on public.homepage_content for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "anyone submits enquiries" on public.enquiries for insert to anon, authenticated with check (true);
create policy "staff reads enquiries" on public.enquiries for select to authenticated using (public.is_staff());
create policy "staff updates enquiries" on public.enquiries for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "anyone creates orders" on public.orders for insert to anon, authenticated with check (status = 'pending');
create policy "staff manages orders" on public.orders for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "admins read audit" on public.audit_log for select to authenticated using (public.is_staff());

insert into storage.buckets (id,name,public) values ('artworks','artworks',true) on conflict (id) do update set public=true;
create policy "staff uploads artwork images" on storage.objects for insert to authenticated with check (bucket_id='artworks' and public.is_staff());
create policy "staff updates artwork images" on storage.objects for update to authenticated using (bucket_id='artworks' and public.is_staff());
create policy "staff deletes artwork images" on storage.objects for delete to authenticated using (bucket_id='artworks' and public.is_staff());

grant select on public.collections, public.artworks, public.artwork_images, public.homepage_content to anon, authenticated;
grant insert on public.enquiries, public.orders to anon, authenticated;
grant select, insert, update, delete on public.collections, public.artworks, public.artwork_images, public.homepage_content, public.enquiries, public.orders to authenticated;
grant select on public.profiles, public.audit_log to authenticated;

-- After inviting the artist in Authentication > Users, make them an admin:
-- insert into public.profiles(id,display_name,role) values ('AUTH-USER-UUID','Graham Dennis','admin');
