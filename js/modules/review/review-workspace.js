/**
 * modules/review/review-workspace.js — Prototype Review & Catatan Perbaikan Workspace.
 * Mengelola feedback dinamis ke Database Server (REST API /api/notes),
 * notifikasi email otomatis, marker layer responsif, filter, dan CRUD status.
 */

import { getCurrent, navigate } from '../../core/router.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { esc, todayISO, uid, formatStandardDocNo, generateUniqueDocNo, getModuleDocCode, MODULE_DOC_CODES, getAttendanceUniqueKey } from '../../core/utils.js';
import { session } from '../../core/session.js';
import { storage } from '../../core/storage.js';
import { ROLE_LABELS } from '../../core/permissions.js';
import {
  attendanceRepository,
  receptionRepository,
  seedingRepository,
  buddingRepository,
  inspectionRepository,
  selectionRepository,
  entresRepository,
  nurseryActivityRepository,
  warehouseStockRepository,
  requestRepository,
  syncQueueRepository
} from '../../db/repositories.js';
import { resetDatabase } from '../../db/indexeddb.js';
import { renderProcessMappingPortal } from '../process-mapping/process-mapping-ui.js';
import { renderInfoCenterPortal } from '../info-center/info-center-ui.js';
import { cleanAllTransactionalData } from '../../core/storage-registry.js';
import { setWorkspaceViewMode } from '../../core/workspace-view.js';
import {
  initMaterialMasterStorage,
  getAllIssueDocuments,
  getIssueUsageTransactions,
  getIssueByNoIssue,
  getUnifiedMaterialRecords
} from '../../data/material-master.js';

const STORAGE_KEY = 'sigma_feedback_notes';
const API_URL = '/api/notes';

/**
 * Master Canonical Page & Route Mapping Registry untuk Review & Pin Marker
 */
export const CANONICAL_PAGE_MAP = Object.freeze({
  '/login': 'Login',
  '/splash': 'Splash',
  '/sync': 'Sinkronisasi',
  '/home': 'Beranda',
  '/attendance': 'Presensi',
  '/attendance/supervisor': 'Presensi Supervisor',
  '/attendance/supervisor/result': 'Hasil Presensi Supervisor',
  '/attendance/workers': 'Presensi Pekerja',
  '/attendance/summary': 'Ringkasan Presensi',
  '/reception': 'Penerimaan',
  '/reception/kebun-sepupu': 'Penerimaan Bibit Kebun Sepupu',
  '/reception/benih': 'Penerimaan Benih',
  '/reception/benih/sir': 'Penerimaan Benih (SIR)',
  '/reception/benih/camera': 'Penerimaan Benih (Kamera)',
  '/reception/summary': 'Ringkasan Penerimaan',
  '/reception/placeholder': 'Penerimaan (Placeholder)',
  '/seeding': 'Penyemaian & Dederan',
  '/seeding/scan': 'Scan Penyemaian',
  '/seeding/form': 'Pindah Semai (Form)',
  '/seeding/issue-select': 'Pilih Dokumen Issue',
  '/seeding/dederan/scan': 'Scan Bedengan Dederan',
  '/seeding/dederan/form': 'Transaksi Dederan',
  '/seeding/dederan/inspection': 'Pemeriksaan Dederan',
  '/budding': 'Okulasi',
  '/budding/grafting': 'Okulasi & Grafting',
  '/budding/grafting/scan': 'Scan Okulasi',
  '/budding/grafting/form': 'Form Okulasi',
  '/budding/regrafting': 'Okulasi Ulang (Regrafting)',
  '/inspection': 'Pemeriksaan',
  '/inspection/scan': 'Scan Pemeriksaan',
  '/inspection/form': 'Form Pemeriksaan',
  '/inspection/dederan/form': 'Form Pemeriksaan Dederan',
  '/selection': 'Penyeleksian Bibitan',
  '/selection/culling': 'Pemusnahan Bibit (Culling)',
  '/history': 'Histori Transaksi',
  '/transactions': 'Manajer Transaksi',
  '/material': 'Material & Bahan',
  '/nursery-activity': 'Rekam Pemeliharaan',
  '/nursery-activity/form': 'Form Rekam Pemeliharaan',
  '/nursery-activity/consolidation': 'Konsolidasi Hasil Mandoran',
  '/request': 'Permintaan Bibit',
  '/request/kebun-sepupu': 'Permintaan Kebun Sepupu',
  '/request/kebun-sepupu/form': 'Form Permintaan Kebun Sepupu',
  '/request/kebun-sendiri': 'Permintaan Kebun Sendiri',
  '/request/kebun-sendiri/form': 'Form Permintaan Kebun Sendiri',
  '/request/mata-entres': 'Permintaan Mata Entres',
  '/request/mata-entres/form': 'Form Permintaan Mata Entres',
  '/dispatch': 'Pengeluaran Bibit',
  '/dispatch/report': 'Laporan Pengeluaran Bibit',
  '/entres': 'Kebun Entres',
  '/entres/stock': 'Stok Mata Entres',
  '/entres/stock/detail': 'Detail Stok Klon',
  '/entres/menunas': 'Menunas Entres',
  '/entres/menunas/form': 'Form Menunas Entres',
  '/entres/topping': 'Topping Entres',
  '/entres/topping/form': 'Form Topping Entres',
  '/master/bedengan': 'Master Bedengan',
  '/master/batch': 'Master Batch',
  '/destruction': 'Pemusnahan Bibit',
  '/consolidation': 'Konsolidasi Data',
  '/verification': 'Verifikasi Data',
  '/profile': 'Profil Pengguna'
});

/**
 * Mengambil nama judul kanonikal halaman berdasarkan route URL
 * @param {string} route 
 * @returns {string}
 */
