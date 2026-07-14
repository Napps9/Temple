// In-app copy for the public /terms and /privacy screens. This is the
// member/gym-facing rendered version; the canonical drafts (with lawyer
// placeholders and the full DPA) live in docs/legal/*.md. Keep the two
// broadly in sync — a material change to the legal position belongs in
// both, and should be run past counsel before it ships.

export type LegalSection = { heading: string; body: string[] };

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
  contact: string;
};

export const TERMS_OF_SERVICE: LegalDoc = {
  title: 'Terms of Service',
  updated: '10 July 2026',
  intro: [
    'These terms apply to two kinds of user: a gym or fitness business that ' +
      'runs its business on Temple, and an individual who creates their own ' +
      'account to train solo or join a gym. By creating an account you agree ' +
      'to them (for a gym, on behalf of that business).',
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
      heading: 'Your account and age',
      body: [
        'Account holders must be 18 or over. You are responsible for the ' +
          'accuracy of your details, for any staff’s use of the platform, ' +
          'and for keeping your credentials secure.',
        'Temple does not currently verify a member’s age. Where a gym ' +
          'enrols a member under 18, the gym is responsible for obtaining ' +
          'parental or guardian consent before that member provides any ' +
          'personal data, including health data.',
      ],
    },
    {
      heading: 'If you are a consumer',
      body: [
        'If you use Temple as an individual (for example solo training or as ' +
          'a gym member), nothing in these terms removes your statutory ' +
          'rights under the Consumer Rights Act 2015 or the Consumer ' +
          'Contracts Regulations 2013 — including a 14-day right to cancel a ' +
          'paid subscription you buy directly from Temple. Memberships and ' +
          'class purchases you make with a gym are a contract with that gym, ' +
          'not with Temple, so raise those refunds with your gym.',
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
          'invoice, payable within 7 days; we’ll give you at least 30 days’ ' +
          'notice of any price change.',
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
          'be limited. Our total liability to you is capped at the fees you ' +
          'paid Temple in the 3 months before the claim. These terms are ' +
          'governed by the laws of England and Wales.',
      ],
    },
  ],
  contact: 'Questions about these terms: privacy@jointemple.io',
};

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  updated: '10 July 2026',
  intro: [
    'This policy explains how Temple Software Ltd (company no. 15867522) ' +
      'handles the personal data we control — mainly the account data of gym ' +
      'owners, staff, and individual users.',
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
    {
      heading: 'Cookies',
      body: [
        'The app stores only what is needed to keep you signed in and ' +
          'remember preferences like light/dark theme — this needs no ' +
          'consent. Any analytics or other non-essential storage runs only if ' +
          'you accept it in the banner shown on your first visit; you can ' +
          'accept or reject with equal ease, and rejecting keeps only the ' +
          'essential storage. (Marketing emails a gym sends via Temple may ' +
          'track opens and clicks under the gym’s own privacy notice, and ' +
          'always carry a one-click unsubscribe.)',
      ],
    },
    {
      heading: 'Children',
      body: [
        'Solo accounts are for people aged 18 or over, and solo sign-up ' +
          'refuses an under-18 date of birth. A gym may opt in to enrolling ' +
          'members under 18; where it does, we check age from date of birth ' +
          'and capture a parent or guardian’s consent in-app before the ' +
          'member proceeds, and the gym remains responsible for the lawful ' +
          'basis.',
      ],
    },
  ],
  contact: 'Privacy questions: privacy@jointemple.io',
};
