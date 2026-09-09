// Which sender a text goes out on, and whether one exists at all.
//
// Until now this was one hard-coded answer everywhere: the gym's own
// Twilio number. That is exactly right for a reply — somebody texted
// that number and the answer has to come back from it — and it is what
// makes the AI front desk unable to text anybody at all today.
//
// The chain is: a gym's number is bought under Temple's UK regulatory
// bundle; a bundle is approved against one regulation, so a bundle
// covering *local* numbers cannot buy a *mobile*; and a UK local number
// is voice-only (0270, and docs/ai-front-desk-provisioning.md's "option
// A, voice-first"). So "can this gym text" currently reduces to "has a
// second Twilio bundle been approved against the GB mobile regulation",
// which is a business-verification queue measured in days and cannot be
// unblocked from this repository.
//
// It does not have to reduce to that. A signup link is one-way and the
// body names the gym, so Temple can carry it on a sender of its own
// while a gym waits for — or never takes — a mobile number of its own.
// One environment variable, TWILIO_PLATFORM_SMS_SENDER, holds whatever
// Temple has: a Messaging Service SID (MG…, which can itself hold a
// number, a pool, or an alphanumeric sender) or a plain E.164 number.
// Twilio's Messages resource takes either, under different parameter
// names, which is the whole of the difference below.
//
// THE LINE THIS DOES NOT CROSS. Only messages the agent *starts* may
// fall back to it: the join and onboarding links, and member messages.
// A reply on a thread, and the "sorry we missed your call" opener, still
// go out on the gym's own number or not at all — sending those from a
// platform sender would answer somebody on a number they never wrote to.

// Twilio Messaging Service SIDs are the only sender value that starts
// MG, so the two cases need no extra flag to tell apart.
export function twilioSenderParam(sender: string): ['From' | 'MessagingServiceSid', string] {
  return sender.startsWith('MG') ? ['MessagingServiceSid', sender] : ['From', sender];
}

/**
 * The sender for a message Temple initiates, or null when there is none.
 *
 * A gym's own number wins whenever it can carry SMS: a text from the
 * number on their website is worth more than one from ours, and it is
 * the only one somebody can reply to. Temple's sender is the fallback,
 * not the default.
 */
export function outboundSmsSender(
  gymNumber: string | null | undefined,
  gymSmsCapable: boolean,
  platformSender: string | null | undefined,
): string | null {
  if (gymSmsCapable && gymNumber) return gymNumber;
  return platformSender || null;
}
