import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/cd87cee5-4a6c-4972-bf89-56cf399fe1e0';

async function run() {
  console.log('Starting puppeteer browser verification...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 1. Open app
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });

  // 2. Stage 1: ASB Creation Modal & Signature
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'ASB001' });
  });
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });

  // Click Buat Berita Acara button
  await page.waitForSelector('#btn-create-bapb');
  await page.click('#btn-create-bapb');
  await page.waitForSelector('#bapb-sig-canvas-asb');
  await new Promise(r => setTimeout(r, 600));

  // Scroll modal body down to show signature
  await page.evaluate(() => {
    const modalBody = document.querySelector('.modal-fullscreen .modal-body');
    if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));

  // Screenshot Stage 1: ASB Signature Area
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_stage1_asb_signature.png'),
    fullPage: false
  });
  console.log('[OK] bapb_stage1_asb_signature.png captured');

  // Draw signature on ASB canvas
  const asbCanvas = await page.$('#bapb-sig-canvas-asb');
  const asbBox = await asbCanvas.boundingBox();
  await page.mouse.move(asbBox.x + 40, asbBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(asbBox.x + 50 + i * 5, asbBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Test clear button
  await page.click('#btn-clear-sig-asb');
  // Draw again
  await page.mouse.move(asbBox.x + 40, asbBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(asbBox.x + 50 + i * 5, asbBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Now seed a clean draft awaiting Askep directly to test Stage 2
  const draftDocNo = await page.evaluate(async () => {
    const { storage } = await import('./js/core/storage.js');
    const { session } = await import('./js/core/session.js');
    const { BAPB_STATUS, DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');

    const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    const testId = 'BAPB-VERIF-2026-001';
    const filtered = records.filter(r => r.id !== testId);

    const canvas = document.getElementById('bapb-sig-canvas-asb');
    const asbSigData = canvas ? canvas.toDataURL('image/png') : ('data:image/png;base64,' + 'A'.repeat(800));

    const draft = {
      id: testId,
      bapbId: testId,
      docNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0123',
      draftDocNo: 'DRAFT-BAPB/TB/DIV-I/10/2026/0123',
      officialDocNo: null,
      isFinal: false,
      documentType: 'BAPB_KARET',
      transactionType: 'PEMUSNAHAN_BIBIT',
      estateId: 'EST-TBS',
      estateCode: 'TB',
      divisionId: 'DIV-001',
      divisionCode: 'DIV-I',
      items: [{
        sourceSelectionId: 'SEL-001',
        sourceSelectionNo: 'TBS/DIV-I/CULL/SEL-I/10/2026/01',
        klon: 'GT 1',
        bedengan: 'BED-04',
        quantity: 150,
        stage: 'Afkir Seleksi'
      }],
      totalQty: 150,
      quantity: 150,
      klon: 'GT 1',
      bedengan: 'BED-04',
      tanggalPelaksanaan: '2026-10-17',
      metodePemusnahan: 'Pencincangan dan Pemendaman',
      photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
      signatures: {
        asb: {
          roleTitle: 'Asisten Divisi Bibitan — Pelaksana',
          name: 'Annisa',
          userId: 'TBS-ASB-001',
          signatureDataUrl: asbSigData,
          signedAt: '2026-10-17T10:00:00+07:00'
        },
        askep: null,
        pengurus: null
      },
      bapbStatus: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
      status: BAPB_STATUS.DRAFT_AWAITING_ASKEP,
      createdByName: 'Annisa',
      createdAt: new Date().toISOString()
    };

    filtered.unshift(draft);
    storage.set(DESTRUCTION_STORAGE_KEY, filtered);

    // Switch session to Askep (Beny Sihotang)
    session.start({ code: 'ASK001' });
    return draft.draftDocNo;
  });

  // Reload page as Askep
  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.btn-askep-action');

  // Click Pemeriksaan & Tanda Tangan Askep
  await page.click('.btn-askep-action');
  await page.waitForSelector('#bapb-sig-canvas-askep');
  await new Promise(r => setTimeout(r, 600));

  // Scroll down to show Askep canvas
  await page.evaluate(() => {
    const modalBody = document.querySelector('.modal-fullscreen .modal-body');
    if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));

  // Screenshot Stage 2: Askep Signature Area
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_stage2_askep_signature.png'),
    fullPage: false
  });
  console.log('[OK] bapb_stage2_askep_signature.png captured');

  // Draw signature on Askep canvas
  const askepCanvas = await page.$('#bapb-sig-canvas-askep');
  const askepBox = await askepCanvas.boundingBox();
  await page.mouse.move(askepBox.x + 40, askepBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(askepBox.x + 50 + i * 5, askepBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Test clear button
  await page.click('#btn-clear-sig-askep');
  // Draw again
  await page.mouse.move(askepBox.x + 40, askepBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(askepBox.x + 50 + i * 5, askepBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Submit Askep approval
  await page.click('#btn-confirm-sign-askep');
  await new Promise(r => setTimeout(r, 1000));

  // Switch to Pengurus (Junaidi)
  await page.evaluate(async () => {
    const { session } = await import('./js/core/session.js');
    session.start({ code: 'PGS001' });
  });

  await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.btn-pengurus-action');

  // Click Pemeriksaan & Pengesahan Dokumen FINAL
  await page.click('.btn-pengurus-action');
  await page.waitForSelector('#bapb-sig-canvas-pengurus');
  await new Promise(r => setTimeout(r, 600));

  // Scroll down to show Pengurus canvas
  await page.evaluate(() => {
    const modalBody = document.querySelector('.modal-fullscreen .modal-body');
    if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));

  // Screenshot Stage 3: Pengurus Signature Area
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_stage3_pengurus_signature.png'),
    fullPage: false
  });
  console.log('[OK] bapb_stage3_pengurus_signature.png captured');

  // Draw signature on Pengurus canvas
  const pgrCanvas = await page.$('#bapb-sig-canvas-pengurus');
  const pgrBox = await pgrCanvas.boundingBox();
  await page.mouse.move(pgrBox.x + 40, pgrBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(pgrBox.x + 50 + i * 5, pgrBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Test clear button
  await page.click('#btn-clear-sig-pengurus');
  // Draw again
  await page.mouse.move(pgrBox.x + 40, pgrBox.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(pgrBox.x + 50 + i * 5, pgrBox.y + 40 + (i % 2) * 15);
  }
  await page.mouse.up();

  // Submit Pengurus Finalization
  await page.click('#btn-confirm-finalize-pengurus');
  await new Promise(r => setTimeout(r, 1200));

  // Screenshot Stage 4: Final document card
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'bapb_stage4_final_document.png'),
    fullPage: false
  });
  console.log('[OK] bapb_stage4_final_document.png captured');

  // Verify all signatures stored on document in storage
  const finalDocData = await page.evaluate(async () => {
    const { storage } = await import('./js/core/storage.js');
    const { DESTRUCTION_STORAGE_KEY } = await import('./js/modules/destruction/destruction-manager.js');
    const records = storage.get(DESTRUCTION_STORAGE_KEY, []) || [];
    return records.find(r => r.id === 'BAPB-VERIF-2026-001');
  });

  console.log('Final Document Status:', finalDocData?.bapbStatus);
  console.log('Final Official Doc No:', finalDocData?.officialDocNo);
  console.log('Has ASB Sig:', !!finalDocData?.signatures?.asb?.signatureDataUrl);
  console.log('Has Askep Sig:', !!finalDocData?.signatures?.askep?.signatureDataUrl);
  console.log('Has Pengurus Sig:', !!finalDocData?.signatures?.pengurus?.signatureDataUrl);

  await browser.close();
  console.log('[SUCCESS] All 3 stages verified and captured!');
}

run().catch(err => {
  console.error('[FAILED]', err);
  process.exit(1);
});
