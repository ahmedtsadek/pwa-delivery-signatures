import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type ParsedRx = {
  rxNumber: string;
  patientName?: string;
  rxDate?: string;
  drugName?: string;
  qty?: string;
  due?: string;
};

export type ParsedReceipt = {
  template: 'SAINT_MARY_RX_DELIVERY' | 'GENERIC';
  pageCount: number;
  pharmacyName?: string;
  facilityName?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  driverRaw?: string;
  driverNormalized?: string;
  logNumber?: string;
  barcodeValue?: string;
  patientNames: string[];
  rxNumbers: string[];
  prescriptions: ParsedRx[];
  rawPages: string[];
  warnings: string[];
};

type TextItem = { str: string; transform: number[]; width?: number };

type Row = { y: number; items: Array<{ x: number; text: string }> };

type AddressParts = {
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

function clean(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDriver(raw?: string) {
  if (!raw) return undefined;
  const value = raw.replace(/^Driver\s*:\s*/i, '').replace(/\s+x_+.*$/i, '').trim();
  const parts = value.split('/').map(v => v.trim()).filter(Boolean);
  return (parts.at(-1) || value).replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
}

function parseCityStateZip(line?: string): AddressParts {
  if (!line) return {};
  const m = clean(line).match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!m) return {};
  return { city: clean(m[1]), state: m[2].toUpperCase(), postalCode: m[3] };
}

function rowsFromItems(items: TextItem[]): Row[] {
  const grouped: Row[] = [];
  const tolerance = 2.2;
  for (const item of items) {
    const text = clean(item.str);
    if (!text) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let row = grouped.find(r => Math.abs(r.y - y) <= tolerance);
    if (!row) {
      row = { y, items: [] };
      grouped.push(row);
    }
    row.items.push({ x, text });
  }
  return grouped
    .sort((a, b) => b.y - a.y)
    .map(r => ({ ...r, items: r.items.sort((a, b) => a.x - b.x) }));
}

function rowText(row: Row) {
  return clean(row.items.map(i => i.text).join(' '));
}

function extractAddressFromRows(rows: Row[]): AddressParts {
  const deliveredRowIndex = rows.findIndex(r => /Delivered\s+To\s*:/i.test(rowText(r)));
  if (deliveredRowIndex < 0) return {};

  const deliveredRow = rows[deliveredRowIndex];
  const anchor = deliveredRow.items.find(i => /Delivered\s+To\s*:/i.test(i.text));
  const anchorX = anchor?.x ?? Math.max(...deliveredRow.items.map(i => i.x));

  let address1 = '';
  const deliveredText = rowText(deliveredRow);
  const inline = deliveredText.match(/Delivered\s+To\s*:\s*(.+)$/i)?.[1];
  if (inline) address1 = clean(inline);

  if (!address1) {
    const right = deliveredRow.items.filter(i => i.x > anchorX + 15 && !/Delivered\s+To/i.test(i.text));
    address1 = clean(right.map(i => i.text).join(' '));
  }

  let cityLine = '';
  for (let i = deliveredRowIndex + 1; i < Math.min(rows.length, deliveredRowIndex + 6); i++) {
    const candidates = rows[i].items.filter(it => it.x >= anchorX - 20);
    const text = clean(candidates.map(it => it.text).join(' '));
    if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(text)) {
      cityLine = text;
      break;
    }
    const full = rowText(rows[i]);
    if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(full) && !/Orange,?\s*CA\s*92865/i.test(full)) {
      cityLine = full;
      break;
    }
  }

  return { address1, ...parseCityStateZip(cityLine) };
}

function parsePrescriptions(pageText: string): ParsedRx[] {
  const lines = pageText.split(/\r?\n/).map(clean).filter(Boolean);
  const rx: ParsedRx[] = [];
  for (const line of lines) {
    // Common rendered pattern: "1: 787539 CRUZ SANTOS,DORIS 08/11/2026 ASPIRIN EC 81 MG TABLET 1 $0.00"
    const m = line.match(/^\d+:\s*(\d{4,})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s*(.+?)\s+(\d+(?:\.\d+)?)\s+\$?([\d.]+)$/);
    if (m) {
      rx.push({
        rxNumber: m[1],
        patientName: clean(m[2]),
        rxDate: m[3],
        drugName: clean(m[4]),
        qty: m[5],
        due: m[6]
      });
      continue;
    }
    const fallback = line.match(/^\d+:\s*(\d{4,})\s+(.+)$/);
    if (fallback) rx.push({ rxNumber: fallback[1] });
  }
  return rx;
}

