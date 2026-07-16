// Central date display formatter. The platform shows dates as
// DD/MM/YYYY everywhere except the calendar / scheduling views (which
// keep their weekday / month-name rendering) and worded dates like
// "3 Mar 2026".
//
// Accepts an ISO date ('YYYY-MM-DD'), an ISO timestamp
// ('YYYY-MM-DDT…') — whose date part is taken as stored, with no
// timezone shift, matching the previous `.slice(0, 10)` display
// behaviour — or a Date. Returns '' for nullish/empty input, and the
// raw string if it can't be parsed so a bad value stays visible rather
// than silently vanishing.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fromDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    const datePart = value.slice(0, 10);
    if (ISO_DATE_RE.test(datePart)) {
      const [y, m, d] = datePart.split('-');
      return `${d}/${m}/${y}`;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return fromDate(parsed);
  }
  if (Number.isNaN(value.getTime())) return '';
  return fromDate(value);
}
