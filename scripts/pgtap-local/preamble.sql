-- Enough of Supabase's own surface for Temple's migrations to apply against a
-- bare Postgres: the auth schema, the JWT-claim readers the RLS policies call,
-- the roles, and stubs for the extensions this box does not carry.
--
-- This is a harness, not a fixture. It exists so a migration and its pgTAP file
-- can be run before they are pushed to a live database.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- On Supabase pgcrypto lives in the extensions schema, and the functions
-- that mint tokens schema-qualify it (0014, 0262) because their own
-- search_path is public only. Here it lands in public, so without this
-- alias every one of those calls dies with "schema extensions does not
-- exist" — a failure the harness invents rather than reports.
create schema if not exists extensions;
create or replace function extensions.gen_random_bytes(integer)
returns bytea language sql as $$ select public.gen_random_bytes($1) $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text unique default null,
  phone_confirmed_at timestamptz,
  phone_change text default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status smallint default 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text;
$$;

-- pg_cron is not installable here. The migrations only ever call
-- cron.schedule/unschedule, and what they schedule is irrelevant to whether the
-- schema and its functions are correct, so the calls are absorbed.
create schema if not exists cron;
create or replace function cron.schedule(text, text, text) returns bigint
language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(text) returns boolean
language sql as $$ select true $$;
create table if not exists cron.job (jobid bigint, jobname text, schedule text, command text);

-- Storage: only referenced for bucket rows and policies.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, path_tokens text[],
  version text
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;

-- Vault, for anything reading a secret name.
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(), name text unique, secret text,
  created_at timestamptz default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret from vault.secrets;

create extension if not exists plpgsql;

-- Storage path helpers the avatar/logo policies call.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end $$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[array_length(parts, 1)];
end $$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(storage.filename(name), '.');
  return parts[array_length(parts, 1)];
end $$;

-- pg_net, same reasoning as pg_cron: the migrations only enqueue HTTP calls
-- from crons, which has no bearing on whether the schema is correct.
create schema if not exists net;
create or replace function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds integer default 5000
) returns bigint language sql as $$ select 1::bigint $$;
create or replace function net.http_get(
  url text, params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$ select 1::bigint $$;
-- The replies pg_net records; read by recent_worker_responses (0282).
create table if not exists net._http_response (
  id           bigint,
  status_code  integer,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz not null default now()
);

-- Vault's writer, which several dispatch tests call to mint a one-time secret.
create or replace function vault.create_secret(
  new_secret text, new_name text default null,
  new_description text default '', new_key_id uuid default null
) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets (name, secret) values (new_name, new_secret)
    on conflict (name) do update set secret = excluded.secret
    returning id into v_id;
  return v_id;
end $$;

create or replace function vault.update_secret(
  secret_id uuid, new_secret text default null, new_name text default null,
  new_description text default null
) returns void
language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id;
$$;
