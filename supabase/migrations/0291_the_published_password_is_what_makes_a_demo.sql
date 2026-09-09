-- The published password is what makes a gym a demo
--
-- 0278 flagged a gym by its slug: anything starting `demo-` was forced
-- is_demo and could not be unflagged. The prefix was load-bearing because
-- the two sales tenants existed nowhere in this repository — there was
-- nothing else to name them by. tenants.ts has since named all three, so
-- that argument has expired, and what is left is a naming convention
-- standing in for a security fact.
--
-- The security fact is narrower and it is this: api/demo-credentials.ts
-- serves demo_marketing_credentials to anyone who loads jointemple.io, so
-- whichever tenant is in that table has an owner password in public. That
-- tenant must not be able to mail, text or charge a stranger. Every other
-- tenant whose slug happens to begin `demo-` is a gym one person signs
-- into with a password only they hold, and the guards were costing it the
-- one feature it most needs to show: an AI front desk that really texts
-- the prospect a link.
--
-- So the flag follows the exposure. Publishing a tenant's credentials
-- flags it, by trigger, whoever does the publishing and however — that is
-- the same row api/demo-credentials.ts reads, so a tenant cannot become
-- publicly passworded without becoming a demo tenant in the same
-- statement. And it survives the nightly rotation for free, because
-- publish-demo-credentials.ts runs immediately after the seeder recreates
-- the gym.
--
-- is_demo stays settable by hand, so an internal tenant that wants the
-- same protection can have it — demo-ironworks and demo-hyrox carry a
-- documented static password and are worth a decision, but they are a QA
-- fixture nobody outside Temple can reach, so this leaves them alone
-- rather than guessing.
--
-- AND IT DROPS 0290 ENTIRELY. That was an allowlist of handsets a demo
-- gym was permitted to really text, and it was the wrong shape: a real
-- gym texts whoever the prospect gives it. Special-casing the destination
-- made the demo behave unlike the product it exists to sell. Nothing
-- referenced it outside the sender, so it goes rather than lingering.

begin;

-- ============================================================================
-- 1. 0290, removed
-- ============================================================================

drop function if exists public.allow_demo_sms_number(uuid, text, text, integer);
drop function if exists public.demo_sms_allowed(uuid, text);
drop table if exists public.demo_sms_allowlist;

-- ============================================================================
-- 2. The slug stops deciding
-- ============================================================================

drop trigger if exists gyms_force_is_demo on public.gyms;
drop function if exists public._force_is_demo_for_demo_slug();

comment on column public.gyms.is_demo is
  'A demo tenant: real data, real screens, but no vendor call may leave the '
  'building on its behalf. Set automatically for whichever tenant has its '
  'password published to the marketing site (demo_marketing_credentials), '
  'and settable by hand for an internal tenant that wants the same. No '
  'longer inferred from the slug. See supabase/functions/_shared/demo.ts.';

-- ============================================================================
-- 3. Publishing a password is what flags a tenant
-- ============================================================================

create function public._flag_published_demo_gym()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gyms set is_demo = true where slug = new.slug;
  return new;
end;
$$;

-- After, not before: the flag is a consequence of the row existing, and a
-- failure to find the gym must not stop the credentials being recorded.
create trigger demo_credentials_flag_gym
  after insert or update on public.demo_marketing_credentials
  for each row execute function public._flag_published_demo_gym();

-- ============================================================================
-- 4. Reconcile what is true right now
-- ============================================================================

-- Whatever is published today is a demo tenant.
update public.gyms g
   set is_demo = true
  from public.demo_marketing_credentials c
 where c.slug = g.slug and g.is_demo = false;

-- And everything else the prefix caught is an ordinary gym again. This is
-- the line that lets a sales tenant's front desk text a real handset.
update public.gyms g
   set is_demo = false
 where g.is_demo
   and not exists (
     select 1 from public.demo_marketing_credentials c where c.slug = g.slug
   );

commit;
