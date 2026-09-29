import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

type Relationship = 'SELF'|'CAREGIVER'|'PARENT'|'SIBLING'|'CHILD'|'FACILITY_STAFF'|'OTHER';

export type ReceiptCompletion = {
  recipientName: string;
  relationship: Relationship;
  deliveredAt: Date;
  driverName: string;
  notes?: string;
  signaturePng: Buffer;
};

type PageLayout = {
  recipientX: number;
  recipientY: number;
  recipientWidth: number;
  relationMarks: Record<Relationship, number>;
  signatureX: number;
  signatureY: number;
  signatureWidth: number;
  signatureHeight: number;
  dateX: number;
  dateY: number;
  dateWidth: number;
  driverX: number;
  driverY: number;
  driverWidth: number;
  notesX: number;
  notesY: number;
  notesWidth: number;
};

// The Saint Mary print template changes horizontal spacing between page 1 and
// continuation/final pages. Coordinates below are measured in PDF points from
// the actual 612x792 template and intentionally stay inside the printed blanks.
const FIRST_PAGE_LAYOUT: PageLayout = {
  recipientX: 184,
  recipientY: 265,
  recipientWidth: 55,
  relationMarks: {
    SELF: 249,
    CAREGIVER: 281,
    PARENT: 336,
    SIBLING: 378,
    CHILD: 422,
    FACILITY_STAFF: 459,
    OTHER: 459
  },
  signatureX: 82,
  signatureY: 244,
  signatureWidth: 145,
  signatureHeight: 22,
  dateX: 383,
  dateY: 248,
  dateWidth: 96,
  driverX: 136,
  driverY: 232,
  driverWidth: 22,
  notesX: 110,
  notesY: 218,
  notesWidth: 365
};

const FINAL_PAGE_LAYOUT: PageLayout = {
  recipientX: 171,
  recipientY: 603,
  recipientWidth: 49,
  relationMarks: {
    SELF: 230,
    CAREGIVER: 259,
    PARENT: 309,
    SIBLING: 347,
    CHILD: 387,
    FACILITY_STAFF: 421,
    OTHER: 421
  },
  signatureX: 78,
  signatureY: 576,
  signatureWidth: 132,
  signatureHeight: 22,
  dateX: 377,
  dateY: 580,
  dateWidth: 87,
  driverX: 126,
  driverY: 559,
  driverWidth: 20,
  notesX: 119,
  notesY: 544,
  notesWidth: 355
};

function fmt(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: process.env.APP_TIME_ZONE || 'America/Los_Angeles'
  }).format(date);
}

function fitText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    preferredSize: number;
    minSize?: number;
    maxChars?: number;
  }
) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;

  const minSize = options.minSize ?? 6;
  let value = options.maxChars ? clean.slice(0, options.maxChars) : clean;
  let size = options.preferredSize;

  while (size > minSize && font.widthOfTextAtSize(value, size) > options.maxWidth) {
    size -= 0.25;
  }

  if (font.widthOfTextAtSize(value, size) > options.maxWidth) {
    while (value.length > 1 && font.widthOfTextAtSize(value + '...', size) > options.maxWidth) {
      value = value.slice(0, -1);
    }
    if (value !== clean) value += '...';
  }

  page.drawText(value, {
    x: options.x,
    y: options.y,
    size,
    font,
    color: rgb(0, 0, 0)
  });
}

export async function stampSaintMaryReceipt(originalPdf: Buffer, data: ReceiptCompletion) {
  const pdf = await PDFDocument.load(originalPdf);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signature = await pdf.embedPng(data.signaturePng);

  const pages = pdf.getPages();
  const targetIndexes = pages.length === 1 ? [0] : [...new Set([0, pages.length - 1])];

  for (const index of targetIndexes) {
    const page = pages[index];
    const layout = index === 0 ? FIRST_PAGE_LAYOUT : FINAL_PAGE_LAYOUT;

    fitText(page, data.recipientName, bold, {
      x: layout.recipientX,
      y: layout.recipientY,
      maxWidth: layout.recipientWidth,
      preferredSize: 8.5,
      minSize: 5.75,
      maxChars: 38
    });

    const relationX = layout.relationMarks[data.relationship] ?? layout.relationMarks.OTHER;
    page.drawText('X', {
      x: relationX,
      y: layout.recipientY - 1,
      size: 8,
      font: bold,
      color: rgb(0, 0, 0)
    });

    const scaled = signature.scaleToFit(layout.signatureWidth, layout.signatureHeight);
    page.drawImage(signature, {
      x: layout.signatureX,
      y: layout.signatureY,
      width: scaled.width,
      height: scaled.height
    });

    fitText(page, fmt(data.deliveredAt), font, {
      x: layout.dateX,
      y: layout.dateY,
      maxWidth: layout.dateWidth,
      preferredSize: 8.25,
      minSize: 6
    });

    // The receipt already prints the parsed driver before this blank. Fill only
    // the small driver confirmation blank instead of overwriting the label/name.
    fitText(page, data.driverName, bold, {
      x: layout.driverX,
      y: layout.driverY,
      maxWidth: layout.driverWidth,
      preferredSize: 7.5,
      minSize: 5.5,
      maxChars: 8
    });

    if (data.notes?.trim()) {
      fitText(page, data.notes, font, {
        x: layout.notesX,
        y: layout.notesY,
        maxWidth: layout.notesWidth,
        preferredSize: 7.5,
        minSize: 6,
        maxChars: 90
      });
    }
  }

  return Buffer.from(await pdf.save());
}
