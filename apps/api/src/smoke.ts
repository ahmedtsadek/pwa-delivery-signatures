import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseReceiptPdf } from './receiptParser.js';
import { stampSaintMaryReceipt } from './signedReceipt.js';
import { improveRoadOrder } from './routing.js';

async function syntheticReceipt() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let pageNo = 1; pageNo <= 3; pageNo++) {
    const page = pdf.addPage([612, 792]);

    const draw = (text: string, x: number, y: number, size = 10) =>
      page.drawText(text, { x, y, size, font });

    draw('Saint Mary Pharmacy', 35, 752, 13);
    draw('Delivered To: 100 TEST AVE', 260, 752, 10);
    draw('TESTVILLE CA 90000', 400, 735, 10);
    draw('TEST CARE CENTER', 400, 718, 10);
    draw('Rx Delivery Receipt', 230, 690, 16);
    draw('9/28/2026 2:23:59 PM', 245, 674, 9);

    if (pageNo === 1) {
      draw('1: 9991001 DOE,JANE 09/28/2026 TESTDRUG 10 MG TABLET 1 $0.00', 30, 610, 9);
      draw('2: 9991002 DOE,JANE 09/28/2026 SECOND DRUG 20 MG TAB 1 $0.00', 30, 575, 9);
    }
    if (pageNo === 2) {
      draw('1: 9991003 DOE,JANE 09/28/2026 THIRD DRUG 5 MG TAB 1 $0.00', 30, 610, 9);
    }

    if (pageNo === 1 || pageNo === 3) {
      draw('Patient/Caregiver/Relation Name __________ () Self () Caregiver () Parent () Sibiling () Child () Others_______', 35, pageNo === 1 ? 265 : 603, 8);
      draw('Signature X__________________________ Date / Time __________________', 35, pageNo === 1 ? 244 : 576, 8);
      draw('Driver: NHdriver/TEE x____', 35, pageNo === 1 ? 232 : 559, 8);
      draw('Comments/Notes :', 35, pageNo === 1 ? 218 : 544, 8);
    }

    draw('*9990001*', 500, 65, 9);
    draw('Log #: 9990001', 470, 45, 11);
  }

  return Buffer.from(await pdf.save());
}

async function main() {
  const receipt = await syntheticReceipt();
  const parsed = await parseReceiptPdf(receipt);

  assert.equal(parsed.template, 'SAINT_MARY_RX_DELIVERY');
  assert.equal(parsed.pageCount, 3);
  assert.equal(parsed.address1, '100 TEST AVE');
  assert.equal(parsed.city, 'TESTVILLE');
  assert.equal(parsed.state, 'CA');
  assert.equal(parsed.postalCode, '90000');
  assert.equal(parsed.facilityName, 'TEST CARE CENTER');
  assert.equal(parsed.driverNormalized, 'TEE');
  assert.equal(parsed.logNumber, '9990001');
  assert.equal(parsed.barcodeValue, '9990001');
  assert.deepEqual(parsed.patientNames, ['DOE,JANE']);
  assert.deepEqual(parsed.rxNumbers.sort(), ['9991001','9991002','9991003']);

  // Tiny valid transparent PNG. The production app supplies the real drawn signature.
  const signaturePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw3qWQAAAABJRU5ErkJggg==',
    'base64'
  );

  const signed = await stampSaintMaryReceipt(receipt, {
    recipientName: 'TEST RECEIVER',
    relationship: 'CAREGIVER',
    deliveredAt: new Date('2026-09-28T15:00:00-07:00'),
    driverName: 'TEE',
    notes: 'Synthetic CI receipt only',
    signaturePng
  });

  assert.ok(signed.length > receipt.length, 'signed PDF should contain added proof content');
  const signedDoc = await PDFDocument.load(signed);
  assert.equal(signedDoc.getPageCount(), 3);

  const routeCandidates = [
    { id: 'A', latitude: 0, longitude: 0 },
    { id: 'B', latitude: 0, longitude: 0 },
    { id: 'C', latitude: 0, longitude: 0 },
    { id: 'D', latitude: 0, longitude: 0 }
  ];
  // Matrix indexes are [origin, A, B, C, D]. The initial A->C->B->D
  // ordering is deliberately expensive; bounded 2-opt should improve it.
  const matrix = [
    [0, 1, 9, 2, 9],
    [1, 0, 1, 8, 9],
    [9, 1, 0, 1, 2],
    [2, 8, 1, 0, 1],
    [9, 9, 2, 1, 0]
  ];
  const improved = improveRoadOrder(
    [routeCandidates[0], routeCandidates[2], routeCandidates[1], routeCandidates[3]],
    routeCandidates,
    matrix
  );
  assert.notDeepEqual(improved.map(x => x.id), ['A','C','B','D']);

  console.log(JSON.stringify({
    ok: true,
    parsed: {
      template: parsed.template,
      pageCount: parsed.pageCount,
      address: [parsed.address1, parsed.city, parsed.state, parsed.postalCode].join(', '),
      driver: parsed.driverNormalized,
      logNumber: parsed.logNumber,
      rxCount: parsed.rxNumbers.length
    },
    signedPdfBytes: signed.length
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
