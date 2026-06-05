// Replace with `supabase gen types typescript --local > src/types/database.ts`
// once the local Supabase project is initialised.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GymRole = 'owner' | 'admin' | 'coach' | 'staff' | 'member';

export type PlanSubState =
  | 'pending'
  | 'active'
  | 'paused'
  | 'cancelled_at_period_end'
  | 'lapsed'
  | 'cancelled'
  | 'refunded_retained';

export type MembershipPlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

export type Database = {
  public: {
    Tables: {
      gyms: {
        Row: { id: string; name: string; slug: string; created_at: string };
        Insert: { id?: string; name: string; slug: string; created_at?: string };
        Update: Partial<{ id: string; name: string; slug: string; created_at: string }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_memberships: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag: boolean;
          emergency_contact: string | null;
          par_q_id: string | null;
          left_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag?: boolean;
          emergency_contact?: string | null;
          par_q_id?: string | null;
          left_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag: boolean;
          emergency_contact: string | null;
          par_q_id: string | null;
          left_at: string | null;
          created_at: string;
        }>;
        Relationships: [
          {
            foreignKeyName: 'gym_memberships_gym_id_fkey';
            columns: ['gym_id'];
            referencedRelation: 'gyms';
            referencedColumns: ['id'];
          },
        ];
      };
      invite_codes: {
        Row: {
          id: string;
          gym_id: string;
          code: string;
          role: GymRole;
          created_by: string;
          expires_at: string | null;
          used_by: string | null;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          code: string;
          role?: GymRole;
          created_by: string;
          expires_at?: string | null;
          used_by?: string | null;
          used_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          code: string;
          role: GymRole;
          created_by: string;
          expires_at: string | null;
          used_by: string | null;
          used_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_hours: {
        Row: {
          id: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_sessions: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          coach_id: string | null;
          starts_at: string;
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          created_by: string;
          created_at: string;
          class_type_id: string | null;
          recurrence_id: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          coach_id?: string | null;
          starts_at: string;
          duration_minutes?: number;
          capacity?: number;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          class_type_id?: string | null;
          recurrence_id?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          coach_id: string | null;
          starts_at: string;
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          created_by: string;
          created_at: string;
          class_type_id: string | null;
          recurrence_id: string | null;
        }>;
        Relationships: [];
      };
      class_types: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_recurrences: {
        Row: {
          id: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          starts_on: string;
          ends_on: string | null;
          tz: string;
          materialized_until: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes?: string | null;
          starts_on: string;
          ends_on?: string | null;
          tz?: string;
          materialized_until?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          starts_on: string;
          ends_on: string | null;
          tz: string;
          materialized_until: string | null;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_bookings: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at: string;
          attended_at: string | null;
          marked_by: string | null;
          no_show: boolean;
          no_show_marked_at: string | null;
          promoted_from_waitlist: boolean;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at?: string;
          attended_at?: string | null;
          marked_by?: string | null;
          no_show?: boolean;
          no_show_marked_at?: string | null;
          promoted_from_waitlist?: boolean;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at: string;
          attended_at: string | null;
          marked_by: string | null;
          no_show: boolean;
          no_show_marked_at: string | null;
          promoted_from_waitlist: boolean;
        }>;
        Relationships: [];
      };
      class_programming: {
        Row: {
          id: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections?: Json;
          author_id: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      membership_plans: {
        Row: {
          plan_id: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count: number | null;
          period_length: string | null;
          monthly_price_cents: number | null;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          plan_id?: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count?: number | null;
          period_length?: string | null;
          monthly_price_cents?: number | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          plan_id: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count: number | null;
          period_length: string | null;
          monthly_price_cents: number | null;
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      plan_class_types: {
        Row: {
          plan_id: string;
          class_type_id: string;
        };
        Insert: {
          plan_id: string;
          class_type_id: string;
        };
        Update: Partial<{
          plan_id: string;
          class_type_id: string;
        }>;
        Relationships: [];
      };
      plan_subscriptions: {
        Row: {
          id: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance: number | null;
          period_resets_at: string | null;
          paid_period_end: string | null;
          stripe_subscription_id: string | null;
          awaiting_payment_authentication: boolean;
          cancelled_at: string | null;
          price_cents: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance?: number | null;
          period_resets_at?: string | null;
          paid_period_end?: string | null;
          stripe_subscription_id?: string | null;
          awaiting_payment_authentication?: boolean;
          cancelled_at?: string | null;
          price_cents?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance: number | null;
          period_resets_at: string | null;
          paid_period_end: string | null;
          stripe_subscription_id: string | null;
          awaiting_payment_authentication: boolean;
          cancelled_at: string | null;
          price_cents: number | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      coach_tasks: {
        Row: {
          id: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile: string | null;
          title: string;
          notes: string | null;
          status: 'open' | 'done' | 'cancelled';
          due_date: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile?: string | null;
          title: string;
          notes?: string | null;
          status?: 'open' | 'done' | 'cancelled';
          due_date?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile: string | null;
          title: string;
          notes: string | null;
          status: 'open' | 'done' | 'cancelled';
          due_date: string | null;
          completed_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      cover_requests: {
        Row: {
          id: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes: string | null;
          status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at: string;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes?: string | null;
          status?: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at?: string;
          cancelled_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes: string | null;
          status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at: string;
          cancelled_at: string | null;
        }>;
        Relationships: [];
      };
      cover_request_sessions: {
        Row: {
          id: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by: string | null;
          claimed_at: string | null;
          gym_id: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by?: string | null;
          claimed_at?: string | null;
          gym_id: string;
        };
        Update: Partial<{
          id: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by: string | null;
          claimed_at: string | null;
          gym_id: string;
        }>;
        Relationships: [];
      };
      sop_documents: {
        Row: {
          id: string;
          gym_id: string;
          title: string;
          body_markdown: string;
          category: string | null;
          author_id: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          title: string;
          body_markdown?: string;
          category?: string | null;
          author_id: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          title: string;
          body_markdown: string;
          category: string | null;
          author_id: string;
          updated_at: string;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      gym_role_capabilities: {
        Row: {
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_insight_targets: {
        Row: {
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'month' | 'quarter';
          target_value: number;
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'month' | 'quarter';
          target_value: number;
          updated_by: string;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'month' | 'quarter';
          target_value: number;
          updated_by: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      member_tags: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id: string | null;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      tag_rules: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid';
          threshold_days: number | null;
          active: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid';
          threshold_days?: number | null;
          active?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid';
          threshold_days: number | null;
          active: boolean;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      comp_grants: {
        Row: {
          grant_id: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total: number | null;
          credits_remaining: number | null;
          class_type_allowlist: string[];
          granted_by: string;
          reason: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          grant_id?: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total?: number | null;
          credits_remaining?: number | null;
          class_type_allowlist?: string[];
          granted_by: string;
          reason?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          grant_id: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total: number | null;
          credits_remaining: number | null;
          class_type_allowlist: string[];
          granted_by: string;
          reason: string | null;
          revoked_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_waitlist: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at: string;
        }>;
        Relationships: [];
      };
      onboarding_responses: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: {
      v_member_cohort: {
        Row: {
          gym_id: string;
          profile_id: string;
          joined_at: string;
          is_intro: boolean;
          is_paying: boolean;
          is_active: boolean;
          is_expiring_soon: boolean;
          is_expired: boolean;
          days_until_expiry: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_invite: {
        Args: { invite_code: string };
        Returns: { gym_id: string; role: GymRole }[];
      };
      extend_recurrence: {
        Args: { rec_id: string; until_date: string };
        Returns: null;
      };
      book_class: {
        Args: { session_id: string };
        Returns: null;
      };
      same_gym_as_caller: {
        Args: { target_profile: string };
        Returns: boolean;
      };
      check_in_member: {
        Args: { p_booking_id: string };
        Returns: null;
      };
      mark_no_show: {
        Args: { p_booking_id: string };
        Returns: null;
      };
      compute_insight_summary: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: {
          intros_new: number;
          intros_target: number;
          conversions: number;
          conversions_target: number;
          expiring_soon: number;
          expired: number;
          paying_now: number;
          billing_live: boolean;
        }[];
      };
      compute_revenue_summary: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: {
          currency: string;
          gross_cents: number;
          charge_count: number;
        }[];
      };
      is_revenue_event: {
        Args: { p_provider: string; p_kind: string };
        Returns: boolean;
      };
      effective_can: {
        Args: { p_gym_id: string; p_capability: string };
        Returns: boolean;
      };
      effective_can_for_role: {
        Args: { p_gym_id: string; p_role: GymRole; p_capability: string };
        Returns: boolean;
      };
      default_capability: {
        Args: { p_role: GymRole; p_capability: string };
        Returns: boolean;
      };
      apply_tag_rules: {
        Args: { p_gym_id: string };
        Returns: number;
      };
      request_cover: {
        Args: { p_session_ids: string[]; p_notes: string | null };
        Returns: string;
      };
      claim_cover: {
        Args: { p_session_offer_id: string };
        Returns: null;
      };
      cancel_cover_request: {
        Args: { p_request_id: string };
        Returns: null;
      };
      complete_task: {
        Args: { p_task_id: string };
        Returns: null;
      };
      reopen_task: {
        Args: { p_task_id: string };
        Returns: null;
      };
      create_invite: {
        Args: { p_gym_id: string; p_role: GymRole; p_expires_at: string | null };
        Returns: string;
      };
      class_type_has_dependents: {
        Args: { p_id: string };
        Returns: boolean;
      };
      plan_has_dependents: {
        Args: { p_id: string };
        Returns: boolean;
      };
      member_has_dependents: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: boolean;
      };
      is_terminal_subscription_status: {
        Args: { p_status: PlanSubState };
        Returns: boolean;
      };
      archive_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      restore_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      delete_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      archive_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      restore_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      delete_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      leave_gym: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: null;
      };
      rejoin_gym: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: null;
      };
      set_avatar_url: {
        Args: { p_url: string };
        Returns: null;
      };
      copy_week_forward: {
        Args: { p_gym_id: string; p_from: string };
        Returns: number;
      };
      cancel_session: {
        Args: { p_session_id: string };
        Returns: number;
      };
      cancel_recurrence_from: {
        Args: { p_session_id: string };
        Returns: number;
      };
      cancel_recurrence: {
        Args: { p_recurrence_id: string };
        Returns: number;
      };
      join_waitlist: {
        Args: { p_session_id: string };
        Returns: number;
      };
      leave_waitlist: {
        Args: { p_session_id: string };
        Returns: null;
      };
      my_waitlist_rank: {
        Args: { p_session_id: string };
        Returns: number | null;
      };
      waitlist_for_session: {
        Args: { p_session_id: string };
        Returns: { rank: number; profile_id: string; joined_at: string }[];
      };
    };
    Enums: {
      gym_role: GymRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
