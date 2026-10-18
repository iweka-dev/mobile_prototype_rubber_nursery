/**
 * core/menu-registry.js — Master Menu, Submenu, Feature & Action Registry (Phase 7).
 *
 * Prinsip: "DEFINE THE STRUCTURE FIRST, INTEGRATE LATER."
 * Hierarki:
 * ROLE -> MENU -> SUBMENU -> FEATURE -> ACTION
 *
 * File ini bersifat READ-ONLY CONFIGURATION dan BELUM menjadi runtime authorization/navigation source.
 */

import { ROLES, SCOPE_TYPES, normalizeRole } from './user-context.js';

export const ACTIONS = Object.freeze({
  VIEW: 'VIEW',
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  DELETE: 'DELETE',
  SUBMIT: 'SUBMIT',
  REVIEW: 'REVIEW',
  APPROVE: 'APPROVE',
  VERIFY: 'VERIFY',
  MONITOR: 'MONITOR',
  EXPORT: 'EXPORT',
  PRINT: 'PRINT'
});

export const IMPLEMENTATION_STATUS = Object.freeze({
  EXISTING: 'EXISTING',
  PARTIAL: 'PARTIAL',
  PLANNED: 'PLANNED',
  DOCUMENTED: 'DOCUMENTED'
});

export const REQUIREMENT_SOURCE = Object.freeze({
  EXISTING_CODE: 'EXISTING_CODE',
  ROLE_PROFILE: 'ROLE_PROFILE',
  PROJECT_REQUIREMENT: 'PROJECT_REQUIREMENT',
  FUTURE: 'FUTURE'
});

/**
 * Canonical 7 Domain Kerja / Modul Operasional untuk Role ASISTEN_BIBITAN.
 * Catatan: Daftar ini adalah referensi konseptual domain kerja operasional.
 * Navigasi operasional ASB didistribusikan ke Beranda (Menu Cards) dan Bottom Navigation,
 * bukan sebagai sumber render menu Sidebar Drawer (drawer ASB dikhususkan untuk Data Master).
 */
export const ASISTEN_BIBITAN_MAIN_MENUS = Object.freeze([
  {
    id: 'penerimaan',
    key: 'PENERIMAAN_BIBIT',
    title: 'Penerimaan',
    label: 'Penerimaan',
    route: '/reception/kebun-sepupu',
    iconName: 'documentPlus',
    order: 1
  },
  {
    id: 'permintaan-bibit',
    key: 'PERMINTAAN_BIBIT',
    title: 'Permintaan',
    label: 'Permintaan',
    route: '/request',
    iconName: 'documentPlus',
    order: 2
  },
  {
    id: 'pengeluaran-bibit',
    key: 'PENGELUARAN_BIBIT',
    title: 'Pengeluaran',
    label: 'Pengeluaran',
    route: '/dispatch',
    iconName: 'sprout',
    order: 3
  },
  {
    id: 'pemeriksaan-seleksi',
    key: 'PEMERIKSAAN_HASIL_SELEKSI',
    title: 'Pemeriksaan<br>Hasil Seleksi',
    label: 'Pemeriksaan Hasil Seleksi',
    route: '/selection',
    iconName: 'sprout',
    order: 4
  },
  {
    id: 'pemusnahan-bibit',
    key: 'PEMUSNAHAN_BIBIT',
    title: 'Pemusnahan<br>Bibit',
    label: 'Pemusnahan Bibit',
    route: '/destruction',
    iconName: 'documentPlus',
    order: 5
  },
  {
    id: 'konsolidasi-data',
    key: 'KONSOLIDASI_DATA',
    title: 'Konsolidasi<br>Data',
    label: 'Konsolidasi Data',
    route: '/consolidation',
    iconName: 'documentPlus',
    order: 6
  },
  {
    id: 'verifikasi-data',
    key: 'VERIFIKASI_DATA',
    title: 'Verifikasi<br>Data',
    label: 'Verifikasi Data',
    route: '/verification',
    iconName: 'documentPlus',
    order: 7
  }
]);

