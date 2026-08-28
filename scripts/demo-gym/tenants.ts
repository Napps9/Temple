// The demo tenants that exist in the hosted database.
//
// Two of these — demo-good-life and demo-redline-hyrox — existed for months
// in the hosted project and nowhere else. No migration, no seed file, no
// script default, no constant: a repo-wide grep found them in four lines of
// prose in docs/gym-outreach-checklist.md. Nothing could reseed them,
// rotate them, or reason about them, and nothing did — they carried the
// same documented password from the day they were made.
//
// That is the whole reason this file exists. A tenant anyone can sign into
// needs to be something the repository knows about, or it drifts until
// somebody notices by accident.
//
// Not the same list as seed-demo-gym.ts's slug defaults (demo-ironworks,
// demo-hyrox). Those are throwaway QA fixtures created and destroyed by
// hand. These are long-lived tenants strangers sign into.
//
// Run this file directly to emit the list as TSV, which is how
// .github/workflows/demo-marketing-rotate.yml reads it — so the workflow
// and this list cannot drift apart.

export type DemoTenant = {
  slug: string;
  name: string;
  discipline: 'crossfit' | 'hyrox';
  /**
   * Whether the rotated password is written to demo_marketing_credentials,
   * which api/demo-credentials.ts serves to anyone loading jointemple.io.
   *
   * Exactly one tenant may be published. The RPC behind that table takes no
   * arguments and returns the most recently rotated row (0122) — no slug to
   * pass, which is the property that makes it safe to expose to anon. A
   * second published tenant would silently become whichever one rotated
   * last.
   *
   * The other two are for demos given by a person. Their rotated password is
   * printed in the workflow's job log, which is where whoever is giving the
   * demo reads it.
   */
  published: boolean;
};

export const DEMO_TENANTS: DemoTenant[] = [
  {
    slug: 'demo-launchpad',
    name: 'Launchpad CrossFit',
    discipline: 'crossfit',
    published: true,
  },
  {
    slug: 'demo-good-life',
    name: 'Good Life Crossfit',
    discipline: 'crossfit',
    published: false,
  },
  {
    slug: 'demo-redline-hyrox',
    name: 'Redline Hyrox',
    discipline: 'hyrox',
    published: false,
  },
];

if (DEMO_TENANTS.filter((t) => t.published).length !== 1) {
  throw new Error('Exactly one demo tenant may be published — see DemoTenant.published');
}

if (DEMO_TENANTS.some((t) => !/^demo-[a-z0-9-]+$/.test(t.slug))) {
  throw new Error('Every demo tenant slug must match demo-[a-z0-9-]+');
}

// TSV for the workflow: slug, name, discipline, published.
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const t of DEMO_TENANTS) {
    console.log([t.slug, t.name, t.discipline, t.published ? '1' : '0'].join('\t'));
  }
}