export function getPageTitle(route) {
  if (!route) return 'Aplikasi';
  const clean = String(route).split('?')[0].trim();
  if (CANONICAL_PAGE_MAP[clean]) {
    return CANONICAL_PAGE_MAP[clean];
  }
  // Check prefix match for nested subpages
  for (const [key, title] of Object.entries(CANONICAL_PAGE_MAP)) {
    if (clean.startsWith(key) && key !== '/' && key !== '/home') {
      return title;
    }
  }
  // Friendly format from path: e.g. /custom-page -> "Custom Page"
  const parts = clean.split('/').filter(Boolean);
  if (parts.length > 0) {
    return parts.map(p => p.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(' - ');
  }
  return 'Aplikasi';
}


const PROCESS_STEPS = [
  {
    step: 1,
    title: 'Autentikasi, VPN & Sinkronisasi Master Data',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Semua Role (Wajib VPN)',
    status: 'READY',
    statusLabel: 'Siap Uji (Aktif)',
    route: '/sync',
    desc: 'Pengguna mengaktifkan koneksi VPN (Status: Connected), melakukan login identitas kredensial terdaftar, inisialisasi offline storage, dan sinkronisasi master data terkini (Divisi, Pekerja, SIR, Klon, Gudang).',
    output: 'Status VPN Connected, Master data tersimpan di Database Server, sesi login aktif.',
    icon: '🔐',
    flowChart: {
      summary: 'Alur aktivasi wajib koneksi VPN (Status Connected) untuk seluruh role, otentikasi akun, dan sinkronisasi dataset master dengan Database Server.',
      nodes: [
        { id: '1.1', type: 'start', label: 'Buka App & Splash Screen', actor: 'Semua Role', desc: 'Inisialisasi PWA & pengecekan sesi login lokal' },
        { id: '1.2', type: 'process', label: 'Aktivasi Switch VPN', actor: 'Semua Role', desc: 'Nyalakan toggle VPN hingga berstatus Connected' },
        { id: '1.3', type: 'decision', label: 'Status VPN Connected?', actor: 'Sistem', desc: 'Pemeriksaan status koneksi jaringan aman', branch: '✅ Connected: Buka Form Login | ❌ Disconnected: Login Terkunci' },
        { id: '1.4', type: 'process', label: 'Input Kredensial Akun', actor: 'Semua Role', desc: 'Masukkan Nama Akun / NIK dan Kata Sandi' },
        { id: '1.5', type: 'process', label: 'Tarik & Simpan Master Data', actor: 'Storage Engine', desc: 'Sinkronisasi Divisi, Pekerja, SIR, Klon, & Gudang dari Database Server' },
        { id: '1.6', type: 'end', label: 'Beranda Siap Operasional', actor: 'Semua Role', desc: 'Sesi aktif terverifikasi, hak akses role terbuka' }
      ],
      inputs: ['Koneksi VPN Aktif (Status Connected)', 'Nama Akun / NIK Terdaftar', 'Kata Sandi'],
      outputs: ['Koneksi Jaringan Aman Terverifikasi', 'Sesi Login Aktif (Session Storage)', 'Database Server Terisi Lengkap'],
      sopRules: [
        'VPN wajib diaktifkan (Status: Connected) pada semua role agar dapat melakukan login.',
        'Wajib sync data setiap pagi di kantor/afdeling sebelum masuk areal blind spot.',
        'Gunakan kredensial akun pribadi yang sah.'
      ]
    }
  },
  {
    step: 2,
    title: 'Presensi Harian Supervisor & Pekerja',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri Bibitan',
    status: 'READY',
    statusLabel: 'Siap Uji (Aktif)',
    route: '/attendance',
    desc: 'Rekam presensi supervisor dengan verifikasi GPS + kamera selfie mandor, serta rekap kehadiran pekerja harian nursery (Hadir/Sakit/Izin/Alpa).',
    output: 'Status kehadiran tervalidasi, izin buka transaksi operasional harian.',
    icon: '👥',
    flowChart: {
      summary: 'Alur pembuktian fisik kehadiran mandor/mantri via geotagging + selfie, dilanjutkan pencatatan daftar hadir tenaga kerja harian.',
      nodes: [
        { id: '2.1', type: 'start', label: 'Buka Menu Presensi', actor: 'Mandor / Mantri', desc: 'Akses modul Presensi di Beranda' },
        { id: '2.2', type: 'process', label: 'Deteksi GPS & Selfie', actor: 'Mandor', desc: 'Ambil koordinat GPS nursery & foto live mandor' },
        { id: '2.3', type: 'decision', label: 'Dalam Radius Nursery?', actor: 'Geolocation', desc: 'Cek radius geofence lokasi kerja', branch: '✅ Sesuai: Terverifikasi | ❌ Luar: Peringatan Jarak' },
        { id: '2.4', type: 'process', label: 'Pilih Divisi & Grup', actor: 'Mandor', desc: 'Filter daftar pekerja harian nursery' },
        { id: '2.5', type: 'process', label: 'Input Status Hadir/Absen', actor: 'Mandor', desc: 'Tandai status (Hadir / Sakit / Izin / Alpa)' },
        { id: '2.6', type: 'end', label: 'Presensi Terkunci & Izin Kerja', actor: 'Sistem', desc: 'Total HK dihitung, kunci akses transaksi harian dibuka' }
      ],
      inputs: ['Koordinat Geolocation (GPS)', 'Foto Selfie Mandor', 'Daftar Roster Pekerja Harian'],
      outputs: ['Log Presensi Mandor Tervalidasi', 'Rekap HK Harian Pekerja'],
      sopRules: ['Presensi supervisor wajib dilakukan sebelum pukul 07:00 WIB di titik nursery resmi.', 'Pekerja alpa tanpa keterangan wajib dilaporkan ke Asisten.']
    }
  },
  {
    step: 3,
    title: 'Penerimaan Benih / Biji Kelatak & Material',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri Bibitan',
    status: 'READY',
    statusLabel: 'Siap Uji (Aktif)',
    route: '/reception',
    desc: 'Penerimaan fisik benih/biji kelatak karet dari Kebun Sendiri / Pihak Ke-III, scan/input nomor SIR, upload foto bukti fisik, dan sortir afkir biji pecah/busuk.',
    output: 'Dokumen Penerimaan (2026/APR/...), stok bibit awal tercatat.',
    icon: '📦',
    flowChart: {
      summary: 'Alur penerimaan fisik kiriman benih biji kelatak karet, pemeriksaan surat jalan SIR, pemisahan biji afkir, dokumentasi foto, dan registrasi batch stok.',
      nodes: [
        { id: '3.1', type: 'start', label: 'Logistik Benih Tiba', actor: 'Driver / Vendor', desc: 'Biji kelatak tiba di nursery bersama Surat SIR' },
        { id: '3.2', type: 'process', label: 'Pilih Asal & Nomor SIR', actor: 'Mantri', desc: 'Pilih Kebun Sendiri / Pihak III, no SIR & klon' },
        { id: '3.3', type: 'process', label: 'Sortir & Hitung Fisik', actor: 'Mantri & Pekerja', desc: 'Hitung total biji dan pisahkan biji pecah/busuk' },
        { id: '3.4', type: 'decision', label: 'Standar Kualitas Biji?', actor: 'Mantri', desc: 'Evaluasi kesegaran biji kelatak', branch: '✅ Lolos: Qty Diterima | ❌ Cacat: Catat Afkir & Alasan' },
        { id: '3.5', type: 'process', label: 'Ambil Foto Dokumentasi', actor: 'Mantri', desc: 'Foto sampel benih, karung, dan nota pengantar' },
        { id: '3.6', type: 'end', label: 'Terbit RCV & Batch Stok', actor: 'Sistem', desc: 'Nomor RCV & Batch ID terbit, stok masuk gudang' }
      ],
      inputs: ['Biji Kelatak Karet', 'Dokumen Surat Izin Rilis (SIR)', 'Surat Pengantar / DO Vendor', 'Foto Fisik Lapangan'],
      outputs: ['Dokumen Penerimaan (2026/APR/...)', 'Nomor Batch Penerimaan', 'Stok Benih Gudang Terupdate'],
      sopRules: ['Sortir biji maksimal dilakukan 1x24 jam setelah tiba untuk menjaga daya kecambah.', 'Kadar afkir > 5% wajib dilaporkan segera kepada Asisten Divisi.']
    }
  },
  {
    step: 4,
    title: 'Penyemaian Benih (Germination Bed)',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri Bibitan',
    status: 'READY',
    statusLabel: 'Siap Uji (Aktif)',
    route: '/seeding',
    desc: 'Penaburan benih kelatak ke bedengan perkecambahan pasir basah, pelabelan bedengan, pencatatan persentase daya kecambah, bibit disemai, dan afkir penaburan.',
    output: 'Kartu Bedengan Semai, akumulasi bibit tersemai terhadap batch SIR.',
    icon: '🌱',
    flowChart: {
      summary: 'Alur penaburan biji kelatak ke media pasir bedengan semai, pemasangan papan label batch, dan pemantauan perkecambahan harian.',
      nodes: [
        { id: '4.1', type: 'start', label: 'Ambil Benih Batch RCV', actor: 'Mantri', desc: 'Pilih alokasi benih dari stok penerimaan aktif' },
        { id: '4.2', type: 'process', label: 'Pilih Plot Bedengan Pasir', actor: 'Mantri', desc: 'Tentukan plot bedengan perkecambahan steril' },
        { id: '4.3', type: 'process', label: 'Penaburan Biji ke Pasir', actor: 'Pekerja Semai', desc: 'Benih dibenamkan posisi perut bawah kedalaman 1-2 cm' },
        { id: '4.4', type: 'process', label: 'Catat Qty Tebar & Afkir', actor: 'Mantri', desc: 'Rekam jumlah biji disemai dan afkir penaburan' },
        { id: '4.5', type: 'process', label: 'Pasang Label Bedengan', actor: 'Mantri', desc: 'Cantumkan Klon, No SIR, Tgl Tabur, dan Qty' },
        { id: '4.6', type: 'end', label: 'Kartu Bedengan Semai Aktif', actor: 'Sistem', desc: 'Monitoring daya kecambah harian (stadium jarum) dimulai' }
      ],
      inputs: ['Benih Batch RCV Terpilih', 'Nomor Plot Bedengan Pasir', 'Pasir Bersih & Steril'],
      outputs: ['Kartu Bedengan Semai (KBS)', 'Akumulasi Tebar terhadap Stok SIR'],
      sopRules: ['Bedengan disiram 2x sehari (pagi & sore), naungan paranet 50-70%.', 'Biji ditabur rapat teratur dengan jarak 1-2 cm antar biji.']
    }
  },
  {
    step: 5,
    title: 'Pindah Tanam ke Polibag (Main Nursery)',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri Bibitan',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/selection',
    desc: 'Pemindahan bibit kecambah sehat (stadium jarum/daun pancing) dari bedengan perkecambahan ke polibag tanah di lapangan pembibitan utama (Main Nursery).',
    output: 'Nomor plot baris, populasi polybag tegak di nursery.',
    icon: '🪴',
    flowChart: {
      summary: 'Alur pencabutan kecambah stadium jarum, penyeleksian bentuk akar tunggang, penanaman ke polybag tanah, dan penataan baris Main Nursery.',
      nodes: [
        { id: '5.1', type: 'start', label: 'Cek Kesiapan Kecambah', actor: 'Mantri', desc: 'Periksa kecambah umur 14-21 hari (stadium jarum/pancing)' },
        { id: '5.2', type: 'process', label: 'Pencabutan & Sortir Akar', actor: 'Mantri & Pekerja', desc: 'Pilih kecambah lurus, akar tunggang tidak bercabang' },
        { id: '5.3', type: 'decision', label: 'Akar Lurus & Sehat?', actor: 'Mantri', desc: 'Cek kelainan akar / kerdil', branch: '✅ Lolos: Siap Tanam | ❌ Bengkok: Afkir / Buang' },
        { id: '5.4', type: 'process', label: 'Transplanting ke Polybag', actor: 'Pekerja', desc: 'Tanam ke polybag 15x35 cm media top soil + pupuk RP dasar' },
        { id: '5.5', type: 'process', label: 'Plotting Baris Main Nursery', actor: 'Mantri', desc: 'Pola ganda 2 baris, catat nomor blok & tgl tanam' },
        { id: '5.6', type: 'end', label: 'Populasi Polybag Terdaftar', actor: 'Sistem', desc: 'Jumlah polybag tegak tercatat, mutasi dari bedengan semai' }
      ],
      inputs: ['Kecambah Stadium Jarum / Pancing', 'Polybag 15x35 cm + Top Soil Gembur', 'Pupuk Dasar Rock Phosphate (RP)'],
      outputs: ['Nomor Blok/Baris Main Nursery', 'Jumlah Polybag Tegak Aktif'],
      sopRules: ['Transplanting wajib selesai sebelum stadium daun melebar agar akar tidak putus.', 'Polybag harus dipadatkan merata dan langsung disiram jenuh.']
    }
  },
  {
    step: 6,
    title: 'Kebun Entres & Okulasi (Budding)',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri & Tukang Okulasi',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/budding',
    desc: 'Pengambilan mata kayu entres murni (PB 260, RRIM 600, GT 1) dari Kebun Entres, penempelan mata tunas pada batang bawah, pembukaan perban, dan rekam persentase keberhasilan.',
    output: 'Catatan hasil okulasi (% jadi), mutasi status klon bibitan.',
    icon: '🌿',
    flowChart: {
      summary: 'Alur pemanenan ranting kayu entres murni bersertifikat, pelaksanaan teknik okulasi pada batang bawah, pembukaan perban 21 hari, dan evaluasi persentase mata jadi.',
      nodes: [
        { id: '6.1', type: 'start', label: 'Panen Kayu Entres Murni', actor: 'Mantri Entres', desc: 'Panen ranting entres klon murni (PB 260, RRIM 600, GT 1)' },
        { id: '6.2', type: 'process', label: 'Verifikasi Batang Bawah', actor: 'Tukang Okulasi', desc: 'Batang bawah umur 4-6 bulan, diameter min. 1.0 - 1.5 cm' },
        { id: '6.3', type: 'process', label: 'Sayat Kulit & Tempel Mata', actor: 'Tukang Okulasi', desc: 'Sayat jendela batang bawah, iris perisai mata, dan rekatkan' },
        { id: '6.4', type: 'process', label: 'Balut Pita Plastik Okulasi', actor: 'Tukang Okulasi', desc: 'Lilitkan pita PE kedap air dari arah bawah ke atas' },
        { id: '6.5', type: 'decision', label: 'Buka Perban (Hari ke-21)', actor: 'Mantri', desc: 'Kikis kulit mata tunas', branch: '✅ Hijau: Jadi (Berhasil) | ❌ Coklat: Gagal (Okulasi Ulang)' },
        { id: '6.6', type: 'end', label: 'Rekap Keberhasilan Okulasi', actor: 'Sistem', desc: 'Catatan % jadi per okulator terbit, status klon bibitan terdaftar' }
      ],
      inputs: ['Kayu Entres Klon Murni', 'Batang Bawah Sehat (Rootstock)', 'Pisau Okulasi & Pita Plastik PE'],
      outputs: ['Rekap Hasil Okulasi (% Jadi)', 'Label Klon Terpasang pada Polybag'],
      sopRules: ['Standar keberhasilan okulasi minimal 85-90% per okulator.', 'Kayu entres yang dipanen harus digunakan dalam waktu maksimal 2x24 jam.']
    }
  },
  {
    step: 7,
    title: 'Pemeriksaan Mutu & Penyeleksian (Culling)',
    role: 'ASISTEN',
    roleLabel: 'Mantri & Asisten Lapangan',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/inspection',
    desc: 'Pemeriksaan standar mutu pertumbuhan, pemenggalan batang atas, penyeleksian bibit kerdil / penyakit jamur akar, dan penandaan afkir sebelum siap tanam.',
    output: 'Berita Acara Seleksi, kuota bibit tersertifikasi siap salur.',
    icon: '🔍',
    flowChart: {
      summary: 'Alur pemenggalan batang bawah (snagging), pemeliharaan payung daun 1-2, inspeksi agronomi berkala, eliminasi bibit cacat/penyakit, dan penerbitan sertifikasi bibit siap salur.',
      nodes: [
        { id: '7.1', type: 'start', label: 'Pemenggalan Batang Atas', actor: 'Pekerja', desc: 'Potong batang bawah 5-10 cm di atas mata tunas okulasi' },
        { id: '7.2', type: 'process', label: 'Pembentukan Payung Daun', actor: 'Mantri', desc: 'Pelihara tunas hingga payung ke-1 & ke-2 matang (daun tua)' },
        { id: '7.3', type: 'process', label: 'Inspeksi Mutu & Kesehatan', actor: 'Asisten & Mantri', desc: 'Cek diameter lilit batang, bebas Jamur Akar Putih (JAP)' },
        { id: '7.4', type: 'decision', label: 'Lolos Standar Mutu?', actor: 'Asisten Lapangan', desc: 'Evaluasi kriteria bibit unggul', branch: '✅ Memenuhi: Lolos Sertifikasi | ❌ Sakit/Kerdil: Musnahkan' },
        { id: '7.5', type: 'process', label: 'Penandaan Cat & Label Mutu', actor: 'Mantri', desc: 'Beri tanda cat putih pada polybag lolos seleksi' },
        { id: '7.6', type: 'end', label: 'Berita Acara Seleksi (BAS)', actor: 'Sistem', desc: 'Berita Acara Seleksi terbit, kuota bibit siap salur terkunci' }
      ],
      inputs: ['Bibit Okulasi Payung 2 Matang', 'Kriteria Standar Mutu Bibit Socfindo', 'Peralatan Culling & Cat Penanda'],
      outputs: ['Berita Acara Seleksi (BAS)', 'Kuota Bibit Tersertifikasi Siap Tanam'],
      sopRules: ['Bibit afkir (culling) wajib dimusnahkan agar tidak tercecer atau tertanam.', 'Bibit siap salur wajib berumur minimal payung 2 dengan daun tua mengeras.']
    }
  },
  {
    step: 8,
    title: 'Rekam Pemeliharaan & Pemakaian Material',
    role: 'MANTRI_TANAMAN',
    roleLabel: 'Mantri Bibitan',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/nursery-activity',
    desc: 'Pencatatan kegiatan rutin pemeliharaan: penyiraman, pemupukan NPK/Urea berkala, penyiangan gulma, fungisida, dan penggunaan material/bahan kimia.',
    output: 'Kartu kendali pemeliharaan blok bibitan & buku mutasi pupuk/obat.',
    icon: '🛠️',
    flowChart: {
      summary: 'Alur penjadwalan perawatan bibitan, penginputan pemakaian pupuk dan agrochemical, alokasi tenaga kerja harian, dan pemotongan stok gudang material.',
      nodes: [
        { id: '8.1', type: 'start', label: 'Jadwal Pemeliharaan Blok', actor: 'Mantri', desc: 'Tentukan blok target dan jenis perawatan harian' },
        { id: '8.2', type: 'process', label: 'Pilih Jenis Aktivitas', actor: 'Mantri', desc: 'Siram / Pupuk NPK / Semprot Fungisida / Penyiangan' },
        { id: '8.3', type: 'process', label: 'Input Pemakaian Material', actor: 'Mantri', desc: 'Catat kuantiti pupuk/obat yang dipakai (Kg / Liter)' },
        { id: '8.4', type: 'process', label: 'Catat Tenaga Kerja (HK)', actor: 'Mandor', desc: 'Alokasikan nama pekerja harian dan jam kerja' },
        { id: '8.5', type: 'decision', label: 'Dosis Sesuai SOP?', actor: 'Sistem', desc: 'Validasi dosis per polybag', branch: '✅ Sesuai: Lanjut Simpan | ⚠️ Anomali: Konfirmasi Dosis' },
        { id: '8.6', type: 'end', label: 'Kartu Kendali & Mutasi Stok', actor: 'Sistem', desc: 'Log pemeliharaan blok terupdate, stok gudang terpotong' }
      ],
      inputs: ['Blok / Baris Target Nursery', 'Material (Pupuk NPK, Fungisida, Herbisida)', 'Daftar Alokasi HK Pekerja'],
      outputs: ['Kartu Kendali Pemeliharaan Blok', 'Buku Mutasi Pengeluaran Material Gudang'],
      sopRules: ['Pemupukan dilakukan pada tanah lembab berjarak 5-7 cm dari pangkal batang.', 'Penyemprotan fungisida dihentikan jika cuaca hujan lebat.']
    }
  },
  {
    step: 9,
    title: 'Permintaan & Distribusi Bibit ke Kebun',
    role: 'ASISTEN',
    roleLabel: 'Asisten Divisi & Pengurus',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/request',
    desc: 'Pengajuan alokasi bibit untuk program replanting / sisipan tanaman karet divisi kebun, persetujuan Pengurus, dan pengeluaran fisik bibit polibag dari nursery.',
    output: 'Surat Jalan Pengeluaran Bibit (Delivery Order), pemotongan stok nursery.',
    icon: '📋',
    flowChart: {
      summary: 'Alur penerbitan Surat Permintaan Bibit (SPB), verifikasi persetujuan Pengurus, pemuatan bibit ke armada pengangkut, dan penerbitan Surat Jalan DO ke divisi tujuan.',
      nodes: [
        { id: '9.1', type: 'start', label: 'Pengajuan SPB oleh Asisten', actor: 'Asisten Divisi', desc: 'Input kebutuhan klon, jumlah pokok, & blok tanam kebun' },
        { id: '9.2', type: 'process', label: 'Approval Pengurus / Askep', actor: 'Pengurus / Askep', desc: 'Persetujuan alokasi kuota dan jadwal pengiriman' },
        { id: '9.3', type: 'process', label: 'Verifikasi Kesiapan di Nursery', actor: 'Mantri Nursery', desc: 'Cek stok fisik bibit bersertifikat di blok Main Nursery' },
        { id: '9.4', type: 'process', label: 'Pemuatan ke Truk Pengangkut', actor: 'Pekerja Muat', desc: 'Muat polybag dengan hati-hati ke armada truk (rit)' },
        { id: '9.5', type: 'process', label: 'Penerbitan Surat Jalan (DO)', actor: 'Mantri Nursery', desc: 'Cetak Dokumen Surat Jalan / Delivery Order resmi' },
        { id: '9.6', type: 'end', label: 'Penerimaan Kebun & Potong Stok', actor: 'Sistem', desc: 'Tanda terima lapangan diteken, stok bibit nursery berkurang' }
      ],
      inputs: ['Surat Permintaan Bibit (SPB)', 'Armada Truk Pengangkut', 'Kupon / Jadwal Tanam Divisi'],
      outputs: ['Surat Jalan Pengeluaran Bibit (DO)', 'Berita Acara Serah Terima (BAST)', 'Pemotongan Stok Nursery'],
      sopRules: ['Bibit disiram jenuh beberapa jam sebelum dimuat ke atas truk.', 'Susunan polybag di atas bak truk tidak boleh melebihi 2 tingkat.']
    }
  },
  {
    step: 10,
    title: 'Konsolidasi & Verifikasi Transaksi (Asisten)',
    role: 'ASISTEN',
    roleLabel: 'Asisten & Askep (Rencana Fase Lanjutan)',
    status: 'ANALYSIS',
    statusLabel: 'Tahap Analisis',
    route: '/home',
    desc: 'Layar khusus role Asisten untuk mereviu transaksi terkirim dari Mantri, melakukan koreksi langsung pada field data yang diizinkan, dan persetujuan berjenjang (belum diimplementasikan / masih fokus Role Mantri).',
    output: 'Status transaksi APPROVED, log audit rekonsiliasi data.',
    icon: '⏳',
    flowChart: {
      summary: 'Alur reviu transaksi masuk dari Mantri, koreksi nilai field langsung oleh Asisten tanpa menolak transaksi, dan otorisasi persetujuan berjenjang.',
      nodes: [
        { id: '10.1', type: 'start', label: 'Transaksi Disubmit Mantri', actor: 'Mantri Bibitan', desc: 'Data masuk antrean verifikasi Asisten' },
        { id: '10.2', type: 'process', label: 'Reviu Rincian & Bukti Fisik', actor: 'Asisten', desc: 'Periksa kesesuaian dokumen, kuantiti, dan foto lapangan' },
        { id: '10.3', type: 'decision', label: 'Data Akurat & Sesuai?', actor: 'Asisten', desc: 'Cek konsistensi data', branch: '✅ Sesuai: Langsung Approve | ✏️ Keliru: Koreksi Langsung Field' },
        { id: '10.4', type: 'process', label: 'Koreksi Langsung Nilai Field', actor: 'Asisten', desc: 'Edit angka/field yang keliru dan beri alasan koreksi' },
        { id: '10.5', type: 'process', label: 'Eksekusi Approval', actor: 'Asisten', desc: 'Tekan tombol Approve (Status menjadi APPROVED)' },
        { id: '10.6', type: 'end', label: 'Data Terkunci & Sync Server', actor: 'Sistem', desc: 'Transaksi final tersimpan dengan log audit lengkap' }
      ],
      inputs: ['Transaksi Status SUBMITTED', 'Dokumen Pendukung / Foto Fisik'],
      outputs: ['Transaksi Status APPROVED', 'Log Jejak Audit Koreksi Asisten', 'Data Rekonsiliasi ERP Pusat'],
      sopRules: ['Asisten mengoreksi data secara langsung tanpa proses reject agar alur tidak terhenti.', 'Setiap koreksi wajib menyertakan alasan yang terekam dalam audit trail.']
    }
  }
];

const INITIAL_NOTES = [
  {
    id: 'FB-001',
    number: 1,
    createdAt: '26/08/2026',
    author: 'Budi Santoso',
    creatorRole: 'Customer / User Field',
    email: 'budi.santoso@example.com',
    page: '/login',
    pageTitle: 'Login',
    description: 'Logo PT SOCFINDO dan tombol masuk proporsinya sudah bagus.',
    status: 'Baru',
    marker: { x: 50.0, y: 19.5 }
  },
  {
    id: 'FB-002',
    number: 2,
    createdAt: '26/08/2026',
    author: 'Ahmad Rivai',
    creatorRole: 'Asisten Lapangan',
    email: 'ahmad.rivai@example.com',
    page: '/sync',
    pageTitle: 'Sinkronisasi',
    description: 'Pilihan divisi kerja dan indikator centang sudah rapi.',
    status: 'Dalam Proses',
    marker: { x: 50.0, y: 18.0 }
  },
  {
    id: 'FB-003',
    number: 3,
    createdAt: '26/08/2026',
    author: 'Wagiman',
    creatorRole: 'Mantri Bibitan',
    email: 'wagiman@example.com',
    page: '/home',
    pageTitle: 'Beranda',
    description: 'Menu 3x3 Beranda mudah diakses dan teks tidak terpotong.',
    status: 'Selesai',
    marker: { x: 50.0, y: 22.0 }
  }
];

let notes = [];
let activeWorkspaceTab = 'notes'; // 'notes' | 'flow' | 'transactions' | 'process-mapping' | 'info-center'
let activeTxTab = 'reception'; // 'attendance' | 'reception' | 'seeding' | 'budding' | 'inspection' | 'regrafting' | 'selection' | 'syncQueue'
let txSearchQuery = '';
let txStatusFilter = 'ALL';
let txActivityModeFilter = 'ALL'; // 'ALL' | 'HARIAN' | 'MANDORAN'
let txActivityViewMode = 'DOC'; // 'DOC' (per dokumen) | 'WORKER' (per alokasi per pekerja)
let txConsolidationViewMode = 'DOC'; // 'DOC' (per alokasi kegiatan) | 'WORKER' (per alokasi per pekerja)

export const TX_MODULES = {
  attendance: {
    id: 'attendance',
    title: 'Presensi',
    subtitle: 'Kehadiran Mandor & Pekerja',
    icon: 'attendance',
    route: '/attendance',
    storageKey: 'attendance_transactions',
    repo: attendanceRepository,
    qtyField: null,
    unit: 'Orang'
  },
  reception: {
    id: 'reception',
    title: 'Penerimaan',
    subtitle: 'Stok Masuk Benih & Bibit',
    icon: 'reception',
    route: '/reception',
    storageKey: 'receipt_transactions',
    repo: receptionRepository,
    qtyField: 'qty',
    unit: 'Pkk'
  },
  seeding: {
    id: 'seeding',
    title: 'Penyemaian',
    subtitle: 'Penanaman & Batching Semai',
    icon: 'seeding',
    route: '/seeding',
    storageKey: 'seeding_transactions',
    repo: seedingRepository,
    qtyField: 'totalDisemai',
    unit: 'Pkk'
  },
  dederan: {
    id: 'dederan',
    title: 'Dederan',
    subtitle: 'Penanaman Benih ke Bedengan Deder',
    icon: 'dederan',
    route: '/seeding/dederan/form',
    storageKey: 'dederan_transactions',
    repo: null,
    qtyField: 'jumlahDeder',
    unit: 'Butir'
  },
  budding: {
    id: 'budding',
    title: 'Okulasi',
    subtitle: 'Grafting Mata Tunas Unggul',
    icon: 'budding',
    route: '/budding',
    storageKey: 'budding_transactions',
    repo: buddingRepository,
    qtyField: 'jumlah',
    unit: 'Pkk'
  },
  inspection: {
    id: 'inspection',
    title: 'Pemeriksaan',
    subtitle: 'Inspeksi & Evaluasi Keberhasilan',
    icon: 'inspection',
    route: '/inspection',
    storageKey: 'inspection_transactions',
    repo: inspectionRepository,
    qtyField: 'totalDiperiksa',
    unit: 'Pkk'
  },
  regrafting: {
    id: 'regrafting',
    title: 'Okulasi Janda',
    subtitle: 'Regrafting Okulasi Gagal',
    icon: 'regrafting',
    route: '/budding/regrafting',
    storageKey: 'regrafting_pool',
    repo: buddingRepository,
    qtyField: 'jumlah',
    unit: 'Pkk'
  },
  selection: {
    id: 'selection',
    title: 'Penyeleksian',
    subtitle: 'Afkir & Pengurangan Fisik Stok',
    icon: 'selection',
    route: '/selection',
    storageKey: 'selection_pool',
    repo: selectionRepository,
    qtyField: 'jumlahAfkir',
    unit: 'Pkk'
  },
  entres: {
    id: 'entres',
    title: 'Kebun Entres',
    subtitle: 'Aktivitas Menunas & Topping Entres',
    icon: 'entres',
    route: '/entres',
    storageKey: 'entres_transactions',
    repo: entresRepository,
    qtyField: 'jumlahPokok',
    unit: 'Pkk'
  },
  nurseryActivity: {
    id: 'nurseryActivity',
    title: 'Rekam Pemeliharaan',
    subtitle: 'Aktivitas Harian & Mandoran per Pekerja',
    icon: 'nurseryActivity',
    route: '/nursery-activity',
    storageKey: 'nursery_activity_records',
    repo: nurseryActivityRepository,
    qtyField: 'volumePkk',
    unit: 'Pkk'
  },
  mandoranConsolidation: {
    id: 'mandoranConsolidation',
    title: 'Konsolidasi Mandoran',
    subtitle: 'Konfirmasi Konsolidasi Hasil Mandoran',
    icon: 'mandoranConsolidation',
    route: '/nursery-activity/consolidation',
    storageKey: 'nursery_mandoran_consolidations',
    repo: null,
    qtyField: 'totalHasil',
    unit: 'Pkk'
  },
  request: {
    id: 'request',
    title: 'Permintaan Bibit',
    subtitle: 'SPB & Permintaan Bibit Keluar',
    icon: 'request',
    route: '/request',
    storageKey: 'requests_transactions',
    repo: requestRepository,
    qtyField: 'qtyRequested',
    unit: 'Pkk'
  },
  dispatch: {
    id: 'dispatch',
    title: 'Pengiriman Bibit',
    subtitle: 'Surat Jalan & Dispatch Bibit',
    icon: 'dispatch',
    route: '/dispatch',
    storageKey: 'dispatch_transactions',
    repo: null,
    qtyField: 'qtyKirim',
    unit: 'Pkk'
  },
  destruction: {
    id: 'destruction',
    title: 'Pemusnahan Bibit',
    subtitle: 'Berita Acara Pemusnahan Afkir',
    icon: 'destruction',
    route: '/destruction',
    storageKey: 'destruction_transactions',
    repo: null,
    qtyField: 'qty',
    unit: 'Pkk'
  },
  material: {
    id: 'material',
    title: 'Material & Logistik',
    subtitle: 'Dokumen Issue & Alokasi Gudang',
    icon: 'material',
    route: '/material',
    storageKey: 'issue_documents',
    repo: null,
    qtyField: 'quantityIssue',
    unit: 'Unit'
  },
  syncQueue: {
    id: 'syncQueue',
    title: 'Sinkronisasi',
    subtitle: 'Antrean Transaksi Offline ERP',
    icon: 'syncQueue',
    route: '/sync',
    storageKey: 'sync_queue',
    repo: syncQueueRepository,
    qtyField: null,
    unit: 'Item'
  }
};

function getTxModuleIconSvg(modId, size = 16) {
  const s = size;
  switch (modId) {
    case 'attendance':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
    case 'reception':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`;
    case 'seeding':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10a6 6 0 0 0-6-6H3v2a6 6 0 0 0 6 6h3Z"></path><path d="M12 22V10"></path><path d="M12 8a5 5 0 0 1 5-5h3v2a5 5 0 0 1-5 5h-3Z"></path></svg>`;
    case 'dederan':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"></path><path d="M10 20c0-4 2-7 2-10"></path><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7 1.5-1.1 2.2-2.4 2.2-4.1 0-2-1.5-3.5-3.5-3.5-1 0-2 .5-2.5 1.5"></path></svg>`;
    case 'budding':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path></svg>`;
    case 'inspection':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>`;
    case 'regrafting':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>`;
    case 'selection':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>`;
    case 'entres':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"></path><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>`;
    case 'nurseryActivity':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;
    case 'mandoranConsolidation':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="m9 14 2 2 4-4"></path></svg>`;
    case 'material':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="8" x="2" y="2" rx="1"></rect><rect width="8" height="8" x="14" y="2" rx="1"></rect><rect width="8" height="8" x="2" y="14" rx="1"></rect><rect width="8" height="8" x="14" y="14" rx="1"></rect></svg>`;
    case 'request':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>`;
    case 'dispatch':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
    case 'destruction':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
    case 'syncQueue':
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  }
}

/**
 * Resolver identitas pencatat / pembuat transaksi (Created By).
 * Menyelaraskan nama pencatat dan peran aktif (Mantri Bibitan sebagai default persona operasional,
 * atau peran aktif di session jika tersedia).
 */
export function resolveTxCreatorInfo(item = null) {
  let activeUser = null;
  try {
    activeUser = (typeof session !== 'undefined' && typeof session.get === 'function') ? session.get() : null;
  } catch (e) {
    activeUser = null;
  }
  const activeName = activeUser?.name || null;
  const activeRoleName = activeUser?.position || (activeUser?.role ? (ROLE_LABELS[activeUser.role] || activeUser.role) : null) || 'Mantri Bibitan';

  let name = item?.createdByName || item?.actorName || item?.author;
  let role = item?.createdByPosition || item?.createdByRoleName || (item?.createdByRole ? (ROLE_LABELS[item.createdByRole] || item.createdByRole) : null);

  if (!name && item?.createdBy) {
    if (typeof item.createdBy === 'string' && item.createdBy.includes('(')) {
      const match = item.createdBy.match(/^(.*?)\s*\((.*?)\)$/);
      if (match) {
        name = match[1].trim();
        if (!role) role = match[2].trim();
      } else {
        name = item.createdBy;
      }
    } else {
      name = item.createdBy;
    }
  }

  // Jika nama belum ada, fallback ke active user / mandor / Wagiman
  name = name || activeName || item?.mandor || 'Wagiman';
  // Jika role belum ada, fallback ke active role / Mantri Bibitan
  role = role || activeRoleName || 'Mantri Bibitan';

  return {
    name,
    role,
    display: `${name} (${role})`
  };
}

export function loadTxList(modId) {
  const cfg = TX_MODULES[modId];
  if (!cfg) return [];
  if (modId === 'attendance') {
    const rawItems = storage.get('attendance_transactions', []) || [];
    const map = new Map();
    rawItems.forEach(it => {
      const key = getAttendanceUniqueKey(it) || it.id;
      if (!map.has(key)) map.set(key, it);
    });
    const items = Array.from(map.values());
    return (items || []).map((it) => ({
      ...it,
      name: it.workerName || it.name || it.userName || 'Wagiman',
      workerName: it.workerName || it.name || it.userName || 'Wagiman',
      code: it.workerCode || it.code || it.nik || (it.type === 'SUPERVISOR' ? '1405482' : '1405739'),
      workerCode: it.workerCode || it.code || it.nik || (it.type === 'SUPERVISOR' ? '1405482' : '1405739'),
      position: it.position || it.jabatan || (it.type === 'SUPERVISOR' || it.role === 'MANTRI_TANAMAN' ? 'Mantri Bibitan' : 'Pekerja Bibitan'),
      tanggal: it.tanggal || it.date || todayISO(),
      time: it.time || '07:00',
      location: it.location || it.kebun || 'Tanah Besih - Divisi I',
      status: it.status || 'HADIR'
    }));
  }
  if (modId === 'regrafting') {
    const regrafts = storage.get('budding_transactions', []).filter((t) => t.type === 'REGRAFTING');
    if (regrafts && regrafts.length > 0) {
      return regrafts.map(item => {
        const kayuVal = parseInt(item.jumlahKayu !== undefined ? item.jumlahKayu : (item.kayu || 0));
        return {
          ...item,
          jumlahKayu: kayuVal,
          jumlah: parseInt(item.jumlah || item.qty || 0),
          jumlahDitolak: parseInt(item.jumlahDitolak || 0)
        };
      });
    }
    const pool = storage.get('regrafting_pool', []);
    if (pool && pool.length > 0) {
      return pool.map(item => {
        const match = regrafts.find(r => r.regraftPoolDocNo === item.docNo || r.batchNo === item.batchNo);
        const kayuVal = match ? parseInt(match.jumlahKayu || match.kayu || 0) : parseInt(item.jumlahKayu || 0);
        return {
          ...item,
          jumlahKayu: kayuVal
        };
      });
    }
    return [];
  }
  if (modId === 'selection') {
    const pool = storage.get('selection_pool', []);
    const txs = storage.get('selection_transactions', []);
    if (txs && txs.length > 0) return txs;
    if (pool && pool.length > 0) return pool;
    return [];
  }
  if (modId === 'budding') {
    const items = storage.get('budding_transactions', []);
    return (items || []).filter(t => t.type !== 'REGRAFTING');
  }
  if (modId === 'seeding') {
    const items = storage.get(cfg.storageKey, []);
    return (items || []).map(item => {
      if (!item.bedengan && Array.isArray(item.rows) && item.rows.length > 0) {
        const rowBeds = Array.from(new Set(item.rows.map(r => r.bedengan).filter(Boolean)));
        item.bedengan = rowBeds.length > 0 ? rowBeds.join(', ') : 'Bedengan 01';
      }
      return item;
    });
  }
  if (modId === 'entres') {
    const explicit = storage.get('entres_transactions', null);
    if (Array.isArray(explicit) && explicit.length > 0) return explicit;
    const menunas = storage.get('entres_menunas_transactions', []);
    const topping = storage.get('entres_topping_transactions', []);
    const combined = [
      ...menunas.map(it => ({ ...it, activityType: it.activityType || 'MENUNAS' })),
      ...topping.map(it => ({ ...it, activityType: it.activityType || 'TOPPING' }))
    ];
    return combined;
  }
  if (modId === 'dederan') {
    const items = storage.get('dederan_transactions', []);
    const indukDocs = storage.get('dederan_induk_documents', []);
    return (items || []).map((it, idx) => {
      const parent = indukDocs.find((d) => d.docNo === it.parentDederIndukDocNo || d.id === it.parentDederIndukDocNo || d.sourceReceiptDocNo === it.sourceReceiptDocNo);
      return {
        ...it,
        docNo: it.docNo || formatStandardDocNo(2026, 'DED', idx + 1),
        parentDocNo: it.parentDederIndukDocNo || it.sourceReceiptDocNo || parent?.docNo || '-',
        tanggal: it.tanggalDeder || it.tanggal || it.date || todayISO(),
        bedengan: it.bedenganCode || it.bedenganName || it.bedengan || 'Bedengan 01',
        klon: it.klon || parent?.klon || 'GT 1',
        jumlahDeder: parseTxNumericQty(it.jumlahDeder !== undefined ? it.jumlahDeder : (it.qty || 0)),
        createdBy: it.createdBy || it.actorName || 'Wagiman',
        status: it.status || it.verificationStatus || 'MENUNGGU_VERIFIKASI'
      };
    });
  }
  if (modId === 'dispatch') {
    const items = storage.get('dispatch_transactions', []);
    return (items || []).map((it, idx) => ({
      ...it,
      docNo: it.docNo || it.dispatchNo || formatStandardDocNo(2026, 'DSP', idx + 1),
      parentRequestDocNo: it.parentRequestDocNo || it.requestDocNo || it.spbNo || '-',
      tanggal: it.issuedDate || it.tanggal || it.date || (it.createdAt ? it.createdAt.slice(0, 10) : todayISO()),
      targetDivision: it.targetDivisionName || it.targetDivision || it.targetEstateId || it.tujuan || 'Divisi II',
      klon: it.clone || it.klon || 'PB 260',
      qtyKirim: parseTxNumericQty(it.issuedQty !== undefined ? it.issuedQty : (it.shipmentQty !== undefined ? it.shipmentQty : (it.qty || 0))),
      vehiclePlate: it.vehiclePlate || it.nopol || it.driverName || '-',
      issuedByName: it.issuedByName || it.petugas || it.createdByName || 'Mantri Bibitan',
      status: it.status || 'COMPLETED'
    }));
  }
  if (modId === 'destruction') {
    const rawItems = storage.get('destruction_transactions', null);
    const items = Array.isArray(rawItems) ? rawItems : [];
    return items.map((it, idx) => {
      const isBapb = it.documentType === 'BAPB_KARET' || Boolean(it.bapbStatus) || Boolean(it.signatures);
      const subItems = Array.isArray(it.items) && it.items.length > 0 ? it.items : null;
      
      const docNo = it.officialDocNo || it.docNo || it.draftDocNo || it.destructionNo || it.baNo || formatStandardDocNo(2026, 'CUL', idx + 1);
      const tanggal = it.tanggalPelaksanaan || it.tanggalPemusnahan || it.destructionDate || it.tanggal || it.date || (it.createdAt ? it.createdAt.slice(0, 10) : todayISO());
      
      let sourceSelectionNo = it.sourceSelectionNo || it.batchCode || it.sourceSelectionId || '-';
      let bedengan = it.bedenganCode || it.bedengan || 'Bedengan 01';
      let klon = it.klon || 'GT 1';
      let qty = parseTxNumericQty(it.totalQty !== undefined ? it.totalQty : (it.destructionQty !== undefined ? it.destructionQty : (it.quantity !== undefined ? it.quantity : (it.qty || 0))));

      if (subItems) {
        sourceSelectionNo = [...new Set(subItems.map(s => s.sourceSelectionNo || s.sourceSelectionId).filter(Boolean))].join(', ') || sourceSelectionNo;
        bedengan = [...new Set(subItems.map(s => s.bedengan || s.bedenganCode).filter(Boolean))].join(', ') || bedengan;
        klon = [...new Set(subItems.map(s => s.klon || s.clone).filter(Boolean))].join(', ') || klon;
      }

      return {
        ...it,
        docNo,
        tanggal,
        sourceSelectionNo,
        bedengan,
        klon,
        qty,
        reason: it.reason || it.alasan || 'AFKIR',
        createdByName: it.signatures?.asb?.name || it.createdByName || it.petugas || 'Asisten Bibitan',
        status: it.bapbStatus || it.status || 'MENUNGGU_VERIFIKASI',
        isBapb
      };
    });
  }
  if (modId === 'nurseryActivity') {
    let items = storage.get('nursery_activity_records', []);
    if (!items || items.length === 0) {
      items = [
        {
          id: 'ACT-2026-001',
          docNo: 'ACT/NUR/2026/001',
          activityEntryMode: 'HARIAN',
          tanggal: '2026-10-16',
          aktivitas: { id: 'AKT-01', kode: 'A01-01', nama: 'Pemupukan NPK 15-15-15 (Bibitan Utama)' },
          allocationCode: 'A01-01',
          allocationName: 'Pemupukan NPK 15-15-15 (Bibitan Utama)',
          program: 'PRG/NUR/01/2026',
          programCode: 'PRG/NUR/01/2026',
          tahapan: 'Main Nursery',
          bedengan: 'Bedengan MN-01 s/d MN-04',
          lokasiBlok: { blok: 'Blok A - MN 01', luas: 2.5, jumlahPokok: 1200 },
          volumePkk: 1200,
          uom: 'Pkk',
          pekerja: [
            { id: 'W-01', workerId: 'W-01', code: 'P001', name: 'Sutrisno', position: 'Pekerja Bibitan', role: 'Pekerja Harian', statusKerja: 'Hadir Penuh' },
            { id: 'W-02', workerId: 'W-02', code: 'P002', name: 'Joko Susanto', position: 'Pekerja Bibitan', role: 'Pekerja Harian', statusKerja: 'Hadir Penuh' },
            { id: 'W-03', workerId: 'W-03', code: 'P003', name: 'Budi Santoso', position: 'Pekerja Bibitan', role: 'Pekerja Harian', statusKerja: 'Hadir Penuh' }
          ],
          mandor: 'Wagiman',
          createdByName: 'Wagiman',
          status: 'VERIFIED'
        },
        {
          id: 'ACT-2026-002',
          docNo: 'ACT/NUR/2026/002',
          activityEntryMode: 'MANDORAN',
          tanggal: '2026-10-17',
          aktivitas: { id: 'AKT-02', kode: 'RAW-01', nama: 'Penyiangan Gulma Bedengan Polybag' },
          allocationCode: 'RAW-01',
          allocationName: 'Penyiangan Gulma Bedengan Polybag',
          workGroupRoleCode: 'BORONGAN-RAWAT',
          workGroupRoleName: 'Pekerja Borongan Rawat',
          taskQuantity: 500,
          uom: 'Pkk',
          program: 'PRG/NUR/01/2026',
          programCode: 'PRG/NUR/01/2026',
          tahapan: 'Main Nursery',
          bedengan: 'Bedengan MN-05 s/d MN-08',
          lokasiBlok: { blok: 'Blok B - MN 02', luas: 3.0, jumlahPokok: 1800 },
          pekerja: [
            { id: 'W-04', workerId: 'W-04', code: 'P004', name: 'Rahmat Hidayat', position: 'Pekerja Borongan', role: 'Pekerja Borongan', taskQuantity: 500, inputHasil: 600, resultType: 'TUNTAS', selisihBasis: '+100 Pkk' },
            { id: 'W-05', workerId: 'W-05', code: 'P005', name: 'Surono', position: 'Pekerja Borongan', role: 'Pekerja Borongan', taskQuantity: 500, inputHasil: 550, resultType: 'TUNTAS', selisihBasis: '+50 Pkk' },
            { id: 'W-06', workerId: 'W-06', code: 'P006', name: 'Agus Priyanto', position: 'Pekerja Borongan', role: 'Pekerja Borongan', taskQuantity: 500, inputHasil: 520, resultType: 'TUNTAS', selisihBasis: '+20 Pkk' }
          ],
          volumePkk: 1670,
          totalHasil: 1670,
          mandor: 'Wagiman',
          createdByName: 'Wagiman',
          status: 'CONSOLIDATED'
        },
        {
          id: 'ACT-2026-003',
          docNo: 'ACT/NUR/2026/003',
          activityEntryMode: 'MANDORAN',
          tanggal: '2026-10-17',
          aktivitas: { id: 'AKT-03', kode: 'RAW-03', nama: 'Penyiraman Bibitan Polybag' },
          allocationCode: 'RAW-03',
          allocationName: 'Penyiraman Bibitan Polybag',
          workGroupRoleCode: 'BORONGAN-RAWAT',
          workGroupRoleName: 'Pekerja Borongan Rawat',
          taskQuantity: 400,
          uom: 'Pkk',
          program: 'PRG/NUR/01/2026',
          programCode: 'PRG/NUR/01/2026',
          tahapan: 'Main Nursery',
          bedengan: 'Bedengan MN-09 s/d MN-12',
          lokasiBlok: { blok: 'Blok C - MN 03', luas: 2.0, jumlahPokok: 850 },
          pekerja: [
            { id: 'W-07', workerId: 'W-07', code: 'P007', name: 'Hadi Gunawan', position: 'Pekerja Borongan', role: 'Pekerja Borongan', taskQuantity: 400, inputHasil: 450, resultType: 'TUNTAS', selisihBasis: '+50 Pkk' },
            { id: 'W-08', workerId: 'W-08', code: 'P008', name: 'Tri Prasetyo', position: 'Pekerja Borongan', role: 'Pekerja Borongan', taskQuantity: 400, inputHasil: 400, resultType: 'TUNTAS', selisihBasis: '0 Pkk' }
          ],
          volumePkk: 850,
          totalHasil: 850,
          mandor: 'Supriono',
          createdByName: 'Supriono',
          status: 'VERIFIED'
        }
      ];
      storage.set('nursery_activity_records', items);
    }
    return (items || []).map((it, idx) => {
      const isMandoran = (it.activityEntryMode === 'MANDORAN') || !!it.workGroupRoleCode;
      const mode = isMandoran ? 'MANDORAN' : 'HARIAN';
      const aktNama = typeof it.aktivitas === 'object' ? (it.aktivitas?.nama || it.aktivitas?.title) : (it.aktivitas || it.activityType || it.jenisKegiatan || (isMandoran ? 'Pemeliharaan Mandoran' : 'Pemupukan Rutin'));
      const pekerjaList = Array.isArray(it.pekerja) ? it.pekerja : [];
      const mandorName = it.actorName || it.createdByName || it.mandor || it.supervisor || (pekerjaList[0]?.name || pekerjaList[0]?.workerName) || 'Wagiman';
      const taskQty = Number(it.taskQuantity || 0);
      const totalWorkerHasil = pekerjaList.reduce((s, w) => s + (Number(w.inputHasil) || 0), 0);
      const vol = isMandoran
        ? (totalWorkerHasil || taskQty * (pekerjaList.length || 1) || Number(it.volumePkk || 0))
        : (it.volumePkk !== undefined ? Number(it.volumePkk) : (it.taskQuantity !== undefined ? Number(it.taskQuantity) : (totalWorkerHasil || Number(it.qty || 0))));
      
      const allocationCode = it.allocationCode || (typeof it.aktivitas === 'object' ? it.aktivitas?.kode : '-') || '-';
      const allocationName = it.allocationName || aktNama;
      const alokasi = (allocationCode !== '-' && allocationName !== '-') ? `${allocationCode} — ${allocationName}` : (allocationName || allocationCode);
      const uom = it.uom || it.uomCode || 'Pkk';

      return {
        ...it,
        docNo: it.docNo || it.id || `ACT/NUR/2026/0${idx + 1}`,
        tanggal: it.tanggal || it.date || (it.createdAt ? it.createdAt.slice(0, 10) : todayISO()),
        activityType: aktNama,
        activityEntryMode: mode,
        entryMode: mode,
        isMandoran,
        allocationCode,
        allocationName,
        alokasi,
        workGroupRoleCode: it.workGroupRoleCode || it.roleCode || (isMandoran ? 'BORONGAN-RAWAT' : 'CFNA'),
        workGroupRoleName: it.workGroupRoleName || (isMandoran ? 'Pekerja Borongan Rawat' : 'Pekerja Harian'),
        taskQuantity: taskQty,
        uom,
        unit: uom,
        tahapan: it.tahapan || it.program || it.programCode || 'Main Nursery',
        bedengan: it.bedengan || (typeof it.lokasiBlok === 'object' ? it.lokasiBlok?.blok : null) || 'Bedengan 01',
        materialName: it.materialName || it.taskItemName || it.allocationCode || (it.isMaterial ? 'Material Nursery' : 'Jasa / Tenaga'),
        pekerja: pekerjaList,
        workerCount: pekerjaList.length,
        volumePkk: parseTxNumericQty(vol),
        totalHasil: parseTxNumericQty(totalWorkerHasil || vol),
        mandor: mandorName,
        createdByName: resolveTxCreatorInfo(it).name,
        createdByRole: resolveTxCreatorInfo(it).role,
        createdBy: resolveTxCreatorInfo(it).display,
        status: it.status || (it.mandoranConsolidationId ? 'CONSOLIDATED' : (it.verificationStatus || 'VERIFIED'))
      };
    });
  }
  if (modId === 'request') {
    const txs = storage.get('requests_transactions', storage.get('requests', [])) || [];
    return (txs || []).map((it, idx) => {
      const distItems = Array.isArray(it.distributionItems) ? it.distributionItems : [];
      const klonVal = it.klon || it.approvedClone || it.requestedClone || (distItems[0]?.klon) || 'PB 260';
      const tahapanVal = it.growthStage || it.tahapan || (distItems[0]?.growthStage || distItems[0]?.tahapan) || 'Rubber Main Nursery';
      const targetVal = it.targetEstateName || it.targetDivision || it.estateTujuan || it.targetDivisionName || 'Divisi II - Replanting 2026';
      const reqQty = it.requestedQty !== undefined ? it.requestedQty : (it.qtyRequested !== undefined ? it.qtyRequested : (it.qty !== undefined ? it.qty : (distItems.reduce((s, d) => s + (Number(d.qty) || 0), 0) || 0)));
      const dispQty = it.qtyDispatched !== undefined ? it.qtyDispatched : (it.dispatchedQty !== undefined ? it.dispatchedQty : (it.jumlahBatangDikeluarkan !== undefined ? it.jumlahBatangDikeluarkan : (it.status === 'COMPLETED' ? reqQty : 0)));
      return {
        ...it,
        docNo: it.docNo || it.spbNo || it.requestId || it.id || formatStandardDocNo(2026, 'REQ', idx + 1),
        tanggal: it.requiredDate || it.tanggal || it.date || (it.createdAt ? it.createdAt.slice(0, 10) : todayISO()),
        requestType: it.requestType || it.tipePermintaan || (it.targetEstateName ? 'Kebun Sepupu' : (it.distributionItems ? 'Kebun Sendiri' : 'Permintaan Bibit')),
        targetDivision: targetVal,
        tahapan: tahapanVal,
        klon: klonVal,
        qtyRequested: parseTxNumericQty(reqQty),
        qtyDispatched: parseTxNumericQty(dispQty),
        status: it.status || 'APPROVED'
      };
    });
  }
  if (modId === 'reception') {
    const directReceipts = storage.get('receipt_transactions', []) || [];
    const kspReceipts = storage.get('receipt_ksp_transactions', []) || [];
    const map = new Map();
    directReceipts.forEach((it) => {
      const doc = it.docNo || it.nomorDokumen || it.id;
      map.set(doc, it);
    });
    kspReceipts.forEach((it) => {
      const doc = it.docNo || it.receiptDocNo || it.nomorDokumen || it.id;
      if (!map.has(doc)) {
        map.set(doc, {
          ...it,
          id: it.id || doc,
          docNo: doc,
          nomorDokumen: it.nomorDokumen || doc,
          tanggal: it.tanggal || it.date || todayISO(),
          tahapan: it.tahapan || it.tahapanPertumbuhan || 'Rubber Main Nursery',
          klon: it.klon || 'PB 260',
          sumber: it.sumber || it.asalKebun || it.rekanan || 'Kebun Sepupu',
          qty: it.jumlahBenih || it.qty || it.volume || 0,
          status: it.status || 'APPROVED'
        });
      }
    });
    return Array.from(map.values());
  }
  if (modId === 'material') {
    initMaterialMasterStorage();
    const docs = getAllIssueDocuments();
    return (docs || []).map((doc, idx) => {
      const item = doc.items?.[0] || {};
      const itemCode = item.itemCode || doc.itemCode || '-';
      const itemName = item.itemName || doc.itemName || 'Material';
      const uom = item.uom || doc.uom || 'Unit';
      const quantityIssue = Number(item.quantityIssue !== undefined ? item.quantityIssue : doc.quantityIssue) || 0;
      const usedQuantity = Number(item.usedQuantity !== undefined ? item.usedQuantity : doc.usedQuantity) || 0;
      const remainingQuantity = Number(item.remainingQuantity !== undefined ? item.remainingQuantity : doc.remainingQuantity) || 0;
      const alokasi = (doc.kodeAlokasi && doc.namaAlokasi) ? `${doc.kodeAlokasi} — ${doc.namaAlokasi}` : (doc.kodeAlokasi || doc.namaAlokasi || '-');

      return {
        ...doc,
        id: doc.id || doc.noIssue || `ISS-${idx + 1}`,
        docNo: doc.noIssue || doc.id || `ISS-${idx + 1}`,
        noIssue: doc.noIssue || doc.id || `ISS-${idx + 1}`,
        itemCode,
        itemName,
        uom,
        alokasi,
        kodeAlokasi: doc.kodeAlokasi || '-',
        namaAlokasi: doc.namaAlokasi || '-',
        quantityIssue,
        usedQuantity,
        remainingQuantity,
        tanggal: doc.tanggal || todayISO(),
        status: doc.status || 'AVAILABLE',
        items: doc.items || []
      };
    });
  }
  if (modId === 'mandoranConsolidation') {
    const rawItems = storage.get('nursery_mandoran_consolidations', []) || [];
    const result = [];
    rawItems.forEach((item, docIdx) => {
      const docNo = item.docNo || item.id || formatStandardDocNo(2026, 'CSL', docIdx + 1);
      const rawDate = item.createdAt ? item.createdAt.slice(0, 10) : (item.date || item.tanggal || todayISO());
      const groups = Array.isArray(item.groups) ? item.groups : [];
      const mandorName = item.actor?.name || item.createdByName || item.mandor || 'Wagiman';
      const sourceCount = Array.isArray(item.sourceTransactionIds) ? item.sourceTransactionIds.length : (item.sourceCount || 0);

      if (groups.length > 0) {
        // Tampilkan per Alokasi Kegiatan secara presisi dengan UOM & volume akurat masing-masing
        groups.forEach((g, gIdx) => {
          const wList = Array.isArray(g.workers) ? g.workers : [];
          const groupTotalHasil = wList.reduce((s, w) => s + (Number(w.inputHasil !== undefined ? w.inputHasil : (w.total || w.hasil || 0)) || 0), 0);
          const allocationCode = g.allocationCode || '-';
          const allocationName = g.allocationName || g.workGroupRoleName || 'Pemeliharaan Bibitan';
          const alokasi = (allocationCode !== '-' && allocationName !== '-') ? `${allocationCode} — ${allocationName}` : (allocationName || allocationCode);
          const roleName = g.workGroupRoleName || g.roleName || 'Pekerja Bibitan';
          const uom = g.uom || item.uom || 'Pkk';

          result.push({
            ...item,
            id: `${item.id || docNo}__grp_${gIdx}`,
            rawConsolidationId: item.id || docNo,
            docNo,
            groupIndex: gIdx,
            totalGroupsInDoc: groups.length,
            tanggal: rawDate,
            date: rawDate,
            allocationCode,
            allocationName,
            alokasi,
            workGroupRoleCode: g.workGroupRoleCode || g.roleCode || item.workGroupRoleCode || item.roleCode || 'PEKERJA_BIBITAN',
            workGroupRoleName: roleName,
            roleCode: g.workGroupRoleCode || g.roleCode || item.workGroupRoleCode || item.roleCode || 'PEKERJA_BIBITAN',
            roleName,
            taskQuantity: Number(g.taskQuantity || 0),
            workerCount: wList.length,
            totalHasil: groupTotalHasil,
            uom,
            unit: uom,
            workers: wList,
            pekerja: wList,
            group: g,
            groups: item.groups,
            mandor: mandorName,
            createdByName: resolveTxCreatorInfo(item).name,
            createdByRole: resolveTxCreatorInfo(item).role,
            createdBy: resolveTxCreatorInfo(item).display,
            sourceCount: Math.min(sourceCount, wList.reduce((s, w) => s + (w.sourceTransactionIds ? w.sourceTransactionIds.length : 0), 0) || sourceCount),
            sourceTransactionIds: item.sourceTransactionIds || [],
            status: item.status || 'CONSOLIDATED'
          });
        });
      } else {
        const wList = Array.isArray(item.workers) ? item.workers : (Array.isArray(item.pekerja) ? item.pekerja : []);
        const totalHasil = wList.length > 0
          ? wList.reduce((s, w) => s + (Number(w.inputHasil !== undefined ? w.inputHasil : (w.total || w.hasil || 0)) || 0), 0)
          : Number(item.totalHasil || item.qty || 0);
        let allocationCode = item.allocationCode || '-';
        let allocationName = item.allocationName || item.alokasi || 'Pemeliharaan Bibitan';
        if ((!allocationCode || allocationCode === '-') && item.alokasi && item.alokasi.includes(' — ')) {
          const parts = item.alokasi.split(' — ');
          allocationCode = parts[0].trim();
          allocationName = parts[1].trim();
        }
        const alokasi = (allocationCode !== '-' && allocationName !== '-') ? `${allocationCode} — ${allocationName}` : (allocationName || allocationCode);
        const uom = item.uom || item.unit || 'Pkk';

        result.push({
          ...item,
          id: item.id || docNo,
          rawConsolidationId: item.id || docNo,
          docNo,
          tanggal: rawDate,
          date: rawDate,
          allocationCode,
          allocationName,
          alokasi,
          workGroupRoleCode: item.workGroupRoleCode || item.roleCode || 'PEKERJA_BIBITAN',
          workGroupRoleName: item.roleName || 'Pekerja Bibitan',
          roleCode: item.workGroupRoleCode || item.roleCode || 'PEKERJA_BIBITAN',
          roleName: item.roleName || 'Pekerja Bibitan',
          taskQuantity: Number(item.taskQuantity || 0),
          workerCount: wList.length || Number(item.workerCount || 1),
          totalHasil,
          uom,
          unit: uom,
          workers: wList,
          pekerja: wList,
          mandor: mandorName,
          createdByName: resolveTxCreatorInfo(item).name,
          createdByRole: resolveTxCreatorInfo(item).role,
          createdBy: resolveTxCreatorInfo(item).display,
          sourceCount,
          sourceTransactionIds: item.sourceTransactionIds || [],
          status: item.status || 'CONSOLIDATED'
        });
      }
    });
    return result;
  }
  const items = storage.get(cfg.storageKey, []);
  return items || [];
}

function saveTxList(modId, list) {
  const cfg = TX_MODULES[modId];
  if (!cfg) return;
  storage.set(cfg.storageKey, list);
  if (modId === 'selection') {
    storage.set('selection_pool', list);
    storage.set('selection_transactions', list);
  }
  if (modId === 'regrafting') {
    const allBudding = storage.get('budding_transactions', []);
    const otherBudding = allBudding.filter((t) => t.type !== 'REGRAFTING');
    const updatedBudding = [...otherBudding, ...list.map(item => ({ ...item, type: 'REGRAFTING' }))];
    storage.set('budding_transactions', updatedBudding);
    storage.set('regrafting_pool', list);
  }
  if (modId === 'entres') {
    storage.set('entres_transactions', list);
  }
  if (modId === 'nurseryActivity') {
    storage.set('nursery_activity_records', list);
  }
  if (modId === 'mandoranConsolidation') {
    storage.set('nursery_mandoran_consolidations', list);
  }
  if (modId === 'material') {
    storage.set('issue_documents', list);
  }
  if (modId === 'request') {
    storage.set('requests_transactions', list);
  }
  if (modId === 'dederan') {
    storage.set('dederan_transactions', list);
  }
  if (modId === 'dispatch') {
    storage.set('dispatch_transactions', list);
  }
  if (modId === 'destruction') {
    storage.set('destruction_transactions', list);
  }
  list.forEach((item) => {
    try {
      cfg.repo.create(item);
    } catch (e) { }
  });
}
let flowRoleFilter = 'ALL';
let expandedFlowSteps = new Set([1]); // Step 1 terbuka secara default untuk preview langsung
let isReviewMode = false;
let isAllMarkersHidden = false;
let selectedNoteId = null;
let searchQuery = '';
let filterStatus = 'ALL';
let filterPage = 'ALL';
let isServerConnected = false;

/** Memuat data catatan dari API Server (dengan fallback LocalStorage) */
async function loadNotes() {
  try {
    const res = await fetch(API_URL, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        notes = result.data;
        isServerConnected = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        renderReviewPanel();
        updateMarkers();
        return;
      }
    }
  } catch (err) {
    console.warn('[review] Gagal koneksi ke server API, beralih ke penyimpanan lokal:', err);
    isServerConnected = false;
  }

  // Fallback ke LocalStorage bila server offline
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      notes = JSON.parse(raw);
    } else {
      notes = [...INITIAL_NOTES];
      saveNotesLocally();
    }
  } catch (err) {
    notes = [...INITIAL_NOTES];
  }
  renderReviewPanel();
  updateMarkers();
}

/** Menyimpan catatan lokal sebagai cache */
function saveNotesLocally() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    console.warn('[review] failed to save notes locally:', err);
  }
}

function setWorkspaceTab(tab) {
  if (tab === 'info-center' || tab === 'process-mapping') {
    tab = 'notes';
  }
  activeWorkspaceTab = tab;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  } catch (_) { }
}

/** Sinkronkan seluruh data transaksi dari IndexedDB & Storage Frame HP */
export async function syncAllTxFromMobileDB(targetModId = null) {
  try {
    let syncedCount = 0;

    // 1. Presensi
    if (!targetModId || targetModId === 'attendance') {
      const dbList = await attendanceRepository.list();
      const stored = storage.get('attendance_transactions', []);
      const map = new Map();
      (dbList || []).forEach((it) => {
        const key = getAttendanceUniqueKey(it) || it.id;
        map.set(key, it);
      });
      stored.forEach((it) => {
        const key = getAttendanceUniqueKey(it) || it.id;
        if (!map.has(key)) map.set(key, it);
      });
      const merged = Array.from(map.values()).map((it) => ({
        ...it,
        name: it.workerName || it.name || it.userName || 'Wagiman',
        workerName: it.workerName || it.name || it.userName || 'Wagiman',
        code: it.workerCode || it.code || it.nik || (it.type === 'SUPERVISOR' ? '1405482' : '1405739'),
        workerCode: it.workerCode || it.code || it.nik || (it.type === 'SUPERVISOR' ? '1405482' : '1405739'),
        position: it.position || it.jabatan || (it.type === 'SUPERVISOR' || it.role === 'MANTRI_TANAMAN' ? 'Mantri Bibitan' : 'Pekerja Bibitan'),
        tanggal: it.tanggal || it.date || (it.capturedAt ? it.capturedAt.slice(0, 10) : todayISO()),
        time: it.time || (it.capturedAt ? it.capturedAt.slice(11, 16) : '07:00'),
        location: it.location || it.kebun || 'Tanah Besih - Divisi I',
        method: it.method || (it.type === 'SUPERVISOR' ? 'REKAM_DATA_WAJAH' : 'MANUAL'),
        status: it.status || 'HADIR'
      }));
      storage.set('attendance_transactions', merged);
      if (targetModId === 'attendance') syncedCount = merged.length;
    }

    // 2. Penerimaan
    if (!targetModId || targetModId === 'reception') {
      const dbList = await receptionRepository.list();
      const stored = storage.get('receipt_transactions', []);
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values()).map((it, idx) => {
        const standardDoc = it.docNo && it.docNo.includes('/') && !it.docNo.startsWith('RCV-')
          ? it.docNo
          : formatStandardDocNo(2026, 'APR', idx + 1);
        return {
          ...it,
          id: it.id || standardDoc,
          docNo: standardDoc,
          nomorDokumen: it.nomorDokumen || standardDoc
        };
      });
      storage.set('receipt_transactions', merged);
      if (targetModId === 'reception') syncedCount = merged.length;
    }

    // 3. Penyemaian
    if (!targetModId || targetModId === 'seeding') {
      const dbList = await seedingRepository.list();
      const stored = storage.get('seeding_transactions', []);
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values()).map((it, idx) => {
        let standardDoc = it.docNo && it.docNo.includes('/') && !it.docNo.startsWith('SEED-') && !it.docNo.startsWith('SEED/')
          ? it.docNo
          : formatStandardDocNo(2026, 'SOW', idx + 1);
        if (typeof standardDoc === 'string' && standardDoc.includes('/SEM/')) {
          standardDoc = standardDoc.replace('/SEM/', '/SOW/');
        }
        return {
          ...it,
          id: it.id || standardDoc,
          docNo: standardDoc,
          nomorDokumen: it.nomorDokumen || standardDoc
        };
      });
      storage.set('seeding_transactions', merged);
      if (targetModId === 'seeding') syncedCount = merged.length;
    }

    // 4. Okulasi & 6. Okulasi Janda
    if (!targetModId || targetModId === 'budding' || targetModId === 'regrafting') {
      const dbList = await buddingRepository.list();
      const stored = storage.get('budding_transactions', []);
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values()).map((it, idx) => {
        let standardDoc = it.docNo;
        const isRegraft = it.type === 'REGRAFTING';
        if (!standardDoc || standardDoc.startsWith('OKL/') || standardDoc.startsWith('OKL-') || standardDoc === 'OKL/2026/01') {
          standardDoc = formatStandardDocNo(2026, isRegraft ? 'RGRF' : 'GRF', idx + 1);
        } else if (typeof standardDoc === 'string' && (standardDoc.includes('/OKL/') || standardDoc.includes('/OKJ/') || standardDoc.includes('/REG/'))) {
          standardDoc = standardDoc.replace('/OKL/', isRegraft ? '/RGRF/' : '/GRF/').replace('/OKJ/', '/RGRF/').replace('/REG/', '/RGRF/');
        }
        return {
          ...it,
          id: it.id || standardDoc,
          docNo: standardDoc,
          nomorDokumen: it.nomorDokumen || standardDoc
        };
      });
      storage.set('budding_transactions', merged);
      if (targetModId === 'budding') syncedCount = merged.filter((t) => t.type !== 'REGRAFTING').length;
      if (targetModId === 'regrafting') syncedCount = merged.filter((t) => t.type === 'REGRAFTING').length;
    }

    // 5. Pemeriksaan
    if (!targetModId || targetModId === 'inspection') {
      const dbList = await inspectionRepository.list();
      const stored = storage.get('inspection_transactions', []);
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values());
      storage.set('inspection_transactions', merged);
      if (targetModId === 'inspection') syncedCount = merged.length;
    }

    // 7. Penyeleksian
    if (!targetModId || targetModId === 'selection') {
      const dbList = await selectionRepository.list();
      const stored = storage.get('selection_transactions', storage.get('selection_pool', []));
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values());
      storage.set('selection_transactions', merged);
      storage.set('selection_pool', merged);
      if (targetModId === 'selection') syncedCount = merged.length;
    }

    // 8. Kebun Entres
    if (!targetModId || targetModId === 'entres') {
      const dbList = await entresRepository.list();
      const menunas = storage.get('entres_menunas_transactions', []);
      const topping = storage.get('entres_topping_transactions', []);
      const map = new Map();
      (dbList || []).forEach((it) => map.set(it.id || it.docNo, it));
      menunas.forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, { ...it, activityType: it.activityType || 'MENUNAS' });
      });
      topping.forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, { ...it, activityType: it.activityType || 'TOPPING' });
      });
      const merged = Array.from(map.values());
      storage.set('entres_transactions', merged);
      if (targetModId === 'entres') syncedCount = merged.length;
    }

    // 9. Rekam Pemeliharaan
    if (!targetModId || targetModId === 'nurseryActivity') {
      const dbList = await nurseryActivityRepository.list();
      const stored = storage.get('nursery_activity_records', []);
      const map = new Map();
      (dbList || []).forEach((it) => map.set(it.id || it.docNo, it));
      stored.forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values());
      storage.set('nursery_activity_records', merged);
      if (targetModId === 'nurseryActivity') syncedCount = merged.length;
    }

    // 10. Material & Logistik
    if (!targetModId || targetModId === 'material') {
      initMaterialMasterStorage();
      const docs = getAllIssueDocuments();
      if (targetModId === 'material') syncedCount = (docs || []).length;
    }

    // 10b. Konsolidasi Mandoran
    if (!targetModId || targetModId === 'mandoranConsolidation') {
      const stored = storage.get('nursery_mandoran_consolidations', []);
      if (targetModId === 'mandoranConsolidation') syncedCount = stored.length;
    }

    // 11. Pengeluaran Bibit
    if (!targetModId || targetModId === 'request') {
      const dbList = await requestRepository.list();
      const stored = storage.get('requests_transactions', storage.get('requests', []));
      const map = new Map();
      stored.forEach((it) => map.set(it.id || it.docNo, it));
      (dbList || []).forEach((it) => {
        if (!map.has(it.id || it.docNo)) map.set(it.id || it.docNo, it);
      });
      const merged = Array.from(map.values());
      storage.set('requests_transactions', merged);
      if (targetModId === 'request') syncedCount = merged.length;
    }

    // 12. Dederan Benih
    if (!targetModId || targetModId === 'dederan') {
      const stored = storage.get('dederan_transactions', []);
      if (targetModId === 'dederan') syncedCount = stored.length;
    }

    // 13. Pengiriman Bibit (Dispatch)
    if (!targetModId || targetModId === 'dispatch') {
      const stored = storage.get('dispatch_transactions', []);
      if (targetModId === 'dispatch') syncedCount = stored.length;
    }

    // 14. Pemusnahan Bibit (Destruction)
    if (!targetModId || targetModId === 'destruction') {
      const stored = storage.get('destruction_transactions', []);
      if (targetModId === 'destruction') syncedCount = stored.length;
    }

    // 15. Antrean Sinkronisasi
    if (!targetModId || targetModId === 'syncQueue') {
      const dbList = await syncQueueRepository.list();
      const stored = storage.get('sync_queue', []);
      const map = new Map();
      (dbList || []).forEach((it) => map.set(it.id, it));
      stored.forEach((it) => {
        if (!map.has(it.id)) map.set(it.id, it);
      });
      const merged = Array.from(map.values());
      storage.set('sync_queue', merged);
      if (targetModId === 'syncQueue') syncedCount = merged.length;
    }

    if (activeWorkspaceTab === 'transactions') {
      renderReviewPanel();
    }
    return syncedCount;
  } catch (err) {
    console.warn('[review-workspace] syncAllTxFromMobileDB error:', err);
    return 0;
  }
}

/** Inisialisasi Review Workspace */
export function initReviewWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (tabParam && ['notes', 'transactions'].includes(tabParam)) {
    activeWorkspaceTab = tabParam;
  } else if (tabParam === 'flow' || tabParam === 'info-center' || tabParam === 'process-mapping') {
    activeWorkspaceTab = 'notes';
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url);
    } catch (_) { }
  }

  loadNotes();
  syncAllTxFromMobileDB();
  setupMarkerLayer();
  setupMobileWorkspaceSwitcher();

  // Dengarkan perubahan hash route agar marker dan filter tersinkron
  window.addEventListener('hashchange', () => {
    updateMarkers();
    if (activeWorkspaceTab === 'transactions') {
      syncAllTxFromMobileDB();
    }
  });

  // Dengarkan perubahan data di storage agar Tab Transaksi selalu realtime tersinkron dengan Frame HP
  window.addEventListener('sigma:storage-update', () => {
    if (activeWorkspaceTab === 'transactions') {
      renderReviewPanel();
    }
  });
}

/** Setup switcher tab navigasi pada layar mobile (< 768px) */
function setupMobileWorkspaceSwitcher() {
  // Mode switcher global telah ditangani secara terpusat oleh workspace-view.js pada header workspace
}

function updateMobileTabBadge() {
  const badge = document.getElementById('mobile-tab-badge');
  if (badge) {
    badge.textContent = notes.length;
  }
}

/** Setup layer marker di atas layar prototype */
function setupMarkerLayer() {
  const markerLayer = document.getElementById('marker-layer');
  if (!markerLayer) return;

  // Tangkap klik pada prototype untuk menaruh marker saat Review Mode aktif
  markerLayer.addEventListener('click', (e) => {
    if (!isReviewMode) return;

    const rect = markerLayer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Hitung koordinat persentase relatif (0% - 100%) terhadap frame prototype
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    openAddFeedbackModal({ x: parseFloat(xPct.toFixed(1)), y: parseFloat(yPct.toFixed(1)) });
  });
}

/** Render marker pins pada layar prototype */
export function updateMarkers() {
  const markerLayer = document.getElementById('marker-layer');
  if (!markerLayer) return;

  const currentRoute = (getCurrent().route || '/login').split('?')[0];

  markerLayer.innerHTML = '';
  markerLayer.classList.toggle('is-review-mode', isReviewMode);

  if (isReviewMode) {
    const banner = document.createElement('div');
    banner.className = 'marker-pin-banner';
    banner.innerHTML = '📍 Klik pada layar untuk menaruh pin catatan';
    markerLayer.appendChild(banner);
  }

  // Jika semua marker disembunyikan, hentikan rendering pin
  if (isAllMarkersHidden) return;

  // Tampilkan marker yang sesuai halaman aktif (atau semua marker) dan tidak di-hide
  const visibleNotes = notes.filter(
    (n) => (!n.page || n.page === currentRoute || filterPage === n.page) && !n.hidden
  );

  visibleNotes.forEach((n) => {
    if (!n.marker || typeof n.marker.x !== 'number') return;

    const pin = document.createElement('div');
    const statusClass = n.status === 'Dalam Proses' ? 'status-proses' : n.status === 'Selesai' ? 'status-selesai' : 'status-baru';
    const isSelected = selectedNoteId === n.id;

    pin.className = `marker-pin ${statusClass} ${isSelected ? 'is-selected' : ''}`;
    pin.style.left = `${n.marker.x}%`;
    pin.style.top = `${n.marker.y}%`;
    pin.title = `#${String(n.number).padStart(2, '0')} - ${n.author}: ${n.description}`;

    pin.innerHTML = `
      <div class="marker-badge">#${n.number}</div>
      ${isSelected ? '<div class="marker-ripple"></div>' : ''}
    `;

    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNote(n.id, true);
    });

    markerLayer.appendChild(pin);
  });
}

