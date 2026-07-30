-- A pgTAP shim: just enough of it to run this repo's test files locally.
--
-- The real extension is not installable on this box, and the Supabase CLI that
-- CI uses is not here either — so without this, a pgTAP file's first execution
-- is against the hosted database. That is how "you planned 39 tests but ran 0"
-- got discovered by a red deploy instead of by a test run.
--
-- Faithful to the parts that matter: plan/finish counting, the TAP lines, the
-- 5-character SQLSTATE convention in throws_ok, and running each assertion so
-- side effects happen in the same order they would under pg_prove.

create schema if not exists _tap;

create table if not exists _tap.state (
  planned integer,
  run integer not null default 0,
  failed integer not null default 0
);

grant usage on schema _tap to public;

create or replace function plan(n integer) returns setof text
language plpgsql security definer set search_path = _tap, public as $$
begin
  delete from _tap.state;
  insert into _tap.state (planned) values (n);
  return next '1..' || n;
end $$;

create or replace function public._tap_emit(pass boolean, descr text) returns text
language plpgsql security definer set search_path = _tap, public as $$
declare v_num integer;
begin
  update _tap.state
    set run = run + 1,
        failed = failed + case when pass then 0 else 1 end
    returning run into v_num;
  return case when pass then 'ok ' else 'not ok ' end || v_num || ' - ' || coalesce(descr, '');
end $$;

create or replace function ok(boolean, text default '') returns text
language sql as $$ select _tap_emit(coalesce($1, false), $2) $$;

create or replace function is(anyelement, anyelement, text default '') returns text
language plpgsql as $$
declare pass boolean;
begin
  pass := $1 is not distinct from $2;
  if pass then return _tap_emit(true, $3); end if;
  return _tap_emit(false, $3)
    || E'\n#          have: ' || coalesce($1::text, 'NULL')
    || E'\n#          want: ' || coalesce($2::text, 'NULL');
end $$;

create or replace function lives_ok(text, text default '') returns text
language plpgsql as $$
begin
  begin
    execute $1;
  exception when others then
    return _tap_emit(false, $2) || E'\n#     died: ' || sqlerrm;
  end;
  return _tap_emit(true, $2);
end $$;

-- pgTAP reads a 5-character second argument as an SQLSTATE and anything else as
-- the message. Both forms appear in this repo.
create or replace function throws_ok(text, text default null, text default null)
returns text
language plpgsql as $$
declare
  v_state text;
  v_msg   text;
  v_descr text;
  v_want_state text;
  v_want_msg   text;
begin
  if $2 is not null and length($2) = 5 then
    v_want_state := $2; v_want_msg := $3; v_descr := coalesce($3, $2);
  else
    v_want_msg := $2; v_descr := coalesce($3, $2);
  end if;
  begin
    execute $1;
  exception when others then
    v_state := sqlstate; v_msg := sqlerrm;
    if v_want_state is not null and v_state <> v_want_state then
      return _tap_emit(false, v_descr) || E'\n#     wrong state: ' || v_state;
    end if;
    if v_want_msg is not null and v_msg <> v_want_msg then
      return _tap_emit(false, v_descr)
        || E'\n#          have: ' || v_msg
        || E'\n#          want: ' || v_want_msg;
    end if;
    return _tap_emit(true, v_descr);
  end;
  return _tap_emit(false, v_descr) || E'\n#     no exception raised';
end $$;

create or replace function throws_ok(text, integer) returns text
language sql as $$ select throws_ok($1, $2::text, null) $$;

create or replace function finish() returns setof text
language plpgsql security definer set search_path = _tap, public as $$
declare s _tap.state;
begin
  select * into s from _tap.state;
  if s.planned is distinct from s.run then
    return next '# Looks like you planned ' || s.planned
      || ' tests but ran ' || s.run;
  end if;
  if s.failed > 0 then
    return next '# Looks like you failed ' || s.failed || ' tests of ' || s.run;
  end if;
  return next '# planned=' || s.planned || ' run=' || s.run
    || ' failed=' || s.failed;