/**
 * Data Master Group Menus for Role ASISTEN_BIBITAN (Sidebar only)
 */
export const ASISTEN_BIBITAN_DATA_MASTER_MENUS = Object.freeze([
  {
    id: 'master-bedengan',
    key: 'MASTER_BEDENGAN',
    label: 'Master Bedengan',
    route: '/master/bedengan',
    iconName: 'database',
    order: 1
  },
  {
    id: 'master-batch',
    key: 'MASTER_BATCH',
    label: 'Master Batch',
    route: '/master/batch',
    iconName: 'database',
    order: 2
  }
]);

/**
 * Master Menu Registry
 */
export const MENU_REGISTRY = Object.freeze([
  {
    id: 'MENU-PRESENSI',
    key: 'PRESENSI',
    label: 'Presensi',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    icon: '👷',
    order: 1,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PENERIMAAN',
    key: 'PENERIMAAN',
    label: 'Penerimaan',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN]),
    icon: '📦',
    order: 2,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PENYEMAIAN',
    key: 'PENYEMAIAN',
    label: 'Penyemaian',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    icon: '🌱',
    order: 3,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-OKULASI',
    key: 'OKULASI',
    label: 'Okulasi',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    icon: '🌿',
    order: 4,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PEMERIKSAAN',
    key: 'PEMERIKSAAN',
    label: 'Pemeriksaan',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASKEP]),
    icon: '🔍',
    order: 5,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PENYELEKSIAN',
    key: 'PENYELEKSIAN',
    label: 'Penyeleksian Bibit',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    icon: '✅',
    order: 6,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-KEBUN-ENTRES',
    key: 'KEBUN_ENTRES',
    label: 'Kebun Entres',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    icon: '🌳',
    order: 7,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-KEGIATAN-BIBITAN',
    key: 'KEGIATAN_BIBITAN',
    label: 'Kegiatan Bibitan',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    icon: '🛠️',
    order: 8,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PERMINTAAN',
    key: 'PERMINTAAN',
    label: 'Permintaan',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN]),
    icon: '📋',
    order: 9,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-PENGIRIMAN',
    key: 'PENGIRIMAN',
    label: 'Pengiriman',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.KTU, ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    icon: '🚚',
    order: 10,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-REVIEW-WORKSPACE',
    key: 'REVIEW_WORKSPACE',
    label: 'Review & Otorisasi',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.KTU, ROLES.ASISTEN_BIBITAN]),
    icon: '📝',
    order: 11,
    status: 'ACTIVE'
  },
  {
    id: 'MENU-RIWAYAT-DATA',
    key: 'RIWAYAT_DATA',
    label: 'Riwayat Data',
    roleKeys: Object.freeze([
      ROLES.PENGURUS,
      ROLES.ASKEP,
      ROLES.ASISTEN,
      ROLES.ASISTEN_BIBITAN,
      ROLES.MANTRI_TANAMAN,
      ROLES.TEKNIKER_I,
      ROLES.KTU
    ]),
    icon: '📅',
    order: 12,
    status: 'ACTIVE'
  }
]);

/**
 * Master Submenu Registry
 */
