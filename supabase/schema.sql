-- 100 Days of Code(Me) — Supabase schema
-- Run once in Supabase → SQL Editor → New query → Run.

-- 1) One row per user holding the whole tracker as JSON
create table if not exists public.trackers (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Automatic version history (safety net against accidental overwrites)
create table if not exists public.tracker_history (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  data     jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists tracker_history_user_idx on public.tracker_history(user_id, saved_at desc);

-- 3) Row Level Security: each user can only ever see their own data
alter table public.trackers        enable row level security;
alter table public.tracker_history enable row level security;

drop policy if exists "trackers_select_own" on public.trackers;
drop policy if exists "trackers_insert_own" on public.trackers;
drop policy if exists "trackers_update_own" on public.trackers;
drop policy if exists "history_select_own"  on public.tracker_history;

create policy "trackers_select_own" on public.trackers
  for select to authenticated using (auth.uid() = user_id);
create policy "trackers_insert_own" on public.trackers
  for insert to authenticated with check (auth.uid() = user_id);
create policy "trackers_update_own" on public.trackers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "history_select_own" on public.tracker_history
  for select to authenticated using (auth.uid() = user_id);

grant select, insert, update on public.trackers        to authenticated;
grant select                 on public.tracker_history to authenticated;

-- 4) Snapshot the previous version at most every 6 hours
create or replace function public.snapshot_tracker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.tracker_history
    where user_id = old.user_id and saved_at > now() - interval '6 hours'
  ) then
    insert into public.tracker_history(user_id, data) values (old.user_id, old.data);
  end if;
  -- keep the latest 200 snapshots per user
  delete from public.tracker_history
  where user_id = old.user_id
    and id not in (select id from public.tracker_history
                   where user_id = old.user_id order by saved_at desc limit 200);
  return new;
end $$;

drop trigger if exists trackers_snapshot on public.trackers;
create trigger trackers_snapshot
  before update on public.trackers
  for each row execute function public.snapshot_tracker();

-- 5) Tiny keep-alive function (used by the GitHub Action so the free project never pauses)
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;