end $$;

-- Assertions this repo uses that the shim answers structurally.
create or replace function has_table(text, text, text default '') returns text
language sql as $$
  select _tap_emit(
    exists (select 1 from pg_tables where schemaname = $1 and tablename = $2), $3)
$$;

create or replace function has_function(text, text, text default '') returns text
language sql as $$
  select _tap_emit(
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.proname = $2
    ), $3)
$$;

create or replace function pass(text default '') returns text
language sql as $$ select _tap_emit(true, $1) $$;

create or replace function fail(text default '') returns text
language sql as $$ select _tap_emit(false, $1) $$;

-- The rest of what this suite calls. throws_like is the second most used
-- assertion in the repo after is(), so an incomplete shim is nearly useless.

create or replace function throws_like(text, text, text default '') returns text
language plpgsql as $$
begin
  begin
    execute $1;
  exception when others then
    if sqlerrm like $2 then return _tap_emit(true, $3); end if;
    return _tap_emit(false, $3)
      || E'\n#          have: ' || sqlerrm
      || E'\n#     should like: ' || $2;
  end;
  return _tap_emit(false, $3) || E'\n#     no exception raised';
end $$;

-- (sql, errcode, errmsg, description) — the four-argument form.
create or replace function throws_ok(text, text, text, text) returns text
language plpgsql as $$
begin
  begin
    execute $1;
  exception when others then
    if $2 is not null and sqlstate <> $2 then
      return _tap_emit(false, $4) || E'\n#     wrong state: ' || sqlstate;
    end if;
    if $3 is not null and sqlerrm <> $3 then
      return _tap_emit(false, $4)
        || E'\n#          have: ' || sqlerrm || E'\n#          want: ' || $3;
    end if;
    return _tap_emit(true, $4);
  end;
  return _tap_emit(false, $4) || E'\n#     no exception raised';
end $$;

create or replace function throws_ok(text, integer, text, text) returns text
language sql as $$ select throws_ok($1, $2::text, $3, $4) $$;

create or replace function isnt(anyelement, anyelement, text default '') returns text
language sql as $$ select _tap_emit($1 is distinct from $2, $3) $$;

create or replace function alike(text, text, text default '') returns text
language sql as $$ select _tap_emit($1 like $2, $3) $$;

create or replace function cmp_ok(anyelement, text, anyelement, text default '')
returns text
language plpgsql as $$
declare v boolean;
begin
  execute format('select $1 %s $2', $2) into v using $1, $3;
  return _tap_emit(coalesce(v, false), $4);
end $$;

create or replace function results_eq(text, text, text default '') returns text
language plpgsql as $$
declare a jsonb; b jsonb;
begin
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || $1 || ') t' into a;
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || $2 || ') t' into b;
  if a = b then return _tap_emit(true, $3); end if;
  return _tap_emit(false, $3)
    || E'\n#          have: ' || a::text || E'\n#          want: ' || b::text;
end $$;

create or replace function has_index(name, name, name, text default '') returns text
language sql as $$
  select _tap_emit(exists (
    select 1 from pg_indexes
    where schemaname = $1::text and tablename = $2::text and indexname = $3::text
  ), $4)
$$;

create or replace function col_is_null(name, name, name, text default '') returns text
language sql as $$
  select _tap_emit(exists (
    select 1 from information_schema.columns
    where table_schema = $1::text and table_name = $2::text
      and column_name = $3::text and is_nullable = 'YES'
  ), $4)
$$;

create or replace function has_function(name, name, name[], text default '')
returns text
language sql as $$
  select _tap_emit(exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $1::text and p.proname = $2::text
  ), $4)
$$;

create or replace function has_table(name, name, text default '') returns text
language sql as $$
  select _tap_emit(
    exists (select 1 from pg_tables where schemaname = $1::text and tablename = $2::text), $3)
$$;