/** Highlight dan buka detail feedback */
function selectNote(noteId, openDetail = false) {
  selectedNoteId = noteId;
  updateMarkers();
  renderReviewPanel();

  const note = notes.find((n) => n.id === noteId);
  if (note && openDetail) {
    openFeedbackDetailModal(note);
  }
}

/** Render Panel Review (Desktop Table & Mobile Cards) */
export function renderReviewPanel() {
  if (activeWorkspaceTab === 'flow') {
    activeWorkspaceTab = 'notes';
  }
  updateMobileTabBadge();
  const container = document.getElementById('review-panel-container');
  if (!container) return;

  // Filter notes
  const filteredNotes = notes.filter((n) => {
    const matchSearch =
      !searchQuery ||
      n.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (n.creatorRole && n.creatorRole.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (n.email && n.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      String(n.number).includes(searchQuery);

    const matchStatus = filterStatus === 'ALL' || n.status === filterStatus;
    const matchPage = filterPage === 'ALL' || n.page === filterPage;

    return matchSearch && matchStatus && matchPage;
  });

  const countBaru = notes.filter((n) => n.status === 'Baru').length;
  const countProses = notes.filter((n) => n.status === 'Dalam Proses').length;
  const countSelesai = notes.filter((n) => n.status === 'Selesai').length;

  // Filter process steps
  const filteredSteps = PROCESS_STEPS.filter((step) => {
    if (flowRoleFilter === 'ALL') return true;
    if (flowRoleFilter === 'MANTRI_TANAMAN') return step.role === 'MANTRI_TANAMAN' || step.roleLabel.includes('Mantri');
    if (flowRoleFilter === 'ASISTEN') return step.role === 'ASISTEN' || step.roleLabel.includes('Asisten');
    if (flowRoleFilter === 'READY') return step.status === 'READY';
    if (flowRoleFilter === 'ANALYSIS') return step.status === 'ANALYSIS';
    return true;
  });

  const countReadySteps = PROCESS_STEPS.filter((s) => s.status === 'READY').length;
  const countAnalysisSteps = PROCESS_STEPS.filter((s) => s.status === 'ANALYSIS').length;

  // Render Tabs Navigation Bar
  let html = `
    <div class="workspace-main-tabs">
      <button class="workspace-main-tab-btn ${activeWorkspaceTab === 'notes' ? 'is-active' : ''}" id="tab-main-notes" type="button">
        <span>📝</span>
        <span>Catatan Perbaikan</span>
        <span class="tab-badge">${notes.length}</span>
      </button>
      <!-- [TEMPORARILY DISABLED / COMMENTED OUT] Tab Flow Proses
      <button class="workspace-main-tab-btn ${activeWorkspaceTab === 'flow' ? 'is-active' : ''}" id="tab-main-flow" type="button">
        <span>🔄</span>
        <span>Flow Proses</span>
        <span class="tab-badge-pulse">${PROCESS_STEPS.length} Tahapan</span>
      </button>
      -->
      <button class="workspace-main-tab-btn ${activeWorkspaceTab === 'transactions' ? 'is-active' : ''}" id="tab-main-transactions" type="button">
        <span>📊</span>
        <span>Data Transaksi</span>
        <span class="tab-badge-pulse" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">8 Modul (CRUD)</span>
      </button>
      <!-- [TEMPORARILY HIDDEN] Tab 3: Pemetaan Alur Proses Aplikasi (Disembunyikan sementara, siap diaktifkan kembali)
      <button class="workspace-main-tab-btn ${activeWorkspaceTab === 'process-mapping' ? 'is-active' : ''}" id="tab-main-process-mapping" type="button">
        <span>🗺️</span>
        <span>Pemetaan Alur Proses Aplikasi</span>
      </button>
      -->
      <!-- [TEMPORARILY HIDDEN] Tab 4: Pusat Informasi Aplikasi (Disembunyikan sementara, siap diaktifkan kembali)
      <button class="workspace-main-tab-btn ${activeWorkspaceTab === 'info-center' ? 'is-active' : ''}" id="tab-main-info-center" type="button">
        <span>📚</span>
        <span>Pusat Informasi Aplikasi</span>
      </button>
      -->
    </div>
  `;

  if (activeWorkspaceTab === 'notes') {
    // TAB 1: CATATAN PERBAIKAN
    html += `
      <div class="review-panel-head">
        <div class="review-title-group">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>Catatan Perbaikan</h2>
            <span class="server-status-pill ${isServerConnected ? 'online' : 'offline'}" title="${isServerConnected ? 'Tersambung ke Server Database & Email' : 'Berjalan dalam mode offline lokal'}">
              ${isServerConnected ? '🟢 Database Server Online' : '🟡 Mode Offline (Lokal)'}
            </span>
          </div>
          <p>Prototype Review & Quality Assurance Panel &bull; Otomatis Notifikasi Email</p>
        </div>
        <div class="review-actions-group">
          <button class="btn-toggle-all-markers ${isAllMarkersHidden ? 'is-hidden-mode' : ''}" id="btn-toggle-all-markers" type="button" title="Sembunyikan / Tampilkan Semua Pin Marker">
            ${isAllMarkersHidden ? 'Semua Pin: Tersembunyi' : 'Semua Pin: Tampil'}
          </button>
          <button class="btn-toggle-review-mode ${isReviewMode ? 'is-active' : ''}" id="btn-toggle-review" type="button">
            ${isReviewMode ? '🔴 Matikan Mode Pin' : '📍 Mode Pin Marker'}
          </button>
          <button class="btn-add-feedback" id="btn-add-feedback" type="button">
            <span>+</span> Tambah Catatan
          </button>
        </div>
      </div>

      <div class="review-filter-bar">
        <div class="filter-search-wrap">
          <span class="filter-search-icon">🔍</span>
          <input class="filter-search-input" id="review-search" type="text" placeholder="Cari catatan, pembuat, email..." value="${esc(searchQuery)}" />
        </div>
        <select class="filter-select" id="review-filter-status">
          <option value="ALL" ${filterStatus === 'ALL' ? 'selected' : ''}>Semua Status</option>
          <option value="Baru" ${filterStatus === 'Baru' ? 'selected' : ''}>Status: Baru</option>
          <option value="Dalam Proses" ${filterStatus === 'Dalam Proses' ? 'selected' : ''}>Status: Dalam Proses</option>
          <option value="Selesai" ${filterStatus === 'Selesai' ? 'selected' : ''}>Status: Selesai</option>
        </select>
        <select class="filter-select" id="review-filter-page">
          <option value="ALL" ${filterPage === 'ALL' ? 'selected' : ''}>Semua Halaman</option>
          ${(() => {
        const pageFilterOptions = new Map();
        notes.forEach(n => {
          if (n.page) {
            pageFilterOptions.set(n.page, n.pageTitle || getPageTitle(n.page));
          }
        });
        Object.entries(CANONICAL_PAGE_MAP).forEach(([r, title]) => {
          if (!pageFilterOptions.has(r)) {
            pageFilterOptions.set(r, title);
          }
        });
        return Array.from(pageFilterOptions.entries()).map(([r, title]) => `
              <option value="${esc(r)}" ${filterPage === r ? 'selected' : ''}>Halaman: ${esc(title)}</option>
            `).join('');
      })()}
        </select>
      </div>

      <div class="review-stats-summary" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <span>Total: <strong>${notes.length} Catatan</strong></span>
          <span class="stat-pill baru">Baru: ${countBaru}</span>
          <span class="stat-pill proses">Proses: ${countProses}</span>
          <span class="stat-pill selesai">Selesai: ${countSelesai}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-refresh-notes" id="btn-refresh-notes" type="button" title="Muat ulang data dari database server" style="background:#f1f5f9; border:1px solid #cbd5e1; padding:4px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
            🔄 Refresh Data
          </button>
          <button class="btn-test-email-trigger" id="btn-test-email-trigger" type="button" title="Kirim email uji coba ke admin" style="background:#f0fdf4; border:1px solid #86efac; color:#15803d; padding:4px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
            ✉️ Tes Email
          </button>
        </div>
      </div>

      <!-- Desktop & Tablet Table -->
      <div class="review-table-container">
        <table class="review-table">
          <thead>
            <tr>
              <th class="col-no">No</th>
              <th class="col-date">Tanggal</th>
              <th class="col-author">Pembuat</th>
              <th class="col-page">Halaman</th>
              <th class="col-desc">Deskripsi Catatan</th>
              <th class="col-status">Status</th>
              <th class="col-role">Dibuat Oleh</th>
              <th class="col-marker">Marker</th>
              <th class="col-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${filteredNotes.length === 0
        ? '<tr><td colspan="9" class="review-empty-state">Tidak ada catatan perbaikan yang cocok dengan filter.</td></tr>'
        : filteredNotes
          .map(
            (n) => `
              <tr class="${selectedNoteId === n.id ? 'is-selected' : ''}" data-id="${n.id}">
                <td class="col-no">#${String(n.number).padStart(2, '0')}</td>
                <td class="col-date">${esc(n.createdAt)}</td>
                <td class="col-author">
                  <div style="font-weight:700; color:#0f172a; margin-bottom:2px;">${esc(n.author)}</div>
                  ${n.email ? `<div style="font-size:0.75rem; color:#64748b; word-break:break-all;">✉️ ${esc(n.email)}</div>` : ''}
                </td>
                <td class="col-page">
                  <span class="badge" style="background:#f1f5f9; border:1px solid #e2e8f0; color:#334155; font-size:0.75rem; padding:3px 8px; border-radius:4px; font-weight:600; white-space:nowrap;">
                    ${esc(n.pageTitle || n.page || '-')}
                  </span>
                </td>
                <td class="col-desc">${esc(n.description)}</td>
                <td class="col-status">
                  <span class="table-status-badge ${n.status === 'Dalam Proses' ? 'status-proses' : n.status === 'Selesai' ? 'status-selesai' : 'status-baru'
              }">${esc(n.status)}</span>
                </td>
                <td class="col-role">${esc(n.creatorRole || 'Customer')}</td>
                <td class="col-marker">
                  <button class="btn-table-action btn-toggle-marker-visibility ${n.hidden ? 'is-hidden' : ''}" data-id="${n.id}" type="button" title="${n.hidden ? 'Tampilkan Pin Marker di Layar' : 'Sembunyikan Pin Marker dari Layar'}">
                    ${n.hidden ? '🙈 Sembunyi' : '👁️ Tampil'}
                  </button>
                </td>
                <td class="col-actions">
                  <div class="table-action-btns">
                    <button class="btn-table-action btn-view-pin" data-id="${n.id}" type="button" title="Lihat Pin">📍 Pin</button>
                    <button class="btn-table-action btn-edit-status" data-id="${n.id}" type="button" title="Ubah Status">✏️ Status</button>
                    <button class="btn-table-action delete btn-delete-note" data-id="${n.id}" type="button" title="Hapus">🗑️</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join('')
      }
          </tbody>
        </table>
      </div>

      <!-- Mobile Card List (< 768px) -->
      <div class="review-mobile-list">
        ${filteredNotes.length === 0
        ? '<div class="review-empty-state">Tidak ada catatan perbaikan.</div>'
        : filteredNotes
          .map(
            (n) => `
          <div class="feedback-card-item ${selectedNoteId === n.id ? 'is-selected' : ''}" data-id="${n.id}">
            <div class="feedback-card-head">
              <span class="feedback-card-no">#${String(n.number).padStart(2, '0')}</span>
              <span class="table-status-badge ${n.status === 'Dalam Proses' ? 'status-proses' : n.status === 'Selesai' ? 'status-selesai' : 'status-baru'
              }">${esc(n.status)}</span>
            </div>
            <div class="feedback-card-date">📅 ${esc(n.createdAt)} &bull; ${esc(n.pageTitle || n.page || '-')}</div>
            <div class="feedback-card-author">👤 ${esc(n.author)} ${n.email ? `<span style="font-size:0.75rem; color:#64748b;">(${esc(n.email)})</span>` : ''}</div>
            <div class="feedback-card-desc">${esc(n.description)}</div>
            <div class="feedback-card-footer">
              <span>Dibuat Oleh: <strong>${esc(n.creatorRole || 'Customer')}</strong></span>
              <div style="display:flex; align-items:center; gap:6px;">
                <button class="btn-table-action btn-toggle-marker-visibility ${n.hidden ? 'is-hidden' : ''}" data-id="${n.id}" type="button" title="${n.hidden ? 'Tampilkan Pin Marker' : 'Sembunyikan Pin Marker'}">
                  ${n.hidden ? '🙈 Sembunyi' : '👁️ Tampil'}
                </button>
                <button class="btn-table-action btn-edit-status" data-id="${n.id}" type="button">Status</button>
              </div>
            </div>
          </div>
        `
          )
          .join('')
      }
      </div>
    `;
  } else if (activeWorkspaceTab === 'flow') {
    // TAB 2: FLOW PROSES (WORKFLOW PIPELINE)
    html += `
      <div class="flow-process-container">
        <div class="flow-process-header">
          <div class="flow-process-title-group">
            <h2>Alur Proses Bisnis Pembibitan Karet (SIGMA Rubber Nursery)</h2>
            <p>Pemetaan tahapan kerja dari penerimaan benih, Aktifitas Bibitan, Permintaan dan Pengeluaran Bibit.</p>
          </div>
          <div class="flow-process-stats">
            <span class="flow-stat-badge active">${countReadySteps} Modul Siap Uji</span>
            <span class="flow-stat-badge analysis">${countAnalysisSteps} Tahap Analisis</span>
          </div>
        </div>

        <!-- Filter Peran / Kategori Flow & Global Flowchart Toggle -->
        <div class="flow-role-filter-group">
          <div class="flow-filters-left">
            <span class="filter-label">Filter:</span>
            <button class="flow-role-pill ${flowRoleFilter === 'ALL' ? 'is-active' : ''}" data-flow-filter="ALL" type="button">Semua Tahapan (${PROCESS_STEPS.length})</button>
            <button class="flow-role-pill ${flowRoleFilter === 'MANTRI_TANAMAN' ? 'is-active' : ''}" data-flow-filter="MANTRI_TANAMAN" type="button">Role Mantri</button>
            <button class="flow-role-pill ${flowRoleFilter === 'ASISTEN' ? 'is-active' : ''}" data-flow-filter="ASISTEN" type="button">Role Asisten</button>
            <button class="flow-role-pill ${flowRoleFilter === 'READY' ? 'is-active' : ''}" data-flow-filter="READY" type="button">Siap Uji (${countReadySteps})</button>
            <button class="flow-role-pill ${flowRoleFilter === 'ANALYSIS' ? 'is-active' : ''}" data-flow-filter="ANALYSIS" type="button">Analisis (${countAnalysisSteps})</button>
          </div>
          <div class="flow-filters-right">
            <button id="btn-expand-all-flow" class="btn-flow-control" type="button">Buka Semua Detail</button>
            <button id="btn-collapse-all-flow" class="btn-flow-control" type="button">Tutup Semua</button>
          </div>
        </div>

        <!-- Timeline Steps -->
        <div class="flow-timeline">
          ${filteredSteps.length === 0
        ? '<div class="review-empty-state">Tidak ada tahapan alur yang sesuai dengan filter.</div>'
        : filteredSteps
          .map((step) => {
            const isExpanded = expandedFlowSteps.has(step.step);
            const fc = step.flowChart;
            return `
            <div class="flow-step-card ${step.status === 'READY' ? 'is-active-module' : 'is-analysis-module'}" data-step="${step.step}">
              <div class="flow-step-header-row">
                <div class="flow-step-number-badge">
                  <span>${String(step.step).padStart(2, '0')}</span>
                </div>
                <div class="flow-step-main-meta">
                  <div class="flow-step-top-line">
                    <h3 class="flow-step-title">${step.title}</h3>
                    <span class="flow-step-status-tag ${step.status === 'READY' ? 'ready' : 'analysis'}">${step.statusLabel}</span>
                    <span class="flow-step-role-tag">${step.roleLabel}</span>
                  </div>
                  <div class="flow-step-desc">${step.desc}</div>
                  <div class="flow-step-meta-info">
                    <span class="meta-item"><strong>Output:</strong> ${step.output}</span>
                    <span class="meta-item"><strong>Rute:</strong> <code>#${step.route}</code></span>
                  </div>
                </div>
                <div class="flow-step-actions-cell">
                  <button class="btn-flow-navigate" data-route="${step.route}" type="button" title="Buka modul di layar mobile">
                    Buka Layar
                  </button>
                  <button class="btn-flow-note" data-route="${step.route}" data-title="${step.title}" type="button" title="Beri catatan perbaikan">
                    Catatan
                  </button>
                </div>
              </div>

              <!-- Flowchart Toggle Button -->
              <div class="flow-step-toggle-row">
                <button class="btn-toggle-flowchart ${isExpanded ? 'is-expanded' : ''}" data-step="${step.step}" type="button">
                  <span class="toggle-icon">${isExpanded ? '▲' : '▼'}</span>
                  <span>${isExpanded ? 'Sembunyikan Alur Proses Sistem' : 'Alur Proses Sistem'}</span>
                </button>
              </div>

              <!-- Flowchart Stepper Box -->
              ${isExpanded && fc
                ? `
                <div class="flow-step-flowchart-box">
                  <div class="flowchart-header">
                    <span class="flowchart-heading">Alur Proses Aplikasi</span>
                    <span class="flowchart-badge-count">${fc.nodes.length} Tahapan</span>
                  </div>

                  <div class="flowchart-summary-text">
                    <strong>Ringkasan Alur:</strong> ${esc(fc.summary)}
                  </div>

                  <!-- Stepper Sequence List -->
                  <div class="flowchart-stepper-container">
                    ${fc.nodes
                  .map(
                    (node, nIdx) => `
                      <div class="flow-stepper-item">
                        <div class="stepper-indicator-col">
                          <div class="stepper-dot">${String(nIdx + 1).padStart(2, '0')}</div>
                          ${nIdx < fc.nodes.length - 1 ? '<div class="stepper-line"></div>' : ''}
                        </div>
                        <div class="stepper-content-col">
                          <div class="stepper-head">
                            <span class="stepper-node-title">${esc(node.label)}</span>
                            <span class="stepper-type-pill ${node.type}">${node.type === 'start'
                        ? 'Inisialisasi'
                        : node.type === 'process'
                          ? 'Operasional'
                          : node.type === 'decision'
                            ? 'Verifikasi Mutu'
                            : 'Output Sistem'
                      }</span>
                            <span class="stepper-actor-tag">Role: ${esc(node.actor)}</span>
                          </div>
                          <div class="stepper-desc">${esc(node.desc)}</div>
                          ${node.branch ? `<div class="stepper-branch-alert"><strong>Verifikasi:</strong> ${esc(node.branch)}</div>` : ''}
                        </div>
                      </div>
                    `
                  )
                  .join('')}
                  </div>

                  <!-- 3-Column Meta Details -->
                  <div class="flowchart-meta-grid">
                    <div class="flowchart-meta-box">
                      <div class="flowchart-meta-box-title">Prasyarat & Input Data</div>
                      <ul class="flowchart-meta-box-list">
                        ${fc.inputs.map((inp) => `<li>${esc(inp)}</li>`).join('')}
                      </ul>
                    </div>
                    <div class="flowchart-meta-box">
                      <div class="flowchart-meta-box-title">Output & Dokumen Sistem</div>
                      <ul class="flowchart-meta-box-list">
                        ${fc.outputs.map((out) => `<li>${esc(out)}</li>`).join('')}
                      </ul>
                    </div>
                    <div class="flowchart-meta-box">
                      <div class="flowchart-meta-box-title">Ketentuan SOP Kebun</div>
                      <ul class="flowchart-meta-box-list">
                        ${fc.sopRules.map((rule) => `<li>${esc(rule)}</li>`).join('')}
                      </ul>
                    </div>
                  </div>
                </div>
              `
                : ''
              }
            </div>
          `;
          })
          .join('')
      }
        </div>
      </div>
    `;
  } else if (activeWorkspaceTab === 'transactions') {
    html += renderTransactionsWorkspaceTab();
  } else if (activeWorkspaceTab === 'process-mapping') {
    html += `
      <div class="process-mapping-container" id="process-mapping-container"></div>
    `;
  } else if (activeWorkspaceTab === 'info-center') {
    html += `
      <div class="info-center-container" id="info-center-container"></div>
    `;
  }

  container.innerHTML = html;

  // ---------- ATTACH EVENT LISTENERS ----------

  // Main Tabs switching
  container.querySelector('#tab-main-notes')?.addEventListener('click', () => {
    setWorkspaceTab('notes');
    renderReviewPanel();
  });

  container.querySelector('#tab-main-flow')?.addEventListener('click', () => {
    setWorkspaceTab('flow');
    renderReviewPanel();
  });

  container.querySelector('#tab-main-transactions')?.addEventListener('click', () => {
    setWorkspaceTab('transactions');
    renderReviewPanel();
  });

  container.querySelector('#tab-main-process-mapping')?.addEventListener('click', () => {
    setWorkspaceTab('process-mapping');
    renderReviewPanel();
  });

  container.querySelector('#tab-main-info-center')?.addEventListener('click', () => {
    setWorkspaceTab('info-center');
    renderReviewPanel();
  });

  if (activeWorkspaceTab === 'info-center') {
    const icContainer = container.querySelector('#info-center-container');
    if (icContainer) {
      renderInfoCenterPortal(icContainer);
    }
    return;
  }

  if (activeWorkspaceTab === 'process-mapping') {
    const pmContainer = container.querySelector('#process-mapping-container');
    if (pmContainer) {
      renderProcessMappingPortal(pmContainer);
    }
    return;
  }

  if (activeWorkspaceTab === 'transactions') {
    attachTransactionsWorkspaceEvents(container);
    return;
  }

  if (activeWorkspaceTab === 'flow') {
    // Flow Role Filter Pills
    container.querySelectorAll('.flow-role-pill[data-flow-filter]').forEach((pill) => {
      pill.addEventListener('click', () => {
        flowRoleFilter = pill.dataset.flowFilter;
        renderReviewPanel();
      });
    });

    // Expand All / Collapse All Flowcharts
    container.querySelector('#btn-expand-all-flow')?.addEventListener('click', () => {
      PROCESS_STEPS.forEach((s) => expandedFlowSteps.add(s.step));
      renderReviewPanel();
    });

    container.querySelector('#btn-collapse-all-flow')?.addEventListener('click', () => {
      expandedFlowSteps.clear();
      renderReviewPanel();
    });

    // Individual Flowchart Toggle Buttons
    container.querySelectorAll('.btn-toggle-flowchart').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stepNum = parseInt(btn.dataset.step, 10);
        if (expandedFlowSteps.has(stepNum)) {
          expandedFlowSteps.delete(stepNum);
        } else {
          expandedFlowSteps.add(stepNum);
        }
        renderReviewPanel();
      });
    });

    // Flow Navigate Button (Langsung Buka Halaman di Frame HP)
    container.querySelectorAll('.btn-flow-navigate').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;
        if (route) {
          navigate(route);
          toast(`Menampilkan layar prototype: ${route}`, 'info');

          // Bila di layar mobile (< 768px), otomatis switch ke mode HP
          if (window.innerWidth < 768) {
            setWorkspaceViewMode('hp');
          }
        }
      });
    });

    // Flow Note Button (Navigasi ke halaman + buka mode tambah catatan)
    container.querySelectorAll('.btn-flow-note').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;
        if (route) {
          navigate(route);
          activeWorkspaceTab = 'notes';
          isReviewMode = true;
          renderReviewPanel();
          updateMarkers();
          toast('Mode Pin Marker aktif! Klik pada layar HP untuk menaruh pin catatan.', 'info');
        }
      });
    });
    return;
  }

  // Event Listeners khusus Tab Catatan Perbaikan
  const btnToggleAll = container.querySelector('#btn-toggle-all-markers');
  btnToggleAll?.addEventListener('click', () => {
    isAllMarkersHidden = !isAllMarkersHidden;
    toast(isAllMarkersHidden ? 'Semua pin marker disembunyikan' : 'Semua pin marker ditampilkan', 'info');
    updateMarkers();
    renderReviewPanel();
  });

  const btnToggle = container.querySelector('#btn-toggle-review');
  btnToggle?.addEventListener('click', () => {
    isReviewMode = !isReviewMode;
    toast(isReviewMode ? 'Mode Pin Aktif: Klik pada layar prototype untuk menaruh catatan' : 'Mode Pin Nonaktif', 'info');
    updateMarkers();
    renderReviewPanel();
  });

  const btnAdd = container.querySelector('#btn-add-feedback');
  btnAdd?.addEventListener('click', () => {
    openAddFeedbackModal();
  });

  const btnRefresh = container.querySelector('#btn-refresh-notes');
  btnRefresh?.addEventListener('click', async () => {
    toast('Memperbarui data dari server...', 'info');
    await loadNotes();
    toast('Data catatan berhasil diperbarui!', 'success');
  });

  const btnTestEmail = container.querySelector('#btn-test-email-trigger');
  btnTestEmail?.addEventListener('click', async () => {
    try {
      toast('Mengirimkan email uji coba...', 'info');
      const res = await fetch('/api/notes/test-email', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        if (data.result?.simulated) {
          toast('Email simulasi berhasil diproses di server (Cek log server)', 'info');
        } else {
          toast(`Email uji coba berhasil dikirim ke: ${data.result?.recipient || 'Admin'}`, 'success');
        }
      } else {
        toast('Gagal mengirim email: ' + (data.error || 'Server error'), 'danger');
      }
    } catch (e) {
      toast('Server tidak merespons pengujian email', 'danger');
    }
  });

  const searchInput = container.querySelector('#review-search');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderReviewPanel();
  });

  const statusSelect = container.querySelector('#review-filter-status');
  statusSelect?.addEventListener('change', (e) => {
    filterStatus = e.target.value;
    renderReviewPanel();
    updateMarkers();
  });

  const pageSelect = container.querySelector('#review-filter-page');
  pageSelect?.addEventListener('change', (e) => {
    filterPage = e.target.value;
    renderReviewPanel();
    updateMarkers();
  });

  // Table row clicks
  container.querySelectorAll('.review-table tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-table-action')) return;
      const id = tr.dataset.id;
      if (id) selectNote(id, true);
    });
  });

  // Mobile card clicks
  container.querySelectorAll('.feedback-card-item').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-table-action')) return;
      const id = card.dataset.id;
      if (id) selectNote(id, true);
    });
  });

  // Toggle single marker visibility
  container.querySelectorAll('.btn-toggle-marker-visibility').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const note = notes.find((n) => n.id === id);
      if (!note) return;

      note.hidden = !note.hidden;
      saveNotesLocally();
      updateMarkers();
      renderReviewPanel();

      // Sync ke backend bila online
      try {
        await fetch(`${API_URL}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hidden: note.hidden })
        });
      } catch (err) {
        // Safe offline ignore
      }
      toast(`Pin #${note.number} ${note.hidden ? 'disembunyikan' : 'ditampilkan'} di layar`, 'info');
    });
  });

  // Pin button
  container.querySelectorAll('.btn-view-pin').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      selectNote(id, false);
      toast(`Pin #${notes.find((n) => n.id === id)?.number} ditandai pada layar`, 'info');
    });
  });

  // Status button
  container.querySelectorAll('.btn-edit-status').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const note = notes.find((n) => n.id === id);
      if (note) openChangeStatusModal(note);
    });
  });

  // Delete button
  container.querySelectorAll('.btn-delete-note').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const note = notes.find((n) => n.id === id);
      if (!note) return;

      openModal({
        title: `Hapus Catatan #${String(note.number).padStart(2, '0')}`,
        body: `<p>Apakah Anda yakin ingin menghapus catatan perbaikan dari <strong>${esc(note.author)}</strong>?</p>`,
        footer: `
          <button class="btn btn-ghost" data-del-cancel>Batal</button>
          <button class="btn btn-danger" data-del-confirm>Hapus Catatan</button>
        `
      });

      const root = document.getElementById('modal-root');
      root.querySelector('[data-del-cancel]')?.addEventListener('click', closeModal);
      root.querySelector('[data-del-confirm]')?.addEventListener('click', async () => {
        // Hapus dari server
        try {
          await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('[review] failed to delete on server, falling back to local deletion');
        }

        notes = notes.filter((n) => n.id !== id);
        saveNotesLocally();
        closeModal();
        toast('Catatan berhasil dihapus', 'info');
        renderReviewPanel();
        updateMarkers();
      });
    });
  });
}

