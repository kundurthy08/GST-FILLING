// Indian GST validation, state master, paise arithmetic, and formula neutralization utilities

export const INDIAN_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function validateGstin(gstin: string | null | undefined): {
  valid: boolean;
  reason?: string;
  stateCode?: string;
  stateName?: string;
} {
  if (!gstin) return { valid: false, reason: 'GSTIN is empty' };
  const cleaned = gstin.trim().toUpperCase();
  if (cleaned.length !== 15) {
    return { valid: false, reason: `GSTIN length must be 15 characters (found ${cleaned.length})` };
  }
  if (!GSTIN_REGEX.test(cleaned)) {
    return { valid: false, reason: 'GSTIN format does not match statutory pattern' };
  }
  const stateCode = cleaned.slice(0, 2);
  const stateName = INDIAN_STATES[stateCode];
  if (!stateName) {
    return { valid: false, reason: `Unknown GST state code ${stateCode}` };
  }
  // Mod-36 checksum verification on first 14 chars
  let factor = 2;
  let sum = 0;
  const mod = GSTIN_CHARS.length; // 36
  for (let i = 13; i >= 0; i--) {
    const codePoint = GSTIN_CHARS.indexOf(cleaned[i]);
    if (codePoint < 0) return { valid: false, reason: 'Invalid character in GSTIN' };
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / mod) + (addend % mod);
    sum += addend;
  }
  const remainder = sum % mod;
  const checkCodePoint = (mod - remainder) % mod;
  const expectedChar = GSTIN_CHARS[checkCodePoint];
  if (cleaned[14] !== expectedChar) {
    return {
      valid: false,
      reason: `GSTIN checksum mismatch (expected '${expectedChar}', got '${cleaned[14]}')`,
      stateCode,
      stateName,
    };
  }
  return { valid: true, stateCode, stateName };
}

export function normalizeInvoiceNumber(invNo: string): string {
  return (invNo || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+/, '') || '0';
}

export function toPaise(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const num = typeof val === 'number' ? val : Number(String(val).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function formatINR(paise: number): string {
  const rupees = (paise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

// Half-up integer percentage calculation in paise using basis points (e.g., 2800 bps = 28.00%)
export function calcTaxPaise(taxablePaise: number, rateBps: number): number {
  const sign = taxablePaise < 0 ? -1 : 1;
  const absTaxable = Math.abs(taxablePaise);
  return sign * Math.round((absTaxable * rateBps) / 10000);
}

// Neutralize dangerous spreadsheet formula injection prefixes on text fields
export function sanitizeSpreadsheetText(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function getPeriodLabel(returnPeriod: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!/^\d{6}$/.test(returnPeriod)) return returnPeriod;
  const mm = parseInt(returnPeriod.slice(0, 2), 10);
  const yyyy = returnPeriod.slice(2);
  return `${months[mm - 1] || returnPeriod.slice(0, 2)} ${yyyy}`;
}

export function getFinancialYearFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '2026-27';
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  if (month >= 4) {
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  }
  return `${year - 1}-${String(year % 100).padStart(2, '0')}`;
}
