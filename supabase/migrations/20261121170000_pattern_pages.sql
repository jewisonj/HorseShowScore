-- Horse Show Scorer: pictures of pattern book pages. Safe to run more than once.
--
-- The owner decided on 2026-11-21 to publish the pattern book's pages with the
-- show: the associations make their patterns public. Each picture is one page
-- of the book, shown under the written maneuvers on the class screen.
--
-- Anyone can read a picture, like the shows that point at them. Only show
-- admins can add, replace or remove one.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pattern-pages', 'pattern-pages', true, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading goes through the bucket's public address and needs no policy.
-- These cover the people who put pictures there.
drop policy if exists "show admins see pattern pages" on storage.objects;
create policy "show admins see pattern pages" on storage.objects
  for select to authenticated
  using (bucket_id = 'pattern-pages' and (select public.is_show_admin()));

drop policy if exists "show admins add pattern pages" on storage.objects;
create policy "show admins add pattern pages" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pattern-pages' and (select public.is_show_admin()));

drop policy if exists "show admins replace pattern pages" on storage.objects;
create policy "show admins replace pattern pages" on storage.objects
  for update to authenticated
  using (bucket_id = 'pattern-pages' and (select public.is_show_admin()))
  with check (bucket_id = 'pattern-pages' and (select public.is_show_admin()));

drop policy if exists "show admins remove pattern pages" on storage.objects;
create policy "show admins remove pattern pages" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pattern-pages' and (select public.is_show_admin()));