export const SUBMENU_REGISTRY = Object.freeze([
  // PRESENSI
  {
    id: 'SUB-PRES-SUPERVISOR',
    key: 'PRESENSI_SUPERVISOR',
    menuKey: 'PRESENSI',
    label: 'Presensi Supervisor',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 1,
    status: 'ACTIVE'
  },
  {
    id: 'SUB-PRES-WORKERS',
    key: 'PRESENSI_PEKERJA',
    menuKey: 'PRESENSI',
    label: 'Presensi Pekerja',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 2,
    status: 'ACTIVE'
  },
  {
    id: 'SUB-PRES-SUMMARY',
    key: 'PRESENSI_RINGKASAN',
    menuKey: 'PRESENSI',
    label: 'Ringkasan Presensi',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 3,
    status: 'ACTIVE'
  },

  // PENERIMAAN
  {
    id: 'SUB-RCV-BENIH',
    key: 'PENERIMAAN_BENIH',
    menuKey: 'PENERIMAAN',
    label: 'Penerimaan Benih/Kecambah',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    order: 1,
    status: 'ACTIVE'
  },
  {
    id: 'SUB-RCV-ESTATE',
    key: 'PENERIMAAN_BIBIT_ESTATE',
    menuKey: 'PENERIMAAN',
    label: 'Penerimaan Bibit Kebun',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN]),
    order: 2,
    status: 'ACTIVE'
  },

  // PENYEMAIAN
  {
    id: 'SUB-SEED-FORM',
    key: 'PENYEMAIAN_INPUT',
    menuKey: 'PENYEMAIAN',
    label: 'Input Penyemaian Kecambah',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 1,
    status: 'ACTIVE'
  },

  // OKULASI
  {
    id: 'SUB-BUD-GRAFTING',
    key: 'OKULASI_GRAFTING',
    menuKey: 'OKULASI',
    label: 'Input Okulasi & Grafting',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 1,
    status: 'ACTIVE'
  },
  {
    id: 'SUB-BUD-REGRAFT',
    key: 'OKULASI_REGRAFTING',
    menuKey: 'OKULASI',
    label: 'Okulasi Ulang / Regrafting',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 2,
    status: 'ACTIVE'
  },

  // PEMERIKSAAN
  {
    id: 'SUB-INSP-FIELD',
    key: 'PEMERIKSAAN_LAPANGAN',
    menuKey: 'PEMERIKSAAN',
    label: 'Inspeksi & Pemeriksaan Bibit',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASKEP]),
    order: 1,
    status: 'ACTIVE'
  },

  // PENYELEKSIAN
  {
    id: 'SUB-SEL-CULL',
    key: 'PENYELEKSIAN_BIBIT',
    menuKey: 'PENYELEKSIAN',
    label: 'Seleksi Bibit Siap Tanam & Afkir',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    order: 1,
    status: 'ACTIVE'
  },

  // KEBUN ENTRES
  {
    id: 'SUB-ENT-MENUNAS',
    key: 'ENTRES_MENUNAS',
    menuKey: 'KEBUN_ENTRES',
    label: 'Kegiatan Menunas Entres',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 1,
    status: 'ACTIVE'
  },
  {
    id: 'SUB-ENT-TOPPING',
    key: 'ENTRES_TOPPING',
    menuKey: 'KEBUN_ENTRES',
    label: 'Topping & Pemanenan Entres',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 2,
    status: 'ACTIVE'
  },

  // KEGIATAN BIBITAN
  {
    id: 'SUB-ACT-MAINT',
    key: 'KEGIATAN_PEMELIHARAAN',
    menuKey: 'KEGIATAN_BIBITAN',
    label: 'Pemeliharaan & Perawatan Bibitan',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    order: 1,
    status: 'ACTIVE'
  },

  // PERMINTAAN
  {
    id: 'SUB-REQ-ESTATE',
    key: 'PERMINTAAN_BIBIT_ESTATE',
    menuKey: 'PERMINTAAN',
    label: 'Permintaan Bibit Kebun Sepupu',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN]),
    order: 1,
    status: 'ACTIVE'
  },

  // PENGIRIMAN
  {
    id: 'SUB-DSP-ESTATE',
    key: 'PENGIRIMAN_BIBIT_ESTATE',
    menuKey: 'PENGIRIMAN',
    label: 'Pengiriman & Dispatch Bibit',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.KTU, ROLES.ASISTEN_BIBITAN]),
    order: 1,
    status: 'ACTIVE'
  },

  // REVIEW WORKSPACE
  {
    id: 'SUB-REV-APPROVAL',
    key: 'REVIEW_VERIFIKASI',
    menuKey: 'REVIEW_WORKSPACE',
    label: 'Verifikasi & Otorisasi Transaksi',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.KTU, ROLES.ASISTEN_BIBITAN]),
    order: 1,
    status: 'ACTIVE'
  },

  // RIWAYAT DATA
  {
    id: 'SUB-HIST-LOGS',
    key: 'RIWAYAT_LOGS',
    menuKey: 'RIWAYAT_DATA',
    label: 'Log Riwayat Transaksi',
    roleKeys: Object.freeze([
      ROLES.PENGURUS,
      ROLES.ASKEP,
      ROLES.ASISTEN,
      ROLES.ASISTEN_BIBITAN,
      ROLES.MANTRI_TANAMAN,
      ROLES.TEKNIKER_I,
      ROLES.KTU
    ]),
    order: 1,
    status: 'ACTIVE'
  }
]);

