-- Phase 1 foundation for Supabase Auth and chat history.
-- Supabase Auth owns the canonical users table at auth.users. Credentials and
-- provider identities stay there; public.profiles contains app-owned fields.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.app_sessions (
  -- This is Supabase Auth's signed session_id claim, not an access/refresh token.
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_type text not null default 'web'
    check (client_type in ('web', 'desktop', 'ios', 'android')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= created_at)
);

create index if not exists app_sessions_user_last_seen_idx
  on public.app_sessions (user_id, last_seen_at desc);

create index if not exists app_sessions_ended_at_idx
  on public.app_sessions (ended_at)
  where ended_at is not null;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stable client id makes offline-to-cloud migration and retries idempotent.
  client_id text,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, user_id)
);

alter table public.conversations
  add column if not exists client_id text;
alter table public.conversations
  add column if not exists pinned boolean not null default false;
create unique index if not exists conversations_user_client_id_uidx
  on public.conversations (user_id, client_id);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc, id desc);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stable client id permits streaming message updates via an idempotent upsert.
  client_id text,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint messages_conversation_owner_fkey
    foreign key (conversation_id, user_id)
    references public.conversations (id, user_id)
    on delete cascade
);

alter table public.messages
  add column if not exists client_id text;
create unique index if not exists messages_user_client_id_uidx
  on public.messages (user_id, client_id);

create index if not exists messages_conversation_id_id_idx
  on public.messages (conversation_id, id);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc, id desc);

alter table public.profiles enable row level security;
alter table public.app_sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on table public.profiles, public.app_sessions,
  public.conversations, public.messages from anon, authenticated;

grant usage on schema public to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.app_sessions to authenticated;
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.messages to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can read their app sessions" on public.app_sessions;
create policy "Users can read their app sessions"
  on public.app_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can register their current app session" on public.app_sessions;
create policy "Users can register their current app session"
  on public.app_sessions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and id::text = (select auth.jwt() ->> 'session_id')
  );

drop policy if exists "Users can update their current app session" on public.app_sessions;
create policy "Users can update their current app session"
  on public.app_sessions for update to authenticated
  using (
    (select auth.uid()) = user_id
    and id::text = (select auth.jwt() ->> 'session_id')
  )
  with check (
    (select auth.uid()) = user_id
    and id::text = (select auth.jwt() ->> 'session_id')
  );

drop policy if exists "Users can read their conversations" on public.conversations;
create policy "Users can read their conversations"
  on public.conversations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their conversations" on public.conversations;
create policy "Users can create their conversations"
  on public.conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their conversations" on public.conversations;
create policy "Users can update their conversations"
  on public.conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their conversations" on public.conversations;
create policy "Users can delete their conversations"
  on public.conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their messages" on public.messages;
create policy "Users can read their messages"
  on public.messages for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their messages" on public.messages;
create policy "Users can add their messages"
  on public.messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their messages" on public.messages;
create policy "Users can update their messages"
  on public.messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their messages" on public.messages;
create policy "Users can delete their messages"
  on public.messages for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Enable row change events when Supabase Realtime is available. Re-running the
-- schema is safe and never adds the same table twice to the publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'conversations'
    ) then
      alter publication supabase_realtime add table public.conversations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end;
$$;

commit;
