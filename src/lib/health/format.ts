/**
 * Server-side timestamp display for the health surface (RD-28: the client
 * renders strings verbatim and does no clock math).
 *
 * Recent stamps read as "Sun 6:02 AM ET"; anything a week old or older gains
 * its date ("Feb 8, 6:02 AM ET") because a bare weekday would be ambiguous.
 * The "ET" suffix is explicit — an operator reading health from another
 * timezone must not have to guess whose clock this is.
 */

const ET = "America/New_York";
const WEEK_MS = 7 * 24 * 60 * 60_000;

export function formatEtStamp(value: Date, now: Date): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

  if (now.getTime() - value.getTime() < WEEK_MS) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short",
    }).format(value);
    return `${weekday} ${time} ET`;
  }

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
  }).format(value);
  return `${date}, ${time} ET`;
}