/** Modal Tambah Catatan */
export function openAddFeedbackModal(markerCoords = null) {
  const currentRouteRaw = getCurrent().route || '/login';
  const currentRoute = currentRouteRaw.split('?')[0];
  const user = session.get() || {};
  const defaultAuthor = user.name && user.name !== 'Mantri Tanaman' && user.name !== 'Mantri Bibitan' ? user.name : 'Pengunjung / User';
  const defaultRole = user.role ? (ROLE_LABELS[user.role] || user.role) : 'Customer / User Field';

  const isMarkerMode = markerCoords !== null && typeof markerCoords === 'object';
  const defaultCoords = markerCoords || { x: 50.0, y: 40.0 };
  const activePageTitle = getPageTitle(currentRoute);

  let pageFieldHtml = '';
  if (isMarkerMode) {
    // SCENARIO 1: Pin Marker Mode — locked to current page to prevent spatial/page inconsistency
    pageFieldHtml = `
      <div class="feedback-form-row">
        <label class="feedback-form-label">Halaman Terkait <span style="font-size:0.75rem; color:#64748b;">(Terkunci sesuai posisi Pin Marker)</span></label>
        <input class="feedback-form-input" id="input-fb-page-display" type="text" value="${esc(activePageTitle)} (${esc(currentRoute)})" readonly style="background:#f1f5f9; color:#334155; font-weight:600; cursor:not-allowed;" />
        <input type="hidden" id="input-fb-page" value="${esc(currentRoute)}" />
      </div>
    `;
  } else {
    // SCENARIO 2: Generic Add Note without Pin Marker — dropdown with current page pre-selected
    const knownOptions = Object.entries(CANONICAL_PAGE_MAP);
    const hasCurrentInMap = Boolean(CANONICAL_PAGE_MAP[currentRoute]);

    pageFieldHtml = `
      <div class="feedback-form-row">
        <label class="feedback-form-label">Halaman Terkait</label>
        <select class="feedback-form-select" id="input-fb-page">
          ${!hasCurrentInMap ? `<option value="${esc(currentRoute)}" selected>${esc(activePageTitle)} (${esc(currentRoute)})</option>` : ''}
          ${knownOptions.map(([r, title]) => `
            <option value="${esc(r)}" ${r === currentRoute ? 'selected' : ''}>${esc(title)} (${esc(r)})</option>
          `).join('')}
        </select>
      </div>
    `;
  }

  openModal({
    title: isMarkerMode ? 'Tambah Catatan Pin Marker' : 'Tambah Catatan Perbaikan',
    body: `
      <div class="feedback-form-row">
        <label class="feedback-form-label">Nama Pembuat <span style="color:#ef4444;">*</span></label>
        <input class="feedback-form-input" id="input-fb-author" type="text" placeholder="Masukkan nama Anda" value="${esc(defaultAuthor)}" />
      </div>
      <div class="feedback-form-row">
        <label class="feedback-form-label">Email Anda <span style="font-size:0.75rem; color:#64748b;">(opsional, untuk notifikasi balasan)</span></label>
        <input class="feedback-form-input" id="input-fb-email" type="email" placeholder="nama@email.com" />
      </div>
      <div class="feedback-form-row">
        <label class="feedback-form-label">Peran / Kategori</label>
        <input class="feedback-form-input" id="input-fb-role" type="text" placeholder="Contoh: Customer, Asisten, QA" value="${esc(defaultRole)}" />
      </div>
      ${pageFieldHtml}
      <div class="feedback-form-row">
        <label class="feedback-form-label">Deskripsi Catatan / Perbaikan <span style="color:#ef4444;">*</span></label>
        <textarea class="feedback-form-textarea" id="input-fb-desc" placeholder="Tuliskan catatan perbaikan atau feedback secara detail..."></textarea>
      </div>
      ${isMarkerMode ? `
        <div class="feedback-form-row">
          <label class="feedback-form-label">Koordinat Pin Marker</label>
          <div class="feedback-marker-coords">
            Posisi relatif: X: <strong>${defaultCoords.x}%</strong>, Y: <strong>${defaultCoords.y}%</strong>
          </div>
        </div>
      ` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" data-fb-cancel>Batal</button>
      <button class="btn btn-primary" data-fb-save id="btn-save-note-modal">Simpan & Kirim Notifikasi</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-fb-cancel]')?.addEventListener('click', closeModal);

  root.querySelector('#btn-save-note-modal')?.addEventListener('click', async () => {
    const author = root.querySelector('#input-fb-author')?.value.trim() || 'Reviewer';
    const email = root.querySelector('#input-fb-email')?.value.trim() || '';
    const role = root.querySelector('#input-fb-role')?.value.trim() || 'Customer';
    const page = isMarkerMode ? currentRoute : (root.querySelector('#input-fb-page')?.value || currentRoute);
    const desc = root.querySelector('#input-fb-desc')?.value.trim();

    if (!desc) {
      toast('Deskripsi catatan wajib diisi', 'danger');
      root.querySelector('#input-fb-desc')?.focus();
      return;
    }

    const saveBtn = root.querySelector('#btn-save-note-modal');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';
    }

    const pageTitle = getPageTitle(page);

    const payload = {
      author,
      email,
      creatorRole: role,
      page,
      pageTitle,
      description: desc,
      status: 'Baru',
      marker: isMarkerMode ? defaultCoords : null
    };

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success && result.data) {
          notes.unshift(result.data);
          saveNotesLocally();
          closeModal();
          isReviewMode = false;

          if (result.emailStatus?.sent) {
            toast('Catatan disimpan ke Database & notifikasi email terkirim!', 'success');
          } else {
            toast('Catatan berhasil disimpan ke Database Server!', 'success');
          }

          renderReviewPanel();
          updateMarkers();
          return;
        }
      }
    } catch (err) {
      console.warn('[review] API POST gagal, menyimpan secara lokal:', err);
    }

    // Fallback Offline
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const fallbackNote = {
      id: `FB-${Date.now()}`,
      number: notes.length + 1,
      createdAt: dateStr,
      author,
      creatorRole: role,
      email,
      page,
      pageTitle,
      description: desc,
      status: 'Baru',
      marker: isMarkerMode ? defaultCoords : null,
      hidden: false
    };

    notes.unshift(fallbackNote);
    saveNotesLocally();
    closeModal();
    isReviewMode = false;

    toast('Catatan tersimpan (Offline Storage)', 'info');
    renderReviewPanel();
    updateMarkers();
  });
}


/** Modal Detail Feedback */
function openFeedbackDetailModal(note) {
  openModal({
    title: `Detail Catatan #${String(note.number).padStart(2, '0')}`,
    body: `
      <div style="display:flex; flex-direction:column; gap:12px; font-size:0.92rem;">
        <div><strong>Halaman:</strong> ${esc(note.pageTitle || note.page)}</div>
        <div><strong>Tanggal:</strong> ${esc(note.createdAt)}</div>
        <div><strong>Pembuat:</strong> ${esc(note.author)} (${esc(note.creatorRole || 'Customer')})</div>
        ${note.email ? `<div><strong>Email:</strong> <a href="mailto:${esc(note.email)}" style="color:#116834;">${esc(note.email)}</a></div>` : ''}
        <div><strong>Status:</strong> <span class="table-status-badge ${note.status === 'Dalam Proses' ? 'status-proses' : note.status === 'Selesai' ? 'status-selesai' : 'status-baru'
      }">${esc(note.status)}</span></div>
        <div><strong>Deskripsi:</strong></div>
        <div style="background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0; line-height:1.45; word-break:break-word;">
          ${esc(note.description)}
        </div>
        <div style="font-size:0.8rem; color:#64748b;">
          📍 Lokasi Pin Marker: (${note.marker?.x}%, ${note.marker?.y}%)
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-detail-close>Tutup</button>
      <button class="btn btn-outline" data-detail-edit-status>Ubah Status</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-detail-close]')?.addEventListener('click', closeModal);
  root.querySelector('[data-detail-edit-status]')?.addEventListener('click', () => {
    closeModal();
    openChangeStatusModal(note);
  });
}

/** Modal Ganti Status Feedback */
function openChangeStatusModal(note) {
  openModal({
    title: `Ubah Status Catatan #${String(note.number).padStart(2, '0')}`,
    body: `
      <div class="feedback-form-row">
        <label class="feedback-form-label">Pilih Status Baru</label>
        <select class="feedback-form-select" id="select-change-status">
          <option value="Baru" ${note.status === 'Baru' ? 'selected' : ''}>Baru</option>
          <option value="Dalam Proses" ${note.status === 'Dalam Proses' ? 'selected' : ''}>Dalam Proses</option>
          <option value="Selesai" ${note.status === 'Selesai' ? 'selected' : ''}>Selesai</option>
        </select>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-status-cancel>Batal</button>
      <button class="btn btn-primary" data-status-save>Perbarui Status</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-status-cancel]')?.addEventListener('click', closeModal);

  root.querySelector('[data-status-save]')?.addEventListener('click', async () => {
    const newStatus = root.querySelector('#select-change-status')?.value;
    if (newStatus) {
      const saveBtn = root.querySelector('[data-status-save]');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan...';
      }

      note.status = newStatus;
      saveNotesLocally();
      closeModal();

      let emailNotified = false;
      // Update di server
      try {
        const res = await fetch(`${API_URL}/${note.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.emailStatus?.sent) {
            emailNotified = true;
          }
        }
      } catch (err) {
        console.warn('[review] failed to update status on server:', err);
      }

      if (emailNotified) {
        toast(`Status #${note.number} diubah ke ${newStatus} & email notifikasi terkirim!`, 'success');
      } else {
        toast(`Status catatan #${note.number} diperbarui menjadi ${newStatus}`, 'success');
      }

      renderReviewPanel();
      updateMarkers();
    }
  });
}

