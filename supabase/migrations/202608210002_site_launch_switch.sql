-- Public launch switch. The safe default is the coming-soon page.
alter table public.homepage_content
  add column if not exists site_live boolean not null default false;

insert into public.homepage_content (id, site_live)
values (1, false)
on conflict (id) do nothing;
