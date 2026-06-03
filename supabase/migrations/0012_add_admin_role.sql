-- Phase 2 Tier 5: add the 'admin' role to gym_role.
--
-- Sits between owner and coach in the privilege ladder. Manages
-- members, tags, staff settings, and SOPs; cannot touch money,
-- refunds, the plan catalog, owner-invites, admin-invites, or cover.
-- Capability mapping lives in src/lib/can.ts; the SQL helpers that
-- gate RLS / RPCs land in 0013.
--
-- The split into its own migration is the actual fix for the
-- "ALTER TYPE ... ADD VALUE cannot be referenced in the same
-- statement" constraint: this file commits before 0013/0014 ever
-- read the new value.

alter type public.gym_role add value 'admin' before 'coach';