// ==========================================================================
// WORKSPACE TAB 3: DATA TRANSAKSI (KATALOG & CRUD 8 MODUL)
// ==========================================================================

function parseTxNumericQty(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  let s = String(val).trim();
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s) return 0;

  if (s.includes('.') && s.includes(',')) {
    if (s.indexOf('.') < s.lastIndexOf(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = s.replace(/\./g, '');
    }
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  }

  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function getTxItemUnit(item, modId) {
  if (!item) return TX_MODULES[modId]?.unit || '';
  if (item.unit) return item.unit;
  if (item.satuan) return item.satuan;
  if (typeof item.qty === 'string') {
    const match = item.qty.match(/[0-9.,\s]+([a-zA-Z]+)/);
    if (match && match[1]) {
      const u = match[1].trim();
      return u.charAt(0).toUpperCase() + u.slice(1).toLowerCase();
    }
  }
  if (modId === 'reception') {
    const jenis = (item.jenis || item.rawState?.jenisPenerimaan || '').toLowerCase();
    if (jenis.includes('benih') || jenis.includes('biji')) return 'Butir';
    if (jenis.includes('bibit') || jenis.includes('tanaman')) return 'Pkk';
    if (jenis.includes('entres') || jenis.includes('kayu')) return 'Btg';
  }
  if (modId === 'seeding' || modId === 'dederan') {
    return 'Butir';
  }
  if (modId === 'entres') {
    return 'Btg';
  }
  if (modId === 'material') {
    return item.uom || item.unit || 'Unit';
  }
  if (modId === 'nurseryActivity' || modId === 'mandoranConsolidation') {
    return item.uom || item.unit || 'Pkk';
  }
  if (modId === 'dispatch' || modId === 'request' || modId === 'destruction') {
    return 'Pkk';
  }
  return TX_MODULES[modId]?.unit || 'Pkk';
}

function renderTransactionsWorkspaceTab() {
  const curMod = TX_MODULES[activeTxTab] || TX_MODULES.reception;
  let rawList = loadTxList(activeTxTab);

  // Search filter
  let filteredList = rawList.filter((item) => {
    if (txSearchQuery) {
      const q = txSearchQuery.toLowerCase().trim();
      const str = JSON.stringify(item).toLowerCase();
      if (!str.includes(q)) return false;
    }
    if (txStatusFilter !== 'ALL') {
      if ((item.status || 'SUBMITTED') !== txStatusFilter) return false;
    }
    if (activeTxTab === 'nurseryActivity' && txActivityModeFilter !== 'ALL') {
      const mode = item.activityEntryMode || item.entryMode || 'HARIAN';
      if (mode !== txActivityModeFilter) return false;
    }
    return true;
  });

  // Calculate volume & unit dynamically
  const dominantUnit = filteredList.length > 0 ? getTxItemUnit(filteredList[0], activeTxTab) : (curMod.unit || '');
  const totalVolume = curMod.qtyField
    ? filteredList.reduce((sum, it) => sum + parseTxNumericQty(it[curMod.qtyField] || it.totalHasil || it.jumlahBenih || it.qty || 0), 0)
    : 0;

  let html = `
    <div class="tx-catalog-wrapper">
      <!-- HEADER -->
      <div class="tx-catalog-header">
        <div class="tx-header-left">
          <h2 class="tx-header-title">Monitoring Data Transaksi</h2>
          <p class="tx-header-subtitle">Data Transaksi Gawai Rubber Nursery.</p>
        </div>
        <div class="tx-header-actions">
          <button class="btn-tx-destructive" id="btn-tx-reset-all" type="button" title="Kosongkan seluruh data transaksi & afkir di prototype">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Bersihkan Semua Data</span>
          </button>
          <button class="btn-tx-secondary" id="btn-tx-open-screen" type="button" title="Buka modul terkait di layar HP">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path></svg>
            <span>Buka di HP</span>
          </button>
          <button class="btn-tx-secondary" id="btn-tx-seed-sample" type="button" title="Tarik & sinkronkan data transaksi terbaru dari Frame HP">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            <span>Muat Data HP</span>
          </button>
          <button class="btn-tx-primary" id="btn-tx-add-new" type="button">
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Tambah Transaksi</span>
          </button>
        </div>
      </div>

      <!-- CONTEXT / SUMMARY STRIP -->
      <div class="tx-context-strip">
        <div class="tx-context-badge">
          <span class="tx-context-dot"></span>
          <span>${Object.keys(TX_MODULES).length} Modul Pembibitan</span>
        </div>
        <span style="color: #cbd5e1;">•</span>
        <span class="tx-context-desc">Sinkronisasi HP Aktif & Terintegrasi</span>
      </div>

      <!-- 12 MODUL SUB-TABS -->
      <div class="tx-modules-nav-wrap">
        ${Object.values(TX_MODULES)
      .map((m) => {
        const isActive = m.id === activeTxTab;
        const count = loadTxList(m.id).length;
        return `
            <button class="tx-module-tab tx-sub-tab-btn ${isActive ? 'is-active' : ''}" data-mod="${m.id}" type="button">
              <span class="tx-module-tab-icon">${getTxModuleIconSvg(m.id, 14)}</span>
              <span>${esc(m.title)}</span>
              <span class="tx-module-tab-count">${count}</span>
            </button>
          `;
      })
      .join('')}
      </div>

      <!-- FILTER BAR & METRICS -->
      <div class="tx-toolbar">
        <div class="tx-toolbar-left" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
          <div class="tx-search-box">
            <span class="tx-search-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input class="tx-search-input" id="tx-search-input" type="text" placeholder="Cari no. dokumen, batch, klon, bedengan..." value="${esc(
        txSearchQuery
      )}" />
          </div>
          <select class="tx-status-select" id="tx-filter-status">
            <option value="ALL" ${txStatusFilter === 'ALL' ? 'selected' : ''}>Semua Status</option>
            <option value="CONSOLIDATED" ${txStatusFilter === 'CONSOLIDATED' ? 'selected' : ''}>Status: Consolidated</option>
            <option value="AVAILABLE" ${txStatusFilter === 'AVAILABLE' ? 'selected' : ''}>Status: Available</option>
            <option value="PARTIALLY_USED" ${txStatusFilter === 'PARTIALLY_USED' ? 'selected' : ''}>Status: Partially Used</option>
            <option value="FULLY_USED" ${txStatusFilter === 'FULLY_USED' ? 'selected' : ''}>Status: Fully Used</option>
            <option value="APPROVED" ${txStatusFilter === 'APPROVED' ? 'selected' : ''}>Status: Approved</option>
            <option value="SUBMITTED" ${txStatusFilter === 'SUBMITTED' ? 'selected' : ''}>Status: Submitted</option>
            <option value="COMPLETED" ${txStatusFilter === 'COMPLETED' ? 'selected' : ''}>Status: Completed</option>
            <option value="VERIFIED" ${txStatusFilter === 'VERIFIED' ? 'selected' : ''}>Status: Verified</option>
            <option value="DRAFT" ${txStatusFilter === 'DRAFT' ? 'selected' : ''}>Status: Draft</option>
            <option value="HADIR" ${txStatusFilter === 'HADIR' ? 'selected' : ''}>Status: Hadir</option>
          </select>
          ${activeTxTab === 'nurseryActivity' ? `
            <select class="tx-status-select" id="tx-filter-activity-mode">
              <option value="ALL" ${txActivityModeFilter === 'ALL' ? 'selected' : ''}>Semua Fitur (Harian & Mandoran)</option>
              <option value="HARIAN" ${txActivityModeFilter === 'HARIAN' ? 'selected' : ''}>Rekam Aktivitas Harian (Alokasi CFNA)</option>
              <option value="MANDORAN" ${txActivityModeFilter === 'MANDORAN' ? 'selected' : ''}>Rekam Aktivitas Mandoran (Per Pekerja)</option>
            </select>
            <div style="display: flex; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px; gap: 2px;">
              <button id="btn-toggle-view-doc" type="button" style="padding: 4px 10px; font-size: 0.74rem; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s; background: ${txActivityViewMode === 'DOC' ? '#ffffff' : 'transparent'}; color: ${txActivityViewMode === 'DOC' ? '#0f172a' : '#64748b'}; box-shadow: ${txActivityViewMode === 'DOC' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">
                Ringkasan Dokumen
              </button>
              <button id="btn-toggle-view-worker" type="button" style="padding: 4px 10px; font-size: 0.74rem; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s; background: ${txActivityViewMode === 'WORKER' ? '#ffffff' : 'transparent'}; color: ${txActivityViewMode === 'WORKER' ? '#0f172a' : '#64748b'}; box-shadow: ${txActivityViewMode === 'WORKER' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">
                Rincian per Pekerja
              </button>
            </div>
          ` : ''}
          ${activeTxTab === 'mandoranConsolidation' ? `
            <div style="display: flex; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px; gap: 2px;">
              <button id="btn-toggle-consol-doc" type="button" style="padding: 4px 10px; font-size: 0.74rem; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s; background: ${txConsolidationViewMode === 'DOC' ? '#ffffff' : 'transparent'}; color: ${txConsolidationViewMode === 'DOC' ? '#0f172a' : '#64748b'}; box-shadow: ${txConsolidationViewMode === 'DOC' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">
                Ringkasan per Alokasi
              </button>
              <button id="btn-toggle-consol-worker" type="button" style="padding: 4px 10px; font-size: 0.74rem; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s; background: ${txConsolidationViewMode === 'WORKER' ? '#ffffff' : 'transparent'}; color: ${txConsolidationViewMode === 'WORKER' ? '#0f172a' : '#64748b'}; box-shadow: ${txConsolidationViewMode === 'WORKER' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">
                Rincian per Alokasi ➔ Pekerja
              </button>
            </div>
          ` : ''}
          ${txSearchQuery
      ? '<button class="tx-btn-reset-search" id="btn-tx-reset-search" type="button">Reset</button>'
      : ''
    }
        </div>

        <div class="tx-toolbar-right">
          <span class="tx-metric-badge">
            Total: ${filteredList.length} Record
          </span>
          ${(activeTxTab === 'mandoranConsolidation' || activeTxTab === 'nurseryActivity') ? `
            <span class="tx-metric-badge volume" style="background: #f0fdf4; color: #166534; border-color: #bbf7d0;">
              Hasil Kerja: ${(() => {
                const uomTotals = new Map();
                filteredList.forEach(it => {
                  const u = it.uom || 'Pkk';
                  const v = parseTxNumericQty(it.totalHasil !== undefined ? it.totalHasil : (it.volumePkk || 0));
                  uomTotals.set(u, (uomTotals.get(u) || 0) + v);
                });
                if (uomTotals.size === 0) return '0';
                return Array.from(uomTotals.entries()).map(([u, v]) => `${v.toLocaleString('id-ID')} ${u}`).join(' | ');
              })()}
            </span>
          ` : (curMod.qtyField
      ? `
            <span class="tx-metric-badge volume">
              Volume: ${totalVolume.toLocaleString('id-ID')} ${esc(dominantUnit)}
            </span>
          `
      : '')
    }
        </div>
      </div>

      <!-- CONTENT AREA: TABLE / EMPTY STATE -->
      <div class="tx-content-card">
        ${filteredList.length === 0
      ? renderEmptyStateCard({
        title: 'Belum ada data transaksi',
        description: `Belum ada transaksi pada modul ${esc(curMod.title)}. Tambahkan transaksi baru atau muat data dari HP.`,
        actionHtml: `
          <div class="tx-empty-actions" style="margin-top: 12px; display: flex; gap: 8px; justify-content: center;">
            <button id="btn-tx-empty-add" class="btn-tx-primary" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Tambah Transaksi</span>
            </button>
            <button id="btn-tx-empty-sample" class="btn-tx-secondary" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              <span>Muat Data HP</span>
            </button>
          </div>
        `
      })
      : `
          <div class="tx-table-responsive">
            ${renderDynamicTxTable(activeTxTab, curMod, filteredList)}
          </div>
        `
    }
      </div>
    </div>
  `;

  return html;
}

function getTxStatusBadge(status) {
  status = status || 'SUBMITTED';
  let bg = '#f1f5f9';
  let color = '#475569';
  let border = '#cbd5e1';
  let label = status;

  if (['APPROVED', 'VERIFIED', 'COMPLETED', 'HADIR', 'SYNCED', 'AVAILABLE', 'TERSEDIA'].includes(status)) {
    bg = '#f0fdf4';
    color = '#15803d';
    border = '#bbf7d0';
    if (status === 'AVAILABLE') label = 'AVAILABLE';
  } else if (['SUBMITTED', 'UNDER_REVIEW', 'PROCESS', 'PARTIALLY_USED'].includes(status)) {
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
    if (status === 'PARTIALLY_USED') label = 'PARTIALLY USED';
  } else if (['DRAFT', 'PENDING', 'REGRAFTING', 'PENDING_DECLARATION'].includes(status)) {
    bg = '#fffbeb';
    color = '#b45309';
    border = '#fde68a';
  } else if (['FAILED', 'AFKIR', 'REJECTED', 'MATI', 'FULLY_USED', 'HABIS'].includes(status)) {
    bg = '#fef2f2';
    color = '#b91c1c';
    border = '#fecaca';
    if (status === 'FULLY_USED') label = 'FULLY USED';
  }
  return `<span style="display: inline-block; font-size: 0.68rem; font-weight: 700; background: ${bg}; color: ${color}; border: 1px solid ${border}; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.02em;">${esc(label)}</span>`;
}

function getTxCrudButtons(idx, docNo = '') {
  return `
    <div style="position: relative; display: inline-block;">
      <button type="button" class="btn-tx-action-trigger" data-idx="${idx}" data-docno="${esc(docNo)}" title="Menu Aksi" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #475569; padding: 0; transition: all 0.15s ease;">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="1.3" fill="currentColor"></circle>
          <circle cx="19" cy="12" r="1.3" fill="currentColor"></circle>
          <circle cx="5" cy="12" r="1.3" fill="currentColor"></circle>
        </svg>
      </button>

      <div class="tx-action-dropdown" style="display: none; position: absolute; right: 0; top: 32px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); z-index: 100; min-width: 125px; overflow: hidden; text-align: left;">
        <button type="button" class="btn-tx-detail" data-idx="${idx}" data-docno="${esc(docNo)}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.76rem; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #f1f5f9;">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="#475569" stroke-width="2.2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          <span>Detail</span>
        </button>
        <button type="button" class="btn-tx-edit" data-idx="${idx}" data-docno="${esc(docNo)}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.76rem; font-weight: 600; color: #1d4ed8; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #f1f5f9;">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="#1d4ed8" stroke-width="2.2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        <button type="button" class="btn-tx-del" data-idx="${idx}" data-docno="${esc(docNo)}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.76rem; font-weight: 600; color: #dc2626; display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="#dc2626" stroke-width="2.2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Hapus</span>
        </button>
      </div>
    </div>
  `;
}

function renderDynamicTxTable(modId, curMod, list) {
  let theadHtml = '';
  let tbodyHtml = '';

  if (modId === 'attendance') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">NIK & Pekerja</th>
        <th style="padding: 10px 12px;">Jabatan</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Jam Presensi</th>
        <th style="padding: 10px 12px;">Lokasi Kebun</th>
        <th style="padding: 10px 12px;">Metode / Bukti</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const displayName = item.workerName || item.name || item.userName || 'Pekerja';
      const displayCode = item.workerCode || item.code || item.nik || (displayName === 'Wagiman' ? '1405482' : '1405739');
      const displayPosition = item.position || item.jabatan || (item.type === 'SUPERVISOR' || item.role === 'MANTRI_TANAMAN' ? 'Mantri Bibitan' : 'Pekerja Bibitan');
      const displayDate = item.tanggal || item.date || (item.capturedAt ? item.capturedAt.slice(0, 10) : todayISO());
      const rawTime = item.time || (item.capturedAt ? item.capturedAt.slice(11, 19) : '07:15');
      const displayTime = rawTime.includes('WIB') ? rawTime : `${rawTime} WIB`;
      const displayLoc = item.location || item.kebun || 'Tanah Besih - Divisi I';
      const displayMethod = item.method === 'REKAM_DATA_WAJAH' || item.type === 'SUPERVISOR' ? 'Wajah (AI)' : 'Presensi Rombongan';
      const displayStatus = item.status || 'HADIR';

      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
          ${esc(displayName)}
          <div style="font-size: 0.72rem; color: #64748b; font-weight: 400;">NIK: ${esc(displayCode)}</div>
        </td>
        <td style="padding: 10px 12px; color: #334155;">${esc(displayPosition)}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(displayDate)}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${esc(displayTime)}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(displayLoc)}</td>
        <td style="padding: 10px 12px;">
          <span style="font-size: 0.72rem; color: #0369a1; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; font-weight: 600;">
            ${esc(displayMethod)}
          </span>
        </td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(displayStatus)}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
      `;
    }).join('');
  } else if (modId === 'reception') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen / PO</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Tahapan Pertumbuhan</th>
        <th style="padding: 10px 12px;">Jenis Klon</th>
        <th style="padding: 10px 12px;">Asal / Supplier</th>
        <th style="padding: 10px 12px; text-align: right;">Jumlah Diterima</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'reception');
      const numQty = parseTxNumericQty(item.jumlahBenih || item.qty || item.totalDiterima || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || item.nomorDokumen || formatStandardDocNo(2026, 'APR', idx + 1))}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #334155;">${esc(item.tahapan || 'Rubber Main Nursery')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.klon || 'PB 260')}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.sumber || item.sourceName || item.supplier || '-')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #116834;">${numQty.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'APPROVED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'seeding') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen Semai</th>
        <th style="padding: 10px 12px;">Tanggal Semai</th>
        <th style="padding: 10px 12px;">No. Bedengan</th>
        <th style="padding: 10px 12px;">Klon Batang Bawah</th>
        <th style="padding: 10px 12px; text-align: right;">Benih Disemai</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Polybag</th>
        <th style="padding: 10px 12px; text-align: right;">Ditolak</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      let bedDisplay = item.bedengan;
      if (!bedDisplay && Array.isArray(item.rows) && item.rows.length > 0) {
        const beds = Array.from(new Set(item.rows.map(r => r.bedengan).filter(Boolean)));
        bedDisplay = beds.length > 0 ? beds.join(', ') : 'Bedengan 01';
      }
      bedDisplay = bedDisplay || 'Bedengan 01';

      const itemUnit = getTxItemUnit(item, 'seeding');
      const numDisemai = parseTxNumericQty(item.totalDisemai || item.qty || 0);
      const polybagVal = parseTxNumericQty(item.totalPolybag || (numDisemai ? Math.ceil(numDisemai / 2) : 0));
      const ditolakVal = parseTxNumericQty(item.ditolak || 0);

      return `
        <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
          <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
          <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
            ${esc((item.docNo || formatStandardDocNo(2026, 'SOW', idx + 1)).replace('/SEM/', '/SOW/'))}
            <div style="font-size: 0.72rem; color: #116834; font-weight: 700;">${esc(item.batchNo || 'Batch-01')}</div>
          </td>
          <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
          <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(bedDisplay)}</td>
          <td style="padding: 10px 12px; font-weight: 600; color: #334155;">${esc(item.klonAwal || item.klon || 'GT 1')}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #116834;">${numDisemai.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #475569;">${polybagVal.toLocaleString('id-ID')} Plb</td>
          <td style="padding: 10px 12px; text-align: right; color: ${ditolakVal > 0 ? '#dc2626' : '#64748b'}; font-weight: ${ditolakVal > 0 ? '700' : '500'};">${ditolakVal.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
          <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'SUBMITTED')}</td>
          <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
        </tr>
      `;
    }).join('');
  } else if (modId === 'dederan') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen Deder</th>
        <th style="padding: 10px 12px;">Tanggal Deder</th>
        <th style="padding: 10px 12px;">Ref. Dok Induk / Penerimaan</th>
        <th style="padding: 10px 12px;">No. Bedengan</th>
        <th style="padding: 10px 12px;">Klon Benih</th>
        <th style="padding: 10px 12px; text-align: right;">Jumlah Dideder</th>
        <th style="padding: 10px 12px;">Petugas / Mandor</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'dederan');
      const numDeder = parseTxNumericQty(item.jumlahDeder !== undefined ? item.jumlahDeder : (item.qty || 0));
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || formatStandardDocNo(2026, 'DED', idx + 1))}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.tanggalDeder || todayISO())}</td>
        <td style="padding: 10px 12px; font-size: 0.72rem; color: #475569;">${esc(item.parentDocNo || item.parentDederIndukDocNo || item.sourceReceiptDocNo || '-')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || item.bedenganCode || 'Bedengan 01')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klon || 'GT 1')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #116834;">${numDeder.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.createdBy || item.actorName || 'Wagiman')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'MENUNGGU_VERIFIKASI')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'budding') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen & Batch</th>
        <th style="padding: 10px 12px;">Tanggal Okulasi</th>
        <th style="padding: 10px 12px;">No. Bedengan</th>
        <th style="padding: 10px 12px;">Klon Batang Bawah</th>
        <th style="padding: 10px 12px;">Klon Entres</th>
        <th style="padding: 10px 12px; text-align: right;">Kayu Entres (Btg)</th>
        <th style="padding: 10px 12px; text-align: right;">Diokulasi</th>
        <th style="padding: 10px 12px; text-align: right;">Ditolak</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'budding');
      const numDiokulasi = parseTxNumericQty(item.jumlah || item.qty || 0);
      const numDitolak = parseTxNumericQty(item.jumlahDitolak || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
          ${esc((item.docNo || formatStandardDocNo(2026, 'GRF', idx + 1)).replace('/OKL/', '/GRF/'))}
          <div style="font-size: 0.72rem; color: #116834; font-weight: 700;">${esc(item.batchNo || 'Batch-01')}</div>
        </td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || 'Bedengan 01')}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.klonRootstock || 'GT 1')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klonEntres || item.klon || 'PB 260')}</td>
        <td style="padding: 10px 12px; text-align: right; color: #475569;">${(parseTxNumericQty(item.jumlahKayu || 0)).toLocaleString('id-ID')} Btg</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #116834;">${numDiokulasi.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: right; color: ${numDitolak > 0 ? '#dc2626' : '#64748b'}; font-weight: ${numDitolak > 0 ? '700' : '500'};">${numDitolak.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'COMPLETED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'inspection') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen & Batch</th>
        <th style="padding: 10px 12px;">Tanggal Periksa</th>
        <th style="padding: 10px 12px;">Ref. Dokumen Okulasi</th>
        <th style="padding: 10px 12px;">Bedengan</th>
        <th style="padding: 10px 12px; text-align: right;">Total Diperiksa</th>
        <th style="padding: 10px 12px; text-align: right;">Hasil Jadi (Sukses)</th>
        <th style="padding: 10px 12px; text-align: right;">Hasil Gagal</th>
        <th style="padding: 10px 12px; text-align: center;">% Jadi</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'inspection');
      const periksaVal = parseTxNumericQty(item.totalDiperiksa || 0);
      const jadiVal = parseTxNumericQty(item.jumlahJadi || 0);
      const gagalVal = parseTxNumericQty(item.jumlahGagal || (periksaVal - jadiVal)) || 0;
      const persen = item.persenJadi !== undefined ? item.persenJadi : (periksaVal > 0 ? Math.round((jadiVal / periksaVal) * 100) : 0);

      return `
        <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
          <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
          <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
            ${esc(item.docNo || 'INSP/2026/01')}
            <div style="font-size: 0.72rem; color: #116834; font-weight: 700;">${esc(item.batchNo || 'Batch-01')}</div>
          </td>
          <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
          <td style="padding: 10px 12px; font-size: 0.72rem; color: #475569;">${esc(item.buddingDocNo || '-')}</td>
          <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || 'Bedengan 01')}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #0f172a;">${periksaVal.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #15803d;">${jadiVal.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #b91c1c;">${gagalVal.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="font-weight: 800; font-size: 0.75rem; color: #116834; padding: 2px 7px; background: #dcfce7; border-radius: 4px; border: 1px solid #bbf7d0;">${persen}%</span>
          </td>
          <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'VERIFIED')}</td>
          <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
        </tr>
      `;
    }).join('');
  } else if (modId === 'regrafting') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen & Batch</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Bedengan</th>
        <th style="padding: 10px 12px;">Klon Entres</th>
        <th style="padding: 10px 12px; text-align: right;">Kayu Entres (Btg)</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Regrafting</th>
        <th style="padding: 10px 12px; text-align: right;">Ditolak</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'regrafting');
      const numRegraft = parseTxNumericQty(item.jumlah || item.qty || 0);
      const numDitolak = parseTxNumericQty(item.jumlahDitolak || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
          ${esc(item.docNo || 'REG/2026/01')}
          <div style="font-size: 0.72rem; color: #116834; font-weight: 700;">${esc(item.batchNo || 'Batch-01')}</div>
        </td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || 'Bedengan 01')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klonEntres || item.klon || 'PB 260')}</td>
        <td style="padding: 10px 12px; text-align: right; color: #475569;">${(parseTxNumericQty(item.jumlahKayu || 0)).toLocaleString('id-ID')} Btg</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #116834;">${numRegraft.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: right; color: ${numDitolak > 0 ? '#dc2626' : '#64748b'}; font-weight: ${numDitolak > 0 ? '700' : '500'};">${numDitolak.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'SUBMITTED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'selection') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen Seleksi</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Asal / Sumber Afkir</th>
        <th style="padding: 10px 12px;">Ref Dokumen / Batch</th>
        <th style="padding: 10px 12px;">Bedengan</th>
        <th style="padding: 10px 12px;">Klon</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Afkir</th>
        <th style="padding: 10px 12px;">Alasan Afkir</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'selection');
      const numAfkir = parseTxNumericQty(item.jumlahAfkir || item.jumlah || item.qty || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo ? item.docNo.replace('/SEL/', '/CULL/').replace('DEC-CUL/', '2026/CULL/0').replace('SEL-POOL/', '2026/CULL/0').replace('SEL/REJ/', '2026/CULL/0') : formatStandardDocNo(2026, 'CULL', idx + 1))}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px;">
          <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;">
            ${esc(item.originType || 'AFKIR_SELEKSI')}
          </span>
        </td>
        <td style="padding: 10px 12px; font-size: 0.72rem; color: #475569;">${esc(item.batchNo || item.buddingDocNo || item.inspectionDocNo || '-')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || 'Bedengan 01')}</td>
        <td style="padding: 10px 12px; font-weight: 600;">${esc(item.klon || 'GT 1')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #b91c1c;">${numAfkir.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; font-size: 0.75rem; font-weight: 600; color: #7f1d1d;">${esc(item.alasan || 'MATI')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'APPROVED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'entres') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen / Plot</th>
        <th style="padding: 10px 12px;">Jenis Aktivitas</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Blok / Plot Entres</th>
        <th style="padding: 10px 12px;">Klon Entres</th>
        <th style="padding: 10px 12px; text-align: right;">Pokok Dikerjakan</th>
        <th style="padding: 10px 12px;">Mandor / Pelaksana</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'entres');
      const numPokok = parseTxNumericQty(item.jumlahPokok || item.jumlah || item.qty || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || item.id || `ENT-${idx + 1}`)}</td>
        <td style="padding: 10px 12px;">
          <span style="font-size: 0.70rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: ${item.activityType === 'TOPPING' ? '#fef3c7' : '#dcfce7'}; color: ${item.activityType === 'TOPPING' ? '#92400e' : '#166534'};">
            ${esc(item.activityType || 'MENUNAS')}
          </span>
        </td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.plotId || item.plotNo || item.blok || 'Plot Entres A-1')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klon || 'PB 260')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #0f172a;">${numPokok.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.mandor || item.workerName || 'Wagiman')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'COMPLETED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'nurseryActivity') {
    if (txActivityViewMode === 'WORKER') {
      theadHtml = `
        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; font-size: 0.74rem; text-transform: uppercase;">
          <th style="padding: 10px 12px; width: 40px;">#</th>
          <th style="padding: 10px 12px;">No. Dokumen</th>
          <th style="padding: 10px 12px; text-align: center;">Fitur Rekam</th>
          <th style="padding: 10px 12px;">Tanggal</th>
          <th style="padding: 10px 12px;">Alokasi Kegiatan</th>
          <th style="padding: 10px 12px;">Work Group Role Code</th>
          <th style="padding: 10px 12px;">Nama Pekerja</th>
          <th style="padding: 10px 12px;">NIK / Kode</th>
          <th style="padding: 10px 12px;">Posisi / Peran</th>
          <th style="padding: 10px 12px; text-align: right;">Target Basis</th>
          <th style="padding: 10px 12px; text-align: right;">Realisasi Hasil</th>
          <th style="padding: 10px 12px;">Mandor</th>
          <th style="padding: 10px 12px;">Created By</th>
          <th style="padding: 10px 12px; text-align: center;">Status</th>
          <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
        </tr>
      `;
      const workerRows = [];
      list.forEach((doc, docIdx) => {
        const pList = Array.isArray(doc.pekerja) && doc.pekerja.length > 0
          ? doc.pekerja
          : [{ name: doc.mandor || 'Pekerja Pelaksana', code: '-', position: 'Pekerja Bibitan', inputHasil: doc.volumePkk }];
        pList.forEach((w) => {
          workerRows.push({ doc, docIdx, w });
        });
      });

      if (workerRows.length === 0) {
        tbodyHtml = `<tr><td colspan="15" style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem;">Tidak ada rincian data tenaga kerja ditemukan.</td></tr>`;
      } else {
        tbodyHtml = workerRows.map((itemRow, idx) => {
          const doc = itemRow.doc;
          const w = itemRow.w;
          const isMandoran = doc.activityEntryMode === 'MANDORAN';
          const targetQty = parseTxNumericQty(w.taskQuantity !== undefined ? w.taskQuantity : doc.taskQuantity || 0);
          const hasilVal = parseTxNumericQty(w.inputHasil !== undefined ? w.inputHasil : doc.volumePkk || 0);
          const uom = doc.uom || 'Pkk';

          const modeBadge = isMandoran
            ? `<span style="display: inline-block; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 9999px; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; white-space: nowrap;">MANDORAN</span>`
            : `<span style="display: inline-block; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 9999px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; white-space: nowrap;">HARIAN</span>`;

          const hasilHtml = isMandoran
            ? `<span style="font-weight: 800; color: #15803d; font-size: 0.82rem;">${hasilVal.toLocaleString('id-ID')} ${esc(uom)}</span>`
            : `<span style="font-weight: 700; color: #0284c7; font-size: 0.78rem; background: #eff6ff; padding: 2px 6px; border-radius: 4px;">Hadir Penuh</span>`;

          return `
            <tr class="tx-table-row-clickable" data-idx="${itemRow.docIdx}" data-docno="${esc(doc.docNo || '')}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease; cursor: pointer;">
              <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
              <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; font-family: monospace; font-size: 0.8rem;">${esc(doc.docNo || '-')}</td>
              <td style="padding: 10px 12px; text-align: center;">${modeBadge}</td>
              <td style="padding: 10px 12px; color: #334155; font-size: 0.78rem;">${esc(doc.tanggal || '-')}</td>
              <td style="padding: 10px 12px; font-size: 0.8rem; color: #1e293b; max-width: 200px;">
                <strong>${esc(doc.allocationCode || '-')}</strong><br>
                <span style="color: #64748b; font-size: 0.74rem;">${esc(doc.allocationName || doc.activityType || '-')}</span>
              </td>
              <td style="padding: 10px 12px; font-family: monospace; font-size: 0.76rem; font-weight: 700; color: #0369a1;">
                ${esc(doc.workGroupRoleCode || '-')}
              </td>
              <td style="padding: 10px 12px; font-weight: 700; color: #0f172a; font-size: 0.82rem;">${esc(w.name || w.workerName || 'Pekerja')}</td>
              <td style="padding: 10px 12px; font-family: monospace; font-size: 0.75rem; color: #64748b;">${esc(w.code || w.workerCode || '-')}</td>
              <td style="padding: 10px 12px; color: #475569; font-size: 0.76rem;">${esc(w.position || w.role || (isMandoran ? 'Pekerja Borongan' : 'Pekerja Harian'))}</td>
              <td style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 0.78rem;">
                ${isMandoran && targetQty > 0 ? `${targetQty.toLocaleString('id-ID')} ${esc(uom)}` : '<span style="color:#94a3b8;">-</span>'}
              </td>
              <td style="padding: 10px 12px; text-align: right;">${hasilHtml}</td>
              <td style="padding: 10px 12px; color: #475569; font-size: 0.78rem;">${esc(doc.mandor || '-')}</td>
              <td style="padding: 10px 12px; font-size: 0.78rem; color: #1e293b; white-space: nowrap;">
                <strong>${esc(doc.createdByName || 'Wagiman')}</strong><br>
                <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-top: 2px;">
                  ${esc(doc.createdByRole || 'Mantri Bibitan')}
                </span>
              </td>
              <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(doc.status || 'VERIFIED')}</td>
              <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(itemRow.docIdx, doc.docNo)}</td>
            </tr>
          `;
        }).join('');
      }
    } else {
      // DOCUMENT SUMMARY VIEW
      theadHtml = `
        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; font-size: 0.74rem; text-transform: uppercase;">
          <th style="padding: 10px 12px; width: 40px;">#</th>
          <th style="padding: 10px 12px;">No. Dokumen Rawat</th>
          <th style="padding: 10px 12px; text-align: center;">Fitur Rekam</th>
          <th style="padding: 10px 12px;">Tanggal</th>
          <th style="padding: 10px 12px;">Alokasi Kegiatan</th>
          <th style="padding: 10px 12px;">Work Group Role Code</th>
          <th style="padding: 10px 12px;">Rincian Tenaga Kerja & Hasil</th>
          <th style="padding: 10px 12px; text-align: right;">Target Basis</th>
          <th style="padding: 10px 12px; text-align: right;">Total Realisasi Hasil</th>
          <th style="padding: 10px 12px;">Mandor / Tim</th>
          <th style="padding: 10px 12px;">Created By</th>
          <th style="padding: 10px 12px; text-align: center;">Status</th>
          <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
        </tr>
      `;
      tbodyHtml = list.map((item, idx) => {
        const isMandoran = item.activityEntryMode === 'MANDORAN';
        const pList = Array.isArray(item.pekerja) ? item.pekerja : [];
        const itemUnit = item.uom || 'Pkk';
        const numVol = parseTxNumericQty(item.totalHasil !== undefined ? item.totalHasil : (item.volumePkk || 0));
        const targetBasis = parseTxNumericQty(item.taskQuantity || 0);

        const modeBadge = isMandoran
          ? `<span style="display: inline-block; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 9999px; background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; white-space: nowrap;">REKAM MANDORAN</span>`
          : `<span style="display: inline-block; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 9999px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; white-space: nowrap;">REKAM HARIAN</span>`;

        let workerSummaryHtml = '';
        if (pList.length === 0) {
          workerSummaryHtml = `<span style="color: #94a3b8; font-size: 0.74rem;">Tidak ada pekerja</span>`;
        } else if (isMandoran) {
          workerSummaryHtml = `
            <div style="display: flex; flex-direction: column; gap: 3px; max-width: 250px;">
              <span style="font-size: 0.70rem; font-weight: 800; color: #c2410c; background: #fff7ed; padding: 1px 6px; border-radius: 4px; display: inline-block; width: fit-content;">
                ${pList.length} Pekerja Borongan
              </span>
              ${pList.slice(0, 2).map(w => `
                <div style="font-size: 0.74rem; color: #334155; display: flex; justify-content: space-between; gap: 8px;">
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>${esc(w.name || w.workerName)}</strong></span>
                  <strong style="color: #15803d; white-space: nowrap;">${Number(w.inputHasil || 0).toLocaleString('id-ID')} ${esc(itemUnit)}</strong>
                </div>
              `).join('')}
              ${pList.length > 2 ? `<span style="font-size: 0.70rem; color: #64748b; font-style: italic;">+${pList.length - 2} pekerja lainnya...</span>` : ''}
            </div>
          `;
        } else {
          workerSummaryHtml = `
            <div style="display: flex; flex-direction: column; gap: 3px; max-width: 250px;">
              <span style="font-size: 0.70rem; font-weight: 800; color: #1d4ed8; background: #eff6ff; padding: 1px 6px; border-radius: 4px; display: inline-block; width: fit-content;">
                ${pList.length} Pekerja Harian
              </span>
              ${pList.slice(0, 2).map(w => `
                <div style="font-size: 0.74rem; color: #334155;">
                  <strong>${esc(w.name || w.workerName)}</strong> <span style="color: #64748b; font-size: 0.70rem;">(${esc(w.code || w.workerCode || '-')})</span>
                </div>
              `).join('')}
              ${pList.length > 2 ? `<span style="font-size: 0.70rem; color: #64748b; font-style: italic;">+${pList.length - 2} pekerja lainnya...</span>` : ''}
            </div>
          `;
        }

        return `
          <tr class="tx-table-row-clickable" data-idx="${idx}" data-docno="${esc(item.docNo || '')}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease; cursor: pointer;">
            <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
            <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; font-family: monospace; font-size: 0.82rem;">${esc(item.docNo || `ACT-${idx + 1}`)}</td>
            <td style="padding: 10px 12px; text-align: center;">${modeBadge}</td>
            <td style="padding: 10px 12px; color: #334155; font-size: 0.78rem;">${esc(item.tanggal || todayISO())}</td>
            <td style="padding: 10px 12px; font-size: 0.8rem; color: #1e293b;">
              <strong>${esc(item.allocationCode || '-')}</strong><br>
              <span style="color: #475569; font-size: 0.74rem;">${esc(item.allocationName || item.activityType || '-')}</span>
            </td>
            <td style="padding: 10px 12px; font-family: monospace; font-size: 0.78rem; font-weight: 700; color: #0369a1;">
              ${esc(item.workGroupRoleCode || '-')}
            </td>
            <td style="padding: 10px 12px;">${workerSummaryHtml}</td>
            <td style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 0.8rem;">
              ${isMandoran && targetBasis > 0 ? `${targetBasis.toLocaleString('id-ID')} ${esc(itemUnit)}` : '<span style="color:#94a3b8;">-</span>'}
            </td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #116834; font-size: 0.85rem;">
              ${numVol.toLocaleString('id-ID')} ${esc(itemUnit)}
            </td>
            <td style="padding: 10px 12px; color: #475569; font-size: 0.78rem;">${esc(item.mandor || 'Wagiman')}</td>
            <td style="padding: 10px 12px; font-size: 0.78rem; color: #1e293b; white-space: nowrap;">
              <strong>${esc(item.createdByName || 'Wagiman')}</strong><br>
              <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-top: 2px;">
                ${esc(item.createdByRole || 'Mantri Bibitan')}
              </span>
            </td>
            <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'VERIFIED')}</td>
            <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx, item.docNo)}</td>
          </tr>
        `;
      }).join('');
    }
  } else if (modId === 'material') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">Item Code</th>
        <th style="padding: 10px 12px;">Nama Material & Bahan</th>
        <th style="padding: 10px 12px;">No. Dokumen Issue</th>
        <th style="padding: 10px 12px;">Alokasi Biaya</th>
        <th style="padding: 10px 12px; text-align: center;">Satuan (UOM)</th>
        <th style="padding: 10px 12px; text-align: right;">Kuantitas Issue Gudang</th>
        <th style="padding: 10px 12px; text-align: right;">Total Terpakai</th>
        <th style="padding: 10px 12px; text-align: right;">Sisa Saldo Stok</th>
        <th style="padding: 10px 12px; text-align: center;">Status Saldo</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemCode = item.itemCode || item.code || '-';
      const itemName = item.itemName || item.materialName || item.name || '-';
      const noIssue = item.noIssue || item.docNo || '-';
      const alokasi = item.alokasi || ((item.kodeAlokasi && item.namaAlokasi) ? `${item.kodeAlokasi} — ${item.namaAlokasi}` : item.kodeAlokasi || '-');
      const uom = item.uom || item.unit || '-';
      const qtyIssue = parseTxNumericQty(item.quantityIssue !== undefined ? item.quantityIssue : item.initialStock || 0);
      const usedQty = parseTxNumericQty(item.usedQuantity !== undefined ? item.usedQuantity : item.qtyOut || 0);
      const remQty = parseTxNumericQty(item.remainingQuantity !== undefined ? item.remainingQuantity : Math.max(0, qtyIssue - usedQty));

      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a; font-family: monospace; font-size: 0.8rem;">${esc(itemCode)}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">${esc(itemName)}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #0284c7; font-size: 0.8rem;">${esc(noIssue)}</td>
        <td style="padding: 10px 12px; color: #475569; font-size: 0.78rem;">${esc(alokasi)}</td>
        <td style="padding: 10px 12px; text-align: center; color: #334155; font-weight: 600; font-size: 0.78rem;">${esc(uom)}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #1e293b;">${qtyIssue.toLocaleString('id-ID')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #b91c1c;">${usedQty.toLocaleString('id-ID')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #15803d;">${remQty.toLocaleString('id-ID')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'AVAILABLE')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
      `;
    }).join('');
  } else if (modId === 'request') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen SPK / Dispatch</th>
        <th style="padding: 10px 12px;">Tanggal</th>
        <th style="padding: 10px 12px;">Divisi / Estate Tujuan</th>
        <th style="padding: 10px 12px;">Tahapan Pertumbuhan</th>
        <th style="padding: 10px 12px;">Klon Bibit</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Diminta</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Dikeluarkan</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'request');
      const numReq = parseTxNumericQty(item.qtyRequested || item.qty || 0);
      const numDisp = parseTxNumericQty(item.qtyDispatched || item.qty || 0);
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || item.requestId || `REQ-${idx + 1}`)}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.date || todayISO())}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">${esc(item.targetDivision || item.estateTujuan || 'Divisi II - Replanting 2026')}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.tahapan || 'Rubber Main Nursery')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klon || 'PB 260')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #475569;">${numReq.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #15803d;">${numDisp.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'APPROVED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'dispatch') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Dokumen / Dispatch</th>
        <th style="padding: 10px 12px;">Tanggal Kirim</th>
        <th style="padding: 10px 12px;">Ref. Dokumen SPB</th>
        <th style="padding: 10px 12px;">Tujuan Pengiriman</th>
        <th style="padding: 10px 12px;">Klon Bibit</th>
        <th style="padding: 10px 12px; text-align: right;">Jumlah Kirim</th>
        <th style="padding: 10px 12px;">Kendaraan / Nopol</th>
        <th style="padding: 10px 12px;">Petugas Pengirim</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'dispatch');
      const numKirim = parseTxNumericQty(item.qtyKirim !== undefined ? item.qtyKirim : (item.issuedQty !== undefined ? item.issuedQty : (item.qty || 0)));
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || item.dispatchNo || formatStandardDocNo(2026, 'DSP', idx + 1))}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.issuedDate || todayISO())}</td>
        <td style="padding: 10px 12px; font-size: 0.72rem; color: #475569;">${esc(item.parentRequestDocNo || item.requestDocNo || '-')}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">${esc(item.targetDivision || item.targetDivisionName || 'Divisi II')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #116834;">${esc(item.klon || item.clone || 'PB 260')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #15803d;">${numKirim.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.vehiclePlate || item.nopol || '-')}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.issuedByName || item.petugas || 'Mantri Bibitan')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'COMPLETED')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'destruction') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">No. Berita Acara (BA)</th>
        <th style="padding: 10px 12px;">Tanggal Pemusnahan</th>
        <th style="padding: 10px 12px;">Ref. Seleksi / Batch</th>
        <th style="padding: 10px 12px;">No. Bedengan</th>
        <th style="padding: 10px 12px;">Klon Bibit</th>
        <th style="padding: 10px 12px; text-align: right;">Jlh Dimusnahkan</th>
        <th style="padding: 10px 12px;">Alasan Pemusnahan</th>
        <th style="padding: 10px 12px;">Petugas Pelaksana</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => {
      const itemUnit = getTxItemUnit(item, 'destruction');
      const numCull = parseTxNumericQty(item.qty !== undefined ? item.qty : (item.destructionQty !== undefined ? item.destructionQty : 0));
      return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.docNo || item.destructionNo || formatStandardDocNo(2026, 'CUL', idx + 1))}</td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.tanggal || item.tanggalPemusnahan || todayISO())}</td>
        <td style="padding: 10px 12px; font-size: 0.72rem; color: #475569;">${esc(item.sourceSelectionNo || item.batchCode || '-')}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #111827;">${esc(item.bedengan || item.bedenganCode || 'Bedengan 01')}</td>
        <td style="padding: 10px 12px; font-weight: 600; color: #334155;">${esc(item.klon || 'GT 1')}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #b91c1c;">${numCull.toLocaleString('id-ID')} ${esc(itemUnit)}</td>
        <td style="padding: 10px 12px; font-size: 0.75rem; font-weight: 600; color: #7f1d1d;">${esc(item.reason || item.alasan || 'AFKIR')}</td>
        <td style="padding: 10px 12px; color: #475569;">${esc(item.createdByName || item.petugas || 'Mantri Bibitan')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'MENUNGGU_VERIFIKASI')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `;
    }).join('');
  } else if (modId === 'mandoranConsolidation') {
    if (txConsolidationViewMode === 'WORKER') {
      const flattenedRows = [];
      list.forEach((doc, docIdx) => {
        const workers = Array.isArray(doc.workers) ? doc.workers : (Array.isArray(doc.pekerja) ? doc.pekerja : []);
        const uom = doc.uom || 'Pkk';
        const targetBasis = parseTxNumericQty(doc.taskQuantity || 0);
        if (workers.length === 0) {
          flattenedRows.push({
            doc,
            docIdx,
            worker: { name: 'Belum ada pekerja', code: '-', inputHasil: 0, resultType: '-', potongJamDecision: '-' },
            uom,
            targetBasis
          });
        } else {
          workers.forEach((w) => {
            flattenedRows.push({
              doc,
              docIdx,
              worker: w,
              uom: w.uom || uom,
              targetBasis: parseTxNumericQty(w.taskQuantity !== undefined ? w.taskQuantity : targetBasis)
            });
          });
        }
      });

      theadHtml = `
        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; font-size: 0.74rem; text-transform: uppercase;">
          <th style="padding: 10px 12px; width: 40px;">#</th>
          <th style="padding: 10px 12px;">ID / No. Konsolidasi</th>
          <th style="padding: 10px 12px;">Tanggal</th>
          <th style="padding: 10px 12px;">Alokasi Kegiatan</th>
          <th style="padding: 10px 12px;">Work Group Role Code</th>
          <th style="padding: 10px 12px;">Nama Pekerja</th>
          <th style="padding: 10px 12px;">NIK / Kode</th>
          <th style="padding: 10px 12px;">Peran Pekerja</th>
          <th style="padding: 10px 12px; text-align: right;">Target Basis</th>
          <th style="padding: 10px 12px; text-align: right;">Realisasi Hasil</th>
          <th style="padding: 10px 12px; text-align: right;">Selisih Basis</th>
          <th style="padding: 10px 12px; text-align: center;">Potong Jam / Status</th>
          <th style="padding: 10px 12px;">Created By</th>
          <th style="padding: 10px 12px; text-align: center;">Status</th>
          <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
        </tr>
      `;

      tbodyHtml = flattenedRows.map((row, idx) => {
        const { doc, docIdx, worker: w, uom, targetBasis } = row;
        const inputVal = parseTxNumericQty(w.inputHasil !== undefined ? w.inputHasil : (w.total || 0));
        const selisih = inputVal - targetBasis;
        const selisihHtml = targetBasis > 0
          ? (selisih >= 0
              ? `<span style="color: #15803d; font-weight: 700;">+${selisih.toLocaleString('id-ID')} ${esc(uom)}</span>`
              : `<span style="color: #b91c1c; font-weight: 700;">${selisih.toLocaleString('id-ID')} ${esc(uom)}</span>`)
          : '<span style="color: #94a3b8;">-</span>';

        const potongHtml = w.potongJamDecision === 'POTONG'
          ? `<span style="display: inline-block; font-size: 0.70rem; font-weight: 700; background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; border: 1px solid #fca5a5;">Potong Jam (${esc(w.potongJamReason || '-')})</span>`
          : `<span style="display: inline-block; font-size: 0.70rem; font-weight: 700; background: #f0fdf4; color: #15803d; padding: 2px 6px; border-radius: 4px; border: 1px solid #bbf7d0;">Lengkap</span>`;

        return `
          <tr class="tx-table-row-clickable" data-idx="${docIdx}" data-docno="${esc(doc.docNo || '')}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease; cursor: pointer;">
            <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
            <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; font-family: monospace; font-size: 0.8rem;">${esc(doc.docNo || `CSL-${docIdx + 1}`)}</td>
            <td style="padding: 10px 12px; color: #64748b; font-size: 0.78rem;">${esc(doc.tanggal || '-')}</td>
            <td style="padding: 10px 12px; font-size: 0.8rem; color: #0f172a;">
              ${doc.allocationCode && doc.allocationCode !== '-' ? `
                <strong>${esc(doc.allocationCode)}</strong><br>
                <span style="color: #475569; font-size: 0.74rem;">${esc(doc.allocationName || doc.alokasi)}</span>
              ` : `
                <strong>${esc(doc.allocationName || doc.alokasi || '-')}</strong>
              `}
            </td>
            <td style="padding: 10px 12px; font-family: monospace; font-size: 0.76rem; font-weight: 700; color: #0369a1;">
              ${esc(doc.workGroupRoleCode || doc.roleCode || '-')}
            </td>
            <td style="padding: 10px 12px; font-weight: 700; color: #0f172a; font-size: 0.82rem;">${esc(w.name || w.workerName || 'Pekerja')}</td>
            <td style="padding: 10px 12px; font-family: monospace; font-size: 0.75rem; color: #64748b;">${esc(w.code || w.workerCode || '-')}</td>
            <td style="padding: 10px 12px; color: #475569; font-size: 0.76rem;">${esc(w.position || doc.roleName || 'Pekerja Bibitan')}</td>
            <td style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 0.78rem;">
              ${targetBasis > 0 ? `${targetBasis.toLocaleString('id-ID')} ${esc(uom)}` : '<span style="color:#94a3b8;">-</span>'}
            </td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #15803d; font-size: 0.84rem;">
              ${inputVal.toLocaleString('id-ID')} ${esc(uom)}
            </td>
            <td style="padding: 10px 12px; text-align: right; font-size: 0.76rem;">${selisihHtml}</td>
            <td style="padding: 10px 12px; text-align: center;">${potongHtml}</td>
            <td style="padding: 10px 12px; font-size: 0.78rem; color: #1e293b; white-space: nowrap;">
              <strong>${esc(doc.createdByName || 'Wagiman')}</strong><br>
              <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-top: 2px;">
                ${esc(doc.createdByRole || 'Mantri Bibitan')}
              </span>
            </td>
            <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(doc.status || 'CONSOLIDATED')}</td>
            <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(docIdx, doc.docNo)}</td>
          </tr>
        `;
      }).join('');
    } else {
      // DOC SUMMARY VIEW (Per Alokasi Kegiatan)
      theadHtml = `
        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; font-size: 0.74rem; text-transform: uppercase;">
          <th style="padding: 10px 12px; width: 40px;">#</th>
          <th style="padding: 10px 12px;">ID / No. Konsolidasi</th>
          <th style="padding: 10px 12px;">Tanggal Konsolidasi</th>
          <th style="padding: 10px 12px;">Alokasi Kegiatan</th>
          <th style="padding: 10px 12px;">Work Group Role Code</th>
          <th style="padding: 10px 12px;">Peran Pekerja</th>
          <th style="padding: 10px 12px; text-align: center;">Jumlah Tenaga Kerja</th>
          <th style="padding: 10px 12px;">Rincian Pekerja & Hasil</th>
          <th style="padding: 10px 12px; text-align: right;">Target Basis</th>
          <th style="padding: 10px 12px; text-align: right;">Total Hasil Kerja</th>
          <th style="padding: 10px 12px; text-align: center;">Satuan</th>
          <th style="padding: 10px 12px; text-align: center;">Dokumen Sumber</th>
          <th style="padding: 10px 12px;">Created By</th>
          <th style="padding: 10px 12px; text-align: center;">Status</th>
          <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
        </tr>
      `;

      tbodyHtml = list.map((item, idx) => {
        const docNo = item.docNo || item.id || `CSL-${idx + 1}`;
        const alokasi = item.alokasi || '-';
        const roleName = item.roleName || '-';
        const workerCount = Number(item.workerCount || (item.workers ? item.workers.length : 0));
        const totalHasil = parseTxNumericQty(item.totalHasil || 0);
        const uom = item.uom || 'Pkk';
        const targetBasis = parseTxNumericQty(item.taskQuantity || 0);
        const sourceCount = Number(item.sourceCount || (item.sourceTransactionIds ? item.sourceTransactionIds.length : 0));
        const wList = Array.isArray(item.workers) ? item.workers : [];

        let workerSummaryHtml = '';
        if (wList.length === 0) {
          workerSummaryHtml = `<span style="color: #94a3b8; font-size: 0.74rem;">Tidak ada pekerja</span>`;
        } else {
          workerSummaryHtml = `
            <div style="display: flex; flex-direction: column; gap: 3px; max-width: 250px;">
              ${wList.slice(0, 2).map(w => {
                const wVal = parseTxNumericQty(w.inputHasil !== undefined ? w.inputHasil : (w.total || 0));
                return `
                  <div style="font-size: 0.74rem; color: #334155; display: flex; justify-content: space-between; gap: 8px;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>${esc(w.name || w.workerName)}</strong></span>
                    <strong style="color: #15803d; white-space: nowrap;">${wVal.toLocaleString('id-ID')} ${esc(uom)}</strong>
                  </div>
                `;
              }).join('')}
              ${wList.length > 2 ? `<span style="font-size: 0.70rem; color: #64748b; font-style: italic;">+${wList.length - 2} pekerja lainnya...</span>` : ''}
            </div>
          `;
        }

        return `
          <tr class="tx-table-row-clickable" data-idx="${idx}" data-docno="${esc(docNo)}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease; cursor: pointer;">
            <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
            <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; font-family: monospace; font-size: 0.8rem;">${esc(docNo)}</td>
            <td style="padding: 10px 12px; color: #64748b; font-size: 0.78rem;">${esc(item.tanggal || '-')}</td>
            <td style="padding: 10px 12px; font-size: 0.82rem; color: #0f172a;">
              ${item.allocationCode && item.allocationCode !== '-' ? `
                <strong>${esc(item.allocationCode)}</strong><br>
                <span style="color: #475569; font-size: 0.74rem;">${esc(item.allocationName || alokasi)}</span>
              ` : `
                <strong>${esc(item.allocationName || alokasi || '-')}</strong>
              `}
            </td>
            <td style="padding: 10px 12px; font-family: monospace; font-size: 0.78rem; font-weight: 700; color: #0369a1;">
              ${esc(item.workGroupRoleCode || item.roleCode || '-')}
            </td>
            <td style="padding: 10px 12px; color: #475569; font-size: 0.78rem;">${esc(roleName)}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 700; color: #0f172a;">
              <span style="display: inline-block; background: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; border: 1px solid #bfdbfe;">
                ${workerCount} Orang
              </span>
            </td>
            <td style="padding: 10px 12px;">${workerSummaryHtml}</td>
            <td style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 0.78rem;">
              ${targetBasis > 0 ? `${targetBasis.toLocaleString('id-ID')} ${esc(uom)}` : '<span style="color:#94a3b8;">-</span>'}
            </td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 800; color: #15803d; font-size: 0.88rem;">${totalHasil.toLocaleString('id-ID')}</td>
            <td style="padding: 10px 12px; text-align: center; color: #334155; font-weight: 700; font-size: 0.78rem;">${esc(uom)}</td>
            <td style="padding: 10px 12px; text-align: center; font-size: 0.75rem; color: #0284c7; font-weight: 600;">
              ${sourceCount > 0 ? `${sourceCount} Transaksi` : '-'}
            </td>
            <td style="padding: 10px 12px; font-size: 0.78rem; color: #1e293b; white-space: nowrap;">
              <strong>${esc(item.createdByName || 'Wagiman')}</strong><br>
              <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-top: 2px;">
                ${esc(item.createdByRole || 'Mantri Bibitan')}
              </span>
            </td>
            <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'CONSOLIDATED')}</td>
            <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx, docNo)}</td>
          </tr>
        `;
      }).join('');
    }
  } else if (modId === 'syncQueue') {
    theadHtml = `
      <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569;">
        <th style="padding: 10px 12px; width: 40px;">#</th>
        <th style="padding: 10px 12px;">Queue ID</th>
        <th style="padding: 10px 12px;">Entitas / Modul</th>
        <th style="padding: 10px 12px;">Operasi</th>
        <th style="padding: 10px 12px;">Ringkasan Data</th>
        <th style="padding: 10px 12px;">Waktu Antre</th>
        <th style="padding: 10px 12px; text-align: center;">Status</th>
        <th style="padding: 10px 12px; text-align: center; width: 60px;">Aksi</th>
      </tr>
    `;
    tbodyHtml = list.map((item, idx) => `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.1s ease;">
        <td style="padding: 10px 12px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${esc(item.id || item.docNo || `SYNC-${idx + 1}`)}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; text-transform: uppercase;">${esc(item.entity || 'receptions')}</td>
        <td style="padding: 10px 12px;">
          <span style="font-size: 0.70rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #e0f2fe; color: #0369a1;">
            ${esc(item.action || 'CREATE')}
          </span>
        </td>
        <td style="padding: 10px 12px;">
          <div style="font-size: 0.72rem; color: #475569; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${esc(typeof item.payload === 'object' ? JSON.stringify(item.payload) : (item.payload || '-'))}
          </div>
        </td>
        <td style="padding: 10px 12px; color: #334155;">${esc(item.createdAt || item.timestamp || todayISO())}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxStatusBadge(item.status || 'PENDING')}</td>
        <td style="padding: 10px 12px; text-align: center;">${getTxCrudButtons(idx)}</td>
      </tr>
    `).join('');
  }

  return `
    <table class="review-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
      <thead>${theadHtml}</thead>
      <tbody>${tbodyHtml}</tbody>
    </table>
  `;
}

