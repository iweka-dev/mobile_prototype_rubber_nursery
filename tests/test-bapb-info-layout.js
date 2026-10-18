import puppeteer from 'puppeteer';
import path from 'path';
import { renderBapbPrintHtml } from '../js/modules/destruction/bapb-print-template.js';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/308be8c4-169f-4a71-b7e1-ade86fed7390';

async function runBapbInfoLayoutTests() {
  console.log('========================================================================');
  console.log('STARTING TEST SUITE: RAPiKAN LAYOUT INFORMASI BAPB (PREVIEW & CETAK A4)');
  console.log('========================================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      passCount++;
      console.log(`  [PASS] ${message}`);
    } else {
      failCount++;
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  const mockDoc = {
    id: 'BAPB-LAYOUT-001',
    officialDocNo: 'TB/DIV-I/10/2026/01',
    docNo: 'TB/DIV-I/10/2026/01',
    documentType: 'BAPB_KARET',
    isFinal: true,
    bapbStatus: 'FINAL',
    estateId: 'EST-TBS',
    estateName: 'Tanah Besih',
    estateCode: 'TB',
    divisionId: 'DIV-001',
    divisionName: 'Divisi I',
    divisionCode: 'DIV-I',
    metodePemusnahan: 'Pencincangan dan Pemendaman',
    approvalMode: 'SEQUENTIAL',
    tanggalPelaksanaan: '2026-10-17',
    publishedAt: '2026-10-18T00:20:00Z',
    items: [{
      sourceSelectionNo: 'SEL/TB/DIV-I/10/2026/01',
      bedengan: 'BED-01',
      klon: 'GT 1',
      stage: 'Seleksi 1',
      quantity: 50,
      reason: 'Afkir Batang Bengkok'
    }],
    photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    signatures: {
      asb: { name: 'Annisa', signatureDataUrl: 'data:image/png;base64,abc', signedAt: '2026-10-17T08:00:00Z' },
      askep: { name: 'R. Siregar', signatureDataUrl: 'data:image/png;base64,def', signedAt: '2026-10-17T11:00:00Z' },
      pengurus: { name: 'Ir. M. Ridwan', signatureDataUrl: 'data:image/png;base64,ghi', signedAt: '2026-10-18T00:20:00Z' }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Direct HTML Structure & 2-Column Table Verification (Unit Check)
  // ---------------------------------------------------------------------------
  console.log('>>> [1/4] Memeriksa Struktur HTML 2-Kolom Metadata pada Preview & Print...');
  const previewHtml = renderBapbPrintHtml(mockDoc, { isScreenPreview: true });
  const printHtml = renderBapbPrintHtml(mockDoc, { isScreenPreview: false });

  // AC01: Kedua template menggunakan table 2-kolom
  assert(previewHtml.includes('class="bapb-meta-table"'), '[AC01] Preview menggunakan tabel metadata (.bapb-meta-table)');
  assert(printHtml.includes('class="bapb-meta-table"'), '[AC01] Print A4 menggunakan tabel metadata (.bapb-meta-table)');

  // AC01: Ketujuh informasi tercantum lengkap
  const expectedLabels = [
    'Kebun / Estate',
    'Divisi Pembibitan',
    'Metode Pemusnahan',
    'Mode Persetujuan',
    'Tgl Pelaksanaan Fisik',
    'Tgl Pengesahan Resmi (WIB)',
    'Invarian Mutasi Stok'
  ];

  for (const label of expectedLabels) {
    assert(previewHtml.includes(label), `[AC01] Preview memuat label "${label}"`);
    assert(printHtml.includes(label), `[AC01] Print A4 memuat label "${label}"`);
  }

  // AC01: Nilai masing-masing informasi
  assert(previewHtml.includes('Tanah Besih (TB)'), '[AC01] Nilai Kebun / Estate sesuai');
  assert(previewHtml.includes('Divisi I (DIV-I)'), '[AC01] Nilai Divisi Pembibitan sesuai');
  assert(previewHtml.includes('Pencincangan dan Pemendaman'), '[AC01] Nilai Metode Pemusnahan sesuai');
  assert(previewHtml.includes('Persetujuan Bertahap'), '[AC01] Nilai Mode Persetujuan sesuai');
  assert(previewHtml.includes('17/10/2026'), '[AC01] Nilai Tgl Pelaksanaan Fisik sesuai');
  assert(previewHtml.includes('Nol Mutasi (Dipotong saat Seleksi)'), '[AC01] Nilai Invarian Mutasi Stok sesuai');

  // Verify break-inside: avoid on rows
  assert(previewHtml.includes('break-inside: avoid'), '[AC04] Baris tabel memiliki proteksi break-inside: avoid');
  assert(printHtml.includes('break-inside: avoid'), '[AC04] Baris tabel print A4 memiliki proteksi break-inside: avoid');

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,950']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 950 });
    page.on('dialog', async d => await d.accept());

    // -------------------------------------------------------------------------
    // 2. Render & Layout Alignment Verification in Browser (Preview)
    // -------------------------------------------------------------------------
    console.log('\n>>> [2/4] Verifikasi Posisi Horizontal & Text Wrapping pada Preview...');
    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    // Seed mock final document into storage
    await page.evaluate(async (doc) => {
      const { session } = await import('./js/core/session.js');
      session.start({ code: 'ASB001' });
      const { storage } = await import('./js/core/storage.js');
      const existing = storage.get('destruction_transactions', []);
      storage.set('destruction_transactions', [doc, ...existing]);
    }, mockDoc);

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open Print Preview Modal
    const previewBtn = await page.waitForSelector(`.card-bapb-item[data-id="${mockDoc.id}"] .btn-preview-bapb`);
    assert(previewBtn !== null, 'Tombol preview tersedia pada kartu BAPB');
    await previewBtn.click();
    await new Promise(r => setTimeout(r, 600));

    await page.waitForSelector('.modal-bapb-preview-modal .bapb-meta-table');

    // Audit Column Alignment & Table Header Style in Preview
    const previewReport = await page.evaluate(() => {
      const table = document.querySelector('.modal-bapb-preview-modal .bapb-meta-table');
      const rows = Array.from(table.querySelectorAll('tr'));
      
      // Left side: cells 0 (label), 1 (colon), 2 (value) for rows 0..3
      const leftLabels = rows.map(r => r.cells[0].getBoundingClientRect());
      const leftColons = rows.map(r => r.cells[1].getBoundingClientRect());
      const leftValues = rows.map(r => r.cells[2].getBoundingClientRect());

      const leftLabelX = leftLabels[0].left;
      const allLeftLabelsAligned = leftLabels.every(rect => Math.abs(rect.left - leftLabelX) < 1);

      const leftColonX = leftColons[0].left;
      const allLeftColonsAligned = leftColons.every(rect => Math.abs(rect.left - leftColonX) < 1);

      const leftValueX = leftValues[0].left;
      const allLeftValuesAligned = leftValues.every(rect => Math.abs(rect.left - leftValueX) < 1);

      // Right side: cells 3 (label), 4 (colon), 5 (value) for rows 0..2
      const rightRows = rows.slice(0, 3);
      const rightLabels = rightRows.map(r => r.cells[3].getBoundingClientRect());
      const rightColons = rightRows.map(r => r.cells[4].getBoundingClientRect());
      const rightValues = rightRows.map(r => r.cells[5].getBoundingClientRect());

      const rightLabelX = rightLabels[0].left;
      const allRightLabelsAligned = rightLabels.every(rect => Math.abs(rect.left - rightLabelX) < 1);

      const rightColonX = rightColons[0].left;
      const allRightColonsAligned = rightColons.every(rect => Math.abs(rect.left - rightColonX) < 1);

      const rightValueX = rightValues[0].left;
      const allRightValuesAligned = rightValues.every(rect => Math.abs(rect.left - rightValueX) < 1);

      // Check Table Header "Rincian Bibit Karet Yang Dimusnahkan"
      const thEl = document.querySelector('.modal-bapb-preview-modal .bapb-preview-table thead th');
      const thStyle = thEl ? window.getComputedStyle(thEl) : null;
      const thBg = thStyle ? thStyle.backgroundColor : '';
      const thColor = thStyle ? thStyle.color : '';
      const thWeight = thStyle ? thStyle.fontWeight : '';

      return {
        rowCount: rows.length,
        allLeftLabelsAligned,
        allLeftColonsAligned,
        allLeftValuesAligned,
        allRightLabelsAligned,
        allRightColonsAligned,
        allRightValuesAligned,
        leftLabelX,
        leftColonX,
        leftValueX,
        rightLabelX,
        rightColonX,
        rightValueX,
        thBg,
        thColor,
        thWeight,
        tableWidth: table.clientWidth,
        tableScrollWidth: table.scrollWidth,
        hasTableOverflow: table.scrollWidth > table.clientWidth + 2
      };
    });

    assert(previewReport.rowCount === 4, `[AC01] Tabel metadata memuat tepat 4 baris bertingkat 2-kolom (aktual: ${previewReport.rowCount})`);
    assert(previewReport.allLeftLabelsAligned, `[AC02] Label kolom kiri sejajar rapi (X: ${previewReport.leftLabelX}px)`);
    assert(previewReport.allLeftColonsAligned, `[AC02] Titik dua (:) kolom kiri sejajar vertikal (X: ${previewReport.leftColonX}px)`);
    assert(previewReport.allLeftValuesAligned, `[AC02] Nilai kolom kiri sejajar rapi (X: ${previewReport.leftValueX}px)`);
    assert(previewReport.allRightLabelsAligned, `[AC02] Label kolom kanan sejajar rapi (X: ${previewReport.rightLabelX}px)`);
    assert(previewReport.allRightColonsAligned, `[AC02] Titik dua (:) kolom kanan sejajar vertikal (X: ${previewReport.rightColonX}px)`);
    assert(previewReport.allRightValuesAligned, `[AC02] Nilai kolom kanan sejajar rapi (X: ${previewReport.rightValueX}px)`);
    assert(!previewReport.hasTableOverflow, `[AC03] Tabel metadata tidak mengalami overflow horizontal`);

    // Verify Header Color & Text Bold Black
    const isWhiteBg = previewReport.thBg === 'rgb(255, 255, 255)' || previewReport.thBg === '#ffffff';
    assert(isWhiteBg, `[HEADER-AC01] Header tabel rincian berlatar belakang putih (aktual: ${previewReport.thBg})`);
    const isBlackText = previewReport.thColor === 'rgb(0, 0, 0)' || previewReport.thColor === '#000000';
    assert(isBlackText, `[HEADER-AC02] Header tabel rincian berwarna teks hitam (aktual: ${previewReport.thColor})`);
    const isBold = parseInt(previewReport.thWeight, 10) >= 700 || previewReport.thWeight === 'bold';
    assert(isBold, `[HEADER-AC03] Header tabel rincian berbobot tebal / bold (aktual: ${previewReport.thWeight})`);

    // Screenshot Modal Preview
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_layout_preview_clean_2col.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_layout_preview_clean_2col.png tersimpan');

    // -------------------------------------------------------------------------
    // 3. Render & Alignment on Standard A4 Print Sheet
    // -------------------------------------------------------------------------
    console.log('\n>>> [3/4] Verifikasi Posisi Horizontal & Layout pada Lembar A4 Cetak...');
    const a4Page = await browser.newPage();
    await a4Page.setViewport({ width: 1000, height: 1400 });

    const completePrintHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 20px; background: #E2E8F0; }
            .bapb-a4-sheet {
              width: 210mm !important;
              min-height: 297mm !important;
              padding: 16mm 18mm 14mm 18mm !important;
              margin: 0 auto !important;
              background: #FFFFFF !important;
              box-sizing: border-box !important;
            }
          </style>
        </head>
        <body>
          ${printHtml}
        </body>
      </html>
    `;

    await a4Page.setContent(completePrintHtml, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 400));

    const a4Report = await a4Page.evaluate(() => {
      const table = document.querySelector('.bapb-meta-table');
      const rows = Array.from(table.querySelectorAll('tr'));
      
      const leftLabels = rows.map(r => r.cells[0].getBoundingClientRect());
      const leftColons = rows.map(r => r.cells[1].getBoundingClientRect());
      const leftValues = rows.map(r => r.cells[2].getBoundingClientRect());

      const leftLabelX = leftLabels[0].left;
      const allLeftLabelsAligned = leftLabels.every(rect => Math.abs(rect.left - leftLabelX) < 1);

      const leftColonX = leftColons[0].left;
      const allLeftColonsAligned = leftColons.every(rect => Math.abs(rect.left - leftColonX) < 1);

      const leftValueX = leftValues[0].left;
      const allLeftValuesAligned = leftValues.every(rect => Math.abs(rect.left - leftValueX) < 1);

      const rightRows = rows.slice(0, 3);
      const rightLabels = rightRows.map(r => r.cells[3].getBoundingClientRect());
      const rightColons = rightRows.map(r => r.cells[4].getBoundingClientRect());
      const rightValues = rightRows.map(r => r.cells[5].getBoundingClientRect());

      const rightLabelX = rightLabels[0].left;
      const allRightLabelsAligned = rightLabels.every(rect => Math.abs(rect.left - rightLabelX) < 1);

      const rightColonX = rightColons[0].left;
      const allRightColonsAligned = rightColons.every(rect => Math.abs(rect.left - rightColonX) < 1);

      const rightValueX = rightValues[0].left;
      const allRightValuesAligned = rightValues.every(rect => Math.abs(rect.left - rightValueX) < 1);

      const thEl = document.querySelector('.bapb-a4-sheet table thead th');
      const thStyle = thEl ? window.getComputedStyle(thEl) : null;
      const thBg = thStyle ? thStyle.backgroundColor : '';
      const thColor = thStyle ? thStyle.color : '';

      return {
        rowCount: rows.length,
        allLeftLabelsAligned,
        allLeftColonsAligned,
        allLeftValuesAligned,
        allRightLabelsAligned,
        allRightColonsAligned,
        allRightValuesAligned,
        thBg,
        thColor,
        tableWidth: table.clientWidth,
        tableScrollWidth: table.scrollWidth,
        hasTableOverflow: table.scrollWidth > table.clientWidth + 2
      };
    });

    assert(a4Report.rowCount === 4, `[AC04] Cetak A4 memuat tepat 4 baris bertingkat 2-kolom (aktual: ${a4Report.rowCount})`);
    assert(a4Report.allLeftLabelsAligned, `[AC04] Cetak A4: Seluruh label kolom kiri sejajar rapi`);
    assert(a4Report.allLeftColonsAligned, `[AC04] Cetak A4: Titik dua (:) kolom kiri sejajar vertikal`);
    assert(a4Report.allLeftValuesAligned, `[AC04] Cetak A4: Seluruh nilai kolom kiri sejajar rapi`);
    assert(a4Report.allRightLabelsAligned, `[AC04] Cetak A4: Seluruh label kolom kanan sejajar rapi`);
    assert(a4Report.allRightColonsAligned, `[AC04] Cetak A4: Titik dua (:) kolom kanan sejajar vertikal`);
    assert(a4Report.allRightValuesAligned, `[AC04] Cetak A4: Seluruh nilai kolom kanan sejajar rapi`);
    assert(!a4Report.hasTableOverflow, `[AC04] Cetak A4: Tabel metadata tidak mengalami overflow horizontal`);
    assert(a4Report.thBg === 'rgb(255, 255, 255)', `[AC04] Cetak A4: Header tabel rincian berlatar putih`);
    assert(a4Report.thColor === 'rgb(0, 0, 0)', `[AC04] Cetak A4: Header tabel rincian berwarna teks hitam`);

    // Screenshot Lembar A4
    await a4Page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_layout_a4_print_clean_2col.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_layout_a4_print_clean_2col.png tersimpan');
    await a4Page.close();

    // -------------------------------------------------------------------------
    // 4. Test Responsiveness across Mobile Viewports (360px, 390px, 430px)
    // -------------------------------------------------------------------------
    console.log('\n>>> [4/4] Verifikasi Tampilan Mobile Frame HP (360px, 390px, 430px)...');
    const mobileViewports = [
      { width: 360, height: 740, name: '360px' },
      { width: 390, height: 844, name: '390px' },
      { width: 430, height: 932, name: '430px' }
    ];

    for (const mv of mobileViewports) {
      await page.setViewport({ width: mv.width, height: mv.height });
      await new Promise(r => setTimeout(r, 300));

      const mobileReport = await page.evaluate(() => {
        const table = document.querySelector('.modal-bapb-preview-modal .bapb-meta-table');
        const sheet = document.querySelector('.modal-bapb-preview-modal .bapb-sheet-preview');
        const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
        if (!table || !sheet) return { found: false };

        const leftLabels = rows.map(r => r.cells[0].getBoundingClientRect());
        const leftColons = rows.map(r => r.cells[1].getBoundingClientRect());
        const leftValues = rows.map(r => r.cells[2].getBoundingClientRect());
        const leftLabelX = leftLabels[0].left;
        const leftColonX = leftColons[0].left;
        const leftValueX = leftValues[0].left;

        return {
          found: true,
          allLeftLabelsAligned: leftLabels.every(rect => Math.abs(rect.left - leftLabelX) < 1),
          allLeftColonsAligned: leftColons.every(rect => Math.abs(rect.left - leftColonX) < 1),
          allLeftValuesAligned: leftValues.every(rect => Math.abs(rect.left - leftValueX) < 1),
          hasTableOverflow: table.scrollWidth > table.clientWidth + 2,
          hasSheetOverflow: sheet.scrollWidth > sheet.clientWidth + 2
        };
      });

      assert(mobileReport.found, `[AC05 - ${mv.name}] Tabel metadata ditemukan di Frame HP`);
      assert(mobileReport.allLeftLabelsAligned, `[AC05 - ${mv.name}] Label kiri sejajar rapi`);
      assert(mobileReport.allLeftColonsAligned, `[AC05 - ${mv.name}] Titik dua (:) kiri sejajar rapi`);
      assert(mobileReport.allLeftValuesAligned, `[AC05 - ${mv.name}] Nilai kiri sejajar rapi`);
      assert(!mobileReport.hasTableOverflow && !mobileReport.hasSheetOverflow, `[AC05 - ${mv.name}] Tidak ada horizontal overflow`);
    }

    console.log('\n========================================================================');
    console.log(`ALL CHECKS PASSED: ${passCount}/${passCount + failCount} assertions succeeded.`);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n[FATAL ERROR IN TEST]', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

runBapbInfoLayoutTests();
