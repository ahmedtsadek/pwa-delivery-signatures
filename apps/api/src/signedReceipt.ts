import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type Relationship = 'SELF'|'CAREGIVER'|'PARENT'|'SIBLING'|'CHILD'|'FACILITY_STAFF'|'OTHER';

export type ReceiptCompletion = {
  recipientName: string;
  relationship: Relationship;
  deliveredAt: Date;
  driverName: string;
  notes?: string;
  signaturePng: Buffer;
};

// Saint Mary receipt uses US Letter and repeats the signature block on page 1 and the final page.
// Coordinates are PDF points measured from bottom-left and intentionally stay inside the existing blanks.
const SAINT_MARY_LAYOUT = {
  recipientX: 184,
  relationMarks: {
    SELF: 249,
    CAREGIVER: 281,
    PARENT: 336,
    SIBLING: 378,
    CHILD: 422,
    OTHER: 459
  } as Record<Relationship, number>,
  signatureX: 82,
  signatureWidth: 195,
  signatureHeight: 31,
  dateX: 383,
  driverX: 132,
  notesX: 106,
};

function fmt(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: process.env.APP_TIME_ZONE || 'America/Los_Angeles'
  }).format(date);
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
    const h = page.getHeight();
    // Top coordinates vary because page 1 has many Rx lines and last page often has fewer.
    // Find the expected block baseline from observed template page layout.
    const isFirst = index === 0;
    const recipientY = isFirst ? 265 : 603;
    const signatureY = isFirst ? 244 : 576;
    const dateY = isFirst ? 248 : 580;
    const driverY = isFirst ? 232 : 559;
    const notesY = isFirst ? 218 : 544;

    page.drawText(data.recipientName.slice(0, 38), {
      x: SAINT_MARY_LAYOUT.recipientX, y: recipientY, size: 9, font: bold, color: rgb(0,0,0)
    });

    const relationX = SAINT_MARY_LAYOUT.relationMarks[data.relationship] ?? SAINT_MARY_LAYOUT.relationMarks.OTHER;
    page.drawText('X', { x: relationX, y: recipientY - 1, size: 9, font: bold });

    const scaled = signature.scaleToFit(SAINT_MARY_LAYOUT.signatureWidth, SAINT_MARY_LAYOUT.signatureHeight);
    page.drawImage(signature, {
      x: SAINT_MARY_LAYOUT.signatureX,
      y: signatureY,
      width: scaled.width,
      height: scaled.height
    });

    page.drawText(fmt(data.deliveredAt), {
      x: SAINT_MARY_LAYOUT.dateX, y: dateY, size: 8.5, font
    });
    page.drawText(data.driverName.slice(0, 24), {
      x: SAINT_MARY_LAYOUT.driverX, y: driverY, size: 8.5, font: bold
    });
    if (data.notes?.trim()) {
      page.drawText(data.notes.trim().slice(0, 70), {
        x: SAINT_MARY_LAYOUT.notesX, y: notesY, size: 8, font
      });
    }
  }

  return Buffer.from(await pdf.save());
}