/**
 * Master Feature Registry
 */
export const FEATURE_REGISTRY = Object.freeze([
  // --- PRESENSI FEATURES ---
  {
    id: 'FEAT-PRES-001',
    key: 'PRESENSI_SUPERVISOR_SUBMIT',
    submenuKey: 'PRESENSI_SUPERVISOR',
    label: 'Presensi Mandiri Supervisor',
    description: 'Pencatatan swafoto & waktu kehadiran supervisor pembibitan.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-PRES-002',
    key: 'PRESENSI_WORKERS_LOG',
    submenuKey: 'PRESENSI_PEKERJA',
    label: 'Presensi Pekerja Harian',
    description: 'Pencatatan kehadiran dan ketidakhadiran pekerja bibitan.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-PRES-003',
    key: 'PRESENSI_SUMMARY_VIEW',
    submenuKey: 'PRESENSI_RINGKASAN',
    label: 'Ringkasan & Validasi Presensi',
    description: 'Ringkasan kehadiran harian mandor & pekerja bibitan.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.MONITOR]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PENERIMAAN FEATURES ---
  {
    id: 'FEAT-RCV-001',
    key: 'PENERIMAAN_BENIH_ENTRY',
    submenuKey: 'PENERIMAAN_BENIH',
    label: 'Penerimaan Benih Kecambah',
    description: 'Penerimaan fisik kecambah dari supplier dan validasi dokumen SIR.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-RCV-002',
    key: 'PENERIMAAN_BIBIT_APPROVAL',
    submenuKey: 'PENERIMAAN_BIBIT_ESTATE',
    label: 'Monitoring & Otorisasi Penerimaan Bibit',
    description: 'Review dan pengesahan batch penerimaan bibit tingkat kebun.',
    roleKeys: Object.freeze([ROLES.PENGURUS]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.REVIEW, ACTIONS.APPROVE]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PENYEMAIAN FEATURES ---
  {
    id: 'FEAT-SEED-001',
    key: 'PENYEMAIAN_FORM_ENTRY',
    submenuKey: 'PENYEMAIAN_INPUT',
    label: 'Input Penanaman Kecambah',
    description: 'Pencatatan penanaman benih ke bedengan dengan QR scanner.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- OKULASI FEATURES ---
  {
    id: 'FEAT-BUD-001',
    key: 'OKULASI_GRAFTING_ENTRY',
    submenuKey: 'OKULASI_GRAFTING',
    label: 'Input Okulasi & Grafting',
    description: 'Pencatatan hasil okulasi per bedengan dan pekerja.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-BUD-002',
    key: 'OKULASI_REGRAFTING_ENTRY',
    submenuKey: 'OKULASI_REGRAFTING',
    label: 'Input Regrafting (Okulasi Ulang)',
    description: 'Pencatatan okulasi susulan pada bibit yang tidak menempel.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PEMERIKSAAN FEATURES ---
  {
    id: 'FEAT-INSP-001',
    key: 'PEMERIKSAAN_LAPANGAN_ENTRY',
    submenuKey: 'PEMERIKSAAN_LAPANGAN',
    label: 'Inspeksi Kondisi Bibitan & Foto',
    description: 'Pemeriksaan visual bibit, kesehatan, dan upload foto evidensi.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN, ROLES.ASKEP]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT, ACTIONS.VERIFY]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PENYELEKSIAN FEATURES ---
  {
    id: 'FEAT-SEL-001',
    key: 'PENYELEKSIAN_BIBIT_ENTRY',
    submenuKey: 'PENYELEKSIAN_BIBIT',
    label: 'Seleksi Bibit Siap Tanam & Culling',
    description: 'Pemisahan bibit normal/siap kirim dan afkir (mati/abnormal/rusak).',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- KEBUN ENTRES FEATURES ---
  {
    id: 'FEAT-ENT-001',
    key: 'ENTRES_MENUNAS_ENTRY',
    submenuKey: 'ENTRES_MENUNAS',
    label: 'Pencatatan Kegiatan Menunas',
    description: 'Pembersihan tunas liar pada kebun entres.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-ENT-002',
    key: 'ENTRES_TOPPING_ENTRY',
    submenuKey: 'ENTRES_TOPPING',
    label: 'Pencatatan Topping & Panen Entres',
    description: 'Pemanenan kayu entres untuk kebutuhan okulasi.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- KEGIATAN BIBITAN FEATURES ---
  {
    id: 'FEAT-ACT-001',
    key: 'KEGIATAN_MAINTENANCE_LOG',
    submenuKey: 'KEGIATAN_PEMELIHARAAN',
    label: 'Konsolidasi & Pemeliharaan Bibitan',
    description: 'Penyiraman, pemupukan, penyiangan gulma, dan proteksi tanaman.',
    roleKeys: Object.freeze([ROLES.MANTRI_TANAMAN, ROLES.ASISTEN_BIBITAN]),
    expectedScope: SCOPE_TYPES.DIVISION,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.SUBMIT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PERMINTAAN FEATURES ---
  {
    id: 'FEAT-REQ-001',
    key: 'PERMINTAAN_BIBIT_LIST',
    submenuKey: 'PERMINTAAN_BIBIT_ESTATE',
    label: 'Daftar Permintaan Bibit',
    description: 'Melihat batch permintaan bibit dari kebun sepupu / unit pemesan.',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.ASISTEN, ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.MONITOR]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },
  {
    id: 'FEAT-REQ-002',
    key: 'PERMINTAAN_BIBIT_APPROVAL',
    submenuKey: 'PERMINTAAN_BIBIT_ESTATE',
    label: 'Otorisasi Permintaan Bibit',
    description: 'Approval permintaan bibit oleh Pengurus Kebun.',
    roleKeys: Object.freeze([ROLES.PENGURUS]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.REVIEW, ACTIONS.APPROVE]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- PENGIRIMAN FEATURES ---
  {
    id: 'FEAT-DSP-001',
    key: 'PENGIRIMAN_BIBIT_DISPATCH',
    submenuKey: 'PENGIRIMAN_BIBIT_ESTATE',
    label: 'Surat Pengantar & Dispatch Bibit',
    description: 'Pembuatan surat pengantar pengiriman bibit ke afdeling/kebun tujuan.',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.KTU, ROLES.MANTRI_TANAMAN]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.REVIEW, ACTIONS.APPROVE]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- REVIEW WORKSPACE FEATURES ---
  {
    id: 'FEAT-REV-001',
    key: 'REVIEW_TRANSAKSI_WORKSPACE',
    submenuKey: 'REVIEW_VERIFIKASI',
    label: 'Workspace Review & Approval Transaksi',
    description: 'Pusat verifikasi dan approval berkas transaksi operasional.',
    roleKeys: Object.freeze([ROLES.PENGURUS, ROLES.ASKEP, ROLES.KTU]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.REVIEW, ACTIONS.APPROVE, ACTIONS.VERIFY]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  },

  // --- RIWAYAT DATA FEATURES ---
  {
    id: 'FEAT-HIST-001',
    key: 'RIWAYAT_TRANSAKSI_VIEW',
    submenuKey: 'RIWAYAT_LOGS',
    label: 'Riwayat Transaksi & Audit Log',
    description: 'Log transaksi pembibitan yang telah tersimpan dan tersinkronisasi.',
    roleKeys: Object.freeze([
      ROLES.PENGURUS,
      ROLES.ASKEP,
      ROLES.ASISTEN,
      ROLES.ASISTEN_BIBITAN,
      ROLES.MANTRI_TANAMAN,
      ROLES.TEKNIKER_I,
      ROLES.KTU
    ]),
    expectedScope: SCOPE_TYPES.ESTATE,
    implementationStatus: IMPLEMENTATION_STATUS.EXISTING,
    actionKeys: Object.freeze([ACTIONS.VIEW, ACTIONS.EXPORT]),
    requirementSource: REQUIREMENT_SOURCE.EXISTING_CODE
  }
]);

// ==========================================
// GENERIC QUERY HELPERS
// ==========================================

/**
 * Mengambil seluruh menu yang dapat diakses oleh role tertentu.
 * Jika role adalah legacy role, di-resolve via normalizeRole().
 * @param {string} role
 * @returns {Array<Object>}
 */
export function getMenusByRole(role) {
  if (!role) return [];
  const canonicalRole = normalizeRole(role);
  return MENU_REGISTRY.filter((m) => m.roleKeys.includes(canonicalRole)).sort((a, b) => a.order - b.order);
}

/**
 * Mengambil seluruh submenu dari menuKey tertentu.
 * @param {string} menuKey
 * @returns {Array<Object>}
 */
export function getSubmenusByMenu(menuKey) {
  if (!menuKey) return [];
  return SUBMENU_REGISTRY.filter((s) => s.menuKey === menuKey).sort((a, b) => a.order - b.order);
}

/**
 * Mengambil seluruh features yang dapat diakses oleh role tertentu.
 * @param {string} role
 * @returns {Array<Object>}
 */
export function getFeaturesByRole(role) {
  if (!role) return [];
  const canonicalRole = normalizeRole(role);
  return FEATURE_REGISTRY.filter((f) => f.roleKeys.includes(canonicalRole));
}

/**
 * Mengambil seluruh features yang berada di bawah menuKey tertentu.
 * @param {string} menuKey
 * @returns {Array<Object>}
 */
export function getFeaturesByMenu(menuKey) {
  if (!menuKey) return [];
  const submenus = getSubmenusByMenu(menuKey).map((s) => s.key);
  return FEATURE_REGISTRY.filter((f) => submenus.includes(f.submenuKey));
}

/**
 * Mengambil feature berdasarkan featureKey.
 * @param {string} featureKey
 * @returns {Object|null}
 */
export function getFeature(featureKey) {
  if (!featureKey) return null;
  return FEATURE_REGISTRY.find((f) => f.key === featureKey) || null;
}

/**
 * Mengambil daftar aksi yang diperbolehkan pada suatu feature.
 * @param {string} featureKey
 * @returns {Array<string>}
 */
export function getFeatureActions(featureKey) {
  const feat = getFeature(featureKey);
  return feat ? [...feat.actionKeys] : [];
}

/**
 * Memeriksa apakah suatu feature sudah terimplementasi (EXISTING).
 * @param {string} featureKey
 * @returns {boolean}
 */
export function isFeatureExisting(featureKey) {
  const feat = getFeature(featureKey);
  return feat ? feat.implementationStatus === IMPLEMENTATION_STATUS.EXISTING : false;
}
