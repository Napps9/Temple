// Audience definitions — the small jsonb shape a campaign (or a saved
// segment) carries to describe who it goes to. The server-side resolver
// in migration 0044 (comms_audience_rows) is the source of truth for
// what these mean; this module is the typed, unit-tested client mirror
// used by the builder UI and to render human-readable summaries.

export type CohortKey =
  | 'intro'
  | 'active'
  | 'paying'
  | 'expiring_soon'
  | 'expired';

export type AudienceDefinition =
  | { kind: 'all_members' }
  | { kind: 'cohort'; cohorts: CohortKey[] }
  | { kind: 'tags'; tags: string[] }
  | { kind: 'manual'; profile_ids: string[] }
  | { kind: 'pending_members' };

export type AudienceKind = AudienceDefinition['kind'];

export const COHORT_OPTIONS: { key: CohortKey; label: string; blurb: string }[] = [
  { key: 'intro', label: 'Intro', blurb: 'Members on an intro / trial period.' },
  { key: 'active', label: 'Active', blurb: 'Currently active members.' },
  { key: 'paying', label: 'Paying', blurb: 'Members who have ever paid.' },
  { key: 'expiring_soon', label: 'Expiring soon', blurb: 'Access ends within 7 days.' },
  { key: 'expired', label: 'Expired', blurb: 'No live access right now.' },
];

const COHORT_LABEL: Record<CohortKey, string> = COHORT_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.key]: o.label }),
  {} as Record<CohortKey, string>,
);

const VALID_COHORTS = new Set<string>(COHORT_OPTIONS.map((o) => o.key));

export const DEFAULT_AUDIENCE: AudienceDefinition = { kind: 'all_members' };

// Parse anything coming back from jsonb into a valid definition. Unknown
// shapes collapse to "all members" so a campaign can always resolve.
export function normalizeAudience(raw: unknown): AudienceDefinition {
  if (!raw || typeof raw !== 'object') return DEFAULT_AUDIENCE;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'cohort': {
      const cohorts = Array.isArray(r.cohorts)
        ? r.cohorts.filter(
            (c): c is CohortKey => typeof c === 'string' && VALID_COHORTS.has(c),
          )
        : [];
      return { kind: 'cohort', cohorts };
    }
    case 'tags': {
      const tags = Array.isArray(r.tags)
        ? r.tags.filter((t): t is string => typeof t === 'string')
        : [];
      return { kind: 'tags', tags };
    }
    case 'manual': {
      const ids = Array.isArray(r.profile_ids)
        ? r.profile_ids.filter((p): p is string => typeof p === 'string')
        : [];
      return { kind: 'manual', profile_ids: ids };
    }
    case 'pending_members':
      return { kind: 'pending_members' };
    case 'all_members':
    default:
      return DEFAULT_AUDIENCE;
  }
}

// A campaign whose audience can't possibly resolve to anyone — used to
// gate the Send button before we even hit the server count.
export function isAudienceEmptyByConstruction(def: AudienceDefinition): boolean {
  switch (def.kind) {
    case 'all_members':
      return false;
    case 'cohort':
      return def.cohorts.length === 0;
    case 'tags':
      return def.tags.length === 0;
    case 'manual':
      return def.profile_ids.length === 0;
    case 'pending_members':
      return false;
  }
}

export function describeAudience(def: AudienceDefinition): string {
  switch (def.kind) {
    case 'all_members':
      return 'All members';
    case 'cohort':
      if (def.cohorts.length === 0) return 'No cohort selected';
      return def.cohorts.map((c) => COHORT_LABEL[c]).join(', ');
    case 'tags':
      if (def.tags.length === 0) return 'No tags selected';
      if (def.tags.length === 1) return `Tagged "${def.tags[0]}"`;
      return `Tagged with ${def.tags.length} tags`;
    case 'manual':
      if (def.profile_ids.length === 0) return 'No members chosen';
      return def.profile_ids.length === 1
        ? '1 hand-picked member'
        : `${def.profile_ids.length} hand-picked members`;
    case 'pending_members':
      return 'Newly imported members';
  }
}

export const AUDIENCE_KIND_LABELS: Record<AudienceKind, string> = {
  all_members: 'All members',
  cohort: 'By lifecycle',
  tags: 'By tag',
  manual: 'Pick members',
  pending_members: 'Newly imported members',
};