export async function parseReceiptPdf(buffer: Buffer): Promise<ParsedReceipt> {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const rawPages: string[] = [];
  const allRows: Row[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i: any) => typeof i.str === 'string')
      .map((i: any) => ({ str: i.str, transform: i.transform, width: i.width })) as TextItem[];
    const rows = rowsFromItems(items);
    allRows.push(rows);
    rawPages.push(rows.map(rowText).join('\n'));
  }

  const allText = rawPages.join('\n');
  const saintMary = /Saint\s+Mary\s+Pharmacy/i.test(allText) && /Rx\s+Delivery\s+Receipt/i.test(allText);
  const firstRows = allRows[0] || [];
  let address = extractAddressFromRows(firstRows);
  if (!address.address1 || !address.city) {
    const lines = rawPages[0]?.split(/\n/).map(clean).filter(Boolean) || [];
    const firstLine = lines.find(l => /Delivered\s+To\s*:/i.test(l));
    const fallbackAddress1 = firstLine?.match(/Delivered\s+To\s*:\s*(.+)$/i)?.[1];
    const cityCandidates = lines.filter(l => /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(l));
    const destinationCity = cityCandidates.find(l => !/Orange,?\s*CA\s*92865/i.test(l)) || cityCandidates.at(-1);
    address = {
      address1: address.address1 || clean(fallbackAddress1),
      city: address.city || parseCityStateZip(destinationCity).city,
      state: address.state || parseCityStateZip(destinationCity).state,
      postalCode: address.postalCode || parseCityStateZip(destinationCity).postalCode
    };
  }

  const logNumber = allText.match(/Log\s*#\s*:\s*(\d+)/i)?.[1];
  const barcodeValue = allText.match(/\*(\d{5,})\*/)?.[1] || logNumber;
  const driverRaw = allText.match(/Driver\s*:\s*([^\n\r]+?)(?:\s+x_+|$)/i)?.[1]?.trim();
  const driverNormalized = normalizeDriver(driverRaw);

  let facilityName: string | undefined;
  const facilityMatch = allText.match(/\n([A-Z][A-Z0-9 '&.-]{3,})\s*\nRx\s+Delivery\s+Receipt/i);
  if (facilityMatch) facilityName = clean(facilityMatch[1]);

  const prescriptions = rawPages.flatMap(parsePrescriptions);
  const rxNumbers = [...new Set([
    ...prescriptions.map(p => p.rxNumber),
    ...Array.from(allText.matchAll(/(?:^|\n)\d+:\s*(\d{4,})\b/gm)).map(m => m[1])
  ])];
  const patientNames = [...new Set(prescriptions.map(p => p.patientName).filter(Boolean) as string[])];

  const warnings: string[] = [];
  if (!address.address1) warnings.push('Delivery address line was not confidently detected.');
  if (!address.city || !address.state || !address.postalCode) warnings.push('Delivery city/state/ZIP was not confidently detected.');
  if (!logNumber) warnings.push('Log number was not detected.');
  if (!driverRaw) warnings.push('Driver field was not detected.');
  if (!patientNames.length) warnings.push('Patient names were not confidently parsed from prescription rows.');

  return {
    template: saintMary ? 'SAINT_MARY_RX_DELIVERY' : 'GENERIC',
    pageCount: pdf.numPages,
    pharmacyName: saintMary ? 'Saint Mary Pharmacy' : undefined,
    facilityName,
    ...address,
    driverRaw,
    driverNormalized,
    logNumber,
    barcodeValue,
    patientNames,
    rxNumbers,
    prescriptions,
    rawPages,
    warnings
  };
}
