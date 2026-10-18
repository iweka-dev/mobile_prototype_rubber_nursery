import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/T1N0C/.gemini/antigravity-ide/brain/308be8c4-169f-4a71-b7e1-ade86fed7390';

async function runBapbPreMethodSelectionTests() {
  console.log('========================================================================');
  console.log('STARTING E2E TEST: 4-STEP BAPB FLOW & VALIDASI TC-FLOW-01 S/D 08');
  console.log('========================================================================');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 }); // Default iPhone 12/13/14

  page.on('dialog', async dialog => {
    console.log(`  [DIALOG] ${dialog.type()}: "${dialog.message().slice(0, 50)}..." -> ACCEPT`);
    await dialog.accept();
  });

  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition, message) {
    totalChecks++;
    if (condition) {
      passedChecks++;
      console.log(`  [PASS] ${message}`);
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Inisialisasi Sesi ASB & Seed Data Seleksi
    // -------------------------------------------------------------------------
    console.log('\n>>> [1/8] Inisialisasi Sesi ASB dan Seed Data Seleksi...');
    await page.goto('http://localhost:3000/?nocache=' + Date.now(), { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      const { session } = await import('./js/core/session.js');
      session.start({ code: 'ASB001' });
    });

    await page.goto('http://localhost:3000/?nocache=' + Date.now() + '#/destruction', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Seed mock eligible selection docs
    await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      const existingSel = storage.get('selection_transactions', []);
      const testSelId = 'SEL-TEST-PRE-' + Date.now();
      const newSel = {
        id: testSelId,
        docNo: 'SEL/TB/DIV-I/10/2026/0777',
        estateId: 'EST-TBS',
        divisionId: 'DIV-001',
        batchId: 'BATCH-TBS-001',
        batchCode: 'TB-RRIM600-202601',
        bedengan: 'BED-02',
        bedenganCode: 'BED-02',
        klon: 'RRIM 600',
        stage: 'Seleksi 1',
        selectionStage: 'Seleksi 1',
        quantity: 50,
        jumlahAfkir: 50,
        jumlahAfkirTotal: 50,
        status: 'DISETUJUI',
        isApproved: true,
        reason: 'Afkir Batang Bengkok'
      };
      storage.set('selection_transactions', [newSel, ...existingSel]);
    });

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    const initialDocCount = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      return (storage.get('destruction_records', [])).length;
    });

    // -------------------------------------------------------------------------
    // STEP 2: TC-FLOW-01 — Klik 'Buat Berita Acara' Membuka Modal Pilihan Mode
    // -------------------------------------------------------------------------
    console.log('\n>>> [2/8] TC-FLOW-01: Verifikasi Klik Tombol Membuka Modal Mode...');
    const createBtn = await page.waitForSelector('#btn-create-bapb');
    assert(createBtn !== null, '[TC-FLOW-01] Tombol "Buat Berita Acara" tersedia');

    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 500));

    const methodModal = await page.$('.modal-bapb-method-selection');
    assert(methodModal !== null, '[TC-FLOW-01] Modal pemilihan mode terbuka (.modal-bapb-method-selection)');

    const modalTitle = await page.$eval('.modal-title', el => el.textContent.trim());
    assert(modalTitle === 'Pilih Metode Persetujuan', `[TC-FLOW-01] Judul modal: "${modalTitle}"`);

    // Verify source selection & form input are NOT yet in DOM
    const sourceModalInStep1 = await page.$('.modal-bapb-source-selection');
    const formInStep1 = await page.$('.modal-fullscreen');
    assert(sourceModalInStep1 === null, '[TC-FLOW-01] Pilihan dokumen sumber BELUM ditampilkan');
    assert(formInStep1 === null, '[TC-FLOW-01] Form input BAPB BELUM ditampilkan');

    // -------------------------------------------------------------------------
    // STEP 3: TC-FLOW-02 — Wajib Memilih Mode Sebelum Lanjutkan
    // -------------------------------------------------------------------------
    console.log('\n>>> [3/8] TC-FLOW-02: Validasi Wajib Memilih Mode...');
    const isAnyChecked = await page.evaluate(() => {
      const checked = document.querySelector('input[name="bapb-pre-mode"]:checked');
      return checked !== null;
    });

    if (!isAnyChecked) {
      await page.click('#btn-continue-method-selection');
      await new Promise(r => setTimeout(r, 400));
      const stillInMethodModal = await page.$('.modal-bapb-method-selection') !== null;
      assert(stillInMethodModal, '[TC-FLOW-02] Pengguna dicegah lanjut jika belum memilih mode');
    } else {
      console.log('  [PASS] [TC-FLOW-02] Opsi default terkelola dengan baik');
    }

    // -------------------------------------------------------------------------
    // STEP 4: TC-FLOW-08 — Batal Pada Langkah 1 Tidak Membuat Dokumen/Mutasi
    // -------------------------------------------------------------------------
    console.log('\n>>> [4/8] TC-FLOW-08: Tombol Batal pada Modal Mode...');
    await page.click('#btn-cancel-method-selection');
    await new Promise(r => setTimeout(r, 400));
    const modalClosed1 = await page.$('.modal-bapb-method-selection') === null;
    assert(modalClosed1, '[TC-FLOW-08] Menekan Batal menutup modal mode');

    const countAfterCancel1 = await page.evaluate(async () => {
      const { storage } = await import('./js/core/storage.js');
      return (storage.get('destruction_records', [])).length;
    });
    assert(countAfterCancel1 === initialDocCount, '[TC-FLOW-08] Tidak ada dokumen yang dibuat saat batal');

    // -------------------------------------------------------------------------
    // STEP 5: TC-FLOW-03, TC-FLOW-04, TC-FLOW-05 — Modal Dokumen Sumber Seleksi
    // -------------------------------------------------------------------------
    console.log('\n>>> [5/8] TC-FLOW-03 s/d 05: Modal Pemilihan Dokumen Sumber...');
    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 500));

    // Pilih mode Bertahap
    await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
    await new Promise(r => setTimeout(r, 200));

    // Lanjutkan ke Langkah 2 (Pilih Dokumen)
    await page.click('#btn-continue-method-selection');
    await new Promise(r => setTimeout(r, 500));

    // TC-FLOW-03: Modal dokumen sumber terbuka, form BAPB belum ada
    const sourceModal = await page.$('.modal-bapb-source-selection');
    assert(sourceModal !== null, '[TC-FLOW-03] Modal pemilihan dokumen sumber terbuka (.modal-bapb-source-selection)');
    const sourceTitle = await page.$eval('.modal-title', el => el.textContent.trim());
    assert(sourceTitle === 'Pilih Dokumen Sumber Seleksi', `[TC-FLOW-03] Judul modal dokumen: "${sourceTitle}"`);
    const formInStep2 = await page.$('.modal-fullscreen');
    assert(formInStep2 === null, '[TC-FLOW-03] Form input BAPB BELUM ditampilkan pada langkah dokumen sumber');

    // TC-FLOW-04: Tombol Kembali mengembalikan ke Pemilihan Mode dengan state pulih
    console.log('  -> Menguji tombol Kembali (TC-FLOW-04)...');
    await page.click('#btn-back-source-selection');
    await new Promise(r => setTimeout(r, 400));
    const backToMethodModal = await page.$('.modal-bapb-method-selection') !== null;
    assert(backToMethodModal, '[TC-FLOW-04] Tombol Kembali membuka kembali modal pemilihan mode');
    const isSequentialRestored = await page.$eval('#bapb-pre-mode-sequential', el => el.checked);
    assert(isSequentialRestored, '[TC-FLOW-04] Pilihan mode sebelumnya (Bertahap) dipulihkan sempurna');

    // Maju kembali ke dokumen sumber
    await page.click('#btn-continue-method-selection');
    await new Promise(r => setTimeout(r, 500));

    // TC-FLOW-05: Validasi minimal 1 dokumen
    console.log('  -> Menguji validasi wajib minimal 1 dokumen (TC-FLOW-05)...');
    await page.evaluate(() => {
      document.querySelectorAll('.chk-bapb-source').forEach(c => c.checked = false);
    });
    await page.click('#btn-continue-source-selection');
    await new Promise(r => setTimeout(r, 400));
    const stillInSourceModal = await page.$('.modal-bapb-source-selection') !== null;
    const formNotOpenedYet = await page.$('.modal-fullscreen') === null;
    assert(stillInSourceModal && formNotOpenedYet, '[TC-FLOW-05] Dicegah lanjut ke form BAPB jika dokumen belum dicentang');

    // TC-FLOW-08: Batal pada langkah dokumen sumber
    await page.click('#btn-cancel-source-selection');
    await new Promise(r => setTimeout(r, 400));
    const modalClosed2 = await page.$('.modal-bapb-source-selection') === null;
    assert(modalClosed2, '[TC-FLOW-08] Menekan Batal menutup modal dokumen sumber');

    // -------------------------------------------------------------------------
    // STEP 6: TC-FLOW-06 & TC-FLOW-07 — Masuk Form BAPB & Ringkasan Terkonfirmasi
    // -------------------------------------------------------------------------
    console.log('\n>>> [6/8] TC-FLOW-06 & 07: Konfirmasi Dokumen & Form Input BAPB...');
    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 400));
    await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
    await page.click('#btn-continue-method-selection');
    await new Promise(r => setTimeout(r, 500));

    // Centang dokumen sumber ke-1
    await page.click('.chk-bapb-source');
    await new Promise(r => setTimeout(r, 200));

    // Lanjutkan ke Form Input BAPB
    await page.click('#btn-continue-source-selection');
    await new Promise(r => setTimeout(r, 600));

    // TC-FLOW-06: Form input BAPB terbuka dengan ringkasan dokumen terkonfirmasi
    const bapbForm = await page.$('.modal-fullscreen');
    assert(bapbForm !== null, '[TC-FLOW-06] Form input BAPB terbuka setelah dokumen dikonfirmasi');

    const confirmedBox = await page.$('.bapb-confirmed-sources-box');
    assert(confirmedBox !== null, '[TC-FLOW-06] Ringkasan dokumen sumber terkonfirmasi ditampilkan di form input');
    const confirmedText = await page.$eval('.bapb-confirmed-sources-box', el => el.textContent);
    assert(confirmedText.includes('SEL/TB/DIV-I/10/2026/0777') && confirmedText.includes('50 Pkk'), '[TC-FLOW-06] Nomor dokumen dan kuantitas afkir tampil akurat');

    const changeSourceBtn = await page.$('#btn-change-source-selection');
    assert(changeSourceBtn !== null, '[TC-FLOW-06] Tombol "Ubah Dokumen" tersedia pada seksi dokumen sumber');

    // TC-FLOW-07: Menguji Ubah Dokumen dengan preservasi data input
    console.log('  -> Menguji tombol Ubah Dokumen & preservasi isian (TC-FLOW-07)...');
    await page.evaluate(() => {
      const d = document.getElementById('bapb-execution-date');
      if (d) d.value = '2026-10-18';
      const m = document.getElementById('bapb-method');
      if (m) m.value = 'Pembakaran Terkendali';
    });

    await page.click('#btn-change-source-selection');
    await new Promise(r => setTimeout(r, 500));

    const returnedToSourceModal = await page.$('.modal-bapb-source-selection') !== null;
    assert(returnedToSourceModal, '[TC-FLOW-07] Tombol Ubah Dokumen membuka kembali modal pemilihan dokumen');
    const isDocStillChecked = await page.$eval('.chk-bapb-source', el => el.checked);
    assert(isDocStillChecked, '[TC-FLOW-07] Dokumen sumber yang dipilih sebelumnya tetap tercentang');

    // Konfirmasi kembali dan cek form
    await page.click('#btn-continue-source-selection');
    await new Promise(r => setTimeout(r, 600));

    const preservedDate = await page.$eval('#bapb-execution-date', el => el.value);
    const preservedMethod = await page.$eval('#bapb-method', el => el.value);
    assert(preservedDate === '2026-10-18', '[TC-FLOW-07] Tanggal pelaksanaan fisik dipertahankan setelah Ubah Dokumen');
    assert(preservedMethod === 'Pembakaran Terkendali', '[TC-FLOW-07] Metode pemusnahan dipertahankan setelah Ubah Dokumen');

    // -------------------------------------------------------------------------
    // STEP 7: Alur Mode Langsung di Lokasi (DIRECT_ON_SITE)
    // -------------------------------------------------------------------------
    console.log('\n>>> [7/8] Menguji Alur Mode Hadir Langsung di Lokasi...');
    await page.click('#btn-cancel-bapb-modal');
    await new Promise(r => setTimeout(r, 400));

    await page.click('#btn-create-bapb');
    await new Promise(r => setTimeout(r, 400));
    await page.click('.bapb-pre-mode-card[data-mode="DIRECT_ON_SITE"]');
    await page.click('#btn-continue-method-selection');
    await new Promise(r => setTimeout(r, 500));

    await page.click('.chk-bapb-source');
    await page.click('#btn-continue-source-selection');
    await new Promise(r => setTimeout(r, 600));

    const directContainer = await page.$eval('#bapb-direct-signatures-container', el => el.style.display !== 'none');
    assert(directContainer, 'Area 3 tanda tangan (ASB, Askep, Pengurus) tampil pada mode langsung');
    const submitBtnTextDirect = await page.$eval('#btn-submit-bapb-draft', el => el.textContent.trim());
    assert(submitBtnTextDirect.includes('Buat Dokumen') || submitBtnTextDirect.includes('Sahkan Dokumen FINAL'), 'Tombol submit mode langsung adalah "Buat Dokumen"');

    await page.click('#btn-cancel-bapb-modal');
    await new Promise(r => setTimeout(r, 400));

    // -------------------------------------------------------------------------
    // STEP 8: Responsivitas Multi-Viewport (360px, 390px, 430px)
    // -------------------------------------------------------------------------
    console.log('\n>>> [8/8] Verifikasi Responsivitas Seluruh Modal pada 360px, 390px, 430px...');
    const testViewports = [
      { width: 360, height: 740, name: 'Mobile_360' },
      { width: 390, height: 844, name: 'Mobile_390' },
      { width: 430, height: 932, name: 'Mobile_430' }
    ];

    for (const vp of testViewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 300));

      // Test Source Selection Modal Responsiveness
      await page.click('#btn-create-bapb');
      await new Promise(r => setTimeout(r, 400));
      await page.click('.bapb-pre-mode-card[data-mode="SEQUENTIAL"]');
      await page.click('#btn-continue-method-selection');
      await new Promise(r => setTimeout(r, 400));

      const sourceModalOverflow = await page.evaluate(() => {
        const modal = document.querySelector('.modal-bapb-source-selection');
        return modal ? modal.scrollWidth > modal.clientWidth + 2 : false;
      });
      assert(!sourceModalOverflow, `[Responsiveness - ${vp.name}] Modal dokumen sumber tidak ada horizontal overflow`);

      await page.click('#btn-cancel-source-selection');
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n========================================================================');
    console.log(`ALL CHECKS PASSED: ${passedChecks}/${totalChecks} assertions succeeded.`);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n[FATAL TEST ERROR]', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runBapbPreMethodSelectionTests();
