/**
 * js/modules/review/flow-process-data.js
 * Master Dataset Alur Proses Aktual SIGMA Nursery (Gawai Rubber Nursery)
 * 
 * SUMBER KEBENARAN TUNGGAL (SINGLE SOURCE OF TRUTH):
 * Berdasarkan audit source code aktual dan verifikasi perilaku runtime prototype.
 * Seluruh diagram menggunakan format Mermaid Flowchart TD yang valid.
 */

// =============================================================================
// 1. SIKLUS UTAMA (LINTAS MODUL & AKHIR-KE-AKHIR)
// =============================================================================

export const MAIN_FLOW = {
  id: 'main-cycle',
  title: 'Siklus Utama Budidaya, Logistik & Tata Kelola Pembibitan Karet',
  subtitle: 'Pemetaan Lintas Modul: Pengadaan, Persemaian, Okulasi, Distribusi & Audit Harian',
  category: 'Siklus Utama',
  route: '/home',
  rolesInvolved: ['Mantri Bibitan', 'Asisten Bibitan', 'Asisten Divisi', 'Askep', 'Pengurus'],
  verificationStatus: 'TERVERIFIKASI RUNTIME',
  objective: 'Menggambarkan alur komprehensif pembibitan karet dari penerimaan benih awal hingga bibit siap salur ke kebun, lengkap dengan seleksi bertahap, sanitasi afkir (BAPB), dan penguncian harian (EOD).',
  
  mermaidSyntax: `flowchart TD
    subgraph MANTRI["Mantri Bibitan (Lapangan)"]
        A([Mulai]) --> B[Buka SIGMA Nursery & Login]
        B --> C[Lakukan Presensi Pagi di /attendance]
        C --> D[Buka Gate Transaksi Harian]
        D --> E[Penerimaan Benih SIR di /reception/benih]
        E --> F[Penaburan di Bedengan Dederan Pasir]
        F --> G[Pindah Semai Kecambah ke Polibag]
        G --> H[Seleksi I & II Batang Bawah di /selection]
        H --> I{Lolos Seleksi III Batang Bawah?}
        I -- Tidak --> J[Deklarasi Afkir Pra-Okulasi]
        I -- Ya --> K[Panen Kayu Entres & Lakukan Okulasi]
        K --> L[Masa Tunggu Ikatan 21 Hari]
    end

    subgraph ASB["Asisten Bibitan (ASB / Kasie)"]
        L --> M{Pemeriksaan Okulasi Hari-21 & 42?}
        M -- Gagal --> N[Catat ke Regrafting Pool]
        M -- Berhasil --> O[Masuk Kategori Bibit Okulasi Jadi]
        O --> P[Seleksi Siap Salur Payung 1-2]
        P --> Q[Penerbitan Surat Jalan Pengeluaran Bibit]
        J --> R[Inisiasi Dokumen BAPB Bibit Afkir]
    end

    subgraph ASKEP_MGR["Askep & Pengurus Kebun"]
        R --> S{Dual-Approval Dokumen BAPB?}
        S -- Disetujui --> T[Pengesahan BAPB Final Zero-Mutation]
        S -- Revisi --> R
    end

    subgraph CLOSING["Penutupan Harian (EOD)"]
        Q --> U[Mantri Kirim Konfirmasi Harian di /mantri-confirmation]
        T --> U
        N --> K
        U --> V{Verifikasi Harian oleh ASB di /verification?}
        V -- Disetujui --> W[Kunci Permanen & Push Data ke ERP]
        V -- Dikembalikan --> X[Buka Kunci untuk Koreksi Mantri]
        X --> U
        W --> Y([Selesai])
    end`,

  operationalWorkflow: [
    { step: 1, action: 'Presensi Pagi Mandor / Mantri', actor: 'Mantri Bibitan', desc: 'Melakukan presensi selfie + GPS untuk membuka kunci akses pembuatan transaksi.', branch: 'Gate Terbuka jika Status = HADIR', status: 'TERVERIFIKASI', route: '/attendance' },
    { step: 2, action: 'Penerimaan Benih Kelatak SIR', actor: 'Mantri Bibitan', desc: 'Mencatat nomor SIR, sortir fisik, upload foto sampel, dan penerbitan Batch RCV.', branch: 'Klon diizinkan: GT1, RRIC 100, PB 330, Mix', status: 'TERVERIFIKASI', route: '/reception/benih' },
    { step: 3, action: 'Penyemaian Dederan Pasir', actor: 'Mantri Bibitan', desc: 'Menabur benih kelatak di bedengan pasir basah mengacu pada Dokumen Induk RCV.', branch: 'Kapasitas maksimal bedengan pasir divalidasi', status: 'TERVERIFIKASI', route: '/seeding' },
    { step: 4, action: 'Inspeksi Stadium Jarum Dederan', actor: 'Asisten Bibitan', desc: 'Memeriksa daya kecambah dan kesehatan bibit jarum sebelum dipindahkan.', branch: 'Lolos QC -> Lanjut Pindah Semai; Gagal -> Masuk Afkir', status: 'TERVERIFIKASI', route: '/inspection' },
    { step: 5, action: 'Pindah Semai ke Polibag', actor: 'Mantri Bibitan', desc: 'Memindahkan kecambah jarum yang lolos QC ke media polibag semai.', branch: 'Mengonsumsi sisa kecambah hasil inspeksi dederan', status: 'TERVERIFIKASI', route: '/seeding' },
    { step: 6, action: 'Seleksi I, II, & III Batang Bawah', actor: 'Mantri Bibitan', desc: 'Sortir berkala diameter dan keseragaman batang bawah. Afkir langsung memotong stok fisik.', branch: 'Wajib lolos Seleksi III FINAL agar dapat diokulasi', status: 'TERVERIFIKASI', route: '/selection' },
    { step: 7, action: 'Pemanenan Kayu Entres', actor: 'Mantri Bibitan', desc: 'Memanen mata entres klon murni dari Kebun Entres terpelihara.', branch: 'Mencatat nomor blok, klon, dan jumlah mata', status: 'TERVERIFIKASI', route: '/entres' },
    { step: 8, action: 'Okulasi Batang Bawah', actor: 'Mantri Bibitan', desc: 'Menempelkan mata entres terpilih ke bibit batang bawah hasil Seleksi III.', branch: 'Mencatat nama okulator dan nomor bedengan', status: 'TERVERIFIKASI', route: '/budding' },
    { step: 9, action: 'Pemeriksaan Buka Ikatan & Tunas', actor: 'Asisten Bibitan', desc: 'Buka ikatan hari ke-21 dan pemeriksaan tunas hari ke-42.', branch: 'Berhasil -> Bibit Jadi; Gagal -> Masuk Pool Okulasi Janda', status: 'TERVERIFIKASI', route: '/inspection' },
    { step: 10, action: 'Okulasi Janda (Regrafting)', actor: 'Mantri Bibitan', desc: 'Mengokulasi ulang batang bawah yang gagal pada sisi berlawanan.', branch: 'Mengonsumsi kuantitas dari regrafting pool', status: 'TERVERIFIKASI', route: '/budding' },
    { step: 11, action: 'Seleksi Bibit Siap Salur', actor: 'Mantri Bibitan', desc: 'Klasifikasi bibit siap kirim (minimal payung 1-2 sempurna).', branch: 'Bibit lolos masuk saldo siap salur', status: 'TERVERIFIKASI', route: '/selection' },
    { step: 12, action: 'Pengeluaran Bibit & Surat Jalan', actor: 'Asisten Bibitan', desc: 'Verifikasi Surat Permintaan Bibit (SPB), cetak Surat Jalan, dan muat ke truk.', branch: 'Memotong stok bibit siap salur di gudang', status: 'TERVERIFIKASI', route: '/dispatch' },
    { step: 13, action: 'Pemusnahan Bibit Afkir (BAPB)', actor: 'Asisten Bibitan, Askep, Pengurus', desc: 'Penerbitan BAPB digital berjenjang dengan Zero-Mutation stok fisik.', branch: 'Wajib 2 foto kamera & 3 TTD digital', status: 'TERVERIFIKASI', route: '/destruction' },
    { step: 14, action: 'Konfirmasi Rekap Harian (EOD)', actor: 'Mantri Bibitan', desc: 'Mengirimkan rekapitulasi harian transaksi; transaksi otomatis terkunci di HP.', branch: 'Kunci aktif mencegah mutasi tak terotorisasi', status: 'TERVERIFIKASI', route: '/mantri-confirmation' },
    { step: 15, action: 'Verifikasi Asisten & Kirim ERP', actor: 'Asisten Bibitan', desc: 'Pemeriksaan dan persetujuan rekapitulasi harian Mantri.', branch: 'Disetujui -> Kunci permanen & Push ERP; Dikembalikan -> Buka kunci revisi', status: 'TERVERIFIKASI', route: '/verification' }
  ],

  sourceProof: {
    flowName: 'Siklus Utama Pembibitan Karet',
    route: '/home',
    sourceFiles: [
      'js/app.js',
      'js/core/router.js',
      'js/core/attendance-gate-service.js',
      'js/core/dependency-guard.js',
      'js/modules/verification/mantri-confirmation-service.js'
    ],
    handlers: [
      'registerRoute',
      'defaultGuard',
      'assertAttendanceGateOrThrow',
      'guardDependency',
      'isTransactionLockedForMantri'
    ],
    codeRelation: 'Router memvalidasi izin akses dan attendance gate pada TRANSACTION_CREATION_ROUTES. Transaksi mengalir sekuensial melalui dependency-guard dari penerimaan ke dederan, pindah semai, okulasi, hingga penutupan harian EOD.',
    verificationStatus: 'Terverifikasi'
  },

  inputs: ['Akun Kredensial Pengguna', 'Status Kehadiran Hari Berjalan', 'Database Lokal IndexedDB / LocalStorage'],
  outputs: ['Surat Jalan Resmi Pengeluaran', 'Dokumen BAPB Cetak A4', 'Log Transaksi Tersinkronisasi ERP'],
  rules: [
    'Attendance Gate: Transaksi lapangan hanya dapat diinput jika Mantri berstatus HADIR hari ini.',
    'Seleksi Potong Stok: Pemotongan kuantiti stok fisik dilakukan saat modul Seleksi disetujui, bukan saat BAPB.',
    'BAPB Zero-Mutation: Mutasi stok pada eksekusi BAPB adalah 0 karena stok fisik telah dikurangi di tahap seleksi sebelumnya.',
    'End-of-Day Lock: Pengiriman rekap harian oleh Mantri mengunci hak edit/hapus transaksi kecuali dikembalikan oleh ASB.'
  ],
  limitations: [
    'Push data ke ERP pusat saat Verifikasi ASB berjalan dalam mode simulasi lokal.',
    'Aktivasi VPN pada panel simulator adalah flag simulasi lokal (localStorage), bukan koneksi tunnel VPN riil.',
    'Kamera pada browser desktop menggunakan canvas snapshot atau gambar fallback resmi.'
  ]
};

