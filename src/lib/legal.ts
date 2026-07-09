// In-app copy for the public /terms and /privacy screens. This is the
// member/gym-facing rendered version; the canonical drafts (with lawyer
// placeholders and the full DPA) live in docs/legal/*.md. Keep the two
// broadly in sync — a material change to the legal position belongs in
// both, and should be run past counsel before it ships.

export type LegalSection = { heading: string; body: string[] };

export type LegalDoc = {
  title: string;
  updated: string;
  // Shown in a callout at the top — these are pre-launch drafts.
  draftNotice: string;
  intro: string[];
  sections: LegalSection[];
  contact: string;
};

const DRAFT_NOTICE =
  'Draft pending review by our legal counsel. We are sharing it early for ' +
  'transparency; the final version may change.';

export const TERMS_OF_SERVICE: LegalDoc = {
  title: 'Terms of Service',
  updated: 'July 2026',
  draftNotice: DRAFT_NOTICE,
  intro: [
    'These terms govern how a gym, studio, or other fitness business uses ' +
      'Temple to run its business. By creating a gym on Temple you agree to ' +
      'them on behalf of that business.',
  ],
  sections: [
    {
      heading: 'The service',
      body: [
        'Temple is a platform for running a fitness business: class ' +
          'scheduling and bookings, membership plans, member management, ' +
          'programming and training tracking, communications, a storefront, ' +
          'and a website builder. Available features depend on your plan and ' +
          'any add-ons.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'You must be authorised to act for your business and are responsible ' +
          'for your staff’s use of the platform and for keeping your ' +
          'credentials secure.',
      ],
    },
    {
      heading: 'Your members’ data',
      body: [
        'Your gym is the data controller for its members’ personal data, ' +
          'including health data such as PAR-Q answers and injury records. ' +
          'Temple acts as your processor under our Data Processing Agreement. ' +
          'You are responsible for having a lawful basis to process your ' +
          'members’ data and for giving them your own privacy information; ' +
          'Temple provides export, erasure, and audit tools to help.',
      ],
    },
    {
      heading: 'Payments',
      body: [
        'Temple uses Stripe Connect. Your gym connects its own Stripe account ' +
          'and charges its members directly. Temple is not the merchant of ' +
          'record and takes no cut of your members’ payments — you ' +
          'keep 100%, less Stripe’s own fees. Fees for your Temple ' +
          'subscription and paid add-ons are as agreed at sign-up or by ' +
          'invoice.',
      ],
    },
    {
      heading: 'Acceptable use',
      body: [
        'You will not use Temple unlawfully, attempt to breach its security ' +
          'or access other businesses’ data, or use the communications ' +
          'and website tools to send spam or unlawful content. You are ' +
          'responsible for the content you and your staff publish.',
      ],
    },
    {
      heading: 'Availability',
      body: [
        'The service is provided on an “as is” and “as ' +
          'available” basis. We may change, add, or remove features, and ' +
          'some are labelled beta. We are not liable for downtime or ' +
          'third-party outages.',
      ],
    },
    {
      heading: 'Liability and governing law',
      body: [
        'To the extent permitted by law we disclaim implied warranties and ' +
          'limit our liability; nothing limits liability that cannot lawfully ' +
          'be limited. These terms are governed by the laws of England and ' +
          'Wales.',
      ],
    },
  ],
  contact: 'Questions about these terms: legal@jointemple.io',
};

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  updated: 'July 2026',
  draftNotice: DRAFT_NOTICE,
  intro: [
    'This policy explains how Temple handles the personal data we control — ' +
      'mainly the account data of gym owners, staff, and individual users.',
    'For the member data a gym stores in Temple (bookings, training history, ' +
      'and health data such as PAR-Q answers and injuries), the gym is the ' +
      'controller and Temple is its processor. If you are a gym member, ' +
      'contact your gym about its use of your data.',
  ],
  sections: [
    {
      heading: 'What we collect and why',
      body: [
        'To run your account we process your name, email, hashed password, ' +
          'and gym role (to authenticate you and provide the service), usage ' +
          'and log data (for security and improvement), billing data for your ' +
          'Temple subscription, and any support correspondence.',
        'As a controller we do not use members’ health data for our own ' +
          'purposes — we only process it on a gym’s behalf under our ' +
          'Data Processing Agreement.',
      ],
    },
    {
      heading: 'Service providers',
      body: [
        'We rely on Supabase (database, auth, storage), Stripe (payments), ' +
          'Resend (email), and Vercel (hosting). Optional features may use ' +
          'Anthropic (AI assistance, privacy-safe summaries only) and Pexels ' +
          '(stock photos). Each processes data only as needed to provide its ' +
          'part of the service.',
      ],
    },
    {
      heading: 'Retention',
      body: [
        'We keep account data while your account is active and for a ' +
          'reasonable period afterwards. Member health data handled for a gym ' +
          'follows the gym’s settings and our built-in rules, including ' +
          'erasure when a member leaves and an automatic sweep of health data ' +
          'more than three months after a membership ends.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'Subject to law you may access, correct, delete, restrict, or port ' +
          'your data and object to certain processing. For data we control, ' +
          'contact privacy@jointemple.io; for data a gym controls, contact the ' +
          'gym. You may also complain to the UK Information Commissioner’s ' +
          'Office.',
      ],
    },
    {
      heading: 'Security',
      body: [
        'We isolate every gym’s data with row-level security, log ' +
          'health-data access, encrypt data in transit, and route sensitive ' +
          'writes through authorised server-side routines.',
      ],
    },
  ],
  contact: 'Privacy questions: privacy@jointemple.io',
};
