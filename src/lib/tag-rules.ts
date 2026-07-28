// Kind metadata for the auto-tag rule editor + list. The SQL CHECK in
// 0200 is the enforcement; this mirrors it so the editor can't build a
// payload the constraint would reject.

export type TagRulePredicateKind =
  | 'intro'
  | 'expiring_soon'
  | 'expired'
  | 'paying'
  | 'inactive'
  | 'never_paid'
  | 'booked_class_type'
  | 'attended_class_type'
  | 'no_recent_attendance'
  | 'on_plan'
  | 'cancelling'
  | 'joined_within';

export type TagRule = {
  id: string;
  gym_id: string;
  label: string;
  color: string;
  predicate_kind: TagRulePredicateKind;
  threshold_days: number | null;
  class_type_id: string | null;
  plan_id: string | null;
  active: boolean;
};

export type TagRuleKindMeta = {
  value: TagRulePredicateKind;
  label: string;
  // 'optional' windows fall back to "any time" when blank.
  thresholdUse: 'none' | 'optional' | 'required';
  thresholdLabel?: string;
  thresholdDefault?: string;
  needsClassType?: boolean;
  needsPlan?: boolean;
};

export const TAG_RULE_KINDS: TagRuleKindMeta[] = [
  { value: 'intro', label: 'Intro', thresholdUse: 'none' },
  {
    value: 'expiring_soon',
    label: 'Expiring soon',
    thresholdUse: 'optional',
    thresholdLabel: 'Expiring within',
    thresholdDefault: '7',
  },
  { value: 'expired', label: 'Expired', thresholdUse: 'none' },
  { value: 'paying', label: 'Paying', thresholdUse: 'none' },
  { value: 'inactive', label: 'Inactive', thresholdUse: 'none' },
  { value: 'never_paid', label: 'Never paid', thresholdUse: 'none' },
  {
    value: 'booked_class_type',
    label: 'Booked a class type',
    thresholdUse: 'optional',
    thresholdLabel: 'Look-back window',
    needsClassType: true,
  },
  {
    value: 'attended_class_type',
    label: 'Attended a class type',
    thresholdUse: 'optional',
    thresholdLabel: 'Look-back window',
    needsClassType: true,
  },
  {
    value: 'no_recent_attendance',
    label: 'No recent attendance',
    thresholdUse: 'required',
    thresholdLabel: 'No check-ins for',
    thresholdDefault: '30',
  },
  { value: 'on_plan', label: 'On a plan', thresholdUse: 'none', needsPlan: true },
  { value: 'cancelling', label: 'Cancelling', thresholdUse: 'none' },
  {
    value: 'joined_within',
    label: 'Joined recently',
    thresholdUse: 'required',
    thresholdLabel: 'Joined in the last',
    thresholdDefault: '30',
  },
];

export function tagRuleKindMeta(kind: TagRulePredicateKind): TagRuleKindMeta {
  return TAG_RULE_KINDS.find((k) => k.value === kind) ?? TAG_RULE_KINDS[0]!;
}

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

// One-line summary for the rules list. Names come from the caller's
// class-type / plan lookups; a rule whose target was deleted out from
// under it cascades away server-side, so a missing name only happens
// while the lookup is still loading.
export function describeTagRule(
  rule: Pick<TagRule, 'predicate_kind' | 'threshold_days' | 'active'>,
  names: { classTypeName?: string; planName?: string } = {},
): string {
  const classType = names.classTypeName ?? 'a class type';
  const plan = names.planName ?? 'a plan';
  let text: string;
  switch (rule.predicate_kind) {
    case 'expiring_soon':
      text = `Expiring within ${days(rule.threshold_days ?? 7)}`;
      break;
    case 'booked_class_type':
      text =
        rule.threshold_days === null
          ? `Booked ${classType}`
          : `Booked ${classType} in the last ${days(rule.threshold_days)} or upcoming`;
      break;
    case 'attended_class_type':
      text =
        rule.threshold_days === null
          ? `Attended ${classType}`
          : `Attended ${classType} in the last ${days(rule.threshold_days)}`;
      break;
    case 'no_recent_attendance':
      text = `No check-ins for ${days(rule.threshold_days ?? 30)}`;
      break;
    case 'on_plan':
      text = `On ${plan}`;
      break;
    case 'joined_within':
      text = `Joined in the last ${days(rule.threshold_days ?? 30)}`;
      break;
    default:
      text = tagRuleKindMeta(rule.predicate_kind).label;
  }
  return rule.active ? text : `${text} · paused`;
}