function attachTransactionsWorkspaceEvents(container) {
  // Sub-tabs switching
  container.querySelectorAll('.tx-sub-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTxTab = btn.dataset.mod;
      txSearchQuery = '';
      renderReviewPanel();
    });
  });

  // Search input
  const searchInput = container.querySelector('#tx-search-input');
  searchInput?.addEventListener('input', (e) => {
    txSearchQuery = e.target.value;
    clearTimeout(window._txSearchTimeout);
    window._txSearchTimeout = setTimeout(() => {
      renderReviewPanel();
    }, 250);
  });

  // Reset search
  container.querySelector('#btn-tx-reset-search')?.addEventListener('click', () => {
    txSearchQuery = '';
    renderReviewPanel();
  });

  // Status Filter
  const statusSelect = container.querySelector('#tx-filter-status');
  statusSelect?.addEventListener('change', (e) => {
    txStatusFilter = e.target.value;
    renderReviewPanel();
  });

  // Mode Fitur Rekam Pemeliharaan Filter
  const actModeSelect = container.querySelector('#tx-filter-activity-mode');
  actModeSelect?.addEventListener('change', (e) => {
    txActivityModeFilter = e.target.value;
    renderReviewPanel();
  });

  // Toggle View Mode (Dokumen vs Rincian Pekerja) Rekam Pemeliharaan
  container.querySelector('#btn-toggle-view-doc')?.addEventListener('click', () => {
    txActivityViewMode = 'DOC';
    renderReviewPanel();
  });
  container.querySelector('#btn-toggle-view-worker')?.addEventListener('click', () => {
    txActivityViewMode = 'WORKER';
    renderReviewPanel();
  });

  // Toggle View Mode Konsolidasi Mandoran (Ringkasan per Alokasi vs Rincian per Alokasi -> Pekerja)
  container.querySelector('#btn-toggle-consol-doc')?.addEventListener('click', () => {
    txConsolidationViewMode = 'DOC';
    renderReviewPanel();
  });
  container.querySelector('#btn-toggle-consol-worker')?.addEventListener('click', () => {
    txConsolidationViewMode = 'WORKER';
    renderReviewPanel();
  });

  // Buka Layar Modul di HP
  container.querySelector('#btn-tx-open-screen')?.addEventListener('click', () => {
    const curMod = TX_MODULES[activeTxTab];
    if (curMod?.route) {
      navigate(curMod.route);
      toast(`Menampilkan layar ${curMod.title} di frame HP`, 'info');
    }
  });

  // Reset / Bersihkan Seluruh Data Transaksi
  container.querySelector('#btn-tx-reset-all')?.addEventListener('click', () => {
    openModal({
      title: 'Kosongkan Seluruh Data Transaksi & Afkir',
      body: `
        <div style="text-align: center; padding: 12px 0;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <h3 style="font-size: 1rem; font-weight: 800; color: #991b1b; margin: 0 0 8px;">Hapus Bersih Semua Data Transaksi?</h3>
          <p style="font-size: 0.82rem; color: #334155; line-height: 1.5; margin: 0 0 12px;">
            Tindakan ini akan <strong>menghapus seluruh data operasional</strong> di prototype, termasuk:
            <br>&bull; Penerimaan Benih & Bibit APM
            <br>&bull; Batching & Bedengan Penyemaian
            <br>&bull; Okulasi & Okulasi Janda (Regrafting)
            <br>&bull; Pemeriksaan Okulasi (Hasil Sukses vs Gagal)
            <br>&bull; <strong>Daftar Bibit Afkir / Penyeleksian (Selection Pool)</strong>
            <br>&bull; Presensi & Antrean Sinkronisasi
          </p>
          <div style="background: #fef2f2; border: 1px dashed #f87171; border-radius: 6px; padding: 8px; font-size: 0.75rem; color: #b91c1c;">
            Seluruh layar prototype di frame HP akan otomatis kembali bersih (0 data).
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" data-reset-cancel>Batal</button>
        <button class="btn btn-danger" id="btn-confirm-reset-all">Ya, Kosongkan Bersih</button>
      `
    });

    const root = document.getElementById('modal-root');
    root.querySelector('[data-reset-cancel]')?.addEventListener('click', closeModal);
    root.querySelector('#btn-confirm-reset-all')?.addEventListener('click', async () => {
      // Eksekusi pembersihan transaksi dinamis terpusat berbasis registry
      await cleanAllTransactionalData();

      closeModal();
      toast('Seluruh data transaksi dan testing telah dibersihkan!', 'success');
      renderReviewPanel();

      // Refresh frame HP jika sedang di halaman yang relevan
      const cur = getCurrent();
      if (cur?.route) {
        navigate(cur.route);
      }
    });
  });

  // Muat / Sinkron Data Transaksi HP
  const syncMobileData = async () => {
    const btn = container.querySelector('#btn-tx-seed-sample');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Menyinkronkan...</span>';
    }
    const count = await syncAllTxFromMobileDB(activeTxTab);
    const modTitle = TX_MODULES[activeTxTab]?.title || 'Modul';
    if (count > 0) {
      toast(`Berhasil menyinkronkan ${count} transaksi ${modTitle} dari Frame HP!`, 'success');
    } else {
      toast(`Belum ada transaksi ${modTitle} di Frame HP. Silakan lakukan transaksi di modul HP terlebih dahulu.`, 'info');
    }
    renderReviewPanel();
  };
  container.querySelector('#btn-tx-seed-sample')?.addEventListener('click', syncMobileData);
  container.querySelector('#btn-tx-empty-sample')?.addEventListener('click', syncMobileData);

  // Tambah Transaksi
  const openAdd = () => openTxFormModal(null, activeTxTab);
  container.querySelector('#btn-tx-add-new')?.addEventListener('click', openAdd);
  container.querySelector('#btn-tx-empty-add')?.addEventListener('click', openAdd);

  // Menu Aksi 3-dots Trigger & Dropdown
  container.querySelectorAll('.btn-tx-action-trigger').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const parent = btn.closest('div');
      const menu = parent?.querySelector('.tx-action-dropdown');

      container.querySelectorAll('.tx-action-dropdown').forEach((m) => {
        if (m !== menu) m.style.display = 'none';
      });

      if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      }
    });
  });

  // Tutup dropdown jika klik di luar
  document.addEventListener('click', () => {
    document.querySelectorAll('.tx-action-dropdown').forEach((m) => {
      m.style.display = 'none';
    });
  });

  // Edit Transaksi
  container.querySelectorAll('.btn-tx-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.tx-action-dropdown').forEach((m) => (m.style.display = 'none'));
      const idx = parseInt(btn.dataset.idx, 10);
      const list = loadTxList(activeTxTab);
      if (list[idx]) {
        openTxFormModal(list[idx], activeTxTab, idx);
      }
    });
  });

  // Hapus Transaksi
  container.querySelectorAll('.btn-tx-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.tx-action-dropdown').forEach((m) => (m.style.display = 'none'));
      const idx = parseInt(btn.dataset.idx, 10);
      const list = loadTxList(activeTxTab);
      if (list[idx]) {
        openTxDeleteConfirm(list[idx], activeTxTab, idx);
      }
    });
  });

  // Detail Transaksi
  container.querySelectorAll('.btn-tx-detail').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.tx-action-dropdown').forEach((m) => (m.style.display = 'none'));
      const idx = parseInt(btn.dataset.idx, 10);
      const docNo = btn.dataset.docno;
      const list = loadTxList(activeTxTab);
      const item = docNo ? (list.find(it => (it.docNo && it.docNo === docNo) || (it.id && it.id === docNo)) || list[idx]) : list[idx];
      if (item) {
        openTxDetailModal(item, activeTxTab, idx);
      }
    });
  });

  // Klik Baris Tabel untuk Buka Detail
  container.querySelectorAll('.tx-table-row-clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-tx-action-trigger') || e.target.closest('.tx-action-dropdown') || e.target.closest('button')) return;
      const idx = parseInt(row.dataset.idx, 10);
      const docNo = row.dataset.docno;
      const list = loadTxList(activeTxTab);
      const item = docNo ? (list.find(it => (it.docNo && it.docNo === docNo) || (it.id && it.id === docNo)) || list[idx]) : list[idx];
      if (item) {
        openTxDetailModal(item, activeTxTab, idx);
      }
    });
  });
}