// =============================================================================
// 2. FLOW BERDASARKAN ROLE (7 ROLE / PERSONA AKTUAL)
// =============================================================================

export const ROLE_FLOWS = {
  MANTRI_TANAMAN: {
    id: 'role-mantri',
    roleId: 'MANTRI_TANAMAN',
    roleName: 'Mantri Bibitan',
    category: 'Berdasarkan Role',
    route: '/home',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penanggung jawab operasional harian lapangan: presensi, input transaksi budidaya, sortir fisik, dan penguncian harian (EOD).',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka SIGMA Nursery & Aktifkan VPN]
    B --> C[Masuk Akun Mantri di /login]
    C --> D[Tekan Saya Siap Bekerja Jujur di /splash]
    D --> E[Sinkronisasi Divisi Kerja di /sync]
    E --> F[Buka Menu Presensi di /attendance]
    F --> G{Pemeriksaan Jam Efektif?}
    G -- Sebelum 14:00 --> H[Presensi Datang]
    G -- Mulai 14:00 --> I[Presensi Pulang]
    H --> J[Foto Selfie Wajah + GPS Supervisor]
    J --> K[Simpan Presensi Supervisor]
    K --> L[Presensi Pekerja: Toggle Kamera per Orang]
    L --> M[Simpan Presensi Pekerja]
    M --> N[Attendance Gate Terbuka]
    N --> O[Buka Menu Operasional di Beranda]
    O --> P[Input Transaksi: Benih / Dederan / Pindah Semai / Okulasi / Seleksi / Entres]
    P --> Q[Simpan Data Transaksi Lokal]
    Q --> R[Buka Menu Konfirmasi Mantri di /mantri-confirmation]
    R --> S[Periksa Rekapitulasi Harian EOD]
    S --> T[Kirim Konfirmasi Harian ke ASB]
    T --> U[Transaksi Terkunci Otomatis di HP]
    U --> V([Selesai])`,

    sourceProof: {
      flowName: 'Alur Operasional Mantri Bibitan',
      route: '/attendance',
      sourceFiles: [
        'js/modules/auth/login.js',
        'js/modules/auth/splash.js',
        'js/modules/auth/sync.js',
        'js/modules/attendance/attendance-landing.js',
        'js/modules/attendance/attendance-supervisor.js',
        'js/modules/attendance/attendance-workers.js',
        'js/modules/verification/mantri-confirmation-landing.js'
      ],
      handlers: [
        'doLogin',
        'renderSplash',
        'runSync',
        'renderAttendanceLanding',
        'takeSnapshot',
        'executeSaveAttendance',
        'submitMantriConfirmation'
      ],
      codeRelation: 'Mantri login melalui validasi VPN, menjalankan sinkronisasi dataset, melakukan presensi supervisor + pekerja untuk membuka gate, merekam transaksi lapangan, dan menutup hari kerja dengan konfirmasi EOD.',
      verificationStatus: 'Terverifikasi'
    }
  },

  ASISTEN_BIBITAN: {
    id: 'role-asb',
    roleId: 'ASISTEN_BIBITAN',
    roleName: 'Asisten Bibitan (ASB / Kasie)',
    category: 'Berdasarkan Role',
    route: '/verification',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pengawas mutu teknis pembibitan: verifikasi hasil seleksi, inspeksi dederan & okulasi, inisiasi draf BAPB afkir, dan verifikasi akhir rekap harian.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Login Akun Asisten Bibitan di /login]
    B --> C[Buka Beranda Asisten Bibitan]
    C --> D{Pilih Aktivitas Pengawasan?}
    
    D -- Inspeksi Teknis --> E[Buka /inspection]
    E --> F[Inspeksi Stadium Jarum Dederan & Buka Ikatan Okulasi]
    F --> G[Catat Mutu Normal, Jarum, Abnormal & Simpan]

    D -- Verifikasi Seleksi --> H[Buka /selection]
    H --> I[Periksa Berkas Seleksi Batang Bawah Mantri]
    I --> J{Setujui Hasil Seleksi?}
    J -- Ya --> K[Approve Dokumen Seleksi & Potong Stok]
    J -- Tidak --> L[Kembalikan ke Mantri dengan Catatan]

    D -- Inisiasi BAPB --> M[Buka /destruction]
    M --> N[Tarik Data Bibit Afkir Terseleksi]
    N --> O[Ambil 2 Foto Bukti Pemusnahan & TTD Digital]
    O --> P[Kirim Berkas BAPB ke Askep]

    D -- Verifikasi Harian EOD --> Q[Buka /verification]
    Q --> R[Review Seluruh Transaksi Harian Mantri]
    R --> S{Verifikasi Rekap Harian?}
    S -- Disetujui --> T[Status DISETUJUI: Kunci Permanen & Push ERP]
    S -- Dikembalikan --> U[Status DIKEMBALIKAN: Buka Kunci Revisi Mantri]
    
    G --> V([Selesai])
    K --> V
    L --> V
    P --> V
    T --> V
    U --> V`,

    sourceProof: {
      flowName: 'Alur Pengawasan Asisten Bibitan',
      route: '/verification',
      sourceFiles: [
        'js/modules/inspection/inspection-landing.js',
        'js/modules/selection/selection-landing.js',
        'js/modules/destruction/destruction-landing.js',
        'js/modules/verification/verification-landing.js'
      ],
      handlers: [
        'renderInspectionLanding',
        'approvePreGraftingSelectionDocument',
        'createBapbDraft',
        'approveVerificationItem',
        'returnVerificationItem'
      ],
      codeRelation: 'Asisten Bibitan memiliki wewenang approval pada seleksi pra-okulasi, inspeksi dederan, inisiasi draf BAPB, serta audit transaksi harian EOD dengan opsi setujui atau kembalikan.',
      verificationStatus: 'Terverifikasi'
    }
  },

  ASISTEN: {
    id: 'role-asisten-lapangan',
    roleId: 'ASISTEN',
    roleName: 'Asisten Divisi / Lapangan',
    category: 'Berdasarkan Role',
    route: '/reception/kebun-sepupu',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penerima bibit di divisi tanam: melakukan pemeriksaan fisik kiriman bibit kebun sepupu, mencatat selisih/reject, dan mengalokasikan ke blok tanam.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Login Akun Asisten Divisi di /login]
    B --> C[Buka Penerimaan Bibit Kebun Sepupu di /reception/kebun-sepupu]
    C --> D[Lihat Tugas Masuk Pengalihan dari Askep]
    D --> E[Buka Form Pemeriksaan Fisik Lapangan]
    E --> F[Hitung Jumlah Bibit Layak & Bibit Rusak / Reject]
    F --> G[Alokasikan Bibit Layak ke Blok Tanam Divisi]
    G --> H[Ambil Foto Bukti Fisik Penerimaan via Kamera]
    H --> I{Apakah Terdapat Selisih / Discrepancy?}
    I -- Tidak Ada Selisih --> J[Simpan Status DITERIMA]
    I -- Terdapat Selisih --> K[Simpan Status DITERIMA_DENGAN_SELISIH]
    J --> L[Terbitkan Batch Bibitan Baru di Blok Tanam]
    K --> L
    L --> M([Selesai])`,

    sourceProof: {
      flowName: 'Alur Penerimaan Bibit Asisten Divisi',
      route: '/reception/kebun-sepupu',
      sourceFiles: [
        'js/modules/receipt/receipt-kebun-sepupu-landing.js',
        'js/core/receipt-ksp-validator.js',
        'js/core/receipt-ksp-manager.js'
      ],
      handlers: [
        'renderReceiptKebunSepupuLanding',
        'validateReceiptQuantities',
        'validateBlockAllocations',
        'createNurseryBatchesFromReceipt'
      ],
      codeRelation: 'Asisten Lapangan menerima pengalihan dari Askep, memverifikasi bibit fisik di blok tanam, mengunggah foto kamera, dan menyelesaikan penerimaan dengan pembentukan batch tanaman baru.',
      verificationStatus: 'Terverifikasi'
    }
  },

  ASKEP: {
    id: 'role-askep',
    roleId: 'ASKEP',
    roleName: 'Asisten Kepala (Askep)',
    category: 'Berdasarkan Role',
    route: '/home',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Peninjau manajerial kebun: verifikasi dan penentuan jalur penerimaan bibit sepupu, serta penelaahan dan penandatanganan berkas BAPB.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Login Akun Askep di /login]
    B --> C[Buka Beranda Askep]
    C --> D{Pilih Berkas Masuk?}
    
    D -- Penerimaan Kebun Sepupu --> E[Buka /reception/kebun-sepupu]
    E --> F[Periksa Berkas Kiriman dari Pengurus]
    F --> G{Keputusan Verifikasi Askep?}
    G -- Teruskan Lapangan --> H[Tentukan Jalur LAPANGAN & Divisi Tujuan]
    G -- Teruskan Bibitan --> I[Tentukan Jalur BIBITAN & Divisi Tujuan]
    G -- Kembalikan --> J[Kembalikan ke Pengurus dengan Catatan]
    H --> K[Teruskan ke Asisten Lapangan]
    I --> L[Teruskan ke Asisten Bibitan]

    D -- Telaah Berkas BAPB --> M[Buka /destruction]
    M --> N[Periksa Laporan Afkir & 2 Foto Bukti Pemusnahan]
    N --> O{Keputusan Telaah BAPB?}
    O -- Disetujui --> P[Bubuhkan Tanda Tangan Digital Askep]
    P --> Q[Teruskan Dokumen BAPB ke Pengurus Kebun]
    O -- Revisi --> R[Kembalikan Berkas ke Asisten Bibitan]

    J --> S([Selesai])
    K --> S
    L --> S
    Q --> S
    R --> S`,

    sourceProof: {
      flowName: 'Alur Keputusan Asisten Kepala',
      route: '/reception/kebun-sepupu',
      sourceFiles: [
        'js/modules/receipt/receipt-kebun-sepupu-landing.js',
        'js/modules/destruction/destruction-landing.js',
        'js/modules/destruction/destruction-manager.js'
      ],
      handlers: [
        'renderReceiptKebunSepupuLanding',
        'signBapbAskep',
        'returnBapbByAskep'
      ],
      codeRelation: 'Askep bertindak sebagai penentu jalur logistik bibit antar-kebun dan pemberi tanda tangan verifikasi berjenjang kedua pada berkas BAPB sebelum diajukan ke Pengurus.',
      verificationStatus: 'Terverifikasi'
    }
  },

  PENGURUS: {
    id: 'role-pengurus',
    roleId: 'PENGURUS',
    roleName: 'Pengurus Kebun (Estate Manager)',
    category: 'Berdasarkan Role',
    route: '/home',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pimpinan tertinggi kebun: pencatatan kedatangan awal logistik bibit kebun sepupu dan pengesahan dokumen final Berita Acara Pemusnahan Bibit (BAPB).',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Login Akun Pengurus Kebun di /login]
    B --> C[Buka Beranda Pengurus Kebun]
    C --> D{Pilih Agenda Eksekutif?}

    D -- Kedatangan Bibit Sepupu --> E[Buka /reception/kebun-sepupu]
    E --> F[Catat Tanggal Tiba Fisik & Catatan Ekspedisi]
    F --> G[Teruskan Berkas ke Asisten Kepala]

    D -- Pengesahan Dokumen BAPB --> H[Buka /destruction]
    H --> I[Tinjau Kelengkapan Tanda Tangan ASB & Askep]
    I --> J[Tinjau 2 Foto Bukti Pemusnahan Fisik]
    J --> K{Pengesahan Dokumen BAPB Final?}
    K -- Disetujui --> L[Bubuhkan Tanda Tangan Digital Pengurus]
    L --> M[Terbitkan Status FINAL Dokumen BAPB]
    M --> N[Buka Format Cetak A4 Standar Perusahaan]
    K -- Ditolak / Koreksi --> O[Kembalikan Berkas BAPB ke Askep / ASB]

    G --> P([Selesai])
    N --> P
    O --> P`,

    sourceProof: {
      flowName: 'Alur Pengesahan Pengurus Kebun',
      route: '/destruction',
      sourceFiles: [
        'js/modules/receipt/receipt-kebun-sepupu-landing.js',
        'js/modules/destruction/destruction-landing.js',
        'js/modules/destruction/bapb-print-template.js'
      ],
      handlers: [
        'finalizeBapbDocument',
        'printBapbDocument',
        'openBapbPrintPreviewModal'
      ],
      codeRelation: 'Pengurus mengesahkan penerimaan awal logistik dan memberikan tanda tangan final pengesahan BAPB yang mengunci dokumen untuk pencetakan resmi format A4.',
      verificationStatus: 'Terverifikasi'
    }
  },

  PENGURUS_KEBUN_SEPUPU: {
    id: 'role-ksp',
    roleId: 'PENGURUS_KEBUN_SEPUPU',
    roleName: 'Pengurus Kebun Sepupu (Pemohon)',
    category: 'Berdasarkan Role',
    route: '/request/kebun-sepupu',
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pihak kebun pemohon bibit / entres: membuat Surat Permintaan Bibit (SPB) antar kebun dan memantau status persetujuan serta pengiriman.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Login Akun Pengurus Kebun Sepupu di /login]
    B --> C[Buka Menu Permintaan Kebun Sepupu di /request/kebun-sepupu]
    C --> D[Buka Form Permintaan Bibit Baru]
    D --> E[Input Nomor SPB & Tanggal Rencana Tanam]
    E --> F[Pilih Klon Bibit & Kuantitas Permintaan]
    F --> G[Tentukan Kebun Penyedia & Blok Tujuan]
    G --> H[Simpan & Kirim Pengajuan SPB]
    H --> I[Monitor Status: MENUNGGU_PERSETUJUAN]
    I --> J{Status Persetujuan dari Kebun Penyedia?}
    J -- Disetujui --> K[Terima Konfirmasi & Jadwal Pengiriman]
    J -- Ditolak / Disesuaikan --> L[Perbaiki Permintaan SPB]
    L --> H
    K --> M([Selesai])`,

    sourceProof: {
      flowName: 'Alur Permintaan Bibit Kebun Sepupu',
      route: '/request/kebun-sepupu',
      sourceFiles: [
        'js/modules/request/request-kebun-sepupu-landing.js',
        'js/modules/request/request-kebun-sepupu-form.js'
      ],
      handlers: [
        'renderRequestKebunSepupuLanding',
        'renderRequestKebunSepupuForm'
      ],
      codeRelation: 'Pengurus Kebun Sepupu mengisi draf SPB antar-kebun, memilih klon dan jumlah bibit, lalu memantau persetujuan logistik bibit dari kebun induk pembibitan.',
      verificationStatus: 'Terverifikasi'
    }
  },

  TEKNIKER_I_KTU: {
    id: 'role-dev',
    roleId: 'TEKNIKER_I_KTU',
    roleName: 'Tekniker I & Kepala Tata Usaha (KTU)',
    category: 'Berdasarkan Role',
    route: '/placeholder',
    verificationStatus: 'DALAM PENGEMBANGAN',
    summary: 'Role pendukung administrasi & teknik yang saat ini disembunyikan dari selector demo dan belum memiliki alur transaksi aktif.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Pilih Role Tekniker I / KTU]
    B --> C[Sistem Memeriksa Status Kesiapan Modul]
    C --> D[Tampilkan Layar Resmi DALAM PENGEMBANGAN]
    D --> E[Tidak Ada Mutasi Transaksi atau Alur Fiktif]
    E --> F([Selesai])`,

    sourceProof: {
      flowName: 'Role Tekniker I & KTU (Placeholder)',
      route: '/placeholder',
      sourceFiles: [
        'js/modules/auth/login.js',
        'js/core/permissions.js'
      ],
      handlers: [
        'openRolePicker'
      ],
      codeRelation: 'Role KTU dan TEKNIKER_I dikecualikan secara eksplisit dari switcher demo (HIDDEN_SWITCHER_ROLES) dan belum memiliki alur transaksi aktif pada kode saat ini.',
      verificationStatus: 'Belum Terverifikasi',
      unverifiedNotes: 'Fitur belum diimplementasikan di source code; sesuai prinsip audit, status ditandai Dalam Pengembangan tanpa membuat alur transaksi fiktif.'
    }
  }
};

// =============================================================================
// 3. FLOW BERDASARKAN MODUL (14 MODUL OPERASIONAL AKTUAL)
// =============================================================================

export const MODULE_FLOWS = {
  attendance: {
    id: 'mod-attendance',
    code: 'MOD-01',
    name: 'Presensi Harian',
    category: 'Manajemen Kehadiran',
    route: '/attendance',
    rolesInvolved: ['Mantri Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    objective: 'Merekam kehadiran mandor/supervisor (foto wajah + GPS) dan pekerja bibitan harian guna membuka kunci akses pembuatan transaksi.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Presensi di /attendance]
    B --> C{Evaluasi Jam Efektif Sistem?}
    C -- Jam Kurang Dari 14:00 --> D[Sesi Presensi Datang]
    C -- Jam 14:00 ke Atas --> E[Sesi Presensi Pulang]
    
    D --> F[Tampilkan Ringkasan Kehadiran & Status Awan]
    E --> F

    F --> G{Pilih Aksi Presensi?}
    
    G -- Presensi Supervisor --> H{Supervisor Sudah Presensi Hari Ini?}
    H -- Sudah --> I[Tampilkan Notifikasi Info: Sudah Selesai]
    I --> F
    H -- Belum --> J[Buka Kamera di /attendance/supervisor]
    J --> K[Tampilkan Overlay Kedip Mata & Frame Wajah]
    K --> L[Tekan Shutter: Ambil Snapshot Canvas & GPS]
    L --> M[Buka Pratinjau di /attendance/supervisor/result]
    M --> N[Tekan Tombol Simpan]
    N --> O{Konfirmasi Simpan Presensi?}
    O -- Ya --> P[Validasi Duplikasi & Simpan ke IndexedDB]
    P --> Q[Buka Kunci Attendance Gate Transaksi]
    Q --> F
    O -- Batal --> M

    G -- Presensi Pekerja --> R[Buka Daftar di /attendance/workers]
    R --> S[Tampilkan Pekerja Aktif & Section Tidak Hadir]
    S --> T[Klik Switch Toggle Pekerja]
    T --> U[Buka Kamera Modal Pekerja & Tekan Shutter]
    U --> V[Simpan Foto Thumbnail & Centang Status Hadir]
    V --> W[Tekan Tombol Simpan Presensi Pekerja]
    W --> X{Konfirmasi Simpan Pekerja?}
    X -- Ya --> Y[Validasi Duplikasi Lintas Mantri]
    Y --> Z[Simpan Seluruh Record Pekerja ke IndexedDB]
    Z --> F
    X -- Batal --> R

    G -- Sinkronisasi Awan --> AA[Tekan Ikon Awan di Header]
    AA --> AB[Simulasikan Unggah 1200ms & Catat Timestamp]
    AB --> F

    F --> AC([Selesai])`,

    operationalWorkflow: [
      { step: 1, action: 'Evaluasi Jam Efektif', actor: 'Aplikasi', desc: 'Sistem memeriksa jam saat ini: <14:00 masuk sesi DATANG, >=14:00 masuk sesi PULANG.', branch: 'Otomatis via getEffectiveHour()', status: 'TERVERIFIKASI', route: '/attendance' },
      { step: 2, action: 'Pilih Presensi Supervisor', actor: 'Mantri Bibitan', desc: 'Membuka kamera depan supervisor dengan instruksi kedip mata.', branch: 'Dicegah jika supervisor sudah presensi sesi ini', status: 'TERVERIFIKASI', route: '/attendance/supervisor' },
      { step: 3, action: 'Pengambilan Foto Wajah & GPS', actor: 'Mantri Bibitan', desc: 'Menekan tombol shutter kamera untuk mengambil foto canvas dan koordinat GPS perangkat.', branch: 'Fallback gambar resmi jika izin kamera ditolak', status: 'TERVERIFIKASI', route: '/attendance/supervisor' },
      { step: 4, action: 'Penyimpanan Supervisor & Buka Gate', actor: 'Mantri Bibitan', desc: 'Mengonfirmasi hasil capture; sistem menyimpan data ke IndexedDB dan membuka Attendance Gate.', branch: 'Membuka 23 route transaksi operasional', status: 'TERVERIFIKASI', route: '/attendance/supervisor/result' },
      { step: 5, action: 'Presensi Pekerja Bibitan', actor: 'Mantri Bibitan', desc: 'Membuka daftar pekerja, menekan toggle switch untuk membuka kamera modal dan memotret setiap pekerja.', branch: 'Mendukung tambah pekerja dari master & swipe hapus', status: 'TERVERIFIKASI', route: '/attendance/workers' },
      { step: 6, action: 'Simpan Batch Pekerja', actor: 'Mantri Bibitan', desc: 'Menyimpan seluruh pekerja yang tercentang dengan validasi duplikasi lintas mantri.', branch: 'Conflict check terhadap tanggal & ID pekerja', status: 'TERVERIFIKASI', route: '/attendance/workers' },
      { step: 7, action: 'Simulasi Sinkronisasi Awan', actor: 'Mantri Bibitan', desc: 'Menekan tombol awan pada header untuk mencatat status cloud sync lokal.', branch: 'Animasi 1200ms & update timestamp', status: 'TERVERIFIKASI', route: '/attendance' }
    ],

    sourceProof: {
      flowName: 'Modul Presensi Harian',
      route: '/attendance',
      sourceFiles: [
        'js/modules/attendance/attendance-landing.js',
        'js/modules/attendance/attendance-supervisor.js',
        'js/modules/attendance/attendance-supervisor-result.js',
        'js/modules/attendance/attendance-workers.js',
        'js/core/attendance-gate-service.js'
      ],
      handlers: [
        'renderAttendanceLanding',
        'getAttendanceTypeByHour',
        'renderAttendanceSupervisor',
        'takeSnapshot',
        'renderAttendanceSupervisorResult',
        'renderAttendanceWorkers',
        'openWorkerCamera',
        'executeSaveAttendance',
        'getGlobalAttendanceGateStatus'
      ],
      codeRelation: 'Kode mengevaluasi jam kerja melalui getEffectiveHour(), mengalirkan pengambilan foto via getUserMedia() atau fallback image, menyimpan record ke attendanceRepository, dan membuka gate transaksi.',
      verificationStatus: 'Terverifikasi'
    },

    inputs: ['Izin Akses Kamera Depan & GPS', 'Identitas Sesi Aktif Mantri', 'Master Pekerja Divisi'],
    outputs: ['Record Presensi Supervisor (ATT-SUP-*)', 'Record Presensi Pekerja (ATT-WRK-*)', 'Kunci Akses Transaksi Gate Terbuka'],
    rules: [
      'Pemisahan Sesi: Sesi Datang (<14:00) dan Sesi Pulang (>=14:00) terpisah secara independen.',
      'Pencegahan Duplikasi: Supervisor dan Pekerja tidak dapat dipresensi dua kali untuk sesi yang sama pada hari yang sama.',
      'Gate Kunci Transaksi: Transaksi operasional bibitan dilarang dibuat sebelum Mantri melakukan presensi supervisor.'
    ],
    limitations: [
      'Sinkronisasi awan pada tombol header bersifat simulasi lokal (timestamp localStorage).',
      'Pada browser tanpa webcam aktif, sistem otomatis beralih ke gambar fallback supervisor_wagiman.jpg.'
    ]
  },

  reception_sir: {
    id: 'mod-reception-sir',
    code: 'MOD-02',
    name: 'Penerimaan Benih SIR',
    category: 'Pengadaan Benih',
    route: '/reception/benih',
    rolesInvolved: ['Mantri Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penerimaan benih kelatak bersertifikat (SIR) dari pihak ke-III dengan verifikasi nomor dokumen, sortir fisik, dan penerbitan Batch RCV.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Penerimaan di /reception]
    B --> C[Klik Tombol Benih / Biji Kelatak]
    C --> D{Periksa Attendance Gate Mantri?}
    D -- Belum Presensi --> E[Tampilkan Peringatan Gate Presensi & Tolak Akses]
    E --> B
    D -- Sudah Presensi --> F[Buka Form Penerimaan di /reception/benih]
    F --> G[Pilih Dokumen SIR / No Issue Gudang]
    G --> H[Pilih Batch Tujuan & Blok Bedengan]
    H --> I[Pilih Klon: GT1 / RRIC 100 / PB 330 / Mix]
    I --> J[Ambil Foto Sampel Benih via Kamera]
    J --> K[Input Kuantitas Benih & Jumlah Sortir Afkir]
    K --> L[Tekan Tombol Simpan Penerimaan]
    L --> M{Konfirmasi Simpan Data?}
    M -- Ya --> N[Generate Nomor Dokumen RCV Unik]
    N --> O[Simpan Record ke receipt_transactions]
    O --> P[Tampilkan Banner Berhasil Disimpan]
    P --> Q[Otomatis Kembali ke Daftar Penerimaan /reception]
    M -- Batal --> F
    Q --> R([Selesai])`,

    sourceProof: {
      flowName: 'Penerimaan Benih Kelatak SIR',
      route: '/reception/benih',
      sourceFiles: [
        'js/modules/receipt/receipt-landing.js',
        'js/modules/receipt/receipt-benih.js',
        'js/modules/receipt/receipt-sir.js',
        'js/modules/receipt/receipt-camera.js'
      ],
      handlers: [
        'renderReceiptLanding',
        'renderReceiptBenih',
        'assertAttendanceGateOrThrow',
        'generateUniqueDocNo'
      ],
      codeRelation: 'Form memeriksa assertAttendanceGateOrThrow(), membatasi klon Pihak Ke-III hanya pada 4 opsi resmi, menghasilkan nomor RCV unik, dan menyimpan data ke storage receipt_transactions.',
      verificationStatus: 'Terverifikasi'
    }
  },

  reception_cousin: {
    id: 'mod-reception-cousin',
    code: 'MOD-03',
    name: 'Penerimaan Bibit Kebun Sepupu',
    category: 'Logistik Kebun',
    route: '/reception/kebun-sepupu',
    rolesInvolved: ['Pengurus', 'Askep', 'Asisten Divisi', 'Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penerimaan bibit atau mata entres kiriman kebun sepupu melalui alur berjenjang: Pengurus catat tiba, Askep tentukan jalur, dan Asisten periksa fisik.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka /reception/kebun-sepupu]
    B --> C[Pengurus Catat Kedatangan Fisik & Tanggal Tiba]
    C --> D[Status: MENUNGGU_VERIFIKASI_ASKEP]
    D --> E[Askep Buka Berkas & Tentukan Jalur]
    E --> F{Keputusan Jalur Askep?}
    F -- Jalur Lapangan --> G[Status: MENUNGGU_VERIFIKASI_ASISTEN_LAPANGAN]
    F -- Jalur Bibitan --> H[Status: MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN]
    F -- Kembalikan --> I[Status: DIKEMBALIKAN_KE_PENGURUS]
    I --> C
    G --> J[Asisten Buka Form Pemeriksaan Fisik]
    H --> J
    J --> K[Hitung Kuantitas Layak & Reject]
    K --> L[Alokasikan Bibit ke Blok Tanam Kebun]
    L --> M[Ambil Bukti Foto Fisik via Kamera]
    M --> N{Apakah Terdapat Selisih Pengiriman?}
    N -- Selisih Nol --> O[Simpan Status DITERIMA]
    N -- Selisih Lebih Dari Nol --> P[Simpan Status DITERIMA_DENGAN_SELISIH]
    O --> Q[Bentuk Batch Tanaman Baru di Master]
    P --> Q
    Q --> R([Selesai])`,

    sourceProof: {
      flowName: 'Penerimaan Bibit Kebun Sepupu',
      route: '/reception/kebun-sepupu',
      sourceFiles: [
        'js/modules/receipt/receipt-kebun-sepupu-landing.js',
        'js/core/receipt-ksp-validator.js',
        'js/core/receipt-ksp-manager.js'
      ],
      handlers: [
        'renderReceiptKebunSepupuLanding',
        'validateReceiptQuantities',
        'validateBlockAllocations',
        'createNurseryBatchesFromReceipt'
      ],
      codeRelation: 'Alur menerapkan state machine berjenjang: MENUNGGU_PENERIMAAN_PENGURUS -> MENUNGGU_VERIFIKASI_ASKEP -> MENUNGGU_VERIFIKASI_ASISTEN -> DITERIMA dengan validasi alokasi blok dan foto kamera.',
      verificationStatus: 'Terverifikasi'
    }
  },

  seeding_dederan: {
    id: 'mod-seeding-dederan',
    code: 'MOD-04',
    name: 'Dederan & Pindah Semai',
    category: 'Persemaian',
    route: '/seeding',
    rolesInvolved: ['Mantri Bibitan', 'Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penyemaian benih kelatak di bedengan pasir (Dederan), inspeksi kecambah jarum oleh ASB, dan pemindahan ke polibag semai.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Modul Penyemaian di /seeding]
    B --> C{Pilih Tab Operasional?}
    
    C -- Tab Dederan --> D[Buka /seeding/dederan/scan]
    D --> E[Scan / Pilih Bedengan Pasir Dederan]
    E --> F[Buka Form Dederan di /seeding/dederan/form]
    F --> G[Pilih Dokumen Induk Benih RCV]
    G --> H[Input Jumlah Benih & Tanggal Tabur]
    H --> I[Simpan Transaksi Dederan]
    I --> J[Tunggu Masa Kecambah: Inspeksi ASB di /inspection]
    J --> K{Kecambah Lolos QC Stadium Jarum?}
    K -- Ya --> L[Kecambah Masuk Pool Siap Pindah Semai]
    K -- Gagal / Mati --> M[Masuk Akumulasi Afkir Dederan]

    C -- Tab Pindah Semai --> N[Pilih Sumber Dederan Lolos QC]
    N --> O[Scan / Pilih Polibag di /seeding/scan]
    O --> P[Buka Form Pindah Semai di /seeding/form]
    P --> Q[Input Jumlah Bibit Ditanam ke Polibag]
    Q --> R[Validasi Ketersediaan Sisa Kecambah]
    R --> S[Simpan Transaksi Pindah Semai ke seeding_transactions]
    
    L --> N
    S --> T([Selesai])
    M --> T`,

    sourceProof: {
      flowName: 'Penyemaian Dederan & Pindah Semai',
      route: '/seeding',
      sourceFiles: [
        'js/modules/seeding/seeding-landing.js',
        'js/modules/seeding/dederan-form.js',
        'js/modules/seeding/dederan-scan.js',
        'js/modules/seeding/seeding-form.js',
        'js/modules/seeding/seeding-scan.js',
        'js/modules/seeding/dederan-pindah-semai-adapter.js'
      ],
      handlers: [
        'renderSeedingLanding',
        'syncDederanIndukDocuments',
        'getEligiblePindahSemaiSources',
        'renderDederanForm',
        'renderSeedingForm'
      ],
      codeRelation: 'Dederan membuat dokumen induk benih, dipantau melalui inspeksi dederan, dan hanya kecambah yang lolos QC 100% yang diizinkan mengalir ke form pindah semai polibag.',
      verificationStatus: 'Terverifikasi'
    }
  },

  budding: {
    id: 'mod-budding',
    code: 'MOD-05',
    name: 'Okulasi & Regrafting',
    category: 'Pembiakan Vegetatif',
    route: '/budding',
    rolesInvolved: ['Mantri Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penempelan mata entres murni ke batang bawah lolos Seleksi III, serta okulasi ulang (regrafting) bagi bibit gagal pada pemeriksaan ikatan.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Modul Okulasi di /budding]
    B --> C{Pilih Jalur Okulasi?}
    
    C -- Okulasi Utama --> D[Buka /budding/grafting]
    D --> E[Pilih Dokumen Batang Bawah Lolos Seleksi III Final]
    E --> F[Scan / Pilih Bedengan Batang Bawah]
    F --> G[Buka Form Okulasi di /budding/grafting/form]
    G --> H[Pilih Klon Mata Entres Tersedia]
    H --> I[Input Jumlah Okulasi & Nama Okulator]
    I --> J[Simpan Transaksi Okulasi Utama]

    C -- Okulasi Janda (Regrafting) --> K[Buka /budding/regrafting]
    K --> L[Pilih Batang Bawah dari Regrafting Pool]
    L --> M[Buka Form Okulasi Janda]
    M --> N[Tempelkan Mata Entres Baru di Sisi Berlawanan]
    N --> O[Simpan Transaksi Okulasi Janda]

    J --> P[Masa Tunggu 21 Hari Menuju Buka Ikatan]
    O --> P
    P --> Q([Selesai])`,

    sourceProof: {
      flowName: 'Okulasi & Regrafting',
      route: '/budding',
      sourceFiles: [
        'js/modules/budding/budding-landing.js',
        'js/modules/budding/budding-grafting.js',
        'js/modules/budding/budding-form.js',
        'js/modules/budding/budding-regrafting.js'
      ],
      handlers: [
        'renderBuddingLanding',
        'renderBuddingGrafting',
        'renderBuddingForm',
        'renderBuddingRegrafting'
      ],
      codeRelation: 'Okulasi utama mewajibkan dokumen sumber Seleksi III berstatus DISETUJUI dan isFinal = true. Okulasi janda mengambil bibit dari regrafting_pool hasil pemeriksaan ikatan.',
      verificationStatus: 'Terverifikasi'
    }
  },

  inspection: {
    id: 'mod-inspection',
    code: 'MOD-06',
    name: 'Pemeriksaan Mutu & Buka Ikatan',
    category: 'Kontrol Kualitas',
    route: '/inspection',
    rolesInvolved: ['Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pemeriksaan mutu persemaian: evaluasi stadium jarum dederan, buka ikatan okulasi hari ke-21, dan pemeriksaan mata tunas hari ke-42.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Pemeriksaan di /inspection]
    B --> C{Pilih Jenis Pemeriksaan?}

    C -- Inspeksi Dederan --> D[Scan Bedengan Pasir Dederan]
    D --> E[Input Jumlah Normal, Jarum, Abnormal, Mati]
    E --> F[Hitung Persentase Daya Kecambah]
    F --> G[Simpan Hasil Inspeksi Dederan]

    C -- Pemeriksaan Buka Ikatan Okulasi --> H[Pilih Batch Okulasi Umur 21 Hari]
    H --> I[Buka Plastik Ikatan Okulasi]
    I --> J[Hitung Mata Hijau Hidup vs Mata Coklat Mati]
    J --> K{Mata Okulasi Hidup?}
    K -- Ya --> L[Catat Berhasil: Tunggu Tunas Hari-42]
    L --> M[Masuk Kategori Bibit Okulasi Jadi]
    K -- Tidak --> N{Apakah Batang Bawah Masih Sehat?}
    N -- Ya --> O[Kirim ke Regrafting Pool untuk Okulasi Janda]
    N -- Tidak --> P[Catat sebagai Bibit Afkir Mati]

    G --> Q([Selesai])
    M --> Q
    O --> Q
    P --> Q`,

    sourceProof: {
      flowName: 'Pemeriksaan Mutu & Inspeksi Okulasi',
      route: '/inspection',
      sourceFiles: [
        'js/modules/inspection/inspection-landing.js',
        'js/modules/inspection/inspection-form.js',
        'js/core/budding-workflow-service.js'
      ],
      handlers: [
        'renderInspectionLanding',
        'renderInspectionForm',
        'getBuddingInspectionGate'
      ],
      codeRelation: 'Inspeksi memverifikasi batas hari (H+21 buka ikatan, H+42 tunas) dan mendistribusikan hasil evaluasi ke bibit jadi, regrafting pool, atau deklarasi afkir.',
      verificationStatus: 'Terverifikasi'
    }
  },

  selection: {
    id: 'mod-selection',
    code: 'MOD-07',
    name: 'Penyeleksian Bibitan & Afkir',
    category: 'Pengendalian Populasi',
    route: '/selection',
    rolesInvolved: ['Mantri Bibitan', 'Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pemeriksaan fisik bertahap (Seleksi I-III Pra-Okulasi & Seleksi Siap Salur) dengan pemotongan stok fisik langsung pada bibit afkir.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Modul Penyeleksian di /selection]
    B --> C{Pilih Tahapan Seleksi?}
    C -- Seleksi Pra-Okulasi --> D[Pilih Seleksi 1, 2, atau 3 Batang Bawah]
    C -- Seleksi Siap Salur --> E[Pilih Bibit Payung 1-2]
    
    D --> F[Pilih Batch & Bedengan Bibitan]
    E --> F
    F --> G[Input Jumlah Diperiksa & Jumlah Layak]
    G --> H{Apakah Terdapat Bibit Afkir / Culling?}
    H -- Ada Afkir --> I[Pilih Kriteria Afkir: Kerdil / Penyakit / Bengkok]
    I --> J[Ambil Foto Kamera Bukti Afkir Lapangan]
    J --> K[Potong Kuantitas Stok Fisik Langsung]
    K --> L[Simpan ke Dokumen Seleksi & Culling Pool]
    H -- Tidak Ada Afkir --> M[Nyatakan 100% Bibit Layak]
    
    L --> N[Ajukan Dokumen Seleksi ke Asisten Bibitan]
    M --> N
    N --> O{Verifikasi Asisten Bibitan?}
    O -- Disetujui --> P[Status DISETUJUI: Bibit Siap Tahap Berikutnya]
    O -- Dikembalikan --> Q[Status DIKEMBALIKAN: Mantri Revisi Data]
    Q --> F
    P --> R([Selesai])`,

    sourceProof: {
      flowName: 'Penyeleksian Bibitan & Deklarasi Afkir',
      route: '/selection',
      sourceFiles: [
        'js/modules/selection/selection-landing.js',
        'js/modules/selection/selection-manager.js'
      ],
      handlers: [
        'renderSelectionLanding',
        'declareSelectionItem',
        'approvePreGraftingSelectionDocument',
        'returnPreGraftingSelectionDocument'
      ],
      codeRelation: 'Modul seleksi memotong kuantitas stok fisik saat transaksi disetujui (Atomic Cull Deduction) dan memisahkan bibit afkir ke dalam culling pool untuk BAPB.',
      verificationStatus: 'Terverifikasi'
    }
  },

  entres: {
    id: 'mod-entres',
    code: 'MOD-08',
    name: 'Kebun Entres (Menunas & Topping)',
    category: 'Pemeliharaan Sumber Entres',
    route: '/entres',
    rolesInvolved: ['Mantri Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pemeliharaan pohon entres klon murni: penunasan tunas liar, topping pemangkasan pucuk, dan pemantauan stok mata entres.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Kebun Entres di /entres]
    B --> C{Pilih Aktivitas Kebun Entres?}

    C -- Stok Kayu Entres --> D[Buka /entres/stock]
    D --> E[Lihat Ketersediaan Entres per Klon Murni]
    E --> F[Buka Detail Klon di /entres/stock/detail]

    C -- Menunas Entres --> G[Buka /entres/menunas]
    G --> H[Scan / Pilih Baris Pohon Entres]
    H --> I[Buka Form Menunas di /entres/menunas/form]
    I --> J[Catat Pembersihan Tunas Liar & Simpan Transaksi]

    C -- Topping Entres --> K[Buka /entres/topping]
    K --> L[Scan / Pilih Baris Pohon Entres]
    L --> M[Buka Form Topping di /entres/topping/form]
    M --> N[Catat Pemotongan Pucuk Rangsang Tunas Baru & Simpan]

    F --> O([Selesai])
    J --> O
    N --> O`,

    sourceProof: {
      flowName: 'Pengelolaan Kebun Entres',
      route: '/entres',
      sourceFiles: [
        'js/modules/entres/entres-landing.js',
        'js/modules/entres/entres-stock-landing.js',
        'js/modules/entres/menunas-scan.js',
        'js/modules/entres/menunas-form.js',
        'js/modules/entres/topping-scan.js',
        'js/modules/entres/topping-form.js'
      ],
      handlers: [
        'renderEntresLanding',
        'renderEntresStockLanding',
        'renderMenunasForm',
        'renderToppingForm'
      ],
      codeRelation: 'Mengelola pohon induk entres melalui pencatatan sanitasi menunas dan topping, serta menyediakan data ketersediaan mata entres untuk modul okulasi.',
      verificationStatus: 'Terverifikasi'
    }
  },

  maintenance_consolidation: {
    id: 'mod-maintenance-consolidation',
    code: 'MOD-09',
    name: 'Pemeliharaan & Konsolidasi Mandoran',
    category: 'Aktivitas Kultur Teknis',
    route: '/nursery-activity',
    rolesInvolved: ['Mantri Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pencatatan aktivitas kultur teknis harian (penyiraman, pemupukan, gulma, OPT) dan konsolidasi jam kerja / potong jam mandoran.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Rekam Pemeliharaan di /nursery-activity]
    B --> C{Pilih Menu Pemeliharaan?}

    C -- Input Kegiatan Lapangan --> D[Buka Form Pemeliharaan di /nursery-activity/form]
    D --> E[Pilih Aktivitas: Siram / Pupuk / Gulma / OPT]
    E --> F[Pilih Batch Bibitan & Blok Lokasi]
    F --> G[Input Bahan / Pupuk / Pestisida Digunakan]
    G --> H[Simpan Catatan Aktivitas Pemeliharaan]

    C -- Konsolidasi Hasil Mandoran --> I[Buka /nursery-activity/consolidation]
    I --> J[Tinjau Daftar Kelompok Pekerja Harian]
    J --> K[Buka Rincian Potong Jam Pekerja Tertentu]
    K --> L[Hitung Potong Jam Kerja & Kehadiran Mandoran]
    L --> M[Simpan Konsolidasi Hasil Mandoran]

    H --> N([Selesai])
    M --> N`,

    sourceProof: {
      flowName: 'Pemeliharaan & Konsolidasi Mandoran',
      route: '/nursery-activity',
      sourceFiles: [
        'js/modules/maintenance/nursery-activity.js',
        'js/modules/maintenance/mandoran-consolidation.js'
      ],
      handlers: [
        'renderNurseryActivityLanding',
        'renderNurseryActivityForm',
        'renderMandoranConsolidation',
        'renderMandoranPotongJamDetail'
      ],
      codeRelation: 'Merekam kegiatan harian perawatan bibit dan melakukan kalkulasi jam kerja pekerja bibitan sebelum ditutup pada rekap harian.',
      verificationStatus: 'Terverifikasi'
    }
  },

  request_spb: {
    id: 'mod-request-spb',
    code: 'MOD-10',
    name: 'Permintaan Bibit (SPB)',
    category: 'Distribusi & Logistik',
    route: '/request',
    rolesInvolved: ['Pengurus Kebun Sepupu', 'Asisten Divisi', 'Askep'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pengajuan Surat Permintaan Bibit (SPB) untuk kebun sendiri, kebun sepupu, atau mata entres dengan validasi kuota alokasi tanam.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Permintaan Bibit di /request]
    B --> C{Pilih Tipe Permintaan Bibit?}
    
    C -- Permintaan Kebun Sendiri --> D[Buka /request/kebun-sendiri]
    C -- Permintaan Kebun Sepupu --> E[Buka /request/kebun-sepupu]
    C -- Permintaan Mata Entres --> F[Buka /request/mata-entres]

    D --> G[Buka Form Permintaan Bibit di /request/*/form]
    E --> G
    F --> G

    G --> H[Input Nomor Dokumen SPB Resmi]
    H --> I[Pilih Klon Bibit & Kuantitas Diminta]
    I --> J[Tentukan Jadwal Kebutuhan Tanam Lapangan]
    J --> K[Validasi Kuota Bibit Tersedia di Pembibitan]
    K --> L[Simpan Dokumen SPB ke requests_transactions]
    L --> M[Status: MENUNGGU_PERSETUJUAN]
    M --> N[Menunggu Persetujuan Askep / Pengurus]
    N --> O([Selesai])`,

    sourceProof: {
      flowName: 'Permintaan Bibit SPB',
      route: '/request',
      sourceFiles: [
        'js/modules/request/request-landing.js',
        'js/modules/request/request-kebun-sendiri-landing.js',
        'js/modules/request/request-kebun-sendiri-form.js',
        'js/modules/request/request-kebun-sepupu-landing.js',
        'js/modules/request/request-mata-entres-landing.js'
      ],
      handlers: [
        'renderRequestLanding',
        'renderRequestKebunSendiriForm',
        'renderRequestKebunSepupuForm',
        'renderRequestMataEntresForm'
      ],
      codeRelation: 'Membuat dokumen permintaan bibit (SPB) yang divalidasi ketersediaan klon dan kuotanya, sebagai dokumen induk pemenuhan pengeluaran bibit.',
      verificationStatus: 'Terverifikasi'
    }
  },

  dispatch: {
    id: 'mod-dispatch',
    code: 'MOD-11',
    name: 'Pengeluaran Bibit & Surat Jalan',
    category: 'Distribusi & Logistik',
    route: '/dispatch',
    rolesInvolved: ['Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Pemenuhan permintaan bibit berdasarkan SPB disetujui, verifikasi fisik muat truk, dan penerbitan Surat Jalan resmi.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Pengeluaran Bibit di /dispatch]
    B --> C[Pilih Dokumen SPB yang Telah Disetujui]
    C --> D[Buka Form Pengeluaran Bibit]
    D --> E[Periksa Ketersediaan Stok Bibit Siap Salur]
    E --> F[Input Data Ekspedisi: No Polisi Truk & Nama Supir]
    F --> G[Scan Barcode / QR Alokasi Bibit Siap Salur]
    G --> H[Validasi Kesesuaian Klon & Jumlah Muat]
    H --> I[Terbitkan Surat Jalan Resmi Pengeluaran]
    I --> J[Kurangi Stok Fisik Siap Salur di Gudang]
    J --> K[Buka Pratinjau / Cetak Laporan di /dispatch/report]
    K --> L([Selesai])`,

    sourceProof: {
      flowName: 'Pengeluaran Bibit & Surat Jalan',
      route: '/dispatch',
      sourceFiles: [
        'js/modules/dispatch/dispatch-landing.js',
        'js/modules/dispatch/dispatch-report.js'
      ],
      handlers: [
        'renderDispatchLanding',
        'renderDispatchReport'
      ],
      codeRelation: 'Memverifikasi SPB yang disetujui, mencatat nomor polisi truk, memvalidasi kuantitas siap salur, menerbitkan surat jalan, dan memotong saldo stok gudang.',
      verificationStatus: 'Terverifikasi'
    }
  },

  destruction_bapb: {
    id: 'mod-destruction-bapb',
    code: 'MOD-12',
    name: 'Pemusnahan Bibit (BAPB)',
    category: 'Akuntabilitas & Sanitasi',
    route: '/destruction',
    rolesInvolved: ['Asisten Bibitan', 'Askep', 'Pengurus'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penerbitan Berita Acara Pemusnahan Bibit (BAPB) digital berjenjang 3 Tanda Tangan (ASB, Askep, Pengurus) dengan Zero-Mutation stok fisik.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Asisten Bibitan Buka Modul di /destruction]
    B --> C[Pilih Berkas Bibit Afkir Terverifikasi Seleksi]
    C --> D[Validasi Invarian Zero-Mutation Stok]
    D --> E[Ambil 2 Foto Bukti Pemusnahan via Kamera]
    E --> F[Bubuhkan Tanda Tangan Digital ASB]
    F --> G[Kirim Berkas BAPB ke Askep]
    G --> H[Status: MENUNGGU_TTD_ASKEP]
    H --> I[Askep Buka & Periksa Berkas Pemusnahan]
    I --> J{Apakah Askep Menyetujui BAPB?}
    J -- Disetujui --> K[Bubuhkan Tanda Tangan Digital Askep]
    K --> L[Status: MENUNGGU_PENGESAHAN_PENGURUS]
    J -- Ditolak / Revisi --> M[Status: DIKEMBALIKAN_KE_ASB]
    M --> B
    L --> N[Pengurus Kebun Buka & Periksa Dokumen Final]
    N --> O{Apakah Pengurus Mengesahkan BAPB?}
    O -- Disetujui --> P[Bubuhkan Tanda Tangan Digital Pengurus]
    P --> Q[Status Dokumen: DISETUJUI FINAL]
    Q --> R[Buka Menu Cetak Format A4 Resmi Perusahaan]
    O -- Ditolak / Revisi --> S[Kembalikan Berkas ke Askep / ASB]
    S --> I
    R --> T([Selesai])`,

    sourceProof: {
      flowName: 'Berita Acara Pemusnahan Bibit (BAPB)',
      route: '/destruction',
      sourceFiles: [
        'js/modules/destruction/destruction-landing.js',
        'js/modules/destruction/destruction-manager.js',
        'js/modules/destruction/bapb-print-template.js'
      ],
      handlers: [
        'renderDestructionLanding',
        'createBapbDraft',
        'signBapbAskep',
        'finalizeBapbDocument',
        'printBapbDocument'
      ],
      codeRelation: 'Alur berjenjang 3 level approval visual di HP (ASB, Askep, Pengurus). Kuantitas stok divalidasi murni integer, efek inventaris Zero-Mutation, dan mencetak dokumen format A4.',
      verificationStatus: 'Terverifikasi'
    }
  },

  confirmation_verification: {
    id: 'mod-confirmation-verification',
    code: 'MOD-13',
    name: 'Konfirmasi Mantri & Verifikasi Asisten',
    category: 'Tata Kelola Harian (EOD)',
    route: '/mantri-confirmation',
    rolesInvolved: ['Mantri Bibitan', 'Asisten Bibitan'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Penguncian harian (End of Day): Mantri mengunci transaksi hari berjalan, Asisten Bibitan memverifikasi atau mengembalikan untuk perbaikan.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Mantri Selesaikan Transaksi Hari Ini]
    B --> C[Buka /mantri-confirmation]
    C --> D[Periksa Rekapitulasi Transaksi Hari Berjalan]
    D --> E[Kirim Konfirmasi Harian ke ASB]
    E --> F[Status: MENUNGGU_VERIFIKASI_ASB]
    F --> G[Seluruh Transaksi Terkunci Otomatis di HP Mantri]
    G --> H[Asisten Bibitan Buka Menu /verification]
    H --> I[Periksa Rincian Transaksi & Dokumen Pendukung]
    I --> J{Keputusan Verifikasi Asisten Bibitan?}
    J -- Disetujui --> K[Status: DISETUJUI / VERIFIED]
    K --> L[Transaksi Terkunci Permanen & Push Data ke ERP]
    J -- Dikembalikan --> M[Input Alasan Pengembalian / returnReason]
    M --> N[Status: DIKEMBALIKAN / REVISION]
    N --> O[Buka Kembali Kunci Transaksi Khusus di HP Mantri]
    O --> P[Mantri Lakukan Perbaikan & Kirim Ulang Konfirmasi]
    P --> E
    L --> Q([Selesai])`,

    sourceProof: {
      flowName: 'Konfirmasi Mantri & Verifikasi Asisten (EOD)',
      route: '/mantri-confirmation',
      sourceFiles: [
        'js/modules/verification/mantri-confirmation-landing.js',
        'js/modules/verification/mantri-confirmation-service.js',
        'js/modules/verification/verification-landing.js',
        'js/modules/verification/verification-manager.js'
      ],
      handlers: [
        'renderMantriConfirmationLanding',
        'submitMantriConfirmation',
        'renderVerificationLanding',
        'approveVerificationItem',
        'returnVerificationItem',
        'isTransactionLockedForMantri'
      ],
      codeRelation: 'Mantri mengunci transaksi harian dengan konfirmasi EOD. Asisten Bibitan memeriksa dan dapat menyetujui (kunci permanen) atau mengembalikan (membuka kunci kembali dengan alasan pengembalian).',
      verificationStatus: 'Terverifikasi'
    }
  },

  reports_master: {
    id: 'mod-reports-master',
    code: 'MOD-14',
    name: 'Laporan & Data Master',
    category: 'Pelaporan & Referensi',
    route: '/reports',
    rolesInvolved: ['Mantri Bibitan', 'Asisten Bibitan', 'Askep', 'Pengurus'],
    verificationStatus: 'TERVERIFIKASI RUNTIME',
    summary: 'Akses laporan posisi saldo stok bibitan, histori dokumen dikembalikan, dan pemeliharaan referensi master bedengan, batch, dan material.',
    mermaidSyntax: `flowchart TD
    A([Mulai]) --> B[Buka Menu Laporan di /reports atau Master]
    B --> C{Pilih Jenis Laporan atau Master?}

    C -- Laporan Posisi Stok --> D[Buka /reports/stock]
    D --> E[Filter Berdasarkan Program & Klon Bibit]
    E --> F[Tampilkan Saldo Awal, Masuk, Keluar, Afkir, Saldo Akhir]

    C -- Dokumen Dikembalikan --> G[Buka /reports/returned-docs]
    G --> H[Tinjau Daftar Dokumen yang Butuh Revisi Mantri]

    C -- Master Bedengan --> I[Buka /master/bedengan]
    I --> J[Monitoring Kapasitas, Lokasi & Populasi per Bedengan]

    C -- Master Batch Bibitan --> K[Buka /master/batch]
    K --> L[Monitoring Siklus Hidup Batch dari RCV ke Siap Salur]

    C -- Master Material --> M[Buka /material]
    M --> N[Monitoring Bahan Kimia, Pupuk & Kantong Polibag]

    F --> O([Selesai])
    H --> O
    J --> O
    L --> O
    N --> O`,

    sourceProof: {
      flowName: 'Laporan & Data Master',
      route: '/reports',
      sourceFiles: [
        'js/modules/reports/reports-landing.js',
        'js/modules/reports/nursery-stock-report.js',
        'js/modules/reports/returned-documents-report.js',
        'js/modules/master/master-bedengan.js',
        'js/modules/master/master-batch.js',
        'js/data/material-master.js'
      ],
      handlers: [
        'renderReportsLanding',
        'renderNurseryStockReport',
        'renderReturnedDocumentsReport',
        'renderMasterBedengan',
        'renderMasterBatch',
        'renderMaterialMaster'
      ],
      codeRelation: 'Menyajikan kalkulasi saldo stok terpadu dan referensi master entitas yang digunakan oleh seluruh modul operasional SIGMA Nursery.',
      verificationStatus: 'Terverifikasi'
    }
  }
};
