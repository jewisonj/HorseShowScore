-- Horse Show Scorer: the horses list. Safe to run more than once.
--
-- The horse draw needs two things about a horse: whether it takes height
-- riders, and the heaviest weight group it carries. The owner asked on
-- 2026-11-22 for these to be kept on the server, like the riders' marks, so
-- they carry over from show to show instead of living on one computer.
--
-- A horse is its name together with who provides it, since two barns can each
-- have a horse of the same name. Only show admins see or change the list.

create table if not exists public.horses (
  name text not null,
  provider text not null default '',
  takes_height boolean not null default true,
  max_group int not null default 3,
  updated_at timestamptz not null default now(),
  primary key (name, provider),
  constraint horses_name check (length(btrim(name)) between 1 and 80),
  constraint horses_provider check (length(provider) <= 120),
  constraint horses_max_group check (max_group between 1 and 3)
);

alter table public.horses enable row level security;
drop policy if exists "show admins see horses" on public.horses;
create policy "show admins see horses" on public.horses for select to authenticated using ((select public.is_show_admin()));
drop policy if exists "show admins add horses" on public.horses;
create policy "show admins add horses" on public.horses for insert to authenticated with check ((select public.is_show_admin()));
drop policy if exists "show admins change horses" on public.horses;
create policy "show admins change horses" on public.horses for update to authenticated using ((select public.is_show_admin())) with check ((select public.is_show_admin()));
drop policy if exists "show admins remove horses" on public.horses;
create policy "show admins remove horses" on public.horses for delete to authenticated using ((select public.is_show_admin()));
revoke all on public.horses from anon, authenticated;
grant select, insert, update, delete on public.horses to authenticated;
