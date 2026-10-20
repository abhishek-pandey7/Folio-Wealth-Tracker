// AMFI's daily NAV file: every mutual fund scheme with its SEBI category. It is
// 1.5 MB, too much to parse inside one Worker invocation's CPU budget, so the
// fund catalogue job reads it in byte ranges and this parser carries its
// position (current heading and fund house) from one chunk to the next.

export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

/** Where the parser is in the file's heading structure. */
export interface AmfiCursor {
  heading: string;
  fundHouse: string;
  openEnded: boolean;
}

export const START: AmfiCursor = { heading: '', fundHouse: '', openEnded: false };

export interface AmfiScheme {
  code: string;
  name: string;
  fundHouse: string;
  /** AMFI heading, e.g. "Equity Scheme - Large Cap Fund". */
  heading: string;
  plan: string;
  option: string;
  nav: string;
  /** YYYY-MM-DD */
  navDate: string;
}

const OPEN_ENDED = /^Open Ended Schemes\((.+)\)$/;
const OTHER = /^(Close Ended|Interval Fund) Schemes\(/;
const CODE = /^\d+$/;
const NAV = /^\d+(\.\d+)?$/;
const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/** "17-Oct-2026" → "2026-10-17", or undefined. */
function parseDate(raw: string): string | undefined {
  const [d, mon, y] = raw.split('-');
  const mm = mon && MONTHS[mon];
  if (!mm || !d || !y || !/^\d{1,2}$/.test(d) || !/^\d{4}$/.test(y)) return undefined;
  return `${y}-${mm}-${d.padStart(2, '0')}`;
}

/**
 * Parses whole lines. The layout is category headings, fund house names, and
 * semicolon-separated scheme rows:
 *
 *   Open Ended Schemes(Equity Scheme - Large Cap Fund)
 *   Axis Mutual Fund
 *   120465;INF846K01DP8;-;Axis Large Cap Fund;Direct Plan;Growth Option;64.21;17-Oct-2026
 *
 * Older rows omit the Plan and Option columns and carry them in the name.
 * Close-ended and interval schemes are skipped: they cannot be bought anytime.
 */
export function parseLines(text: string, from: AmfiCursor): { schemes: AmfiScheme[]; cursor: AmfiCursor } {
  const cursor = { ...from };
  const schemes: AmfiScheme[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = OPEN_ENDED.exec(line);
    if (heading) {
      cursor.heading = heading[1] as string;
      cursor.fundHouse = '';
      cursor.openEnded = true;
      continue;
    }
    if (OTHER.test(line)) {
      cursor.openEnded = false;
      continue;
    }
    if (!line.includes(';')) {
      cursor.fundHouse = line;
      continue;
    }
    if (!cursor.openEnded) continue;

    const fields = line.split(';').map((f) => f.trim());
    if (fields.length < 6 || !CODE.test(fields[0] as string)) continue; // the header row, or malformed
    const nav = fields[fields.length - 2] as string;
    const navDate = parseDate(fields[fields.length - 1] as string);
    if (!NAV.test(nav) || !navDate) continue; // "N.A." for schemes with no NAV today
    schemes.push({
      code: fields[0] as string,
      name: fields[3] as string,
      fundHouse: cursor.fundHouse,
      heading: cursor.heading,
      plan: fields.length >= 8 ? (fields[4] as string) : '',
      option: fields.length >= 8 ? (fields[5] as string) : '',
      nav: nav.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
      navDate,
    });
  }
  return { schemes, cursor };
}

/**
 * Splits a byte chunk at its last newline so no line (or UTF-8 character) is
 * cut in half. Returns the decoded whole lines and how many bytes they used;
 * the next chunk starts right after. At the end of the file everything counts.
 */
export function wholeLines(bytes: Uint8Array, isLast: boolean): { text: string; used: number } {
  const used = isLast ? bytes.length : bytes.lastIndexOf(0x0a) + 1;
  return { text: new TextDecoder().decode(bytes.subarray(0, used)), used };
}
