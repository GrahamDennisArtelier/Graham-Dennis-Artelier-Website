insert into public.collections (name, slug, sort_order)
values
  ('Atmospheres', 'atmospheres', 0),
  ('Intervals', 'intervals', 1),
  ('Field Notes', 'field-notes', 2)
on conflict do nothing;

update public.artworks as artwork
set collection_id = collection.id
from public.collections as collection
where artwork.collection_id is null
  and lower(trim(artwork.category)) = lower(collection.name);

create or replace function public.clear_artwork_category_on_collection_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.artworks
  set category = null
  where collection_id = old.id;
  return old;
end;
$$;

drop trigger if exists clear_artwork_category_on_collection_delete on public.collections;
create trigger clear_artwork_category_on_collection_delete
before delete on public.collections
for each row execute function public.clear_artwork_category_on_collection_delete();
