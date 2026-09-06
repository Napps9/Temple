// Whether the class sheet offers "Request cover" to the person looking
// at it. The server (request_cover) refuses anyone but the class's own
// coach, so the chip only ever appears where a press can succeed: the
// viewer holds the capability, the class is theirs, it has not started,
// and nobody has already asked. Kept pure so the rule is one tested
// function rather than a JSX condition nobody can exercise.
export function canOfferCover({
  can,
  viewerId,
  coachId,
  inPast,
  openOffer,
}: {
  can: boolean;
  viewerId: string | null | undefined;
  coachId: string | null | undefined;
  inPast: boolean;
  openOffer: boolean;
}): boolean {
  if (!can || inPast || openOffer) return false;
  if (!viewerId || !coachId) return false;
  return viewerId === coachId;
}
