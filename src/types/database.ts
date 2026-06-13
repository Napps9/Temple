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

export type StaffAlertKind = 'parq_flag' | 'injury_new' | 'injury_update';

export type InjurySide = 'left' | 'right' | 'both' | 'na';
export type InjuryStatus = 'active' | 'improving' | 'resolved';
export type InjuryFeeling = 'better' | 'same' | 'worse';

export type LeadStatus =
  | 'cold'
  | 'contacted'
  | 'intro_booked'
  | 'trial_attended'
  | 'converted'
  | 'lost';

export type Database = {
  public: {
    Tables: {
      gyms: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          coach_credit_policy: 'all_scheduled' | 'only_checked_in';
          currency: string;
          class_leaderboards_enabled: boolean;
          strength_leaderboards_enabled: boolean;
          dm_scope: 'full_gym' | 'member_coach_only';
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
          week_starts_on: 'mon' | 'sun';
          timezone: string;
          default_class_capacity: number;
          default_class_minutes: number;
          expiring_within_days: number;
          parq_expiry_days: number;
          health_retention_months: number;
          lead_conversion_window_days: number;
          materialisation_horizon_weeks: number;
          subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number;
          cancel_cutoff_minutes_before: number;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          coach_credit_policy?: 'all_scheduled' | 'only_checked_in';
          currency?: string;
          class_leaderboards_enabled?: boolean;
          strength_leaderboards_enabled?: boolean;
          dm_scope?: 'full_gym' | 'member_coach_only';
          logo_url?: string | null;
          primary_color?: string;
          secondary_color?: string;
          text_color?: string;
          public_signup_enabled?: boolean;
          logo_url_dark?: string | null;
          primary_color_dark?: string | null;
          secondary_color_dark?: string | null;
          text_color_dark?: string | null;
          week_starts_on?: 'mon' | 'sun';
          timezone?: string;
          default_class_capacity?: number;
          default_class_minutes?: number;
          expiring_within_days?: number;
          parq_expiry_days?: number;
          health_retention_months?: number;
          lead_conversion_window_days?: number;
          materialisation_horizon_weeks?: number;
          subscription_resolution?: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead?: number | null;
          booking_cutoff_minutes_before?: number;
          cancel_cutoff_minutes_before?: number;
        };
        Update: Partial<{
          id: string;
          name: string;
          slug: string;
          created_at: string;
          coach_credit_policy: 'all_scheduled' | 'only_checked_in';
          currency: string;
          class_leaderboards_enabled: boolean;
          strength_leaderboards_enabled: boolean;
          dm_scope: 'full_gym' | 'member_coach_only';
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
          week_starts_on: 'mon' | 'sun';
          timezone: string;
          default_class_capacity: number;
          default_class_minutes: number;
          expiring_within_days: number;
          parq_expiry_days: number;
          health_retention_months: number;
          lead_conversion_window_days: number;
          materialisation_horizon_weeks: number;
          subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number;
          cancel_cutoff_minutes_before: number;
        }>;
        Relationships: [];
      };
      direct_messages: {
        Row: {
          id: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at: string;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      lead_sources: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          color?: string;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          gym_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          source_id: string | null;
          status: LeadStatus;
          notes: string | null;
          captured_at: string;
          captured_by: string | null;
          converted_at: string | null;
          converted_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          source_id?: string | null;
          status?: LeadStatus;
          notes?: string | null;
          captured_at?: string;
          captured_by?: string | null;
          converted_at?: string | null;
          converted_profile_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          source_id: string | null;
          status: LeadStatus;
          notes: string | null;
          captured_at: string;
          captured_by: string | null;
          converted_at: string | null;
          converted_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_announcements: {
        Row: {
          id: string;
          gym_id: string;
          posted_by: string | null;
          title: string;
          body: string;
          pinned: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          posted_by?: string | null;
          title: string;
          body: string;
          pinned?: boolean;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          posted_by: string | null;
          title: string;
          body: string;
          pinned: boolean;
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
      class_session_broadcasts: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          sender_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          sender_id?: string | null;
          body: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          sender_id: string | null;
          body: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_session_broadcast_reads: {
        Row: {
          broadcast_id: string;
          profile_id: string;
          read_at: string;
        };
        Insert: {
          broadcast_id: string;
          profile_id: string;
          read_at?: string;
        };
        Update: Partial<{
          broadcast_id: string;
          profile_id: string;
          read_at: string;
        }>;
        Relationships: [];
      };
      coach_pay_rates: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      coach_class_type_qualifications: {
        Row: {
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified: boolean;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      parq_questionnaires: {
        Row: {
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          version: number;
          is_active?: boolean;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          published_by: string | null;
          published_at: string;
        }>;
        Relationships: [];
      };
      parq_questions: {
        Row: {
          id: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes: boolean;
        };
        Insert: {
          id?: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes?: boolean;
        };
        Update: Partial<{
          id: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes: boolean;
        }>;
        Relationships: [];
      };
      parq_responses: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at: string;
          has_flag: boolean;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at?: string;
          has_flag?: boolean;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at: string;
          has_flag: boolean;
        }>;
        Relationships: [];
      };
      parq_answers: {
        Row: {
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation: string | null;
        };
        Insert: {
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation?: string | null;
        };
        Update: Partial<{
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation: string | null;
        }>;
        Relationships: [];
      };
      waiver_documents: {
        Row: {
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          title: string;
          file_path: string;
          file_url: string;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          version: number;
          is_active?: boolean;
          title?: string;
          file_path: string;
          file_url: string;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          title: string;
          file_path: string;
          file_url: string;
          published_by: string | null;
          published_at: string;
        }>;
        Relationships: [];
      };
      waiver_signatures: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at: string;
        }>;
        Relationships: [];
      };
      staff_alerts: {
        Row: {
          id: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id: string | null;
          related_id: string | null;
          created_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id?: string | null;
          related_id?: string | null;
          created_at?: string;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id: string | null;
          related_id: string | null;
          created_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
        }>;
        Relationships: [];
      };
      member_injuries: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          body_region: string;
          side: InjurySide;
          description: string | null;
          pain_level: number;
          movements_hurt: string[];
          movements_ok: string[];
          started_on: string;
          status: InjuryStatus;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          body_region: string;
          side?: InjurySide;
          description?: string | null;
          pain_level: number;
          movements_hurt?: string[];
          movements_ok?: string[];
          started_on?: string;
          status?: InjuryStatus;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          body_region: string;
          side: InjurySide;
          description: string | null;
          pain_level: number;
          movements_hurt: string[];
          movements_ok: string[];
          started_on: string;
          status: InjuryStatus;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        }>;
        Relationships: [];
      };
      injury_updates: {
        Row: {
          id: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling: InjuryFeeling | null;
          status: InjuryStatus;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling?: InjuryFeeling | null;
          status: InjuryStatus;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling: InjuryFeeling | null;
          status: InjuryStatus;
          note: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          date_of_birth: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          date_of_birth?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          date_of_birth: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      member_consents: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis: string;
          consented_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis?: string;
          consented_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis: string;
          consented_at: string;
        }>;
        Relationships: [];
      };
      health_data_access_log: {
        Row: {
          id: string;
          gym_id: string;
          actor_id: string | null;
          subject_profile_id: string | null;
          action: 'view' | 'erase' | 'purge';
          surface: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          actor_id?: string | null;
          subject_profile_id?: string | null;
          action: 'view' | 'erase' | 'purge';
          surface?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          actor_id: string | null;
          subject_profile_id: string | null;
          action: 'view' | 'erase' | 'purge';
          surface: string | null;
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
          appear_in_leaderboards: boolean;
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
          appear_in_leaderboards?: boolean;
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
          appear_in_leaderboards: boolean;
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
          location: string | null;
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
          location?: string | null;
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
          location: string | null;
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
          default_capacity: number | null;
          coach_required: boolean;
          unsupervised_label: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at?: string | null;
          created_at?: string;
          default_capacity?: number | null;
          coach_required?: boolean;
          unsupervised_label?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at: string | null;
          created_at: string;
          default_capacity: number | null;
          coach_required: boolean;
          unsupervised_label: string;
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
          location: string | null;
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
          location?: string | null;
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
          location: string | null;
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
          used_entitlement_kind: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id: string | null;
          booked_by_profile_id: string | null;
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
          used_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id?: string | null;
          booked_by_profile_id?: string | null;
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
          used_entitlement_kind: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id: string | null;
          booked_by_profile_id: string | null;
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
          notice_period_days: number | null;
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
          notice_period_days?: number | null;
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
          notice_period_days: number | null;
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
          priority: number;
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
          priority?: number;
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
          priority: number;
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
      tracked_workouts: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          class_session_id: string | null;
          performed_at: string;
          title: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          class_session_id?: string | null;
          performed_at?: string;
          title?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          class_session_id: string | null;
          performed_at: string;
          title: string | null;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_movement_results: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric: number | null;
          value_seconds: number | null;
          value_unit: string | null;
          notes: string | null;
          performed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric?: number | null;
          value_seconds?: number | null;
          value_unit?: string | null;
          notes?: string | null;
          performed_at?: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric: number | null;
          value_seconds: number | null;
          value_unit: string | null;
          notes: string | null;
          performed_at: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_workout_sections: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id: string | null;
          source_section_index: number | null;
          section_category: string;
          section_format: string;
          title: string | null;
          body: string | null;
          notes: string | null;
          sort_order: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          did_not_finish: boolean | null;
          free_text_result: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id?: string | null;
          source_section_index?: number | null;
          section_category: string;
          section_format: string;
          title?: string | null;
          body?: string | null;
          notes?: string | null;
          sort_order?: number;
          total_time_seconds?: number | null;
          total_rounds?: number | null;
          total_extra_reps?: number | null;
          did_not_finish?: boolean | null;
          free_text_result?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id: string | null;
          source_section_index: number | null;
          section_category: string;
          section_format: string;
          title: string | null;
          body: string | null;
          notes: string | null;
          sort_order: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          did_not_finish: boolean | null;
          free_text_result: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_section_entries: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index: number | null;
          label: string | null;
          weight_numeric: number | null;
          weight_unit: string | null;
          reps: number | null;
          time_seconds: number | null;
          distance_numeric: number | null;
          distance_unit: string | null;
          calories: number | null;
          done: boolean | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index?: number | null;
          label?: string | null;
          weight_numeric?: number | null;
          weight_unit?: string | null;
          reps?: number | null;
          time_seconds?: number | null;
          distance_numeric?: number | null;
          distance_unit?: string | null;
          calories?: number | null;
          done?: boolean | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index: number | null;
          label: string | null;
          weight_numeric: number | null;
          weight_unit: string | null;
          reps: number | null;
          time_seconds: number | null;
          distance_numeric: number | null;
          distance_unit: string | null;
          calories: number | null;
          done: boolean | null;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_section_movement_tags: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key: string | null;
          performed_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key?: string | null;
          performed_at: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key: string | null;
          performed_at: string;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_comms_settings: {
        Row: {
          gym_id: string;
          from_name: string | null;
          reply_to: string | null;
          footer_business_name: string | null;
          footer_address: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          from_name?: string | null;
          reply_to?: string | null;
          footer_business_name?: string | null;
          footer_address?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          from_name: string | null;
          reply_to: string | null;
          footer_business_name: string | null;
          footer_address: string | null;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_audiences: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          definition: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          definition?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          definition: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_campaigns: {
        Row: {
          id: string;
          gym_id: string;
          created_by: string | null;
          title: string;
          subject: string;
          preheader: string;
          from_name: string | null;
          reply_to: string | null;
          status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design: Json;
          audience: Json;
          audience_id: string | null;
          topic_id: string | null;
          compiled_html: string | null;
          compiled_text: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          recipient_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          created_by?: string | null;
          title?: string;
          subject?: string;
          preheader?: string;
          from_name?: string | null;
          reply_to?: string | null;
          status?: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design?: Json;
          audience?: Json;
          audience_id?: string | null;
          topic_id?: string | null;
          compiled_html?: string | null;
          compiled_text?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          recipient_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          created_by: string | null;
          title: string;
          subject: string;
          preheader: string;
          from_name: string | null;
          reply_to: string | null;
          status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design: Json;
          audience: Json;
          audience_id: string | null;
          topic_id: string | null;
          compiled_html: string | null;
          compiled_text: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          recipient_count: number;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_campaign_recipients: {
        Row: {
          id: string;
          campaign_id: string;
          gym_id: string;
          profile_id: string | null;
          email: string;
          full_name: string | null;
          status: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error: string | null;
          provider_message_id: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          first_opened_at: string | null;
          last_opened_at: string | null;
          open_count: number;
          first_clicked_at: string | null;
          last_clicked_at: string | null;
          click_count: number;
          unsubscribed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          gym_id: string;
          profile_id?: string | null;
          email: string;
          full_name?: string | null;
          status?: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error?: string | null;
          provider_message_id?: string | null;
          sent_at?: string | null;
          delivered_at?: string | null;
          first_opened_at?: string | null;
          last_opened_at?: string | null;
          open_count?: number;
          first_clicked_at?: string | null;
          last_clicked_at?: string | null;
          click_count?: number;
          unsubscribed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          campaign_id: string;
          gym_id: string;
          profile_id: string | null;
          email: string;
          full_name: string | null;
          status: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error: string | null;
          provider_message_id: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          first_opened_at: string | null;
          last_opened_at: string | null;
          open_count: number;
          first_clicked_at: string | null;
          last_clicked_at: string | null;
          click_count: number;
          unsubscribed_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      email_events: {
        Row: {
          id: string;
          gym_id: string;
          campaign_id: string;
          recipient_id: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url: string | null;
          meta: Json | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          campaign_id: string;
          recipient_id?: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url?: string | null;
          meta?: Json | null;
          occurred_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          campaign_id: string;
          recipient_id: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url: string | null;
          meta: Json | null;
          occurred_at: string;
        }>;
        Relationships: [];
      };
      email_assets: {
        Row: {
          id: string;
          gym_id: string;
          uploaded_by: string | null;
          path: string;
          url: string;
          file_name: string | null;
          byte_size: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          uploaded_by?: string | null;
          path: string;
          url: string;
          file_name?: string | null;
          byte_size?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          uploaded_by: string | null;
          path: string;
          url: string;
          file_name: string | null;
          byte_size: number | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      email_unsubscribes: {
        Row: {
          id: string;
          gym_id: string;
          email: string;
          profile_id: string | null;
          campaign_id: string | null;
          topic_id: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          email: string;
          profile_id?: string | null;
          campaign_id?: string | null;
          topic_id?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          email: string;
          profile_id: string | null;
          campaign_id: string | null;
          topic_id: string | null;
          reason: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_email_topics: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          description: string | null;
          sort_order: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          description?: string | null;
          sort_order?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          description: string | null;
          sort_order: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_sending_domains: {
        Row: {
          gym_id: string;
          domain: string;
          from_local: string;
          resend_domain_id: string | null;
          status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records: Json;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          domain: string;
          from_local?: string;
          resend_domain_id?: string | null;
          status?: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records?: Json;
          last_checked_at?: string | null;
          verified_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          domain: string;
          from_local: string;
          resend_domain_id: string | null;
          status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records: Json;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
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
      pending_members: {
        Row: {
          id: string;
          gym_id: string;
          email: string;
          full_name: string | null;
          date_of_birth: string | null;
          plan_name: string | null;
          plan_start: string | null;
          plan_end: string | null;
          credits_remaining: number | null;
          imported_status: string | null;
          tags: string[];
          unsubscribed: boolean;
          notes: string | null;
          status: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by: string | null;
          created_at: string;
          linked_at: string | null;
          linked_profile_id: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          email: string;
          full_name?: string | null;
          date_of_birth?: string | null;
          plan_name?: string | null;
          plan_start?: string | null;
          plan_end?: string | null;
          credits_remaining?: number | null;
          imported_status?: string | null;
          tags?: string[];
          unsubscribed?: boolean;
          notes?: string | null;
          status?: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by?: string | null;
          created_at?: string;
          linked_at?: string | null;
          linked_profile_id?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          email: string;
          full_name: string | null;
          date_of_birth: string | null;
          plan_name: string | null;
          plan_start: string | null;
          plan_end: string | null;
          credits_remaining: number | null;
          imported_status: string | null;
          tags: string[];
          unsubscribed: boolean;
          notes: string | null;
          status: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by: string | null;
          created_at: string;
          linked_at: string | null;
          linked_profile_id: string | null;
        }>;
        Relationships: [];
      };
    };
    Functions: {
      accept_invite: {
        Args: { invite_code: string };
        Returns: { gym_id: string; role: GymRole }[];
      };
      submit_parq_response: {
        Args: {
          p_gym_id: string;
          p_questionnaire_id: string;
          p_answers: Json;
        };
        Returns: string;
      };
      current_parq_state: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          active_questionnaire_id: string | null;
          last_response_id: string | null;
          last_completed_at: string | null;
          last_had_flag: boolean | null;
          needs_parq: boolean;
        }[];
      };
      publish_waiver: {
        Args: {
          p_gym_id: string;
          p_title: string;
          p_file_path: string;
          p_file_url: string;
        };
        Returns: string;
      };
      sign_waiver: {
        Args: { p_gym_id: string; p_waiver_id: string; p_signature: Json };
        Returns: string;
      };
      current_waiver_state: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          active_waiver_id: string | null;
          last_signature_id: string | null;
          last_signed_at: string | null;
          needs_waiver: boolean;
        }[];
      };
      log_injury: {
        Args: {
          p_gym_id: string;
          p_body_region: string;
          p_side: string;
          p_description: string | null;
          p_pain_level: number;
          p_movements_hurt: string[];
          p_movements_ok: string[];
          p_started_on: string;
        };
        Returns: string;
      };
      log_injury_update: {
        Args: {
          p_injury_id: string;
          p_pain_level: number;
          p_feeling: string | null;
          p_status: string;
          p_note: string | null;
        };
        Returns: string;
      };
      acknowledge_staff_alert: {
        Args: { p_alert_id: string };
        Returns: null;
      };
      record_consent: {
        Args: {
          p_gym_id: string;
          p_policy_version: string;
          p_lawful_basis?: string;
        };
        Returns: null;
      };
      erase_member_health_data: {
        Args: { p_gym_id: string; p_profile: string };
        Returns: null;
      };
      purge_expired_health_data: {
        Args: Record<string, never>;
        Returns: number;
      };
      log_health_data_access: {
        Args: { p_gym_id: string; p_subject: string; p_surface: string };
        Returns: null;
      };
      get_gym_setup_progress: {
        Args: { p_gym_id: string };
        Returns: { step_key: string; done: boolean }[];
      };
      extend_recurrence: {
        Args: { rec_id: string; until_date: string };
        Returns: null;
      };
      book_class: {
        Args: {
          session_id: string;
          p_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          p_entitlement_id?: string | null;
        };
        Returns: string | null;
      };
      staff_book_member: {
        Args: {
          p_session_id: string;
          p_member_profile_id: string;
          p_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          p_entitlement_id?: string | null;
        };
        Returns: string | null;
      };
      swap_booking_subscription: {
        Args: {
          p_booking_id: string;
          p_entitlement_kind: 'comp_grant' | 'plan_subscription';
          p_entitlement_id: string;
        };
        Returns: null;
      };
      record_lead: {
        Args: {
          p_gym_id: string;
          p_full_name: string;
          p_email?: string | null;
          p_phone?: string | null;
          p_source_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      set_lead_status: {
        Args: {
          p_lead_id: string;
          p_status: LeadStatus;
          p_converted_profile_id?: string | null;
        };
        Returns: null;
      };
      is_booking_eligible: {
        Args: {
          p_profile_id: string;
          p_gym_id: string;
          p_class_session_id: string;
        };
        Returns: boolean;
      };
      list_booking_entitlements: {
        Args: {
          p_class_session_id: string;
          p_target_profile_id?: string | null;
        };
        Returns: {
          kind: 'comp_grant' | 'plan_subscription';
          id: string;
          is_default: boolean;
          label: string;
        }[];
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
      compute_coach_earnings: {
        Args: {
          p_gym_id: string;
          p_coach_id: string;
          p_period_start: string;
          p_period_end: string;
        };
        Returns: {
          class_type_id: string;
          class_type_name: string;
          class_type_color: string;
          class_count: number;
          rate_cents: number;
          earnings_cents: number;
          currency: string;
        }[];
      };
      set_coach_credit_policy: {
        Args: { p_gym_id: string; p_policy: 'all_scheduled' | 'only_checked_in' };
        Returns: null;
      };
      set_dm_scope: {
        Args: { p_gym_id: string; p_scope: 'full_gym' | 'member_coach_only' };
        Returns: null;
      };
      mark_dm_thread_read: {
        Args: { p_peer_id: string };
        Returns: null;
      };
      dm_inbox: {
        Args: Record<string, never>;
        Returns: {
          peer_profile_id: string;
          peer_full_name: string;
          peer_role: GymRole | null;
          last_message_id: string;
          last_message_body: string;
          last_message_at: string;
          last_message_from_me: boolean;
          unread_count: number;
        }[];
      };
      inbox_unread_summary: {
        Args: Record<string, never>;
        Returns: {
          dm_unread: number;
          announcement_unread: number;
          class_broadcast_unread: number;
        }[];
      };
      can_dm: {
        Args: { p_gym_id: string; p_sender: string; p_recipient: string };
        Returns: boolean;
      };
      gym_by_slug: {
        Args: { p_slug: string };
        Returns: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
        }[];
      };
      create_gym: {
        Args: { p_name: string; p_slug: string };
        Returns: string;
      };
      join_gym_by_slug: {
        Args: { p_slug: string };
        Returns: string;
      };
      set_gym_branding: {
        Args: {
          p_gym_id: string;
          p_logo_url: string | null;
          p_primary_color: string;
          p_secondary_color: string;
          p_text_color: string;
          p_logo_url_dark?: string | null;
          p_primary_color_dark?: string | null;
          p_secondary_color_dark?: string | null;
          p_text_color_dark?: string | null;
        };
        Returns: null;
      };
      set_gym_name: {
        Args: { p_gym_id: string; p_name: string };
        Returns: null;
      };
      set_gym_slug: {
        Args: { p_gym_id: string; p_slug: string };
        Returns: null;
      };
      set_gym_public_signup: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_gym_operating_defaults: {
        Args: {
          p_gym_id: string;
          p_week_starts_on: 'mon' | 'sun';
          p_timezone: string;
          p_default_class_capacity: number;
          p_default_class_minutes: number;
          p_expiring_within_days: number;
          p_parq_expiry_days: number;
          p_health_retention_months: number;
          p_lead_conversion_window_days: number;
          p_materialisation_horizon_weeks: number;
          p_subscription_resolution:
            | 'credits_first'
            | 'newest_first'
            | 'highest_priority';
          p_booking_window_hours_ahead?: number | null;
          p_booking_cutoff_minutes_before?: number;
          p_cancel_cutoff_minutes_before?: number;
        };
        Returns: null;
      };
      set_leaderboard_config: {
        Args: {
          p_gym_id: string;
          p_class_enabled: boolean;
          p_strength_enabled: boolean;
        };
        Returns: null;
      };
      set_appear_in_leaderboards: {
        Args: { p_gym_id: string; p_value: boolean };
        Returns: null;
      };
      class_leaderboard: {
        Args: { p_programming_id: string; p_section_index: number };
        Returns: {
          profile_id: string;
          display_name: string;
          score: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          did_not_finish: boolean | null;
          heaviest_weight: number | null;
          weight_unit: string | null;
          section_format: string;
          performed_at: string;
          rank: number;
        }[];
      };
      strength_leaderboard: {
        Args: {
          p_gym_id: string;
          p_movement_key: string;
          p_track_key: string;
          p_metric: 'weight' | 'time' | 'reps' | 'distance' | 'calories';
          p_better: 'higher' | 'lower';
        };
        Returns: {
          profile_id: string;
          display_name: string;
          value_numeric: number | null;
          value_seconds: number | null;
          performed_at: string;
          source: 'direct' | 'tag';
          rank: number;
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
      count_members_as_of: {
        Args: { p_gym_id: string; p_as_of: string };
        Returns: number;
      };
      count_attendance_attendees: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: number;
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
      comms_audience_count: {
        Args: { p_gym_id: string; p_definition: Json; p_topic_id?: string | null };
        Returns: number;
      };
      list_my_email_preferences: {
        Args: { p_gym_id: string };
        Returns: {
          topic_id: string;
          label: string;
          description: string | null;
          subscribed: boolean;
          blanket_unsub: boolean;
        }[];
      };
      set_my_email_topic_subscription: {
        Args: {
          p_gym_id: string;
          p_topic_id: string;
          p_subscribed: boolean;
        };
        Returns: null;
      };
      set_my_email_blanket_unsub: {
        Args: { p_gym_id: string; p_unsubscribed: boolean };
        Returns: null;
      };
      comms_audience_sample: {
        Args: { p_gym_id: string; p_definition: Json; p_limit?: number };
        Returns: { profile_id: string; full_name: string | null; email: string }[];
      };
      comms_send_campaign: {
        Args: { p_campaign_id: string; p_html: string; p_text: string };
        Returns: number;
      };
      comms_finalize_simulation: {
        Args: { p_campaign_id: string };
        Returns: number;
      };
      import_pending_members: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: { inserted: number; updated: number; skipped: number }[];
      };
      pending_members_stats: {
        Args: { p_gym_id: string };
        Returns: {
          pending: number;
          invited: number;
          linked: number;
          skipped: number;
          total: number;
        }[];
      };
      comms_campaign_stats: {
        Args: { p_campaign_id: string };
        Returns: {
          recipients: number;
          sent: number;
          delivered: number;
          simulated: number;
          failed: number;
          bounced: number;
          opened: number;
          clicked: number;
          unsubscribed: number;
        }[];
      };
    };
    Enums: {
      gym_role: GymRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
