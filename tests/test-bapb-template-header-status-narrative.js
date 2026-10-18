import puppeteer from 'puppeteer';
import path from 'path';
import { renderBapbPrintHtml } from '../js/modules/destruction/bapb-print-template.js';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/308be8c4-169f-4a71-b7e1-ade86fed7390';

async function runBapbTemplateVerification() {
  console.log('========================================================================');
  console.log('TEST SUITE: PENYESUAIAN HEADER, STATUS & NARASI TEMPLATE BAPB');
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

  let browser = null;

  try {
    // 1. Direct Unit & HTML Render Verification
    console.log('>>> [1/3] Memeriksa Hasil Render renderBapbPrintHtml() (Unit Check)...');
    
    const mockFinalDoc = {
      id: 'BAPB-TEST-001',
      officialDocNo: 'TB/DIV-I/10/2026/01',
      isFinal: true,
      bapbStatus: 'FINAL',
      estateName: 'Kebun Tanah Besih',
      estateCode: 'TB',
      divisionName: 'Divisi I',
      divisionCode: 'DIV-I',
      tanggalPelaksanaan: '2026-10-18',
      publishedAt: '2026-10-18T10:00:00Z',
      items: [{
        sourceSelectionNo: 'SEL/2026/001',
        bedengan: 'BED-04',
        klon: 'GT 1',
        stage: 'Seleksi 1',
        quantity: 45,
        reason: 'Afkir'
      }],
      photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
      signatures: {
        asb: { name: 'Annisa', signatureDataUrl: 'data:image/png;base64,abc' },
        askep: { name: 'R. Siregar', signatureDataUrl: 'data:image/png;base64,def' },
        pengurus: { name: 'Ir. M. Ridwan', signatureDataUrl: 'data:image/png;base64,ghi' }
      }
    };

    const mockDraftDoc = {
      ...mockFinalDoc,
      id: 'BAPB-TEST-DRAFT',
      isFinal: false,
      bapbStatus: 'DRAFT_AWAITING_ASKEP',
      officialDocNo: null,
      draftDocNo: 'DRAFT-BAPB-001'
    };

    const screenHtml = renderBapbPrintHtml(mockFinalDoc, { isScreenPreview: true });
    const printHtml = renderBapbPrintHtml(mockFinalDoc, { isScreenPreview: false });
    const draftScreenHtml = renderBapbPrintHtml(mockDraftDoc, { isScreenPreview: true });

    const unitResult = { screenHtml, printHtml, draftScreenHtml };

    // AC01: Header teks lama dilarang muncul
    const forbiddenTexts = [
      'PERKEBUNAN KARET & PEMBIBITAN SIGMA',
      'Kebun: Tanah Besih (TB) • Divisi I (DIV-I)',
      'KOMODITI KARET (HEVEA BRASILIENSIS)'
    ];

    for (const text of forbiddenTexts) {
      assert(!unitResult.screenHtml.includes(text), `[AC01] Preview tidak memuat teks terlarang: "${text}"`);
      assert(!unitResult.printHtml.includes(text), `[AC01] Print A4 tidak memuat teks terlarang: "${text}"`);
    }

    // AC02: Status Telah Disetujui vs DRAF PERSETUJUAN
    assert(unitResult.screenHtml.includes('STATUS: Telah Disetujui'), '[AC02] Preview dokumen FINAL menampilkan "STATUS: Telah Disetujui"');
    assert(unitResult.printHtml.includes('STATUS: Telah Disetujui'), '[AC02] Print A4 dokumen FINAL menampilkan "STATUS: Telah Disetujui"');
    assert(!unitResult.screenHtml.includes('STATUS: FINAL (DISAHKAN)'), '[AC02] Label lama "STATUS: FINAL (DISAHKAN)" tidak muncul di preview');
    assert(!unitResult.printHtml.includes('STATUS: FINAL (DISAHKAN)'), '[AC02] Label lama "STATUS: FINAL (DISAHKAN)" tidak muncul di cetak A4');
    assert(unitResult.draftScreenHtml.includes('STATUS: DRAF PERSETUJUAN'), '[AC02] Dokumen draf tetap menampilkan "STATUS: DRAF PERSETUJUAN"');

    // AC03: Susunan Judul Dokumen
    const expectedTitle1 = 'BERITA ACARA';
    const expectedTitle2 = 'PEMUSNAHAN BIBIT KARET';
    const expectedLocation = 'KEBUN: Tanah Besih - Divisi I';
    const expectedDocNo = 'TB/DIV-I/10/2026/01';

    assert(unitResult.screenHtml.includes(expectedTitle1), `[AC03] Preview memuat "${expectedTitle1}"`);
    assert(unitResult.screenHtml.includes(expectedTitle2), `[AC03] Preview memuat "${expectedTitle2}"`);
    assert(unitResult.screenHtml.includes(expectedLocation), `[AC03] Preview memuat "${expectedLocation}"`);
    assert(unitResult.screenHtml.includes(expectedDocNo), `[AC03] Preview memuat nomor resmi "${expectedDocNo}"`);

    // Verify ordering in HTML
    const idxT1 = unitResult.printHtml.indexOf(expectedTitle1);
    const idxT2 = unitResult.printHtml.indexOf(expectedTitle2);
    const idxLoc = unitResult.printHtml.indexOf(expectedLocation);
    const idxNo = unitResult.printHtml.indexOf(expectedDocNo);

    assert(idxT1 < idxT2, '[AC03] BERITA ACARA berada sebelum PEMUSNAHAN BIBIT KARET');
    assert(idxT2 < idxLoc, '[AC03] PEMUSNAHAN BIBIT KARET berada sebelum KEBUN: Tanah Besih - Divisi I');
    assert(idxLoc < idxNo, '[AC03] KEBUN: Tanah Besih - Divisi I berada tepat sebelum nomor dokumen');

    // AC05: Narasi exact match
    const exactNarration = 'Pada hari ini Sabtu telah dilaksanakan kegiatan pemusnahan fisik bibit untuk pembibitan karet yang telah melalui proses seleksi resmi dan dinyatakan tidak layak untuk dipelihara maupun ditanam di lapangan. Berita acara ini dibuat dan disahkan oleh pejabat berwenang sebagai dokumen pertanggungjawaban resmi.';
    assert(unitResult.screenHtml.includes(exactNarration), '[AC05] Narasi preview cocok 100% tanpa perubahan kata');
    assert(unitResult.printHtml.includes(exactNarration), '[AC05] Narasi print A4 cocok 100% tanpa perubahan kata');

    // FOOTER TASK: Verifikasi Footer Baru & Penghapusan Footer Lama
    const oldFooterText = 'Dokumen sah digital tanpa tanda tangan basah tambahan';
    assert(!unitResult.screenHtml.includes(oldFooterText), '[FOOTER-AC01] Footer lama tidak muncul di preview');
    assert(!unitResult.printHtml.includes(oldFooterText), '[FOOTER-AC01] Footer lama tidak muncul di cetak A4');

    const expectedFooterTexts = [
      'PT Socfin Indonesia',
      'Jl. K.L. Yos Sudarso No. 106, Glugur Kota, Kec. Medan Barat, Kota Medan, Sumatera Utara 20115',
      'Telp: +62-61-6610088 | Fax: +62-61-6610099',
      'tanahbesih@socfindo.co.id',
      'https://www.socfindo.co.id'
    ];

    for (const item of expectedFooterTexts) {
      assert(unitResult.screenHtml.includes(item), `[FOOTER-AC02] Preview memuat footer: "${item.slice(0, 35)}..."`);
      assert(unitResult.printHtml.includes(item), `[FOOTER-AC02] Print A4 memuat footer: "${item.slice(0, 35)}..."`);
    }

    assert(!unitResult.screenHtml.includes('Kantor Kebun: PT. Socfin Indonesia - Tanah Besih'), '[FOOTER-AC03] Teks Kantor Kebun telah dihilangkan dari preview');
    assert(!unitResult.printHtml.includes('Kantor Kebun: PT. Socfin Indonesia - Tanah Besih'), '[FOOTER-AC03] Teks Kantor Kebun telah dihilangkan dari cetak A4');

    assert(unitResult.screenHtml.includes('href="mailto:tanahbesih@socfindo.co.id"'), '[FOOTER-AC02] Email memiliki link mailto yang dapat diklik');
    assert(unitResult.screenHtml.includes('href="https://www.socfindo.co.id"'), '[FOOTER-AC02] Website memiliki link url yang dapat diklik');

    // 2. Full Browser & E2E Verification
    console.log('\n>>> [2/3] Membuka Halaman BAPB & Memverifikasi Modal Preview...');
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,950']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('dialog', async d => await d.accept());

    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      const { session } = await import('./js/core/session.js');
      const { storage } = await import('./js/core/storage.js');
      session.start({ code: 'ASB001' });

      const testDoc = {
        id: 'BAPB-TEST-FINAL-' + Date.now(),
        docNo: 'TB/DIV-I/10/2026/01',
        officialDocNo: 'TB/DIV-I/10/2026/01',
        status: 'FINAL',
        bapbStatus: 'FINAL',
        isFinal: true,
        estateId: 'EST-TBS',
        estateName: 'Kebun Tanah Besih',
        estateCode: 'TB',
        divisionId: 'DIV-001',
        divisionName: 'Divisi I',
        divisionCode: 'DIV-I',
        approvalMode: 'DIRECT_ON_SITE',
        tanggalPelaksanaan: '2026-10-18',
        publishedAt: '2026-10-18T10:00:00Z',
        items: [{
          sourceSelectionNo: 'SEL/TB/DIV-I/10/2026/0134',
          bedengan: 'BED-04',
          batchCode: 'TB-RRIM600-202601',
          klon: 'GT 1',
          stage: 'Seleksi 1',
          quantity: 45,
          reason: 'Bibit Kerdil dan Kering'
        }],
        photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
        signatures: {
          asb: { name: 'Annisa', role: 'Asisten Divisi Bibitan', signatureDataUrl: 'data:image/png;base64,abc' },
          askep: { name: 'R. Siregar', role: 'Asisten Kepala', signatureDataUrl: 'data:image/png;base64,def' },
          pengurus: { name: 'Ir. M. Ridwan', role: 'Pengurus', signatureDataUrl: 'data:image/png;base64,ghi' }
        }
      };

      const existing = storage.get('destruction_transactions', []);
      storage.set('destruction_transactions', [testDoc, ...existing]);
    });

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open Preview of latest document
    const previewBtn = await page.waitForSelector('.btn-preview-bapb');
    await previewBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // Check DOM contents inside modal
    const modalContent = await page.$eval('.modal-bapb-preview-modal', el => el.innerText);

    // AC01 DOM verification
    for (const text of forbiddenTexts) {
      assert(!modalContent.includes(text), `[AC01 - DOM] Modal preview tidak menampilkan teks: "${text}"`);
    }

    // AC02 DOM verification
    assert(modalContent.includes('STATUS: Telah Disetujui'), '[AC02 - DOM] Modal preview menampilkan "STATUS: Telah Disetujui"');

    // AC03 DOM verification
    assert(modalContent.includes('BERITA ACARA'), '[AC03 - DOM] Modal preview memuat judul tingkat pertama "BERITA ACARA"');
    assert(modalContent.includes('PEMUSNAHAN BIBIT KARET'), '[AC03 - DOM] Modal preview memuat judul utama "PEMUSNAHAN BIBIT KARET"');
    assert(modalContent.includes('KEBUN: Tanah Besih - Divisi I'), '[AC03 - DOM] Modal preview memuat "KEBUN: Tanah Besih - Divisi I"');

    // AC04: Official Doc No
    assert(modalContent.includes('TB/DIV-I/10/2026/01') || modalContent.includes('TB/DIV-I/'), '[AC04 - DOM] Nomor resmi BAPB aktual ditampilkan');

    // AC05 DOM verification
    assert(modalContent.includes(exactNarration), '[AC05 - DOM] Paragraf narasi baru tampil utuh di layar HP');

    // AC07 DOM verification: Signatures & Photos
    assert(modalContent.includes('Asisten Divisi Bibitan') && modalContent.includes('Asisten Kepala') && modalContent.includes('Pengurus'), '[AC07 - DOM] Ketiga pejabat penandatangan tetap tampil');
    // FOOTER TASK DOM verification
    assert(!modalContent.includes('Dokumen sah digital tanpa tanda tangan basah tambahan'), '[FOOTER-AC01 - DOM] Footer lama tidak tampil di preview DOM');
    assert(modalContent.includes('PT Socfin Indonesia'), '[FOOTER-AC02 - DOM] Footer memuat "PT Socfin Indonesia"');
    assert(modalContent.includes('Jl. K.L. Yos Sudarso No. 106'), '[FOOTER-AC02 - DOM] Footer memuat alamat kantor');
    assert(modalContent.includes('+62-61-6610088'), '[FOOTER-AC02 - DOM] Footer memuat nomor telepon');
    assert(modalContent.includes('tanahbesih@socfindo.co.id'), '[FOOTER-AC02 - DOM] Footer memuat email');
    assert(modalContent.includes('https://www.socfindo.co.id'), '[FOOTER-AC02 - DOM] Footer memuat website');
    assert(!modalContent.includes('Kantor Kebun: PT. Socfin Indonesia - Tanah Besih'), '[FOOTER-AC03 - DOM] Teks kantor kebun telah dihilangkan dari preview DOM');

    // Take screenshot of updated preview (Top)
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_template_updated_preview.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_template_updated_preview.png tersimpan');

    // Scroll to footer and take screenshot of company footer
    await page.evaluate(() => {
      const footerEl = document.querySelector('.bapb-document-footer');
      if (footerEl) footerEl.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await new Promise(r => setTimeout(r, 300));

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'bapb_template_footer_scrolled.png'),
      fullPage: false
    });
    console.log('  [OK] Screenshot bapb_template_footer_scrolled.png tersimpan');

    // 3. Close preview & verify page health
    console.log('\n>>> [3/3] Menutup Preview dan Memastikan Halaman Tetap Sehat...');
    const closeBtn = await page.waitForSelector('#btn-close-print-preview');
    await closeBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const isClosed = await page.$('.modal-bapb-preview-modal') === null;
    assert(isClosed, 'Modal preview berhasil ditutup via tombol Kembali');

    console.log('\n========================================================================');
    console.log(`🎉 SELURUH PENGUJIAN TEMPLATE BAPB LULUS!`);
    console.log(`   Total Checks: ${passCount + failCount} | Passed: ${passCount} | Failed: ${failCount}`);
    console.log('========================================================================\n');

    await browser.close();
  } catch (err) {
    console.error('❌ PENGUJIAN GAGAL DENGAN KESALAHAN:', err);
    await browser.close();
    process.exit(1);
  }
}

runBapbTemplateVerification();
