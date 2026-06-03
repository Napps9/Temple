// Replace with `supabase gen types typescript --local > src/types/database.ts`
// once the local Supabase project is initialised.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GymRole = 'owner' | 'coach' | 'staff' | 'member';

export type PlanSubState =
  | 'pending'
  | 'active'
  | 'paused'
  | 'cancelled_at_period_end'
  | 'lapsed'
  | 'cancelled'
  | 'refunded_retained';

export type MembershipPlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

export type MovementCategory = 'lift' | 'gymnastic' | 'metcon' | 'mono';

export type TrackedMetric =
  | 'weight'
  | 'reps'
  | 'time'
  | 'distance'
  | 'calories'
  | 'rounds';

export type ConnectOnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'rejected';

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
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          color: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          color: string;
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
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at: string;
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
          created_at: string;
        }>;
        Relationships: [];
      };
      movements: {
        Row: {
          movement_id: string;
          name: string;
          category: MovementCategory;
          parent_movement_id: string | null;
          equipment: string[];
          aliases: string[];
          tracked_metrics: TrackedMetric[];
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          movement_id?: string;
          name: string;
          category: MovementCategory;
          parent_movement_id?: string | null;
          equipment?: string[];
          aliases?: string[];
          tracked_metrics: TrackedMetric[];
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          movement_id: string;
          name: string;
          category: MovementCategory;
          parent_movement_id: string | null;
          equipment: string[];
          aliases: string[];
          tracked_metrics: TrackedMetric[];
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      workout_logs: {
        Row: {
          log_id: string;
          profile_id: string;
          gym_id: string | null;
          class_session_id: string | null;
          programmed_at: string | null;
          logged_at: string;
          notes: string | null;
        };
        Insert: {
          log_id?: string;
          profile_id: string;
          gym_id?: string | null;
          class_session_id?: string | null;
          programmed_at?: string | null;
          logged_at?: string;
          notes?: string | null;
        };
        Update: Partial<{
          log_id: string;
          profile_id: string;
          gym_id: string | null;
          class_session_id: string | null;
          programmed_at: string | null;
          logged_at: string;
          notes: string | null;
        }>;
        Relationships: [];
      };
      workout_log_results: {
        Row: {
          result_id: string;
          log_id: string;
          movement_id: string;
          metric_kind: TrackedMetric;
          value_numeric: number | null;
          value_seconds: number | null;
          value_reps: number | null;
          is_rx: boolean;
          ordinal: number;
          created_at: string;
        };
        Insert: {
          result_id?: string;
          log_id: string;
          movement_id: string;
          metric_kind: TrackedMetric;
          value_numeric?: number | null;
          value_seconds?: number | null;
          value_reps?: number | null;
          is_rx?: boolean;
          ordinal?: number;
          created_at?: string;
        };
        Update: Partial<{
          result_id: string;
          log_id: string;
          movement_id: string;
          metric_kind: TrackedMetric;
          value_numeric: number | null;
          value_seconds: number | null;
          value_reps: number | null;
          is_rx: boolean;
          ordinal: number;
          created_at: string;
        }>;
        Relationships: [];
      };
      tags: {
        Row: {
          tag_id: string;
          gym_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          tag_id?: string;
          gym_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          tag_id: string;
          gym_id: string;
          name: string;
          color: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      member_tags: {
        Row: {
          gym_id: string;
          profile_id: string;
          tag_id: string;
          added_by: string;
          added_at: string;
        };
        Insert: {
          gym_id: string;
          profile_id: string;
          tag_id: string;
          added_by: string;
          added_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          profile_id: string;
          tag_id: string;
          added_by: string;
          added_at: string;
        }>;
        Relationships: [];
      };
      class_check_ins: {
        Row: {
          booking_id: string;
          gym_id: string;
          profile_id: string;
          checked_in_by: string;
          checked_in_at: string;
        };
        Insert: {
          booking_id: string;
          gym_id: string;
          profile_id: string;
          checked_in_by: string;
          checked_in_at?: string;
        };
        Update: Partial<{
          booking_id: string;
          gym_id: string;
          profile_id: string;
          checked_in_by: string;
          checked_in_at: string;
        }>;
        Relationships: [];
      };
      chat_threads: {
        Row: {
          thread_id: string;
          gym_id: string;
          profile_id: string;
          last_message_at: string | null;
          last_member_read_at: string | null;
          last_staff_read_at: string | null;
          created_at: string;
        };
        Insert: {
          thread_id?: string;
          gym_id: string;
          profile_id: string;
          last_message_at?: string | null;
          last_member_read_at?: string | null;
          last_staff_read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          thread_id: string;
          gym_id: string;
          profile_id: string;
          last_message_at: string | null;
          last_member_read_at: string | null;
          last_staff_read_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      chat_messages: {
        Row: {
          message_id: string;
          thread_id: string;
          sender_profile_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          message_id?: string;
          thread_id: string;
          sender_profile_id: string;
          body: string;
          created_at?: string;
        };
        Update: Partial<{
          message_id: string;
          thread_id: string;
          sender_profile_id: string;
          body: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      announcements: {
        Row: {
          announcement_id: string;
          gym_id: string;
          audience_id: string | null;
          title: string;
          body: string;
          pinned: boolean;
          published_at: string;
          expires_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          announcement_id?: string;
          gym_id: string;
          audience_id?: string | null;
          title: string;
          body: string;
          pinned?: boolean;
          published_at?: string;
          expires_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          announcement_id: string;
          gym_id: string;
          audience_id: string | null;
          title: string;
          body: string;
          pinned: boolean;
          published_at: string;
          expires_at: string | null;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      announcement_reads: {
        Row: {
          announcement_id: string;
          profile_id: string;
          read_at: string;
        };
        Insert: {
          announcement_id: string;
          profile_id: string;
          read_at?: string;
        };
        Update: Partial<{
          announcement_id: string;
          profile_id: string;
          read_at: string;
        }>;
        Relationships: [];
      };
      stripe_connect_accounts: {
        Row: {
          gym_id: string;
          provider: string;
          provider_account_id: string | null;
          onboarding_status: ConnectOnboardingStatus;
          charges_enabled: boolean;
          payouts_enabled: boolean;
          details_submitted: boolean;
          country: string | null;
          default_currency: string | null;
          last_synced_at: string | null;
          created_at: string;
        };
        Insert: {
          gym_id: string;
          provider?: string;
          provider_account_id?: string | null;
          onboarding_status?: ConnectOnboardingStatus;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
          country?: string | null;
          default_currency?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          provider: string;
          provider_account_id: string | null;
          onboarding_status: ConnectOnboardingStatus;
          charges_enabled: boolean;
          payouts_enabled: boolean;
          details_submitted: boolean;
          country: string | null;
          default_currency: string | null;
          last_synced_at: string | null;
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
    };
    Views: Record<string, never>;
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
      get_lifecycle_bucket_counts: {
        Args: { p_gym_id: string };
        Returns: { bucket: string; count: number }[];
      };
      get_conversion_funnel: {
        Args: { p_gym_id: string; p_since: string | null };
        Returns: {
          grants_issued: number;
          grants_converted: number;
          conversion_rate: number;
        }[];
      };
      get_attendance_weekly: {
        Args: { p_gym_id: string; p_weeks: number };
        Returns: {
          week_start: string;
          class_type_id: string | null;
          class_type_name: string | null;
          bookings_count: number;
          checked_in_count: number;
          no_show_count: number;
          unique_members: number;
        }[];
      };
    };
    Enums: {
      gym_role: GymRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
