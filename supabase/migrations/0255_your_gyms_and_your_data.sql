-- Your gyms and your data
--
-- Two functions for the Account page, both keyed on auth.uid() and
-- nothing else — there is no shape of either call that reads somebody
-- else's record.
--
-- MY_GYMS. A member can already read their own membership rows across
-- every gym, left ones included (gym_memberships_self_select has never
-- had a left_at guard). What they cannot do since 0237 is resolve a
-- LEFT gym's name: user_belongs_to gained its left_at guard there, so
-- the gyms embed silently drops off old memberships and "the gym I
-- trained at for two years" renders as a bare uuid. This definer join
-- returns the row the Account page actually wants — name, role, joined,
-- left — which is how "Left in Jan 2025 · history kept" gets to say the
-- name of the place.
--
-- EXPORT_MY_ACCOUNT_DATA. 0237 answered the training half of Article 15
-- with export_my_training_history: one synchronous jsonb document, no
-- job queue, no tier gate, full or not at all. This is the rest of the
-- account on the same argument: profile, contact details, memberships,
-- bookings, messages both directions, purchases, plan subscriptions —
-- and health data, by the owner's explicit call: PAR-Q responses with
-- their question prompts (answers without prompts are noise) and the
-- injury log. One honest "everything"; the erase path stays its own
-- separate, deliberate action. The training export nests inside so one
-- download IS the account.
--
-- Messages include what the member SENT as well as received — both are
-- their personal data — but never anyone else's thread: the predicate
-- is sender-or-recipient, and nothing joins outward from there.

begin;

create function public.my_gyms()
returns table (
  gym_id    uuid,
  gym_name  text,
  role      public.gym_role,
  joined_at timestamptz,
  left_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select gm.gym_id, g.name, gm.role, gm.created_at, gm.left_at
    from public.gym_memberships gm
    join public.gyms g on g.id = gm.gym_id
   where gm.profile_id = auth.uid()
   order by gm.created_at desc;
$$;

revoke all on function public.my_gyms() from public, anon;
grant execute on function public.my_gyms() to authenticated;

create function public.export_my_account_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile_id', auth.uid(),
    'note', 'Everything Temple holds about your account, in one document. '
         || 'Free of charge and independent of any subscription — this is '
         || 'your right of access, not a product feature.',
    'profile', (
      select to_jsonb(p) from public.profiles p where p.id = auth.uid()
    ),
    'contact_details', (
      select to_jsonb(c) from public.member_contact_details c
       where c.profile_id = auth.uid()
    ),
    'gyms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'gym_id', gm.gym_id,
               'gym_name', g.name,
               'role', gm.role,
               'joined_at', gm.created_at,
               'left_at', gm.left_at) order by gm.created_at desc)
        from public.gym_memberships gm
        join public.gyms g on g.id = gm.gym_id
       where gm.profile_id = auth.uid()
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booking_id', b.id,
               'gym_id', cs.gym_id,
               'class', ct.name,
               'starts_at', cs.starts_at,
               'attended_at', b.attended_at,
               'no_show', b.no_show,
               'booked_at', b.created_at) order by cs.starts_at desc)
        from public.class_bookings b
        left join public.class_sessions cs on cs.id = b.class_session_id
        left join public.class_types ct on ct.id = cs.class_type_id
       where b.profile_id = auth.uid()
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'gym_id', m.gym_id,
               'direction', case when m.sender_id = auth.uid()
                                 then 'sent' else 'received' end,
               'body', m.body,
               'at', m.created_at) order by m.created_at)
        from public.direct_messages m
       where m.sender_id = auth.uid() or m.recipient_id = auth.uid()
    ), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id,
               'gym_id', o.gym_id,
               'status', o.status,
               'total_cents', o.total_cents,
               'currency', o.currency,
               'placed_at', o.created_at,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'name', i.name_snapshot,
                          'quantity', i.quantity,
                          'line_total_cents', i.line_total_cents))
                   from public.store_order_items i
                  where i.order_id = o.id
               ), '[]'::jsonb)) order by o.created_at desc)
        from public.store_orders o
       where o.profile_id = auth.uid()
    ), '[]'::jsonb),
    'plan_subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'gym_id', s.gym_id,
               'plan', mp.name,
               'status', s.status,
               'credit_balance', s.credit_balance,
               'started_at', s.created_at,
               'cancelled_at', s.cancelled_at) order by s.created_at desc)
        from public.plan_subscriptions s
        left join public.membership_plans mp on mp.plan_id = s.plan_id
       where s.profile_id = auth.uid()
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'parq_responses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'gym_id', r.gym_id,
                 'completed_at', r.completed_at,
                 'answers', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'question', q.prompt,
                            'answered_yes', a.answered_yes,
                            'explanation', a.explanation))
                     from public.parq_answers a
                     join public.parq_questions q on q.id = a.question_id
                    where a.response_id = r.id
                 ), '[]'::jsonb)) order by r.completed_at desc)
          from public.parq_responses r
         where r.profile_id = auth.uid()
      ), '[]'::jsonb),
      'injuries', coalesce((
        select jsonb_agg((to_jsonb(mi) || jsonb_build_object(
                 'updates', coalesce((
                   select jsonb_agg(to_jsonb(iu) order by iu.created_at)
                     from public.injury_updates iu
                    where iu.injury_id = mi.id
                 ), '[]'::jsonb))) order by mi.created_at desc)
          from public.member_injuries mi
         where mi.profile_id = auth.uid()
      ), '[]'::jsonb)
    ),
    'training', public.export_my_training_history()
  );
$$;

revoke all on function public.export_my_account_data() from public, anon;
grant execute on function public.export_my_account_data() to authenticated;

commit;