function openTxFormModal(item, modId, editIndex = null) {
  const isEdit = item !== null && editIndex !== null;
  const cfg = TX_MODULES[modId];
  const docNo = item ? item.docNo || item.nomorDokumen || item.id || '' : generateNewDocNo(modId);
  const tanggal = item ? item.tanggal || item.date || todayISO() : todayISO();
  const status = item ? item.status || 'SUBMITTED' : 'SUBMITTED';
  const notes = item ? item.notes || item.catatan || '' : '';

  openModal({
    title: isEdit ? `Edit Transaksi: ${cfg.title}` : `Tambah Transaksi: ${cfg.title}`,
    body: `
      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 0.85rem;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Dokumen / ID Transaksi <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-docNo" type="text" value="${esc(docNo)}" required />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Tanggal Transaksi</label>
            <input class="feedback-form-input" id="tx-input-date" type="text" value="${esc(tanggal)}" placeholder="YYYY-MM-DD" />
          </div>
          <div>
            <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Status Transaksi</label>
            <select class="feedback-form-select" id="tx-input-status">
              <option value="SUBMITTED" ${status === 'SUBMITTED' ? 'selected' : ''}>SUBMITTED</option>
              <option value="AVAILABLE" ${status === 'AVAILABLE' ? 'selected' : ''}>AVAILABLE</option>
              <option value="PARTIALLY_USED" ${status === 'PARTIALLY_USED' ? 'selected' : ''}>PARTIALLY_USED</option>
              <option value="FULLY_USED" ${status === 'FULLY_USED' ? 'selected' : ''}>FULLY_USED</option>
              <option value="APPROVED" ${status === 'APPROVED' ? 'selected' : ''}>APPROVED</option>
              <option value="VERIFIED" ${status === 'VERIFIED' ? 'selected' : ''}>VERIFIED</option>
              <option value="COMPLETED" ${status === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
              <option value="DRAFT" ${status === 'DRAFT' ? 'selected' : ''}>DRAFT</option>
              <option value="HADIR" ${status === 'HADIR' ? 'selected' : ''}>HADIR</option>
            </select>
          </div>
        </div>

        ${renderTxModuleFields(modId, item)}

        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Catatan Operasional</label>
          <textarea class="feedback-form-textarea" id="tx-input-notes" placeholder="Catatan opsional...">${esc(notes)}</textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-tx-cancel>Batal</button>
      <button class="btn btn-primary" id="btn-tx-save-modal">${isEdit ? 'Perbarui Transaksi' : 'Simpan Transaksi'}</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-tx-cancel]')?.addEventListener('click', closeModal);
  root.querySelector('#btn-tx-save-modal')?.addEventListener('click', () => {
    const docNoVal = root.querySelector('#tx-input-docNo')?.value.trim();
    if (!docNoVal) {
      toast('Nomor dokumen wajib diisi!', 'danger');
      return;
    }

    const payload = extractTxFormPayload(modId, root);
    payload.docNo = docNoVal;
    payload.tanggal = root.querySelector('#tx-input-date')?.value || todayISO();
    payload.status = root.querySelector('#tx-input-status')?.value || 'SUBMITTED';
    payload.notes = root.querySelector('#tx-input-notes')?.value || '';

    const creatorInfo = resolveTxCreatorInfo(isEdit ? item : null);
    payload.createdByName = isEdit ? (item.createdByName || creatorInfo.name) : creatorInfo.name;
    payload.createdByRole = isEdit ? (item.createdByRole || creatorInfo.role) : creatorInfo.role;
    payload.createdBy = isEdit ? (item.createdBy || creatorInfo.display) : creatorInfo.display;

    const list = loadTxList(modId);
    if (isEdit) {
      list[editIndex] = { ...item, ...payload, updatedAt: new Date().toISOString() };
    } else {
      payload.id = uid(`${modId.toUpperCase().slice(0, 3)}-`);
      payload.createdAt = new Date().toISOString();
      list.unshift(payload);
    }

    saveTxList(modId, list);
    closeModal();
    toast(isEdit ? 'Data transaksi berhasil diperbarui!' : 'Transaksi baru berhasil ditambahkan!', 'success');
    renderReviewPanel();
  });
}

function openTxDeleteConfirm(item, modId, index) {
  const docTitle = item.docNo || item.name || item.id || `Item #${index + 1}`;
  const cfg = TX_MODULES[modId];

  openModal({
    title: `Hapus Transaksi ${cfg.title}`,
    body: `
      <div style="text-align: center; padding: 12px 0;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        </div>
        <p style="font-size: 0.95rem; color: #1e293b; margin: 0 0 8px;">
          Yakin ingin menghapus data <strong>${esc(docTitle)}</strong>?
        </p>
        <p style="font-size: 0.8rem; color: #64748b; margin: 0;">
          Transaksi akan dihapus dari modul ${cfg.title} dan perubahan akan langsung merefleksikan saldo ketersediaan.
        </p>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-tx-del-cancel>Batal</button>
      <button class="btn btn-danger" id="btn-tx-del-confirm">Ya, Hapus Data</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-tx-del-cancel]')?.addEventListener('click', closeModal);
  root.querySelector('#btn-tx-del-confirm')?.addEventListener('click', () => {
    const list = loadTxList(modId);
    list.splice(index, 1);
    saveTxList(modId, list);
    if (modId === 'selection') {
      let pool = storage.get('selection_pool', []);
      let culled = storage.get('selection_transactions', []);
      pool = pool.filter((p) => p.docNo !== item.docNo && p.id !== item.id);
      culled = culled.filter((c) => c.docNo !== item.docNo && c.selectionPoolDocNo !== item.docNo && c.id !== item.id);
      storage.set('selection_pool', pool);
      storage.set('selection_transactions', culled);
    }
    if (item.id) {
      try {
        cfg.repo.remove(item.id);
      } catch (e) { }
    }
    closeModal();
    toast('Data transaksi berhasil dihapus!', 'info');
    renderReviewPanel();
    const cur = getCurrent();
    if (cur?.route) navigate(cur.route);
  });
}

function openTxDetailModal(item, modId, index) {
  const cfg = TX_MODULES[modId];

  if (modId === 'material') {
    const docNo = item.noIssue || item.docNo || item.id || '-';
    const itemCode = item.itemCode || '-';
    const itemName = item.itemName || item.materialName || '-';
    const uom = item.uom || item.unit || 'Unit';
    const alokasi = item.alokasi || '-';
    const qtyIssue = parseTxNumericQty(item.quantityIssue || 0);
    const usedQty = parseTxNumericQty(item.usedQuantity || 0);
    const remQty = parseTxNumericQty(item.remainingQuantity !== undefined ? item.remainingQuantity : Math.max(0, qtyIssue - usedQty));

    // Ambil rekam pemakaian terpadu (operasional SOW/APR + manual)
    const allRecords = typeof getUnifiedMaterialRecords === 'function' ? getUnifiedMaterialRecords() : [];
    const matchedRecords = allRecords.filter(r => 
      (r.issueDocNo && (r.issueDocNo === docNo || r.issueDocNo === item.id)) ||
      (r.rawRecord && (r.rawRecord.issueDocNo === docNo || r.rawRecord.noIssue === docNo || r.rawRecord.sir === docNo))
    );

    // Relasi dokumen transaksi tambahan
    const directDocRefs = (typeof getIssueUsageTransactions === 'function' ? getIssueUsageTransactions(docNo) : []) || [];

    const usageRowsHtml = matchedRecords.length > 0
      ? matchedRecords.map((r, i) => `
          <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.78rem;">
            <td style="padding: 8px 10px; color: #64748b; font-weight: 600;">${i + 1}</td>
            <td style="padding: 8px 10px; font-weight: 700; color: #0284c7;">${esc(r.docNo || '-')}</td>
            <td style="padding: 8px 10px; color: #334155;">
              <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px;">
                ${esc(r.sourceLabel || r.sourceModule || 'Operasional')}
              </span>
            </td>
            <td style="padding: 8px 10px; color: #64748b;">${esc(r.tanggal || '-')}</td>
            <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #b91c1c;">
              ${parseTxNumericQty(r.quantity || 0).toLocaleString('id-ID')} ${esc(r.uom || uom)}
            </td>
            <td style="padding: 8px 10px; color: #475569;">${esc(r.actor || '-')}</td>
            <td style="padding: 8px 10px; color: #64748b; font-size: 0.74rem;">${esc(r.notes || '-')}</td>
          </tr>
        `).join('')
      : directDocRefs.length > 0
        ? directDocRefs.map((d, i) => `
            <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.78rem;">
              <td style="padding: 8px 10px; color: #64748b; font-weight: 600;">${i + 1}</td>
              <td style="padding: 8px 10px; font-weight: 700; color: #0284c7;">${esc(d.docNo || '-')}</td>
              <td style="padding: 8px 10px; color: #334155;">
                <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; background: #eff6ff; color: #1d4ed8; padding: 2px 6px; border-radius: 4px;">
                  Operasional
                </span>
              </td>
              <td style="padding: 8px 10px; color: #64748b;">${esc(d.tanggal || '-')}</td>
              <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #b91c1c;">-</td>
              <td style="padding: 8px 10px; color: #475569;">Mantri Bibitan</td>
              <td style="padding: 8px 10px; color: #64748b; font-size: 0.74rem;">Penggunaan Dokumen Alokasi</td>
            </tr>
          `).join('')
        : `
            <tr>
              <td colspan="7" style="padding: 24px; text-align: center; color: #64748b; font-size: 0.8rem; background: #f8fafc;">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="#94a3b8" stroke-width="1.8" fill="none" style="margin: 0 auto 6px; display: block;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                Belum ada transaksi operasional yang menggunakan dokumen issue ini.<br>
                <span style="color: #15803d; font-weight: 600;">Saldo stok masih utuh 100% (${qtyIssue.toLocaleString('id-ID')} ${esc(uom)}).</span>
              </td>
            </tr>
          `;

    openModal({
      title: `Detail Dokumen Issue & Riwayat Pemakaian`,
      body: `
        <div style="display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto;">
          <!-- HERO CARD -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">No. Dokumen Issue</span>
                <h3 style="margin: 2px 0 0; font-size: 1.15rem; font-weight: 800; color: #0284c7;">${esc(docNo)}</h3>
              </div>
              <div>${getTxStatusBadge(item.status || 'AVAILABLE')}</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.82rem;">
              <div>
                <span style="color: #64748b; font-weight: 500;">Material & Bahan:</span><br>
                <strong style="color: #0f172a;">${esc(itemName)}</strong> <span style="font-family: monospace; font-size: 0.75rem; color: #64748b;">(${esc(itemCode)})</span>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Alokasi Biaya:</span><br>
                <strong style="color: #334155;">${esc(alokasi)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Satuan (UOM):</span><br>
                <strong style="color: #334155;">${esc(uom)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Tanggal Dokumen:</span><br>
                <strong style="color: #334155;">${esc(item.tanggal || '-')}</strong>
              </div>
            </div>
          </div>

          <!-- SALDO METRIC CARDS -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #475569; text-transform: uppercase;">Issue Gudang</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin-top: 2px;">${qtyIssue.toLocaleString('id-ID')}</div>
              <div style="font-size: 0.7rem; color: #64748b;">${esc(uom)}</div>
            </div>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #b91c1c; text-transform: uppercase;">Total Terpakai</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #b91c1c; margin-top: 2px;">${usedQty.toLocaleString('id-ID')}</div>
              <div style="font-size: 0.7rem; color: #991b1b;">${esc(uom)}</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #15803d; text-transform: uppercase;">Sisa Saldo Stok</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #15803d; margin-top: 2px;">${remQty.toLocaleString('id-ID')}</div>
              <div style="font-size: 0.7rem; color: #166534;">${esc(uom)}</div>
            </div>
          </div>

          <!-- DETAIL RIWAYAT PEMAKAIAN -->
          <div>
            <h4 style="margin: 8px 0 8px; font-size: 0.85rem; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Riwayat Transaksi Pemakaian Terkait (${matchedRecords.length || directDocRefs.length} Transaksi)
            </h4>
            <div style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.72rem; color: #475569; text-transform: uppercase;">
                  <tr>
                    <th style="padding: 8px 10px; width: 30px;">#</th>
                    <th style="padding: 8px 10px;">No. Transaksi</th>
                    <th style="padding: 8px 10px;">Sumber</th>
                    <th style="padding: 8px 10px;">Tanggal</th>
                    <th style="padding: 8px 10px; text-align: right;">Jumlah Terpakai</th>
                    <th style="padding: 8px 10px;">Petugas</th>
                    <th style="padding: 8px 10px;">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  ${usageRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-primary" data-detail-close>Tutup</button>
      `
    });

    const root = document.getElementById('modal-root');
    root.querySelector('[data-detail-close]')?.addEventListener('click', closeModal);
    return;
  }

  if (modId === 'mandoranConsolidation') {
    const docNo = item.docNo || item.id || '-';
    const rawConsolidations = storage.get('nursery_mandoran_consolidations', []) || [];
    const parentDoc = rawConsolidations.find(c => (c.docNo && c.docNo === docNo) || (c.id && c.id === item.rawConsolidationId) || (c.id && c.id === docNo)) || item;
    const groups = Array.isArray(parentDoc.groups) && parentDoc.groups.length > 0
      ? parentDoc.groups
      : (Array.isArray(item.groups) && item.groups.length > 0
          ? item.groups
          : [{
              allocationCode: item.allocationCode || '-',
              allocationName: item.allocationName || item.alokasi || 'Pemeliharaan Bibitan',
              workGroupRoleName: item.roleName || 'Pekerja Bibitan',
              uom: item.uom || 'Pkk',
              taskQuantity: item.taskQuantity || 0,
              workers: Array.isArray(item.workers) ? item.workers : (Array.isArray(item.pekerja) ? item.pekerja : [])
            }]);

    const totalDocWorkers = groups.reduce((sum, g) => sum + (g.workers ? g.workers.length : 0), 0);
    const sourceIds = Array.isArray(parentDoc.sourceTransactionIds) ? parentDoc.sourceTransactionIds : (item.sourceTransactionIds || []);
    const mandorName = parentDoc.actor?.name || parentDoc.createdByName || item.mandor || 'Wagiman';
    const tanggalDoc = parentDoc.createdAt ? parentDoc.createdAt.slice(0, 10) : (item.tanggal || todayISO());

    // Generate HTML section per Alokasi Kegiatan
    const allocationSectionsHtml = groups.map((g, gIdx) => {
      const gCode = g.allocationCode || '-';
      const gName = g.allocationName || g.workGroupRoleName || '-';
      const gRole = g.workGroupRoleName || g.roleName || 'Pekerja Bibitan';
      const gUom = g.uom || 'Pkk';
      const gTargetBasis = parseTxNumericQty(g.taskQuantity || 0);
      const wList = Array.isArray(g.workers) ? g.workers : [];
      const gTotalHasil = wList.reduce((s, w) => s + (Number(w.inputHasil !== undefined ? w.inputHasil : (w.total || 0)) || 0), 0);

      const workerRowsHtml = wList.length > 0
        ? wList.map((w, wIdx) => {
            const inputVal = parseTxNumericQty(w.inputHasil !== undefined ? w.inputHasil : (w.total || 0));
            const wTarget = parseTxNumericQty(w.taskQuantity !== undefined ? w.taskQuantity : gTargetBasis);
            const selisih = inputVal - wTarget;
            const selisihHtml = wTarget > 0
              ? (selisih >= 0
                  ? `<span style="color: #15803d; font-weight: 700;">+${selisih.toLocaleString('id-ID')} ${esc(gUom)}</span>`
                  : `<span style="color: #b91c1c; font-weight: 700;">${selisih.toLocaleString('id-ID')} ${esc(gUom)}</span>`)
              : '<span style="color: #64748b;">-</span>';

            const potongHtml = w.potongJamDecision === 'POTONG'
              ? `<span style="color: #b91c1c; font-weight: 700; background: #fee2e2; padding: 2px 6px; border-radius: 4px; border: 1px solid #fca5a5;">Potong Jam (${esc(w.potongJamReason || '-')})</span>`
              : `<span style="color: #15803d; font-weight: 700; background: #f0fdf4; padding: 2px 6px; border-radius: 4px; border: 1px solid #bbf7d0;">Lengkap</span>`;

            return `
              <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.78rem;">
                <td style="padding: 8px 10px; color: #64748b; font-weight: 600;">${wIdx + 1}</td>
                <td style="padding: 8px 10px; font-weight: 700; color: #0f172a;">${esc(w.name || w.workerName || 'Pekerja')}</td>
                <td style="padding: 8px 10px; font-family: monospace; color: #64748b; font-size: 0.74rem;">${esc(w.code || w.workerCode || '-')}</td>
                <td style="padding: 8px 10px; color: #475569;">${esc(w.resultType || 'TUNTAS')}</td>
                <td style="padding: 8px 10px; text-align: right; color: #64748b;">
                  ${wTarget > 0 ? `${wTarget.toLocaleString('id-ID')} ${esc(gUom)}` : '-'}
                </td>
                <td style="padding: 8px 10px; text-align: right; font-weight: 800; color: #15803d;">
                  ${inputVal.toLocaleString('id-ID')} ${esc(gUom)}
                </td>
                <td style="padding: 8px 10px; text-align: right; font-size: 0.76rem;">${selisihHtml}</td>
                <td style="padding: 8px 10px; font-size: 0.74rem;">${potongHtml}</td>
              </tr>
            `;
          }).join('')
        : `
          <tr>
            <td colspan="8" style="padding: 12px; text-align: center; color: #94a3b8; font-size: 0.78rem;">
              Tidak ada data pekerja pada alokasi ini.
            </td>
          </tr>
        `;

      return `
        <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff; margin-bottom: 12px;">
          <!-- Sub-Header Alokasi Kegiatan -->
          <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <span style="font-size: 0.68rem; font-weight: 800; text-transform: uppercase; color: #0284c7; background: #e0f2fe; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.02em;">
                Alokasi ${gIdx + 1} dari ${groups.length}
              </span>
              <h4 style="margin: 4px 0 0; font-size: 0.92rem; font-weight: 800; color: #0f172a;">
                ${esc(gCode)} — ${esc(gName)}
              </h4>
              <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">
                Peran: <strong>${esc(gRole)}</strong> • Target Basis: <strong>${gTargetBasis > 0 ? `${gTargetBasis.toLocaleString('id-ID')} ${esc(gUom)}` : '-'}</strong>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.70rem; color: #64748b; text-transform: uppercase; font-weight: 700;">Subtotal Hasil Alokasi</span>
              <div style="font-size: 1.15rem; font-weight: 800; color: #15803d;">
                ${gTotalHasil.toLocaleString('id-ID')} <span style="font-size: 0.82rem; font-weight: 700;">${esc(gUom)}</span>
              </div>
              <span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">${wList.length} Pekerja</span>
            </div>
          </div>

          <!-- Tabel Rincian Pekerja -->
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead style="background: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 0.70rem; color: #64748b; text-transform: uppercase;">
              <tr>
                <th style="padding: 7px 10px; width: 30px;">#</th>
                <th style="padding: 7px 10px;">Nama Pekerja</th>
                <th style="padding: 7px 10px;">NIK / Kode</th>
                <th style="padding: 7px 10px;">Tipe Hasil</th>
                <th style="padding: 7px 10px; text-align: right;">Target Basis</th>
                <th style="padding: 7px 10px; text-align: right;">Realisasi Hasil</th>
                <th style="padding: 7px 10px; text-align: right;">Selisih Basis</th>
                <th style="padding: 7px 10px;">Keputusan Potong Jam</th>
              </tr>
            </thead>
            <tbody>
              ${workerRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    openModal({
      title: `Detail Transaksi: Konsolidasi Mandoran`,
      body: `
        <div style="display: flex; flex-direction: column; gap: 14px; max-height: 75vh; overflow-y: auto;">
          <!-- HERO CARD -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">No. Dokumen Konsolidasi</span>
                <h3 style="margin: 2px 0 0; font-size: 1.15rem; font-weight: 800; color: #0284c7;">${esc(docNo)}</h3>
              </div>
              <div>${getTxStatusBadge(parentDoc.status || item.status || 'CONSOLIDATED')}</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.82rem;">
              <div>
                <span style="color: #64748b; font-weight: 500;">Jumlah Alokasi Kegiatan:</span><br>
                <strong style="color: #0f172a;">${groups.length} Alokasi Kegiatan</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Total Tenaga Kerja:</span><br>
                <strong style="color: #334155;">${totalDocWorkers} Orang Pekerja</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Tanggal Konsolidasi:</span><br>
                <strong style="color: #334155;">${esc(tanggalDoc)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Mandor / Petugas Pelaksana:</span><br>
                <strong style="color: #334155;">${esc(mandorName)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Dibuat Oleh (Created By):</span><br>
                <strong style="color: #0f172a;">${esc(item.createdByName || parentDoc.createdByName || 'Wagiman')}</strong>
                <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">
                  ${esc(item.createdByRole || parentDoc.createdByRole || 'Mantri Bibitan')}
                </span>
              </div>
            </div>
          </div>

          <!-- RINCIAN PER ALOKASI KEGIATAN & PEKERJA -->
          <div>
            <h4 style="margin: 0 0 10px; font-size: 0.86rem; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Rincian per Alokasi Kegiatan & Tenaga Kerja (${groups.length} Alokasi, ${totalDocWorkers} Pekerja)
            </h4>
            ${allocationSectionsHtml}
          </div>

          <!-- TRANSAKSI SUMBER -->
          ${sourceIds.length > 0 ? `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
              <span style="font-size: 0.74rem; font-weight: 700; color: #475569;">Referensi Dokumen / ID Transaksi Rekam Pemeliharaan:</span>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                ${sourceIds.map(id => `<span style="font-family: monospace; font-size: 0.72rem; background: #ffffff; border: 1px solid #cbd5e1; padding: 2px 7px; border-radius: 4px; color: #0284c7; font-weight: 600;">${esc(id)}</span>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `,
      footer: `
        <button class="btn btn-primary" data-detail-close>Tutup</button>
      `
    });

    const root = document.getElementById('modal-root');
    root.querySelector('[data-detail-close]')?.addEventListener('click', closeModal);
    return;
  }

  if (modId === 'nurseryActivity') {
    const isMandoran = item.activityEntryMode === 'MANDORAN';
    const docNo = item.docNo || item.id || '-';
    const alokasi = item.alokasi || ((item.allocationCode && item.allocationName) ? `${item.allocationCode} — ${item.allocationName}` : (item.allocationName || item.allocationCode || '-'));
    const program = item.program || item.programCode || 'Main Nursery 2026';
    const blokBedengan = item.bedengan || (typeof item.lokasiBlok === 'object' ? item.lokasiBlok?.blok : null) || 'Bedengan 01';
    const roleName = item.workGroupRoleName || (isMandoran ? 'Pekerja Borongan Rawat' : 'Pekerja Harian');
    const uom = item.uom || 'Pkk';
    const targetBasis = parseTxNumericQty(item.taskQuantity || 0);
    const totalHasil = parseTxNumericQty(item.totalHasil !== undefined ? item.totalHasil : (item.volumePkk || 0));
    const mandor = item.mandor || item.createdByName || 'Wagiman';
    const pList = Array.isArray(item.pekerja) ? item.pekerja : [];

    const workerRowsHtml = pList.length > 0
      ? pList.map((w, i) => {
          const inputVal = parseTxNumericQty(w.inputHasil !== undefined ? w.inputHasil : (w.total || (isMandoran ? 0 : 1)));
          const selisih = inputVal - targetBasis;
          const selisihHtml = targetBasis > 0
            ? (selisih >= 0
                ? `<span style="color: #15803d; font-weight: 700;">+${selisih.toLocaleString('id-ID')} ${esc(uom)}</span>`
                : `<span style="color: #b91c1c; font-weight: 700;">${selisih.toLocaleString('id-ID')} ${esc(uom)}</span>`)
            : '<span style="color: #64748b;">-</span>';

          const hasilColHtml = isMandoran
            ? `<strong style="color: #15803d;">${inputVal.toLocaleString('id-ID')} ${esc(uom)}</strong>`
            : `<span style="color: #0284c7; font-weight: 700; background: #eff6ff; padding: 2px 8px; border-radius: 4px;">Hadir Penuh</span>`;

          return `
            <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.78rem;">
              <td style="padding: 8px 10px; color: #64748b; font-weight: 600;">${i + 1}</td>
              <td style="padding: 8px 10px; font-weight: 700; color: #0f172a;">${esc(w.name || w.workerName || 'Pekerja')}</td>
              <td style="padding: 8px 10px; font-family: monospace; color: #64748b; font-size: 0.74rem;">${esc(w.code || w.workerCode || '-')}</td>
              <td style="padding: 8px 10px; color: #475569;">${esc(w.position || w.role || (isMandoran ? 'Pekerja Borongan' : 'Pekerja Harian'))}</td>
              ${isMandoran ? `
                <td style="padding: 8px 10px; text-align: right; color: #64748b;">${targetBasis > 0 ? `${targetBasis.toLocaleString('id-ID')} ${esc(uom)}` : '-'}</td>
                <td style="padding: 8px 10px; text-align: right;">${hasilColHtml}</td>
                <td style="padding: 8px 10px; text-align: right;">${selisihHtml}</td>
                <td style="padding: 8px 10px; color: #64748b; font-size: 0.74rem;">${esc(w.resultType || 'TUNTAS')}</td>
              ` : `
                <td style="padding: 8px 10px; text-align: center;">${hasilColHtml}</td>
                <td style="padding: 8px 10px; color: #64748b; font-size: 0.74rem;">${esc(w.statusKerja || 'Alokasi Kegiatan Harian Selesai')}</td>
              `}
            </tr>
          `;
        }).join('')
      : `
        <tr>
          <td colspan="${isMandoran ? 8 : 6}" style="padding: 16px; text-align: center; color: #64748b; font-size: 0.8rem;">
            Tidak ada rincian data tenaga kerja.
          </td>
        </tr>
      `;

    openModal({
      title: `Detail Transaksi: Rekam Pemeliharaan`,
      body: `
        <div style="display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto;">
          <!-- HERO CARD -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">No. Dokumen Rawat</span>
                <h3 style="margin: 2px 0 0; font-size: 1.15rem; font-weight: 800; color: #0284c7;">${esc(docNo)}</h3>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span style="display: inline-block; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; border-radius: 9999px; background: ${isMandoran ? '#fff7ed' : '#eff6ff'}; color: ${isMandoran ? '#c2410c' : '#1d4ed8'}; border: 1px solid ${isMandoran ? '#fed7aa' : '#bfdbfe'};">
                  ${isMandoran ? 'REKAM AKTIVITAS MANDORAN' : 'REKAM AKTIVITAS HARIAN'}
                </span>
                ${getTxStatusBadge(item.status || 'VERIFIED')}
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.82rem;">
              <div>
                <span style="color: #64748b; font-weight: 500;">Alokasi Kegiatan:</span><br>
                <strong style="color: #0f172a;">${esc(alokasi)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Peran / Kelompok Kerja:</span><br>
                <strong style="color: #334155;">${esc(roleName)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Program & Lokasi:</span><br>
                <strong style="color: #334155;">${esc(program)} — ${esc(blokBedengan)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Tanggal & Mandor:</span><br>
                <strong style="color: #334155;">${esc(item.tanggal || todayISO())} (${esc(mandor)})</strong>
              </div>
              <div>
                <span style="color: #64748b; font-weight: 500;">Dibuat Oleh (Created By):</span><br>
                <strong style="color: #0f172a;">${esc(item.createdByName || 'Wagiman')}</strong>
                <span style="display: inline-block; font-size: 0.68rem; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">
                  ${esc(item.createdByRole || 'Mantri Bibitan')}
                </span>
              </div>
            </div>
          </div>

          <!-- METRIC CARDS -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #475569; text-transform: uppercase;">Fitur Rekam</div>
              <div style="font-size: 1.05rem; font-weight: 800; color: ${isMandoran ? '#c2410c' : '#1d4ed8'}; margin-top: 2px;">
                ${isMandoran ? 'Mandoran' : 'Harian (CFNA)'}
              </div>
              <div style="font-size: 0.7rem; color: #64748b;">${isMandoran ? 'Per Pekerja Borongan' : 'Alokasi Pekerja Harian'}</div>
            </div>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #1e40af; text-transform: uppercase;">Tenaga Kerja</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #1e3a8a; margin-top: 2px;">${pList.length}</div>
              <div style="font-size: 0.7rem; color: #3b82f6;">Orang Pekerja Terdaftar</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; text-align: center;">
              <div style="font-size: 0.7rem; font-weight: 700; color: #15803d; text-transform: uppercase;">Total Realisasi Hasil</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #15803d; margin-top: 2px;">${totalHasil.toLocaleString('id-ID')}</div>
              <div style="font-size: 0.7rem; color: #166534;">${esc(uom)} ${isMandoran && targetBasis > 0 ? `(Basis: ${targetBasis.toLocaleString('id-ID')}/${uom})` : ''}</div>
            </div>
          </div>

          <!-- DETAIL RINCIAN PEKERJA -->
          <div>
            <h4 style="margin: 8px 0 8px; font-size: 0.85rem; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Rincian Entri Data Tenaga Kerja per Alokasi (${pList.length} Pekerja)
            </h4>
            <div style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.72rem; color: #475569; text-transform: uppercase;">
                  <tr>
                    <th style="padding: 8px 10px; width: 30px;">#</th>
                    <th style="padding: 8px 10px;">Nama Pekerja</th>
                    <th style="padding: 8px 10px;">NIK / Kode</th>
                    <th style="padding: 8px 10px;">Posisi</th>
                    ${isMandoran ? `
                      <th style="padding: 8px 10px; text-align: right;">Target Basis</th>
                      <th style="padding: 8px 10px; text-align: right;">Realisasi Hasil</th>
                      <th style="padding: 8px 10px; text-align: right;">Selisih Basis</th>
                      <th style="padding: 8px 10px;">Status Kerja</th>
                    ` : `
                      <th style="padding: 8px 10px; text-align: center;">Status Kehadiran</th>
                      <th style="padding: 8px 10px;">Keterangan Alokasi</th>
                    `}
                  </tr>
                </thead>
                <tbody>
                  ${workerRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-primary" data-detail-close>Tutup</button>
      `
    });

    const root = document.getElementById('modal-root');
    root.querySelector('[data-detail-close]')?.addEventListener('click', closeModal);
    return;
  }

  openModal({
    title: `Detail Transaksi: ${cfg.title}`,
    body: `
      <div style="max-height: 60vh; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
          ${Object.entries(item)
        .map(([k, v]) => {
          if (k === 'rawState' || k === 'photos' || k === 'photo') return '';
          const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 6px 0; color: #64748b; font-weight: 600; width: 38%; vertical-align: top;">${esc(k)}</td>
                <td style="padding: 6px 0; color: #0f172a; word-break: break-word;">${esc(val)}</td>
              </tr>
            `;
        })
        .join('')}
        </table>
      </div>
    `,
    footer: `
      <button class="btn btn-primary" data-detail-close>Tutup</button>
    `
  });

  const root = document.getElementById('modal-root');
  root.querySelector('[data-detail-close]')?.addEventListener('click', closeModal);
}

function renderTxModuleFields(modId, item) {
  if (modId === 'attendance') {
    return `
      <div>
        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nama Mandor / Pekerja <span style="color:#ef4444;">*</span></label>
        <input class="feedback-form-input" id="tx-input-name" type="text" value="${esc(item?.name || 'Fadilah Yusuf Purba')}" />
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jabatan</label>
          <input class="feedback-form-input" id="tx-input-position" type="text" value="${esc(item?.position || 'Pekerja Bibitan')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jam Presensi</label>
          <input class="feedback-form-input" id="tx-input-time" type="text" value="${esc(item?.time || '07:15')}" />
        </div>
      </div>
    `;
  }
  if (modId === 'reception') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Tahapan Pertumbuhan</label>
          <select class="feedback-form-select" id="tx-input-tahapan">
            <option value="Rubber Main Nursery" ${item?.tahapan !== 'Rubber Advance Planting Material' ? 'selected' : ''}>Rubber Main Nursery (RMN)</option>
            <option value="Rubber Advance Planting Material" ${item?.tahapan === 'Rubber Advance Planting Material' ? 'selected' : ''}>Rubber Advance Planting Material (APM)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jenis Klon</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'PB 260')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Sumber Asal Bibit</label>
          <input class="feedback-form-input" id="tx-input-sumber" type="text" value="${esc(item?.sumber || 'Supplier Bibit Jaya')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Diterima <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-qty" type="number" value="${esc(item?.qty || 5000)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'seeding') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Batch</label>
          <input class="feedback-form-input" id="tx-input-batchNo" type="text" value="${esc(item?.batchNo || 'Batch-01')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Bedengan</label>
          <input class="feedback-form-input" id="tx-input-bedengan" type="text" value="${esc(item?.bedengan || (item?.rows && item.rows[0]?.bedengan) || 'Bedengan 01')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Rootstock</label>
          <input class="feedback-form-input" id="tx-input-klonAwal" type="text" value="${esc(item?.klonAwal || item?.klon || 'GT 1')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Disemai</label>
          <input class="feedback-form-input" id="tx-input-totalDisemai" type="number" value="${esc(item?.totalDisemai || item?.qty || 3000)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'budding' || modId === 'regrafting') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Batch</label>
          <input class="feedback-form-input" id="tx-input-batchNo" type="text" value="${esc(item?.batchNo || 'Batch-01')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Bedengan</label>
          <input class="feedback-form-input" id="tx-input-bedengan" type="text" value="${esc(item?.bedengan || 'Bedengan 01')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Entres (Mata)</label>
          <input class="feedback-form-input" id="tx-input-klonEntres" type="text" value="${esc(item?.klonEntres || 'PB 260')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Rootstock (Bawah)</label>
          <input class="feedback-form-input" id="tx-input-klonRootstock" type="text" value="${esc(item?.klonRootstock || 'GT 1')}" />
        </div>
      </div>
      <div>
        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Diokulasi</label>
        <input class="feedback-form-input" id="tx-input-jumlah" type="number" value="${esc(item?.jumlah || 1500)}" />
      </div>
    `;
  }
  if (modId === 'inspection') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Ref. Dokumen Okulasi</label>
          <input class="feedback-form-input" id="tx-input-buddingDocNo" type="text" value="${esc(item?.buddingDocNo || '2026/GRF/001')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Batch</label>
          <input class="feedback-form-input" id="tx-input-batchNo" type="text" value="${esc(item?.batchNo || 'Batch-01')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Total Diperiksa</label>
          <input class="feedback-form-input" id="tx-input-totalDiperiksa" type="number" value="${esc(item?.totalDiperiksa || 1500)}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Hasil Jadi (Sukses)</label>
          <input class="feedback-form-input" id="tx-input-jumlahJadi" type="number" value="${esc(item?.jumlahJadi || 1350)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'selection') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Batch</label>
          <input class="feedback-form-input" id="tx-input-batchNo" type="text" value="${esc(item?.batchNo || 'Batch-01')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Alasan Pengafkiran</label>
          <select class="feedback-form-select" id="tx-input-alasan">
            <option value="MATI" ${item?.alasan === 'MATI' ? 'selected' : ''}>MATI (Kering / Busuk)</option>
            <option value="ABNORMAL" ${item?.alasan === 'ABNORMAL' ? 'selected' : ''}>ABNORMAL (Kerdil / Rusak)</option>
            <option value="RUSAK" ${item?.alasan === 'RUSAK' ? 'selected' : ''}>RUSAK (Hama / Penyakit)</option>
          </select>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'PB 260')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Diafkir</label>
          <input class="feedback-form-input" id="tx-input-jumlahAfkir" type="number" value="${esc(item?.jumlahAfkir || 50)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'entres') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jenis Aktivitas</label>
          <select class="feedback-form-select" id="tx-input-activityType">
            <option value="MENUNAS" ${item?.activityType === 'MENUNAS' ? 'selected' : ''}>MENUNAS (Tunas Air)</option>
            <option value="TOPPING" ${item?.activityType === 'TOPPING' ? 'selected' : ''}>TOPPING (Pemotongan Pucuk)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Blok / Plot Entres</label>
          <input class="feedback-form-input" id="tx-input-plotId" type="text" value="${esc(item?.plotId || item?.plotNo || 'Plot Entres A-1')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Entres</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'PB 260')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Pokok Dikerjakan</label>
          <input class="feedback-form-input" id="tx-input-jumlahPokok" type="number" value="${esc(item?.jumlahPokok || item?.jumlah || 120)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'nurseryActivity') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Fitur / Mode Entri <span style="color:#ef4444;">*</span></label>
          <select class="feedback-form-input" id="tx-input-activityEntryMode">
            <option value="HARIAN" ${item?.activityEntryMode === 'HARIAN' ? 'selected' : ''}>Rekam Aktivitas Harian (Alokasi CFNA)</option>
            <option value="MANDORAN" ${item?.activityEntryMode === 'MANDORAN' ? 'selected' : ''}>Rekam Aktivitas Mandoran (Borongan)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jenis Kegiatan / Alokasi</label>
          <input class="feedback-form-input" id="tx-input-alokasi" type="text" value="${esc(item?.alokasi || item?.activityType || 'A01-01 — Pemupukan NPK')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Target Basis (Khusus Mandoran)</label>
          <input class="feedback-form-input" id="tx-input-taskQuantity" type="number" value="${esc(item?.taskQuantity || 500)}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Total Volume / Hasil Realisasi</label>
          <input class="feedback-form-input" id="tx-input-volumePkk" type="number" value="${esc(item?.totalHasil || item?.volumePkk || item?.qty || 500)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'material') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Item Code <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-itemCode" type="text" value="${esc(item?.itemCode || '7065168')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nama Material & Bahan <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-itemName" type="text" value="${esc(item?.itemName || item?.materialName || 'POLYBAG 25X50CMX0,20MM')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">No. Dokumen Issue</label>
          <input class="feedback-form-input" id="tx-input-noIssue" type="text" value="${esc(item?.noIssue || item?.docNo || 'ISS-2026-001')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Alokasi Biaya</label>
          <input class="feedback-form-input" id="tx-input-alokasi" type="text" value="${esc(item?.alokasi || 'NUR-MAIN — Nursery Main Stage')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Satuan (UOM)</label>
          <input class="feedback-form-input" id="tx-input-uom" type="text" value="${esc(item?.uom || item?.unit || 'LBR')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Kuantitas Issue Gudang <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-quantityIssue" type="number" value="${esc(item?.quantityIssue || 1000)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'mandoranConsolidation') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Alokasi Kegiatan <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-alokasi" type="text" value="${esc(item?.alokasi || 'RAW-01 — Pemupukan Rutin')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Peran Kelompok Kerja</label>
          <input class="feedback-form-input" id="tx-input-roleName" type="text" value="${esc(item?.roleName || 'Pekerja Borongan/Harian')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Tenaga Kerja (Orang)</label>
          <input class="feedback-form-input" id="tx-input-workerCount" type="number" value="${esc(item?.workerCount || 4)}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Total Hasil Kerja Terkonsolidasi <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-totalHasil" type="number" value="${esc(item?.totalHasil || 1200)}" />
        </div>
      </div>
      <div>
        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Satuan (UOM)</label>
        <input class="feedback-form-input" id="tx-input-uom" type="text" value="${esc(item?.uom || 'Pkk')}" />
      </div>
    `;
  }
  if (modId === 'request') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Divisi / Estate Tujuan</label>
          <input class="feedback-form-input" id="tx-input-targetDivision" type="text" value="${esc(item?.targetDivision || item?.estateTujuan || 'Divisi II - Replanting 2026')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Tahapan Pertumbuhan</label>
          <input class="feedback-form-input" id="tx-input-tahapan" type="text" value="${esc(item?.tahapan || 'Rubber Main Nursery')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Bibit</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'PB 260')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jlh Dikeluarkan</label>
          <input class="feedback-form-input" id="tx-input-qtyDispatched" type="number" value="${esc(item?.qtyDispatched || item?.qty || 1000)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'dederan') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Ref. Dok Induk / Penerimaan</label>
          <input class="feedback-form-input" id="tx-input-parentDocNo" type="text" value="${esc(item?.parentDocNo || item?.parentDederIndukDocNo || 'DED-IN-2026-001')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Bedengan</label>
          <input class="feedback-form-input" id="tx-input-bedengan" type="text" value="${esc(item?.bedengan || item?.bedenganCode || 'Bedengan 01')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Benih</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'GT 1')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Dideder (Butir) <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-jumlahDeder" type="number" value="${esc(item?.jumlahDeder || item?.qty || 1000)}" />
        </div>
      </div>
    `;
  }
  if (modId === 'dispatch') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Ref. Dokumen SPB</label>
          <input class="feedback-form-input" id="tx-input-parentRequestDocNo" type="text" value="${esc(item?.parentRequestDocNo || item?.requestDocNo || 'SPB-2026-001')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Tujuan Pengiriman</label>
          <input class="feedback-form-input" id="tx-input-targetDivision" type="text" value="${esc(item?.targetDivision || item?.targetDivisionName || 'Divisi II')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Bibit</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || item?.clone || 'PB 260')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Kirim (Pkk) <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-qtyKirim" type="number" value="${esc(item?.qtyKirim || item?.issuedQty || item?.qty || 500)}" />
        </div>
      </div>
      <div>
        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Plat Nomor Kendaraan</label>
        <input class="feedback-form-input" id="tx-input-vehiclePlate" type="text" value="${esc(item?.vehiclePlate || 'BK 1234 XY')}" />
      </div>
    `;
  }
  if (modId === 'destruction') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Ref. Dokumen Seleksi / Batch</label>
          <input class="feedback-form-input" id="tx-input-sourceSelectionNo" type="text" value="${esc(item?.sourceSelectionNo || item?.batchCode || 'SEL-2026-001')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Nomor Bedengan</label>
          <input class="feedback-form-input" id="tx-input-bedengan" type="text" value="${esc(item?.bedengan || item?.bedenganCode || 'Bedengan 01')}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Klon Bibit</label>
          <input class="feedback-form-input" id="tx-input-klon" type="text" value="${esc(item?.klon || 'GT 1')}" />
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Jumlah Dimusnahkan (Pkk) <span style="color:#ef4444;">*</span></label>
          <input class="feedback-form-input" id="tx-input-qty" type="number" value="${esc(item?.qty || item?.destructionQty || 50)}" />
        </div>
      </div>
      <div>
        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Alasan Pemusnahan</label>
        <input class="feedback-form-input" id="tx-input-reason" type="text" value="${esc(item?.reason || item?.alasan || 'Bibit mati / abnormal')}" />
      </div>
    `;
  }
  if (modId === 'syncQueue') {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Modul Entitas</label>
          <select class="feedback-form-select" id="tx-input-entity">
            <option value="receptions">receptions (Penerimaan)</option>
            <option value="seedings">seedings (Penyemaian)</option>
            <option value="buddings">buddings (Okulasi)</option>
            <option value="inspections">inspections (Pemeriksaan)</option>
            <option value="attendance">attendance (Presensi)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 4px;">Aksi Operasi</label>
          <select class="feedback-form-select" id="tx-input-action">
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
      </div>
    `;
  }
  return '';
}

function extractTxFormPayload(modId, root) {
  const p = {};
  if (modId === 'attendance') {
    p.name = root.querySelector('#tx-input-name')?.value || '';
    p.position = root.querySelector('#tx-input-position')?.value || '';
    p.time = root.querySelector('#tx-input-time')?.value || '';
    p.type = 'WORKER';
  } else if (modId === 'reception') {
    p.tahapan = root.querySelector('#tx-input-tahapan')?.value || 'Rubber Main Nursery';
    p.klon = root.querySelector('#tx-input-klon')?.value || 'PB 260';
    p.sumber = root.querySelector('#tx-input-sumber')?.value || '';
    p.qty = parseInt(root.querySelector('#tx-input-qty')?.value || 0) || 0;
  } else if (modId === 'seeding') {
    p.batchNo = root.querySelector('#tx-input-batchNo')?.value || 'Batch-01';
    p.bedengan = root.querySelector('#tx-input-bedengan')?.value || 'Bedengan 01';
    p.klonAwal = root.querySelector('#tx-input-klonAwal')?.value || 'GT 1';
    p.totalDisemai = parseInt(root.querySelector('#tx-input-totalDisemai')?.value || 0) || 0;
  } else if (modId === 'budding' || modId === 'regrafting') {
    p.batchNo = root.querySelector('#tx-input-batchNo')?.value || 'Batch-01';
    p.bedengan = root.querySelector('#tx-input-bedengan')?.value || 'Bedengan 01';
    p.klonEntres = root.querySelector('#tx-input-klonEntres')?.value || 'PB 260';
    p.klonRootstock = root.querySelector('#tx-input-klonRootstock')?.value || 'GT 1';
    p.jumlah = parseInt(root.querySelector('#tx-input-jumlah')?.value || 0) || 0;
    if (modId === 'regrafting') p.type = 'REGRAFTING';
  } else if (modId === 'inspection') {
    p.buddingDocNo = root.querySelector('#tx-input-buddingDocNo')?.value || '';
    p.batchNo = root.querySelector('#tx-input-batchNo')?.value || 'Batch-01';
    p.totalDiperiksa = parseInt(root.querySelector('#tx-input-totalDiperiksa')?.value || 0) || 0;
    p.jumlahJadi = parseInt(root.querySelector('#tx-input-jumlahJadi')?.value || 0) || 0;
    p.jumlahGagal = Math.max(0, p.totalDiperiksa - p.jumlahJadi);
    p.persenJadi = p.totalDiperiksa > 0 ? Math.round((p.jumlahJadi / p.totalDiperiksa) * 100) : 0;
  } else if (modId === 'selection') {
    p.batchNo = root.querySelector('#tx-input-batchNo')?.value || 'Batch-01';
    p.alasan = root.querySelector('#tx-input-alasan')?.value || 'MATI';
    p.klon = root.querySelector('#tx-input-klon')?.value || 'PB 260';
    p.jumlahAfkir = parseInt(root.querySelector('#tx-input-jumlahAfkir')?.value || 0) || 0;
  } else if (modId === 'entres') {
    p.activityType = root.querySelector('#tx-input-activityType')?.value || 'MENUNAS';
    p.plotId = root.querySelector('#tx-input-plotId')?.value || 'Plot Entres A-1';
    p.klon = root.querySelector('#tx-input-klon')?.value || 'PB 260';
    p.jumlahPokok = parseInt(root.querySelector('#tx-input-jumlahPokok')?.value || 0) || 0;
  } else if (modId === 'nurseryActivity') {
    const mode = root.querySelector('#tx-input-activityEntryMode')?.value || 'HARIAN';
    p.activityEntryMode = mode;
    p.entryMode = mode;
    p.alokasi = root.querySelector('#tx-input-alokasi')?.value || 'A01-01 — Pemupukan NPK';
    p.activityType = p.alokasi;
    p.taskQuantity = parseInt(root.querySelector('#tx-input-taskQuantity')?.value || 0) || 0;
    p.volumePkk = parseInt(root.querySelector('#tx-input-volumePkk')?.value || 0) || 0;
    p.totalHasil = p.volumePkk;
  } else if (modId === 'material') {
    const itemCode = root.querySelector('#tx-input-itemCode')?.value || '7065168';
    const itemName = root.querySelector('#tx-input-itemName')?.value || 'POLYBAG 25X50CMX0,20MM';
    const noIssue = root.querySelector('#tx-input-noIssue')?.value || ('ISS-' + Date.now());
    const alokasi = root.querySelector('#tx-input-alokasi')?.value || 'NUR-MAIN';
    const uom = root.querySelector('#tx-input-uom')?.value || 'LBR';
    const quantityIssue = parseInt(root.querySelector('#tx-input-quantityIssue')?.value || 0, 10) || 0;

    p.itemCode = itemCode;
    p.itemName = itemName;
    p.materialName = itemName;
    p.noIssue = noIssue;
    p.docNo = noIssue;
    p.alokasi = alokasi;
    p.kodeAlokasi = alokasi;
    p.uom = uom;
    p.unit = uom;
    p.quantityIssue = quantityIssue;
    p.items = [{
      id: uid(),
      itemCode,
      itemName,
      uom,
      quantityIssue,
      usedQuantity: 0,
      remainingQuantity: quantityIssue,
      status: 'AVAILABLE'
    }];
    p.usedQuantity = 0;
    p.remainingQuantity = quantityIssue;
    p.status = 'AVAILABLE';
  } else if (modId === 'mandoranConsolidation') {
    const alokasi = root.querySelector('#tx-input-alokasi')?.value || 'RAW-01 — Pemupukan';
    const roleName = root.querySelector('#tx-input-roleName')?.value || 'Pekerja Borongan';
    const workerCount = parseInt(root.querySelector('#tx-input-workerCount')?.value || 0, 10) || 1;
    const totalHasil = parseInt(root.querySelector('#tx-input-totalHasil')?.value || 0, 10) || 0;
    const uom = root.querySelector('#tx-input-uom')?.value || 'Pkk';

    p.alokasi = alokasi;
    p.allocationName = alokasi;
    p.roleName = roleName;
    p.workerCount = workerCount;
    p.totalHasil = totalHasil;
    p.uom = uom;
    p.unit = uom;
    p.type = 'MANDORAN_RESULT_CONSOLIDATION';
    p.status = 'CONSOLIDATED';
  } else if (modId === 'request') {
    p.targetDivision = root.querySelector('#tx-input-targetDivision')?.value || 'Divisi II';
    p.tahapan = root.querySelector('#tx-input-tahapan')?.value || 'Rubber Main Nursery';
    p.klon = root.querySelector('#tx-input-klon')?.value || 'PB 260';
    p.qtyDispatched = parseInt(root.querySelector('#tx-input-qtyDispatched')?.value || 0) || 0;
  } else if (modId === 'dederan') {
    p.parentDederIndukDocNo = root.querySelector('#tx-input-parentDocNo')?.value || '';
    p.parentDocNo = p.parentDederIndukDocNo;
    p.bedenganCode = root.querySelector('#tx-input-bedengan')?.value || 'Bedengan 01';
    p.bedengan = p.bedenganCode;
    p.klon = root.querySelector('#tx-input-klon')?.value || 'GT 1';
    p.jumlahDeder = parseInt(root.querySelector('#tx-input-jumlahDeder')?.value || 0) || 0;
    p.qty = p.jumlahDeder;
  } else if (modId === 'dispatch') {
    p.parentRequestDocNo = root.querySelector('#tx-input-parentRequestDocNo')?.value || '';
    p.targetDivisionName = root.querySelector('#tx-input-targetDivision')?.value || 'Divisi II';
    p.targetDivision = p.targetDivisionName;
    p.clone = root.querySelector('#tx-input-klon')?.value || 'PB 260';
    p.klon = p.clone;
    p.qtyKirim = parseInt(root.querySelector('#tx-input-qtyKirim')?.value || 0) || 0;
    p.issuedQty = p.qtyKirim;
    p.vehiclePlate = root.querySelector('#tx-input-vehiclePlate')?.value || '';
  } else if (modId === 'destruction') {
    p.sourceSelectionNo = root.querySelector('#tx-input-sourceSelectionNo')?.value || '';
    p.bedenganCode = root.querySelector('#tx-input-bedengan')?.value || 'Bedengan 01';
    p.bedengan = p.bedenganCode;
    p.klon = root.querySelector('#tx-input-klon')?.value || 'GT 1';
    p.qty = parseInt(root.querySelector('#tx-input-qty')?.value || 0) || 0;
    p.destructionQty = p.qty;
    p.reason = root.querySelector('#tx-input-reason')?.value || 'AFKIR';
    p.alasan = p.reason;
  } else if (modId === 'syncQueue') {
    p.entity = root.querySelector('#tx-input-entity')?.value || 'receptions';
    p.action = root.querySelector('#tx-input-action')?.value || 'CREATE';
  }
  return p;
}

function generateNewDocNo(modId) {
  const existingList = loadTxList(modId);
  return generateUniqueDocNo(modId, existingList, 2026);
}
