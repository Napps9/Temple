// The setup checklist's required steps, in the checklist's order. The
// root router reads it to decide whether an owner lands on /setup, the
// checklist reads it to count progress, and the Timeline's setup card
// reads it to say how many are left. One list, so those three cannot
// disagree; it lives here rather than in setup.tsx because the router
// must not pull the setup screen (and the pickers it imports) into the
// first bundle every user evaluates.
export const REQUIRED_SETUP_KEYS = [
  'settings',
  'class_type_and_schedule',
  'parq',
  'stripe',
  'plan',
] as const;
