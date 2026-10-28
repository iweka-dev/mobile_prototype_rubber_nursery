/**
 * js/modules/verification/mantri-confirmation-service.js
 * Central Aggregator Service untuk "Konfirmasi untuk Verifikasi" Mantri Bibitan.
 * 
 * Tanggung Jawab Utama:
 * 1. Mengagregasi transaksi hari ini dari seluruh modul operasional Mantri Bibitan.
 * 2. Memfilter transaksi berdasarkan Actor (Current Logged-in Mantri) & Today (Business Transaction Date).
 * 3. Menormalisasi setiap transaksi ke model standar tanpa mengubah skema raw data.
 * 4. Menyediakan mekanisme submission idempotent ke Asisten Bibitan (menghasilkan verification_transactions).
 */

import { storage } from '../../core/storage.js';
import { todayISO, todayDDMMYYYY, isCullDocNo } from '../../core/utils.js';
import { getCurrentUserContext, resolveUserContext, ROLES } from '../../core/user-context.js';
import { VERIFICATION_STORAGE_KEY, VERIFICATION_STATUS } from './verification-manager.js';
import { 
  submitPreGraftingSelectionDocumentToAsisten,
  getSeleksi1ExecutionsByDocument,
  getSeleksi2ExecutionsByDocument,
  getSeleksi3ExecutionsByDocument,
  getSelectionStageLabel,
  getSelectionCategoryLabel,
  reconcileSelectionPoolWithTransactions
} from '../selection/selection-manager.js';
import { syncAllDederanRejectionsToSelectionPool, getBedenganInspectionSummary } from '../seeding/dederan-manager.js';
import { getWorkersForUserContext } from '../../data/worker-master.js';
import { assertAttendanceGateOrThrow } from '../../core/attendance-gate-service.js';
import { matchActor } from '../../core/transaction-actor.js';
export { matchActor };

export const MANTRI_TRANSACTION_STATUS = Object.freeze({
  READY_TO_CONFIRM: 'READY_TO_CONFIRM',
  SUBMITTED_TO_ASB: 'SUBMITTED_TO_ASB',
  PENDING_ASB: 'PENDING_ASB',
  VERIFIED: 'VERIFIED',
  APPROVED: 'APPROVED',
  REVISION: 'REVISION'
});

export const MODULE_TYPES = Object.freeze({
  PRESENSI: 'PRESENSI',
  TIDAK_HADIR: 'TIDAK_HADIR',
  PENERIMAAN: 'PENERIMAAN',
  PENYEMAIAN: 'PENYEMAIAN',
  DEDERAN: 'DEDERAN',
  KEBUN_ENTRES: 'KEBUN_ENTRES',
  MENUNAS: 'MENUNAS',
  TOPPING: 'TOPPING',
  OKULASI: 'OKULASI',
  PEMERIKSAAN: 'PEMERIKSAAN',
  PEMERIKSAAN_DEDERAN: 'PEMERIKSAAN_DEDERAN',
  SELEKSI_PRA_OKULASI: 'SELEKSI_PRA_OKULASI',
  PENYELEKSIAN: 'PENYELEKSIAN',
  PEMELIHARAAN: 'PEMELIHARAAN',
  PENGELUARAN: 'PENGELUARAN',
  MATERIAL: 'MATERIAL',
  SIMULASI_GUDANG: 'SIMULASI_GUDANG'
});

export const MODULE_LABELS = Object.freeze({
  [MODULE_TYPES.PRESENSI]: 'Presensi',
  [MODULE_TYPES.TIDAK_HADIR]: 'Tidak Hadir',
  [MODULE_TYPES.PENERIMAAN]: 'Penerimaan',
  [MODULE_TYPES.PENYEMAIAN]: 'Penyemaian',
  [MODULE_TYPES.DEDERAN]: 'Dederan (Germinasi)',
  [MODULE_TYPES.KEBUN_ENTRES]: 'Kebun Entres',
  [MODULE_TYPES.MENUNAS]: 'Menunas',
  [MODULE_TYPES.TOPPING]: 'Topping',
  [MODULE_TYPES.OKULASI]: 'Okulasi',
  [MODULE_TYPES.PEMERIKSAAN]: 'Pemeriksaan Okulasi',
  [MODULE_TYPES.PEMERIKSAAN_DEDERAN]: 'Pemeriksaan Dederan',
  [MODULE_TYPES.SELEKSI_PRA_OKULASI]: 'Pemeriksaan Pra-Okulasi',
  [MODULE_TYPES.PENYELEKSIAN]: 'Penyeleksian Bibit',
  [MODULE_TYPES.PEMELIHARAAN]: 'Rekam Pemeliharaan',
  [MODULE_TYPES.PENGELUARAN]: 'Pengeluaran',
  [MODULE_TYPES.MATERIAL]: 'Material & Bahan',
  [MODULE_TYPES.SIMULASI_GUDANG]: 'Simulasi Issue Gudang'
});

/**
 * Helper: Safe number formatting yang aman terhadap null, undefined, numeric string, '-' (hyphen)
 */
export function formatSafeNumber(val, defaultFallback = '-') {
  if (val === undefined || val === null || val === '') return defaultFallback;
  if (val === '-') return '-';
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  return n.toLocaleString('id-ID');
}

/**
 * Helper: Normalisasi date bisnis ke format kanonikal DD/MM/YYYY
 * Mendukung: DD/MM/YYYY, YYYY-MM-DD, ISO string, dan Date object.
 */
export function normalizeDateStr(rawDate) {
  if (!rawDate) return '';
  if (rawDate instanceof Date) {
    if (Number.isNaN(rawDate.getTime())) return '';
    const d = String(rawDate.getDate()).padStart(2, '0');
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const y = rawDate.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const str = String(rawDate).trim();
  if (!str) return '';

  // Case 1: Already DD/MM/YYYY (e.g. "01/10/2026", "1/10/2026", "01-10-2026")
  const ddmmyyyyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${day}/${month}/${year}`;
  }

  // Case 2: ISO date or timestamp YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ
  const yyyymmddMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  // Case 3: Parse with Date as fallback
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    return `${d}/${m}/${y}`;
  }

  return str;
}

/**
 * Helper: Mengekstrak tanggal transaksi bisnis dengan prioritas spesifik
 */
function extractBusinessDate(item) {
  if (!item || typeof item !== 'object') return '';
  const priorityFields = [
    item.tanggal,
    item.tanggalSeleksi,
    item.date,
    item.tanggalDeder,
    item.tanggalTunas,
    item.tanggalTopping,
    item.tanggalOkulasi,
    item.tanggalSemai,
    item.tanggalPenerimaan,
    item.tanggalPemeriksaan,
    item.tanggalInspeksi,
    item.activityDate,
    item.dispatchDate,
    item.receiptDate,
    item.attendanceDate,
    item.usageDate,
    item.issueDate,
    item.completedAt,
    item.createdAt
  ];

  for (const f of priorityFields) {
    if (f) {
      const d = normalizeDateStr(f);
      if (d) return d;
    }
  }
  return '';
}

/**
 * Helper: Menghitung batas waktu submission (submission deadline) untuk tanggal bisnis tertentu.
 * Rule Global:
 * Untuk transaction business date D (format DD/MM/YYYY, ISO, atau Date):
 * Allowed window: D 00:00:00 s.d. D+1 12:00:00 (inklusif).
 * Expired: > D+1 12:00:00.
 *
 * @param {string|Date} rawBusinessDate - Tanggal bisnis transaksi
 * @returns {Date|null} Date object batas akhir cutoff D+1 12:00:00.000
 */
export function calculateSubmissionDeadline(rawBusinessDate) {
  const norm = normalizeDateStr(rawBusinessDate);
  if (!norm) return null;
  const parts = norm.split('/').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [day, month, year] = parts;
  return new Date(year, month - 1, day + 1, 12, 0, 0, 0);
}

/**
 * Single Source of Truth: Menghitung window informasi dan status kelayakan submission.
 * Mengembalikan derived state tanpa mengubah persistensi status di storage.
 *
 * @param {object|string} transactionOrDate - Record transaksi atau string tanggal bisnis
 * @param {Date|string|number} [currentTime=null] - Waktu saat ini (opsional, default new Date())
 * @returns {object} { businessDate, submissionDeadline, submissionDeadlineDate, isSubmissionExpired, canSubmit, submissionWindowStatus }
 */
export function getSubmissionWindowInfo(transactionOrDate, currentTime = null) {
  let bDate = '';
  let lifecycleStatus = MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM;

  if (transactionOrDate && typeof transactionOrDate === 'object') {
    bDate = extractBusinessDate(transactionOrDate) || transactionOrDate.date || '';
    lifecycleStatus = transactionOrDate.status || MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM;
  } else if (typeof transactionOrDate === 'string') {
    bDate = transactionOrDate;
  }

  const normBDate = normalizeDateStr(bDate);
  const deadline = calculateSubmissionDeadline(normBDate);
  const now = currentTime instanceof Date
    ? currentTime
    : (currentTime ? new Date(currentTime) : new Date());

  // Boundary exact: > D+1 12:00:00.000 adalah EXPIRED
  const isExpired = deadline ? (now.getTime() > deadline.getTime()) : false;
  const submissionWindowStatus = isExpired ? 'EXPIRED' : 'OPEN';

  // canSubmit hanya true jika:
  // 1. Belum expired (submissionWindowStatus === 'OPEN')
  // 2. Status lifecycle masih memerlukan konfirmasi (READY_TO_CONFIRM atau REVISION)
  const isPendingSubmission = (
    lifecycleStatus === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM ||
    lifecycleStatus === MANTRI_TRANSACTION_STATUS.REVISION
  );
  const canSubmit = !isExpired && isPendingSubmission;

  return {
    businessDate: normBDate,
    submissionDeadline: deadline ? deadline.toISOString() : null,
    submissionDeadlineDate: deadline,
    isSubmissionExpired: isExpired,
    canSubmit,
    submissionWindowStatus
  };
}

export function isSubmissionExpired(transactionOrDate, currentTime = null) {
  return getSubmissionWindowInfo(transactionOrDate, currentTime).isSubmissionExpired;
}

export function canSubmitTransaction(transaction, currentTime = null) {
  return getSubmissionWindowInfo(transaction, currentTime).canSubmit;
}


/**
 * Canonical Predicate: Memeriksa apakah suatu transaksi berstatus LOCKED untuk Mantri.
 * Mengevaluasi seluruh status field (status, verificationStatus, submissionStatus) secara independen.
 * 
 * @param {object} item - Record transaksi sumber
 * @returns {boolean} true jika transaksi terkunci (sedang diverifikasi atau sudah disetujui/final)
 */
export function isTransactionLockedForMantri(item) {
  if (!item) return false;
  if (item.isFinal === true) return true;

  const primaryStatus = String(item.status || '').toUpperCase().trim();
  const verifStatus = String(item.verificationStatus || '').toUpperCase().trim();
  const subStatus = String(item.submissionStatus || '').toUpperCase().trim();

  // If status is returned/revision, it is unlocked unless actively resubmitted or approved
  const isReturned = primaryStatus === 'DIKEMBALIKAN' || primaryStatus === 'REVISION' ||
                     verifStatus === 'DIKEMBALIKAN' || verifStatus === 'REVISION' ||
                     subStatus === 'DIKEMBALIKAN' || subStatus === 'REVISION';

  if (isReturned) {
    const isApproved =
      primaryStatus === 'TERVERIFIKASI' ||
      primaryStatus === 'DISETUJUI' ||
      primaryStatus === 'APPROVED' ||
      verifStatus === 'TERVERIFIKASI' ||
      verifStatus === 'DISETUJUI' ||
      verifStatus === 'APPROVED';

    const isResubmittedAfterCorrection =
      item.isCorrected === true &&
      (primaryStatus === 'MENUNGGU_VERIFIKASI' ||
       primaryStatus === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN' ||
       subStatus === 'SUBMITTED_TO_ASB');

    if (!isApproved && !isResubmittedAfterCorrection) {
      return false; // Valid returned state is EDITABLE
    }
  }

  const statuses = [
    primaryStatus,
    verifStatus,
    subStatus
  ].filter(Boolean);

  if (statuses.length === 0) return false;

  const lockedStates = new Set([
    'MENUNGGU_VERIFIKASI',
    'SUBMITTED_TO_ASB',
    'PENDING_ASB',
    'DIAJUKAN',
    'DIAJUKAN_PEMERIKSAAN',
    'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
    'TERVERIFIKASI',
    'DISETUJUI',
    'VERIFIED',
    'APPROVED',
    'DATA_TERKONFIRMASI',
    'TERKONFIRMASI'
  ]);

  return statuses.some(s => lockedStates.has(s));
}

/**
 * Helper: Tentukan status siklus hidup konfirmasi untuk record tertentu
 */
function resolveTransactionStatus(item, moduleType, verifMap) {
  const itemId = String(item.id || item.docNo || '');
  const itemDocNo = String(item.docNo || item.id || '');

  // 1. Cek dari verification_transactions dengan composite key (moduleType:id) atau direct id
  const modKey = String(moduleType || '').toUpperCase();
  const isMaterialModule = modKey === 'MATERIAL';
  let verifRecord = modKey ? (verifMap.get(`${modKey}:${itemId}`) || verifMap.get(`${modKey}:${itemDocNo}`)) : null;
  if (!verifRecord) {
    const candidate = verifMap.get(itemId) || verifMap.get(itemDocNo);
    if (candidate) {
      const cType = String(candidate.referenceType || candidate.moduleType || '').toUpperCase();
      if (!cType || !modKey || cType === modKey || (modKey === 'MATERIAL' && cType === 'SIMULASI_GUDANG')) {
        verifRecord = candidate;
      }
    }
  }

  if (verifRecord) {
    const vStat = (verifRecord.verificationStatus || '').toUpperCase();
    if (
      vStat === VERIFICATION_STATUS.TERVERIFIKASI ||
      vStat === 'VERIFIED' ||
      vStat === 'APPROVED' ||
      vStat === 'DISETUJUI' ||
      vStat === VERIFICATION_STATUS.DATA_TERKONFIRMASI ||
      vStat === 'DATA_TERKONFIRMASI' ||
      vStat === 'TERKONFIRMASI'
    ) {
      return {
        status: MANTRI_TRANSACTION_STATUS.VERIFIED,
        verificationStatus: VERIFICATION_STATUS.TERVERIFIKASI,
        latestVerification: verifRecord
      };
    }
    if (vStat === VERIFICATION_STATUS.DIKEMBALIKAN || vStat === 'REVISION') {
      const isRepairedReady = isMaterialModule
        ? (Boolean(item.materialIsCorrected) || String(item.materialSubmissionStatus || '').toUpperCase() === 'READY_TO_CONFIRM')
        : ((
            String(item.status || '').toUpperCase() === 'READY_TO_CONFIRM' ||
            String(item.status || '').toUpperCase() === 'MENUNGGU_VERIFIKASI_MANTRI' ||
            Boolean(item.isCorrected)
          ) && item.verificationStatus !== 'DIKEMBALIKAN');
      if (isRepairedReady) {
        return {
          status: MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM,
          verificationStatus: null,
          latestVerification: verifRecord
        };
      }
      return {
        status: MANTRI_TRANSACTION_STATUS.REVISION,
        verificationStatus: VERIFICATION_STATUS.DIKEMBALIKAN,
        latestVerification: verifRecord
      };
    }
    if (vStat === VERIFICATION_STATUS.MENUNGGU_VERIFIKASI || vStat === 'SUBMITTED_TO_ASB' || vStat === 'PENDING_ASB') {
      return {
        status: MANTRI_TRANSACTION_STATUS.SUBMITTED_TO_ASB,
        verificationStatus: VERIFICATION_STATUS.MENUNGGU_VERIFIKASI,
        latestVerification: verifRecord
      };
    }
  }

  // 2. Cek verified / return status jika item sudah final / dikembalikan
  const rawSubStat = String((isMaterialModule && item.materialSubmissionStatus ? item.materialSubmissionStatus : null) || item.submissionStatus || '').toUpperCase().trim();
  const rawStat = String(item.status || item.verificationStatus || '').toUpperCase().trim();
  const isFinal = Boolean(item.isFinal);

  if (isMaterialModule) {
    if (rawSubStat === 'DISETUJUI' || String(item.materialSubmissionStatus || '').toUpperCase() === 'DISETUJUI') {
      return {
        status: MANTRI_TRANSACTION_STATUS.VERIFIED,
        verificationStatus: VERIFICATION_STATUS.TERVERIFIKASI,
        latestVerification: verifRecord
      };
    }
    if (rawSubStat === 'DIKEMBALIKAN' || String(item.materialSubmissionStatus || '').toUpperCase() === 'DIKEMBALIKAN') {
      return {
        status: MANTRI_TRANSACTION_STATUS.REVISION,
        verificationStatus: VERIFICATION_STATUS.DIKEMBALIKAN,
        latestVerification: verifRecord
      };
    }
    // Standalone material_usage_transactions fallback
    if (item.storageKey === 'material_usage_transactions') {
      if (rawStat === 'DISETUJUI' || (rawStat === 'DISETUJUI' && isFinal) || item.verifiedAt) {
        return {
          status: MANTRI_TRANSACTION_STATUS.VERIFIED,
          verificationStatus: VERIFICATION_STATUS.TERVERIFIKASI,
          latestVerification: verifRecord
        };
      }
      if (rawStat === 'DIKEMBALIKAN' || rawStat === 'REVISION') {
        return {
          status: MANTRI_TRANSACTION_STATUS.REVISION,
          verificationStatus: VERIFICATION_STATUS.DIKEMBALIKAN,
          latestVerification: verifRecord
        };
      }
    }
  } else {
    if (
      rawStat === 'DISETUJUI' ||
      rawStat === 'VERIFIED' ||
      rawStat === 'APPROVED' ||
      rawStat === 'DATA_TERKONFIRMASI' ||
      rawStat === 'TERKONFIRMASI' ||
      (rawStat === 'DISETUJUI' && isFinal) ||
      item.verifiedAt
    ) {
      return {
        status: MANTRI_TRANSACTION_STATUS.VERIFIED,
        verificationStatus: VERIFICATION_STATUS.TERVERIFIKASI,
        latestVerification: null
      };
    }

    if (rawStat === 'DIKEMBALIKAN' || rawStat === 'REVISION' || rawSubStat === 'REVISION' || rawSubStat === 'DIKEMBALIKAN') {
      return {
        status: MANTRI_TRANSACTION_STATUS.REVISION,
        verificationStatus: VERIFICATION_STATUS.DIKEMBALIKAN,
        latestVerification: null
      };
    }
  }

  // 3. Cek explicit submission metadata
  const hasValidSubmittedAt = Boolean(item.submittedAt && String(item.submittedAt).trim() !== '' && String(item.submittedAt).trim() !== '-');
  const isExplicitlySubmitted = isMaterialModule
    ? (String(item.materialSubmissionStatus || '').toUpperCase() === 'SUBMITTED_TO_ASB' || Boolean(item.materialSubmittedAt))
    : (rawSubStat === 'SUBMITTED_TO_ASB' || hasValidSubmittedAt);

  if (isExplicitlySubmitted) {
    return {
      status: MANTRI_TRANSACTION_STATUS.SUBMITTED_TO_ASB,
      verificationStatus: VERIFICATION_STATUS.MENUNGGU_VERIFIKASI,
      latestVerification: null
    };
  }

  // 4. Default: Belum disubmit ke Asisten
  return {
    status: MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM,
    verificationStatus: null,
    latestVerification: null
  };
}

/**
 * Service Utama: Mengambil daftar seluruh transaksi Mantri login hari ini dalam bentuk ternormalisasi
 */
export function getMantriTodayTransactions(userContext = null, targetDate = null, currentTime = null) {
  const user = userContext || getCurrentUserContext() || resolveUserContext();
  const todayStr = targetDate ? normalizeDateStr(targetDate) : todayDDMMYYYY();

  try {
    syncAllDederanRejectionsToSelectionPool();
  } catch (_) {}
  // Bersihkan deklarasi CULL Pra-Okulasi yang sumber pemeriksaannya sudah
  // dihapus sebelum antrean Central Hub Mantri dibentuk.
  try {
    reconcileSelectionPoolWithTransactions();
  } catch (_) {}

  // Ambil data verifikasi untuk mapping status verifikasi terbaru
  const allVerifications = storage.get(VERIFICATION_STORAGE_KEY, []);
  const verifMap = new Map();
  allVerifications.forEach(v => {
    const type = (v.referenceType || v.moduleType || '').toUpperCase();
    if (v.referenceId) {
      verifMap.set(String(v.referenceId), v);
      if (type) verifMap.set(`${type}:${String(v.referenceId)}`, v);
    }
    if (v.referenceDocNo) {
      verifMap.set(String(v.referenceDocNo), v);
      if (type) verifMap.set(`${type}:${String(v.referenceDocNo)}`, v);
    }
  });

  const normalizedList = [];

  // 1. Tidak Hadir (Exception Workflow)
  // Normal presensi sengaja tidak dimasukkan ke Central Hub sesuai PRS-AUD-001.
  // PRE-CONDITION: Hanya dievaluasi jika Mantri sudah melakukan "Simpan Presensi Datang" hari ini.
  const storedAtts = storage.get('attendance_transactions', []);
  const todayWorkerAtts = storedAtts.filter(a => {
    if (a.type !== 'WORKER' && a.attendanceType !== 'DATANG') return false;
    if (a.attendanceType && a.attendanceType !== 'DATANG') return false;

    const bDate = extractBusinessDate(a);
    if (bDate !== todayStr) return false;

    // Match Mantri / User Scope
    const mantriIds = [user?.id, user?.userId].filter(Boolean).map(String);
    const isOwner = [a.createdByUserId, a.userId, a.supervisorId].filter(Boolean).some(id => mantriIds.includes(String(id)));
    if (!isOwner && mantriIds.length > 0) return false;

    if (user?.estateId && a.estateId && a.estateId !== user.estateId) return false;
    if (user?.divisionId && a.divisionId && a.divisionId !== user.divisionId) return false;

    return true;
  });

  // Jika belum ada Presensi Datang yang tersimpan hari ini, Tidak Hadir = 0 (jangan buat item)
  if (todayWorkerAtts.length > 0) {
    const scopedAll = getWorkersForUserContext(user, { activeOnly: false }) || [];
    const presentWorkerKeys = new Set();
    todayWorkerAtts.forEach(a => {
      if (a.workerId) presentWorkerKeys.add(String(a.workerId));
      if (a.code) presentWorkerKeys.add(String(a.code));
      if (a.workerCode) presentWorkerKeys.add(String(a.workerCode));
    });

    const scopedAbsent = scopedAll.filter(
      w => w.status !== 'ACTIVE' || w.active === false || !!w.absentType
    );

    const activeUnchecked = scopedAll.filter(
      w =>
        (w.status === 'ACTIVE' && w.active !== false && !w.absentType) &&
        !presentWorkerKeys.has(String(w.id)) &&
        !presentWorkerKeys.has(String(w.code))
    );

    const absentWorkers = [...scopedAbsent, ...activeUnchecked];

    if (absentWorkers.length > 0) {
      const docNo = `ABSEN-${todayStr.replace(/\//g, '')}`;
      const virtualItem = {
        id: docNo,
        docNo,
        date: todayStr,
        type: 'TIDAK_HADIR',
        status: 'READY_TO_CONFIRM', // default sebelum konfirmasi
        submittedByUserId: user?.id || user?.userId,
        submittedByName: user?.name || 'Mantri Bibitan',
        estateId: user?.estateId,
        divisionId: user?.divisionId,
        detailPekerja: absentWorkers.map(w => ({
          workerId: w.id,
          name: w.name,
          code: w.code,
          absentType: w.absentType || 'C'
        }))
      };

      const stat = resolveTransactionStatus(virtualItem, MODULE_TYPES.TIDAK_HADIR, verifMap);
      const summary = `${absentWorkers.length} Pekerja Tidak Hadir`;
      const infoText = absentWorkers.map(w => w.name || w.code).join(', ');

      normalizedList.push({
        id: docNo,
        docNo,
        moduleType: MODULE_TYPES.TIDAK_HADIR,
        moduleLabel: MODULE_LABELS[MODULE_TYPES.TIDAK_HADIR],
        date: todayStr,
        actor: user?.name || 'Mantri Bibitan',
        summary,
        status: stat.status,
        verificationStatus: stat.verificationStatus,
        rawRecord: virtualItem,
        storageKey: 'virtual_tidak_hadir',
        display: {
          title: 'Tidak Hadir',
          info: infoText || '-',
          mainQty: `${absentWorkers.length} Pekerja Tidak Hadir`,
          unit: 'Orang',
          fields: [
            { label: 'Total Tidak Hadir', value: `${absentWorkers.length} Orang`, highlight: true },
            { label: 'Rincian Pekerja', value: absentWorkers.map(w => `${w.name || '-'} (${w.code || '-'}) · Izin: ${w.absentType || 'C'}`).join('<br>') }
          ]
        }
      });
    }
  }


  // 2. Penerimaan: receipt_ksp_transactions & penerimaan_biji_records & receipt_transactions
  const receipts = [
    ...storage.get('receipt_ksp_transactions', []),
    ...storage.get('penerimaan_biji_records', []),
    ...storage.get('receipt_transactions', [])
  ];
  const seenReceiptIds = new Set();
  receipts.forEach(item => {
    const id = item.id || item.docNo || item.receiptId;
    if (!id || seenReceiptIds.has(id)) return;
    seenReceiptIds.add(id);

    // Penerimaan yang dibuat otomatis dari proses Pengeluaran Bibit/Entres
    // ditujukan ke pihak kebun penerima, bukan konfirmasi transaksi Mantri.
    // Jangan masukkan dokumen turunan ini ke antrean Central Hub Mantri.
    if (item.dispatchId || item.dispatchDocNo || item.parentRequestId) return;

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PENERIMAAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.receiptDocNo || item.id || `RCV-${id}`;
    const actor = item.penerima || item.actorName || item.createdByName || user?.name || 'Mantri Bibitan';
    const rawQty = item.qty !== undefined ? item.qty : (item.quantity !== undefined ? item.quantity : (item.receivedQty !== undefined ? item.receivedQty : (item.acceptedQty !== undefined ? item.acceptedQty : '-')));
    const unit = item.satuan || item.unit || 'Butir';
    const hasUnitInRaw = typeof rawQty === 'string' && /[a-zA-Z]/.test(rawQty.trim());
    const safeQtyFormatted = formatSafeNumber(rawQty);
    const formattedDisplayQty = hasUnitInRaw ? rawQty.trim() : `${safeQtyFormatted} ${unit}`;
    const klon = item.klon || item.clone || '-';
    const tipeAsal = item.tipeAsal || item.asal || item.sumber || item.sourceType || 'Kebun Induk';
    const summary = `${formattedDisplayQty} (Klon: ${klon})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PENERIMAAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PENERIMAAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'receipt_ksp_transactions',
      display: {
        title: 'Penerimaan Benih',
        info: `Klon ${klon} · ${tipeAsal}`,
        mainQty: formattedDisplayQty,
        unit,
        fields: [
          { label: 'Klon', value: klon },
          { label: 'Tipe Asal', value: tipeAsal },
          { label: 'Sumber', value: item.sumber || '-' },
          { label: 'No. SIR', value: item.sir || '-' },
          { label: 'Jumlah Diterima', value: formattedDisplayQty, highlight: true }
        ]
      }
    });
  });

  // 3. Penyemaian: seeding_transactions
  const seedings = storage.get('seeding_transactions', []);
  const seenSeedingIds = new Set();
  seedings.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenSeedingIds.has(id)) return;
    seenSeedingIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PENYEMAIAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.nomorDokumen || item.id || `SEED-${id}`;
    const actor = item.mantri || item.actorName || item.createdByName || user?.name || 'Mantri Bibitan';
    const qty = item.totalDisemai !== undefined ? item.totalDisemai : (item.qty || 0);
    const formattedQty = formatSafeNumber(qty);
    const bedengan = item.bedengan || item.bedenganCode || '-';
    const batch = item.batchNo || '-';
    const summary = `${formattedQty} Butir di Bedengan ${bedengan} (Batch: ${batch})`;

    const ditolakQty = parseInt(item.ditolak !== undefined ? item.ditolak : (item.jumlahDitolak || 0), 10) || 0;
    const alasanDitolak = item.alasanDitolak || item.alasan || '';
    const ditolakDisplay = ditolakQty > 0
      ? `${formatSafeNumber(ditolakQty)} Bibit${alasanDitolak && alasanDitolak !== 'Tidak Ada' ? ` (${alasanDitolak})` : ''}`
      : '0 Bibit';

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PENYEMAIAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PENYEMAIAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'seeding_transactions',
      display: {
        title: 'Penyemaian Benih',
        info: `Batch ${batch} · Bedengan ${bedengan}`,
        mainQty: `${formattedQty} Bibit`,
        unit: 'Bibit',
        fields: [
          { label: 'Program', value: item.program || '-' },
          { label: 'Batch', value: batch },
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: item.klonAwal || item.klon || '-' },
          { label: 'Total Disemai', value: `${formattedQty} Bibit`, highlight: true },
          { label: 'Total Polybag', value: `${formatSafeNumber(item.totalPolybag || 0)} Pkk` },
          { label: 'Bibit Ditolak', value: ditolakDisplay }
        ]
      }
    });
  });

  // 4. Dederan: dederan_transactions
  const dederans = storage.get('dederan_transactions', []);
  const seenDederIds = new Set();
  dederans.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenDederIds.has(id)) return;
    seenDederIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.DEDERAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `DED-${id}`;
    const actor = item.mantri || item.actorName || item.recordedBy || user?.name || 'Mantri Bibitan';
    const qty = item.jumlahDeder !== undefined ? item.jumlahDeder : (item.totalDeder || item.qty || 0);
    const formattedQty = formatSafeNumber(qty);
    const bedengan = item.bedenganCode || item.bedengan || '-';
    const klon = item.klon || item.varietas || '-';
    const summary = `${formattedQty} Butir Germinasi di Bedengan ${bedengan}`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.DEDERAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.DEDERAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'dederan_transactions',
      display: {
        title: 'Germinasi / Dederan',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: `${formattedQty} Butir Deder`,
        unit: 'Butir',
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Jumlah Deder', value: `${formattedQty} Butir`, highlight: true }
        ]
      }
    });
  });

  // 5. Entres Menunas: entres_menunas_transactions (dan entres_transactions type=MENUNAS)
  const allEntres = [
    ...storage.get('entres_menunas_transactions', []),
    ...storage.get('entres_transactions', []).filter(t => (t.activityType || t.type || '').toUpperCase() === 'MENUNAS')
  ];
  const seenMenunasIds = new Set();
  allEntres.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenMenunasIds.has(id)) return;
    seenMenunasIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.KEBUN_ENTRES, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `TUNAS-${id}`;
    const actor = item.mantri || item.actorName || item.mandor || user?.name || 'Mantri Bibitan';
    const qty = item.jumlahPohonDitunas !== undefined ? item.jumlahPohonDitunas : (item.jumlahPokok || item.jumlahTunas || item.qty || 0);
    const formattedQty = formatSafeNumber(qty);
    const plot = item.kodePlot || item.plotId || item.plotNo || '-';
    const klon = item.namaKlon || item.klon || '-';
    const summary = `${formattedQty} Pokok Ditunas di Plot ${plot} (Klon: ${klon})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.KEBUN_ENTRES,
      activityType: 'MENUNAS',
      referenceType: 'MENUNAS',
      moduleLabel: MODULE_LABELS[MODULE_TYPES.KEBUN_ENTRES],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'entres_menunas_transactions',
      display: {
        title: 'Entres Menunas',
        info: `Plot ${plot} · Klon ${klon}`,
        mainQty: `${formattedQty} Pokok Ditunas`,
        unit: 'Pkk',
        fields: [
          { label: 'Plot', value: plot },
          { label: 'Klon', value: klon },
          { label: 'Kebun Entres', value: item.budwoodCode || '-' },
          { label: 'Realisasi Ditunas', value: `${formattedQty} Pkk`, highlight: true }
        ]
      }
    });
  });

  // 6. Entres Topping: entres_topping_transactions (dan entres_transactions type=TOPPING)
  const allToppings = [
    ...storage.get('entres_topping_transactions', []),
    ...storage.get('entres_transactions', []).filter(t => (t.activityType || t.type || '').toUpperCase() === 'TOPPING')
  ];
  const seenToppingIds = new Set();
  allToppings.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenToppingIds.has(id)) return;
    seenToppingIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.KEBUN_ENTRES, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `TOP-${id}`;
    const actor = item.mantri || item.actorName || item.mandor || user?.name || 'Mantri Bibitan';
    const stik = item.jumlahKayu !== undefined ? item.jumlahKayu : (item.jumlahStik || 0);
    const perisai = item.jumlahPerisai !== undefined ? item.jumlahPerisai : 0;
    const formattedStik = formatSafeNumber(stik);
    const formattedPerisai = formatSafeNumber(perisai);
    const plot = item.kodePlot || item.plotId || item.plotNo || '-';
    const klon = item.namaKlon || item.klon || '-';
    const summary = `${formattedStik} Btg · ${formattedPerisai} Perisai di Plot ${plot} (Klon: ${klon})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.KEBUN_ENTRES,
      activityType: 'TOPPING',
      referenceType: 'TOPPING',
      moduleLabel: MODULE_LABELS[MODULE_TYPES.KEBUN_ENTRES],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'entres_topping_transactions',
      display: {
        title: 'Entres Topping',
        info: `Plot ${plot} · Klon ${klon}`,
        mainQty: `${formattedStik} Btg · ${formattedPerisai} Perisai`,
        unit: 'Btg/Perisai',
        fields: [
          { label: 'Plot', value: plot },
          { label: 'Klon', value: klon },
          { label: 'Kebun Entres', value: item.budwoodCode || '-' },
          { label: 'Jumlah Kayu', value: `${formattedStik} Btg`, highlight: true },
          { label: 'Panen Perisai (Mata Entres)', value: `${formattedPerisai} Perisai`, highlight: true }
        ]
      }
    });
  });

  // 7. Okulasi: budding_transactions
  const buddings = storage.get('budding_transactions', []);
  const seenBuddingIds = new Set();
  buddings.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenBuddingIds.has(id)) return;
    seenBuddingIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.OKULASI, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.nomorDokumen || item.id || `OKL-${id}`;
    const actor = item.mantri || item.actorName || item.okulator || user?.name || 'Mantri Bibitan';
    const qty = item.jumlah !== undefined ? item.jumlah : (item.qty || 0);
    const formattedQty = formatSafeNumber(qty);
    const typeLabel = item.type === 'REGRAFTING' ? 'Regrafting' : 'Grafting';
    const bedengan = item.bedengan || '-';
    const klon = item.klonEntres || item.klon || '-';
    const summary = `${formattedQty} Pkk (${typeLabel}) di Bedengan ${bedengan} (Klon: ${klon})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.OKULASI,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.OKULASI],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'budding_transactions',
      display: {
        title: 'Okulasi Bibitan',
        info: `${typeLabel} · Bedengan ${bedengan}`,
        mainQty: `${formattedQty} Pkk`,
        unit: 'Pkk',
        fields: [
          { label: 'Tipe Okulasi', value: typeLabel },
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon Entres', value: klon },
          { label: 'Klon Batang Bawah', value: item.klonRootstock || '-' },
          { label: 'Total Okulasi', value: `${formattedQty} Pkk`, highlight: true },
          { label: 'Mata Entres Digunakan', value: `${formatSafeNumber(item.jumlahMataEntres ?? item.jumlah)} Perisai`, highlight: true }
        ]
      }
    });
  });

  // 8. Pemeriksaan Okulasi: inspection_transactions
  const inspections = storage.get('inspection_transactions', []);
  const seenInspIds = new Set();
  inspections.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenInspIds.has(id)) return;
    seenInspIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PEMERIKSAAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `INSP-${id}`;
    const actor = item.mantri || item.actorName || item.inspektur || user?.name || 'Mantri Bibitan';
    const checked = Number(item.totalDiperiksa !== undefined ? item.totalDiperiksa : (item.qty || 0));
    const jadi = Number(item.jumlahJadi || 0);
    const gagal = Number(item.jumlahGagal !== undefined ? item.jumlahGagal : (checked >= jadi ? (checked - jadi) : 0));
    const pct = item.persenJadi !== undefined ? item.persenJadi : (checked > 0 ? Math.round((jadi / checked) * 100) : 0);
    const formattedChecked = formatSafeNumber(checked);
    const formattedJadi = formatSafeNumber(jadi);
    const formattedGagal = formatSafeNumber(gagal);
    const bedengan = item.bedengan || '-';
    const klon = item.klonEntres || '-';
    const summary = `Periksa: ${formattedChecked} Pkk, Jadi: ${formattedJadi} Pkk (${pct}%)`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PEMERIKSAAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PEMERIKSAAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'inspection_transactions',
      display: {
        title: 'Pemeriksaan Okulasi',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: `${formattedChecked} Diperiksa`,
        breakdown: `${formattedJadi} Berhasil, ${formattedGagal} Tidak Berhasil`,
        unit: 'Pkk',
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Total Diperiksa', value: `${formattedChecked} Pkk` },
          { label: 'Jumlah Berhasil', value: `${formattedJadi} Pkk`, highlight: true },
          { label: 'Jumlah Tidak Berhasil', value: `${formattedGagal} Pkk` },
          { label: 'Persentase Jadi', value: `${pct}%`, highlight: true }
        ]
      }
    });
  });

  // 9. Pemeriksaan Dederan: dederan_inspections
  const dederInspections = storage.get('dederan_inspections', []);
  const seenDederInspIds = new Set();
  dederInspections.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenDederInspIds.has(id)) return;
    seenDederInspIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PEMERIKSAAN_DEDERAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `DINSP-${id}`;
    const actor = item.mantri || item.actorName || item.inspektur || item.inspectorName || user?.name || 'Mantri Bibitan';
    const diperiksa = item.jumlahDiperiksa !== undefined ? item.jumlahDiperiksa : (item.totalDiperiksa || item.jumlahDeder || 0);
    const berhasil = item.jumlahBerhasil !== undefined ? item.jumlahBerhasil : (item.totalLayak || item.sproutNormal || item.jumlahLayak || 0);
    const tidakBerhasil = item.jumlahTidakBerhasil !== undefined ? item.jumlahTidakBerhasil : (item.totalAfkir || item.sproutAfkir || item.jumlahAfkir || 0);
    const formattedDiperiksa = formatSafeNumber(diperiksa);
    const formattedBerhasil = formatSafeNumber(berhasil);
    const formattedTidakBerhasil = formatSafeNumber(tidakBerhasil);
    const bedengan = item.bedenganCode || item.bedengan || '-';
    const klon = item.klon || '-';
    const summary = `Bedengan ${bedengan}: ${formattedDiperiksa} Diperiksa, ${formattedBerhasil} Berhasil, ${formattedTidakBerhasil} Tidak Berhasil`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PEMERIKSAAN_DEDERAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PEMERIKSAAN_DEDERAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'dederan_inspections',
      display: {
        title: 'Pemeriksaan Dederan',
        info: `Bedengan ${bedengan} · Klon ${klon}`,
        mainQty: `${formattedDiperiksa} Diperiksa`,
        breakdown: `${formattedBerhasil} Berhasil, ${formattedTidakBerhasil} Tidak Berhasil`,
        unit: 'Butir',
        fields: [
          { label: 'Bedengan', value: bedengan },
          { label: 'Klon', value: klon },
          { label: 'Total Diperiksa', value: `${formattedDiperiksa} Butir` },
          { label: 'Jumlah Berhasil', value: `${formattedBerhasil} Butir`, highlight: true },
          { label: 'Jumlah Tidak Berhasil', value: `${formattedTidakBerhasil} Butir` }
        ]
      }
    });
  });

  // 10. Seleksi Pra-Okulasi: pre_grafting_selection_documents
  const preGraftingDocs = storage.get('pre_grafting_selection_documents', []);
  const seenPreGraftIds = new Set();
  preGraftingDocs.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenPreGraftIds.has(id)) return;
    seenPreGraftIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.SELEKSI_PRA_OKULASI, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    // 1. UNIVERSAL EXECUTION GATE:
    // Seluruh dokumen Seleksi Pra-Okulasi I-III (apapun status lifecyclenya: READY_TO_CONFIRM,
    // SUBMITTED_TO_ASB, REVISION, maupun VERIFIED) WAJIB memiliki minimal 1 child execution transaction yang valid.
    const stageNorm = String(item.selectionStage || item.stage || '').trim().toUpperCase();
    const isStage3 = stageNorm === 'SELEKSI_III' || stageNorm === 'SELEKSI_3';
    const isStage2 = stageNorm === 'SELEKSI_II' || stageNorm === 'SELEKSI_2';
    const childTxs = isStage3
      ? getSeleksi3ExecutionsByDocument(item.id || item.docNo)
      : (isStage2
          ? getSeleksi2ExecutionsByDocument(item.id || item.docNo)
          : getSeleksi1ExecutionsByDocument(item.id || item.docNo));

    const hasValidExecutions = (Array.isArray(childTxs) && childTxs.length >= 1) ||
      (stat.status === MANTRI_TRANSACTION_STATUS.REVISION && Boolean(item.correctionExecutionId));
    if (!hasValidExecutions) {
      return;
    }

    // 2. READINESS GATE (Khusus status READY_TO_CONFIRM):
    // Dokumen baru hanya boleh masuk Central Hub sebagai READY_TO_CONFIRM jika
    // benar-benar sudah dinyatakan selesai (isCompleted === true AND status === 'COMPLETED').
    // Status non-READY_TO_CONFIRM (SUBMITTED_TO_ASB, REVISION, VERIFIED) tetap mengikuti flow existing.
    if (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM) {
      const isCompleted = item.isCompleted === true;
      const isCompletedStatus = String(item.status || '').trim().toUpperCase() === 'COMPLETED';
      if (!isCompleted || !isCompletedStatus) {
        return;
      }
    }

    // Satu dokumen induk dapat memiliki beberapa transaksi pelaksanaan fisik.
    // Jika lebih dari satu, Central Hub harus mempertahankan identitas setiap
    // nomor transaksi agar jumlah kartu sama dengan Ringkasan Transaksi.
    const hasMultipleExecutionTransactions = childTxs.length > 1 && childTxs.every(child =>
      String(child.transactionType || '').toUpperCase().startsWith('PELAKSANAAN_SELEKSI')
    );
    if (hasMultipleExecutionTransactions) {
      childTxs.forEach(child => {
        const childId = child.id || child.docNo || child.selectionNo;
        if (!childId) return;
        const childDate = extractBusinessDate(child) || bDate;
        const childStat = resolveTransactionStatus(child, MODULE_TYPES.SELEKSI_PRA_OKULASI, verifMap);
        const childOutstanding = childStat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || childStat.status === MANTRI_TRANSACTION_STATUS.REVISION;
        if (childDate !== todayStr && !childOutstanding) return;

        const childDocNo = child.docNo || child.selectionNo || String(childId);
        const childActor = child.createdByName || child.mantri || item.submittedByName || item.createdByName || user?.name || 'Mantri Bibitan';
        const childStage = getSelectionStageLabel(child);
        const childLayak = child.actualBibitRetainedQty !== undefined
          ? child.actualBibitRetainedQty
          : (child.bibitDipertahankan !== undefined ? child.bibitDipertahankan : (child.sessionBibitRetained !== undefined ? child.sessionBibitRetained : (child.jumlahLayak || 0)));
        const childAfkir = child.actualBibitSelectedQty !== undefined
          ? child.actualBibitSelectedQty
          : (child.bibitReject !== undefined ? child.bibitReject : (child.jumlahAfkir || 0));
        const childDiperiksa = child.actualPolybagInspectedQty !== undefined
          ? child.actualPolybagInspectedQty
          : (child.jumlahDiperiksa !== undefined ? child.jumlahDiperiksa : (child.polybagScope || 0));
        const childBatch = child.batchCode || item.batchCode || '-';
        const childBedengan = child.bedenganCode || child.bedengan || item.bedengan || '-';
        const childRaw = {
          ...child,
          parentSelectionDocumentId: child.parentSelectionDocumentId || item.id,
          parentSelectionDocNo: child.parentSelectionDocNo || item.docNo
        };

        normalizedList.push({
          id: String(childId),
          docNo: childDocNo,
          moduleType: MODULE_TYPES.SELEKSI_PRA_OKULASI,
          moduleLabel: MODULE_LABELS[MODULE_TYPES.SELEKSI_PRA_OKULASI],
          date: childDate,
          actor: childActor,
          summary: `${childStage}: ${formatSafeNumber(childLayak)} Layak, ${formatSafeNumber(childAfkir)} Afkir (Batch: ${childBatch})`,
          status: childStat.status,
          verificationStatus: childStat.verificationStatus,
          rawRecord: childRaw,
          storageKey: 'selection_transactions',
          display: {
            title: `Pemeriksaan Pra-Okulasi (${childStage})`,
            info: `Batch ${childBatch} · Bedengan ${childBedengan}`,
            mainQty: `${formatSafeNumber(childLayak)} Layak`,
            unit: 'Pkk',
            fields: [
              { label: 'Tahap Seleksi', value: childStage },
              { label: 'Batch', value: childBatch },
              { label: 'Bedengan', value: childBedengan },
              { label: 'Populasi Diperiksa', value: `${formatSafeNumber(childDiperiksa)} Ply` },
              { label: 'Bibit Layak', value: `${formatSafeNumber(childLayak)} Pkk`, highlight: true },
              { label: 'Bibit Afkir', value: `${formatSafeNumber(childAfkir)} Pkk` }
            ]
          }
        });
      });
      return;
    }

    const docNo = item.docNo || item.selectionDocNo || item.id || `PRE-${id}`;
    const actor = item.submittedByName || item.createdByName || item.mantri || user?.name || 'Mantri Bibitan';
    const stage = getSelectionStageLabel(item);
    const layak = item.totalLayak !== undefined ? item.totalLayak : (item.finalBibitQty || 0);
    const afkir = item.totalAfkir !== undefined ? item.totalAfkir : (item.rejectedBibitQty || 0);
    const diperiksa = item.totalDiperiksa !== undefined ? item.totalDiperiksa : (Number(layak) + Number(afkir));
    const formattedLayak = formatSafeNumber(layak);
    const formattedAfkir = formatSafeNumber(afkir);
    const formattedDiperiksa = formatSafeNumber(diperiksa);
    const batch = item.batchCode || '-';
    const bedengan = item.bedengan || '-';
    const summary = `${stage}: ${formattedLayak} Layak, ${formattedAfkir} Afkir (Batch: ${batch})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.SELEKSI_PRA_OKULASI,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.SELEKSI_PRA_OKULASI],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'pre_grafting_selection_documents',
      display: {
        title: `Pemeriksaan Pra-Okulasi (${stage})`,
        info: `Batch ${batch} · Bedengan ${bedengan}`,
        mainQty: `${formattedLayak} Layak`,
        unit: 'Pkk',
        fields: [
          { label: 'Tahap Seleksi', value: stage },
          { label: 'Batch', value: batch },
          { label: 'Bedengan', value: bedengan },
          { label: 'Populasi Diperiksa', value: `${formattedDiperiksa} Pkk` },
          { label: 'Bibit Layak', value: `${formattedLayak} Pkk`, highlight: true },
          { label: 'Bibit Afkir', value: `${formattedAfkir} Pkk` }
        ]
      }
    });
  });

  // 11. Penyeleksian (Sesi / Pasca-Okulasi): selection_transactions
  const selections = storage.get('selection_transactions', []);
  const seenSelectionIds = new Set();
  selections.forEach(item => {
    if (['DIBATALKAN', 'DITARIK', 'WITHDRAWN'].includes(String(item?.status || item?.verificationStatus || '').toUpperCase())) return;
    const id = item.id || item.docNo || item.selectionNo;
    if (!id || seenSelectionIds.has(id)) return;
    seenSelectionIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PENYELEKSIAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    // CULL declarations for Seleksi Pra-Okulasi also carry parent document IDs.
    // Keep those declarations in the hub; exclude only physical execution rows.
    const isCullDeclaration = isCullDocNo(item.docNo) || isCullDocNo(item.selectionNo) || isCullDocNo(item.selectionPoolDocNo);
    const isChildExecution = !isCullDeclaration && (
      (item.transactionType && String(item.transactionType).startsWith('PELAKSANAAN_SELEKSI')) ||
      Boolean(item.parentSelectionDocumentId || item.parentSelectionDocNo) ||
      (item.selectionStage && ['SELEKSI_I', 'SELEKSI_1', 'SELEKSI_II', 'SELEKSI_2', 'SELEKSI_III', 'SELEKSI_3'].includes(String(item.selectionStage).toUpperCase()))
    );
    if (isChildExecution) return;

    const docNo = item.docNo || item.selectionNo || item.id || `SEL-${id}`;
    const actor = item.mantri || item.createdByName || item.actorName || user?.name || 'Mantri Bibitan';
    let layak = item.actualBibitRetainedQty !== undefined ? item.actualBibitRetainedQty : (item.bibitDipertahankan !== undefined ? item.bibitDipertahankan : (item.jumlahLayak || 0));
    const afkir = item.actualBibitSelectedQty !== undefined ? item.actualBibitSelectedQty : (item.bibitReject !== undefined ? item.bibitReject : (item.jumlahAfkir || 0));

    const docNoStr = String(docNo).toUpperCase();
    const isDederan = item.originType === 'REJECT_DEDERAN' || item.sourceModule === 'DEDERAN' || docNoStr.includes('/CULL/DDR/');
    if (isDederan && Number(layak) === 0) {
      const allDederIns = storage.get('dederan_inspections', []);
      const matchingIns = allDederIns.find(i =>
        (item.sourceTransactionId && (i.id === item.sourceTransactionId || i.docNo === item.sourceTransactionId)) ||
        (item.sourceDocNo && (i.docNo === item.sourceDocNo || i.dederanTxDocNo === item.sourceDocNo)) ||
        (item.dederanDocNo && (i.docNo === item.dederanDocNo || i.dederanTxDocNo === item.dederanDocNo)) ||
        (item.bedenganCode && (i.bedenganCode === item.bedenganCode || i.bedenganId === item.bedenganCode)) ||
        (item.bedengan && (i.bedenganCode === item.bedengan || i.bedenganId === item.bedengan))
      );
      if (matchingIns) {
        const allDederTxs = storage.get('dederan_transactions', []);
        const dederTx = allDederTxs.find(t => t.docNo === (matchingIns.dederanTxDocNo || matchingIns.docNo) || t.id === matchingIns.dederanTxId);
        if (dederTx) {
          const summary = getBedenganInspectionSummary(dederTx);
          if (summary && summary.totalBerhasil > 0) layak = summary.totalBerhasil;
          else if (matchingIns.jumlahBerhasil !== undefined && Number(matchingIns.jumlahBerhasil) > 0) layak = matchingIns.jumlahBerhasil;
        } else if (matchingIns.jumlahBerhasil !== undefined && Number(matchingIns.jumlahBerhasil) > 0) {
          layak = matchingIns.jumlahBerhasil;
        }
      } else {
        const allDederTxs = storage.get('dederan_transactions', []);
        const dederTx = allDederTxs.find(t =>
          (item.bedenganCode && (t.bedenganCode === item.bedenganCode || t.bedenganId === item.bedenganCode)) ||
          (item.bedengan && (t.bedenganCode === item.bedengan || t.bedenganId === item.bedengan))
        );
        if (dederTx) {
          const summary = getBedenganInspectionSummary(dederTx);
          if (summary && summary.totalBerhasil > 0) layak = summary.totalBerhasil;
        }
      }
    }

    const formattedLayak = formatSafeNumber(layak);
    const formattedAfkir = formatSafeNumber(afkir);
    const stageLabel = getSelectionStageLabel(item);
    const reasonCandidates = [
      item.alasanDitolakCategory,
      item.alasanAfkir,
      item.kategoriAfkir,
      item.category,
      item.alasanDetail,
      item.alasan,
      item.rejectSourceReference?.reason,
      item.reason
    ];
    const stageLower = String(stageLabel || item.stage || item.selectionStage || '').trim().toLowerCase();
    const isStageLabel = (val) => {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      return s === stageLower ||
        s.includes('seleksi pra-semai') ||
        s.includes('seleksi pra-okulasi') ||
        s.includes('seleksi pasca-okulasi') ||
        ['seleksi_pra_semai', 'seleksi_1', 'seleksi_i', 'seleksi_2', 'seleksi_ii', 'seleksi_3', 'seleksi_iii', 'seleksi_pasca_okulasi'].includes(s);
    };

    let reason = '-';
    let foundCandidate = null;
    for (const cand of reasonCandidates) {
      if (!cand) continue;
      const s = String(cand).trim();
      if (s && s !== '-' && s.toLowerCase() !== 'tidak ada' && !isStageLabel(s)) {
        foundCandidate = s;
        break;
      }
    }

    if (foundCandidate) {
      reason = getSelectionCategoryLabel({ ...item, category: foundCandidate, alasan: foundCandidate }) || foundCandidate;
    } else {
      const catLabel = getSelectionCategoryLabel(item);
      if (catLabel && catLabel !== 'Afkir' && !isStageLabel(catLabel)) {
        reason = catLabel;
      } else if (afkir && Number(afkir) > 0) {
        reason = 'Afkir';
      } else {
        reason = '-';
      }
    }
    const bedengan = item.bedengan || item.lokasi || '-';
    const summary = `${stageLabel}: ${formattedLayak} Layak, ${formattedAfkir} Afkir`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PENYELEKSIAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PENYELEKSIAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'selection_transactions',
      display: {
        title: 'Penyeleksian Bibit',
        info: `Kategori ${reason} · Bedengan ${bedengan}`,
        mainQty: `${formattedAfkir} Bibit Afkir`,
        unit: 'Pkk',
        fields: [
          { label: 'Tahap Seleksi', value: stageLabel },
          { label: 'Kategori / Alasan Afkir', value: reason },
          { label: 'Bedengan / Lokasi', value: bedengan },
          { label: 'Bibit Afkir (Selected)', value: `${formattedAfkir} Pkk`, highlight: true },
          { label: 'Bibit Dipertahankan', value: `${formattedLayak} Pkk` }
        ]
      }
    });
  });

  // 12. Rekam Pemeliharaan: nursery_activity_transactions & nursery_activity_records
  const activities = [
    ...storage.get('nursery_activity_transactions', []).map(item => ({ item, storageKey: 'nursery_activity_transactions' })),
    ...storage.get('nursery_activity_records', []).map(item => ({ item, storageKey: 'nursery_activity_records' }))
  ];
  const seenActivityIds = new Set();
  activities.forEach(({ item, storageKey }) => {
    const id = item.id || item.docNo;
    if (!id || seenActivityIds.has(id)) return;
    seenActivityIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PEMELIHARAAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `ACT-${id}`;
    const actor = item.mantri || item.actorName || item.mandor || user?.name || 'Mantri Bibitan';
    const actName = item.aktivitas?.nama || item.activityType || 'Pemeliharaan';
    const workerResults = Array.isArray(item.pekerja) ? item.pekerja : [];
    const hasWorkerResults = workerResults.some(worker => worker.inputHasil !== undefined || worker.result !== undefined || worker.quantity !== undefined);
    const vol = hasWorkerResults
      ? workerResults.reduce((total, worker) => total + (Number(worker.inputHasil ?? worker.result ?? worker.quantity) || 0), 0)
      : item.volumePkk !== undefined ? item.volumePkk : (item.aktivitas?.volume !== undefined ? item.aktivitas?.volume : (item.volume || item.qty || 0));
    const formattedVol = formatSafeNumber(vol);
    const loc = item.bedengan || item.location || item.lokasiBlok || item.blok || '-';
    const uom = item.uomCode || item.uom || item.aktivitas?.uom || 'Pkk';
    const roleCode = item.workGroupRoleCode || item.workGroup?.workGroupRoleCode || '';
    const summary = `${actName}${roleCode ? ` - ${roleCode}` : ''} - Bedengan: ${loc} (${formattedVol} ${uom})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PEMELIHARAAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PEMELIHARAAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey,
      display: {
        title: 'Rekam Pemeliharaan',
        info: `${actName} · Bedengan ${loc}`,
        mainQty: `${formattedVol} ${uom}`,
        unit: uom,
        fields: [
          ...(roleCode ? [{ label: 'Work Group Role Code', value: roleCode }] : []),
          { label: 'Jenis Pemeliharaan', value: item.allocationName || actName },
          { label: 'Lokasi / Bedengan', value: loc },
          { label: 'Volume Realisasi', value: `${formattedVol} ${uom}`, highlight: true }
        ]
      }
    });
  });

  // 13. Pengeluaran: dispatch_transactions
  const dispatches = storage.get('dispatch_transactions', []);
  const seenDispatchIds = new Set();
  dispatches.forEach(item => {
    const id = item.id || item.docNo || item.dispatchId;
    if (!id || seenDispatchIds.has(id)) return;
    seenDispatchIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.PENGELUARAN, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.dispatchNo || item.id || `DSP-${id}`;
    const actor = item.mantri || item.dispatcher || item.actorName || item.issuedByName || user?.name || 'Mantri Bibitan';
    const transactionType = String(item.transactionType || '').toUpperCase();
    const isMataEntres = transactionType.includes('MATA_ENTRES') ||
      String(item.type || '').toUpperCase() === 'MATA_ENTRES' ||
      item.jumlahMataEntresDikeluarkan !== undefined ||
      item.details?.some(detail => detail?.mataQty !== undefined);
    const clone = item.clone || item.klon || item.details?.[0]?.klon || '-';
    const destination = isMataEntres
      ? (item.sourceEstateName || item.sourceEstateId || item.requesterEstate || item.requesterEstateId || item.targetNextEstateName || item.targetNextEstateId || '-')
      : (item.targetEstateName || item.targetEstateId || item.destination || item.targetDivisionName || item.targetDivisionId || item.targetDivision || '-');
    const source = isMataEntres
      ? (item.dispatchedFromEstateName || item.estateName || item.targetEstateName || item.dispatchedFromEstateId || item.estateId || item.targetEstateId || '-')
      : (item.sourceEstateName || item.sourceEstateId || item.dispatchedFromEstateName || item.dispatchedFromEstateId || item.estateName || item.estateId || '-');
    const issuedQty = isMataEntres
      ? (item.jumlahMataEntresDikeluarkan ?? item.details?.reduce((total, detail) => total + (Number(detail?.mataQty) || 0), 0) ?? item.issuedQty ?? 0)
      : (item.issuedQty ?? item.qtyDispatched ?? item.quantity ?? item.qty ?? item.totalBatang ?? 0);
    const unit = isMataEntres ? 'Mata' : 'Pkk';
    const formattedQty = formatSafeNumber(issuedQty);
    const title = isMataEntres ? 'Pengeluaran Mata Entres' : 'Pengeluaran Bibit';
    const summary = `${title}: ${formattedQty} ${unit} dari ${source} ke ${destination} (Klon: ${clone})`;
    const mataStemQty = item.jumlahBatangDikeluarkan ?? item.details?.reduce((total, detail) => total + (Number(detail?.qty) || 0), 0);

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.PENGELUARAN,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.PENGELUARAN],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'dispatch_transactions',
      display: {
        title,
        info: isMataEntres ? `Asal ${source} · Tujuan ${destination} · Klon ${clone}` : `Tujuan ${destination} · Klon ${clone}`,
        mainQty: `${formattedQty} ${unit}`,
        unit,
        fields: isMataEntres ? [
          { label: 'No. Permintaan', value: item.parentRequestDocNo || '-' },
          { label: 'Klon', value: clone },
          { label: 'Kebun Asal', value: source },
          { label: 'Kebun Tujuan', value: destination },
          { label: 'Jumlah Mata Entres', value: `${formattedQty} Mata`, highlight: true },
          ...(mataStemQty !== undefined ? [{ label: 'Jumlah Batang', value: `${formatSafeNumber(mataStemQty)} Batang` }] : []),
          { label: 'Kendaraan / Plat', value: item.vehiclePlate || '-' }
        ] : [
          { label: 'No. Permintaan', value: item.parentRequestDocNo || '-' },
          { label: 'Klon', value: clone },
          { label: 'Kebun Tujuan', value: destination },
          ...(item.targetDivisionName || item.targetDivisionId ? [{ label: 'Divisi Tujuan', value: item.targetDivisionName || item.targetDivisionId }] : []),
          { label: 'Jumlah Bibit', value: `${formattedQty} Pkk`, highlight: true },
          { label: 'Kendaraan / Plat', value: item.vehiclePlate || '-' }
        ]
      }
    });
  });

  // 14. Material: seeding_transactions (Canonical Pindah Semai / SOW usage) & material_usage_transactions
  const seedingMaterialTxs = storage.get('seeding_transactions', []).filter(item => {
    const hasIssueDoc = Boolean(String(item.issueDocNo || item.noIssue || '').trim());
    const polyQty = Number(item.totalPolybag !== undefined ? item.totalPolybag : (item.rows?.[0]?.polybag || 0));
    return hasIssueDoc && polyQty > 0;
  });

  const legacyMaterials = [
    ...storage.get('material_usage_transactions', [])
  ];

  const seenMaterialIds = new Set();

  // 14.A Canonical SOW Material Usages
  seedingMaterialTxs.forEach(item => {
    const id = item.docNo || item.id;
    if (!id || seenMaterialIds.has(id)) return;
    seenMaterialIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.MATERIAL, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `MAT-${id}`;
    const actor = item.mantri || item.actorName || item.createdByName || user?.name || 'Mantri Bibitan';
    const qty = Number(item.totalPolybag !== undefined ? item.totalPolybag : (item.rows?.[0]?.polybag || 0));
    const formattedQty = formatSafeNumber(qty);
    const unit = item.uom || item.satuan || 'LBR';
    const matName = item.itemName || item.materialName || 'Biaya Polybag';
    const issueDoc = item.issueDocNo || item.noIssue || '-';
    const batch = item.batchCode || item.batchNo || '-';
    const bedengan = item.bedenganCode || item.bedengan || '-';
    const summary = `${matName}: ${formattedQty} ${unit} (SOW: ${docNo}, Issue: ${issueDoc})`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.MATERIAL,
      sourceModule: 'material',
      sourceTransactionType: 'PINDAH_SEMAI_MATERIAL',
      referenceType: 'MATERIAL',
      referenceId: docNo,
      referenceDocNo: docNo,
      issueDocNo: issueDoc,
      itemCode: item.itemCode || item.kodeItem || '',
      itemName: matName,
      quantityUsed: qty,
      uom: unit,
      batchId: item.batchId || null,
      batchCode: batch,
      bedenganId: item.bedenganId || null,
      bedenganCode: bedengan,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.MATERIAL],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'seeding_transactions',
      display: {
        title: 'Material & Bahan (Pindah Semai)',
        info: `${matName} · Dok. Issue: ${issueDoc}`,
        mainQty: `${formattedQty} ${unit}`,
        unit,
        fields: [
          { label: 'Nama Material', value: matName },
          { label: 'No. Dokumen Issue', value: issueDoc },
          { label: 'Dokumen SOW', value: docNo },
          { label: 'Batch', value: batch },
          { label: 'Bedengan', value: bedengan },
          { label: 'Jumlah Digunakan', value: `${formattedQty} ${unit}`, highlight: true }
        ]
      }
    });
  });

  // 14.B Standalone Legacy Materials
  legacyMaterials.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenMaterialIds.has(id)) return;
    seenMaterialIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.MATERIAL, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.id || `MAT-${id}`;
    const actor = item.mantri || item.actorName || user?.name || 'Mantri Bibitan';
    const qty = item.qty !== undefined ? item.qty : (item.quantity !== undefined ? item.quantity : (item.qtyOut !== undefined ? item.qtyOut : (item.currentStock || 0)));
    const formattedQty = formatSafeNumber(qty);
    const unit = item.unit || item.satuan || 'Unit';
    const matName = item.materialName || item.itemName || item.name || 'Material';
    const category = item.category || item.kategori || 'Umum';
    const summary = `${matName}: ${formattedQty} ${unit}`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.MATERIAL,
      sourceModule: 'material',
      sourceTransactionType: item.sourceTransactionType || 'MATERIAL_USAGE',
      referenceType: 'MATERIAL',
      referenceId: docNo,
      referenceDocNo: docNo,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.MATERIAL],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'material_usage_transactions',
      display: {
        title: 'Material & Bahan',
        info: `${matName} · ${category}`,
        mainQty: `${formattedQty} ${unit}`,
        unit,
        fields: [
          { label: 'Nama Material', value: matName },
          { label: 'Kategori', value: category },
          { label: 'Jumlah Digunakan', value: `${formattedQty} ${unit}`, highlight: true }
        ]
      }
    });
  });

  // 15. Simulasi Issue Gudang: warehouse_issue_simulations
  const warehouseIssues = storage.get('warehouse_issue_simulations', []);
  const seenWarehouseIds = new Set();
  warehouseIssues.forEach(item => {
    const id = item.id || item.docNo;
    if (!id || seenWarehouseIds.has(id)) return;
    seenWarehouseIds.add(id);

    const bDate = extractBusinessDate(item);
    const isToday = (bDate === todayStr);
    const stat = resolveTransactionStatus(item, MODULE_TYPES.SIMULASI_GUDANG, verifMap);
    const isOutstanding = (stat.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || stat.status === MANTRI_TRANSACTION_STATUS.REVISION);
    if (!isToday && !isOutstanding) return;
    if (!matchActor(item, user)) return;

    const docNo = item.docNo || item.issueDocNo || item.id || `WHS-${id}`;
    const actor = item.mantri || item.actorName || user?.name || 'Mantri Bibitan';
    const qty = item.qty !== undefined ? item.qty : (item.quantity || 0);
    const formattedQty = formatSafeNumber(qty);
    const unit = item.unit || 'Unit';
    const itemName = item.itemName || item.materialName || '-';
    const issueDoc = item.issueDocNo || item.docNo || '-';
    const summary = `Issue ${itemName}: ${formattedQty} ${unit}`;

    normalizedList.push({
      id: String(id),
      docNo,
      moduleType: MODULE_TYPES.SIMULASI_GUDANG,
      moduleLabel: MODULE_LABELS[MODULE_TYPES.SIMULASI_GUDANG],
      date: bDate,
      actor,
      summary,
      status: stat.status,
      verificationStatus: stat.verificationStatus,
      rawRecord: item,
      storageKey: 'warehouse_issue_simulations',
      display: {
        title: 'Simulasi Issue Gudang',
        info: `No ${issueDoc} · ${itemName}`,
        mainQty: `${formattedQty} ${unit}`,
        unit,
        fields: [
          { label: 'No. Issue Gudang', value: issueDoc },
          { label: 'Nama Item / Barang', value: itemName },
          { label: 'Jumlah Issue', value: `${formattedQty} ${unit}`, highlight: true }
        ]
      }
    });
  });

  // Enrich all normalized items with latestVerification & submittedAt from verifMap and rawRecord,
  // serta derived submission window metadata (Global Submission Cutoff Engine)
  normalizedList.forEach(tx => {
    const v = verifMap.get(String(tx.id)) || verifMap.get(String(tx.docNo));
    if (v) {
      tx.latestVerification = v;
      if (v.submittedAt && !tx.submittedAt) {
        tx.submittedAt = v.submittedAt;
      }
    }
    if (!tx.submittedAt) {
      tx.submittedAt = tx.rawRecord?.submittedAt || tx.rawRecord?.confirmedAt || tx.rawRecord?.updatedAt || null;
    }

    const windowInfo = getSubmissionWindowInfo(tx, currentTime);
    tx.businessDate = windowInfo.businessDate || tx.date;
    tx.submissionDeadline = windowInfo.submissionDeadline;
    tx.submissionDeadlineDate = windowInfo.submissionDeadlineDate;
    tx.isSubmissionExpired = windowInfo.isSubmissionExpired;
    tx.canSubmit = windowInfo.canSubmit;
    tx.submissionWindowStatus = windowInfo.submissionWindowStatus;
  });

  return normalizedList;
}

/**
 * Service Submission: Mengirim satu atau beberapa transaksi Mantri ke Asisten Bibitan
 * Menghasilkan data audit di `verification_transactions` secara idempotent (mencegah duplicate).
 * Action Gate: Menolak transaksi yang expired / canSubmit === false.
 */
export function submitMantriTransactions(transactionIds = [], userContext = null, moduleTypeFilter = null, currentTime = null) {
  const user = userContext || getCurrentUserContext() || resolveUserContext();
  // GLOBAL ATTENDANCE GATE
  assertAttendanceGateOrThrow(user);

  const allToday = getMantriTodayTransactions(user, null, currentTime);

  const targetItems = (transactionIds.length > 0
    ? allToday.filter(tx => {
        const idMatches = transactionIds.includes(tx.id) || transactionIds.includes(tx.docNo);
        const modMatches = !moduleTypeFilter || tx.moduleType === moduleTypeFilter;
        return idMatches && modMatches;
      })
    : allToday.filter(tx => !moduleTypeFilter || tx.moduleType === moduleTypeFilter)
  ).filter(tx => {
    const isPendingStatus = (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || tx.status === MANTRI_TRANSACTION_STATUS.REVISION);
    const windowInfo = getSubmissionWindowInfo(tx, currentTime);
    return isPendingStatus && windowInfo.canSubmit;
  });

  if (targetItems.length === 0) {
    return {
      success: true,
      submittedCount: 0,
      submittedItems: [],
      message: 'Tidak ada transaksi baru yang perlu dikirim ke Asisten.'
    };
  }

  const nowIso = (currentTime instanceof Date ? currentTime : (currentTime ? new Date(currentTime) : new Date())).toISOString();
  const allVerifs = storage.get(VERIFICATION_STORAGE_KEY, []);
  const submittedItems = [];

  targetItems.forEach(tx => {
    // 1. Update status pada data raw source
    if (tx.moduleType === MODULE_TYPES.SELEKSI_PRA_OKULASI && tx.storageKey === 'pre_grafting_selection_documents') {
      const preDocs = storage.get('pre_grafting_selection_documents', []);
      const pIdx = preDocs.findIndex(d => d.id === tx.id || d.docNo === tx.docNo);
      if (pIdx !== -1) {
        preDocs[pIdx].status = 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN';
        preDocs[pIdx].verificationStatus = 'MENUNGGU_VERIFIKASI';
        preDocs[pIdx].returnReason = null;
        preDocs[pIdx].isCorrected = true;
        preDocs[pIdx].submittedAt = nowIso;
        preDocs[pIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
        preDocs[pIdx].submittedByName = user?.name || 'Mantri Bibitan';
        storage.set('pre_grafting_selection_documents', preDocs);
      }
      try {
        submitPreGraftingSelectionDocumentToAsisten(tx.id, user);
      } catch (err) {
        // status already updated in pre_grafting_selection_documents above
      }
    } else if (tx.storageKey) {
      const records = storage.get(tx.storageKey, []);
      const rIdx = records.findIndex(r =>
        (r.id && String(r.id) === String(tx.id)) ||
        (r.docNo && String(r.docNo) === String(tx.id)) ||
        (tx.docNo && r.docNo && String(r.docNo) === String(tx.docNo))
      );
      if (rIdx !== -1) {
        if (tx.moduleType === MODULE_TYPES.MATERIAL) {
          records[rIdx].materialSubmissionStatus = 'SUBMITTED_TO_ASB';
          records[rIdx].materialSubmittedAt = nowIso;
        } else {
          records[rIdx].status = 'MENUNGGU_VERIFIKASI';
          records[rIdx].submissionStatus = 'SUBMITTED_TO_ASB';
          records[rIdx].returnReason = null;
          records[rIdx].isCorrected = true;
          records[rIdx].submittedAt = nowIso;
          if (tx.moduleType === MODULE_TYPES.PEMELIHARAAN && Array.isArray(records[rIdx].pekerja)) {
            records[rIdx].pekerja = records[rIdx].pekerja.map((worker) => ({
              ...worker,
              asistenVerificationStatus: null,
              asistenReturnReason: '',
              asistenVerifiedByUserId: null,
              asistenVerifiedByName: null,
              asistenVerifiedAt: null
            }));
          }
        }
        records[rIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
        records[rIdx].submittedByName = user?.name || 'Mantri Bibitan';
        storage.set(tx.storageKey, records);
      }
    }

    // 2. Buat / perbarui catatan di verification_transactions secara IDEMPOTENT
    const targetType = (tx.referenceType || tx.moduleType || '').toUpperCase();
    const existingIdx = allVerifs.findIndex(v => {
      const isSameRef = ((v.referenceId && String(v.referenceId) === String(tx.id)) ||
        (v.referenceDocNo && String(v.referenceDocNo) === String(tx.docNo)));
      const vType = (v.referenceType || v.moduleType || '').toUpperCase();
      const isSameType = (vType === targetType);
      return isSameRef && isSameType;
    });

    if (existingIdx !== -1) {
      allVerifs[existingIdx].verificationStatus = VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;
      allVerifs[existingIdx].returnReason = null;
      allVerifs[existingIdx].isRevision = true;
      allVerifs[existingIdx].submittedAt = nowIso;
      allVerifs[existingIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
      allVerifs[existingIdx].submittedByName = user?.name || 'Mantri Bibitan';
      allVerifs[existingIdx].updatedAt = nowIso;
      if (tx.moduleType === MODULE_TYPES.PEMELIHARAAN) {
        allVerifs[existingIdx].workerDecisions = {};
      }
    } else {
      const vNo = `VRF-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
      allVerifs.push({
        verificationId: `VRF-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        verificationNo: vNo,
        referenceType: tx.referenceType || tx.activityType || tx.moduleType,
        referenceId: tx.id,
        referenceDocNo: tx.docNo,
        moduleType: tx.moduleType,
        sourceModule: tx.sourceModule || (tx.moduleType === MODULE_TYPES.MATERIAL ? 'material' : undefined),
        sourceTransactionType: tx.sourceTransactionType || (tx.moduleType === MODULE_TYPES.MATERIAL ? 'PINDAH_SEMAI_MATERIAL' : undefined),
        issueDocNo: tx.issueDocNo || tx.rawRecord?.issueDocNo || null,
        itemCode: tx.itemCode || tx.rawRecord?.itemCode || null,
        itemName: tx.itemName || tx.rawRecord?.itemName || null,
        quantityUsed: tx.quantityUsed !== undefined ? tx.quantityUsed : (tx.rawRecord?.totalPolybag || null),
        uom: tx.uom || tx.rawRecord?.uom || null,
        batchCode: tx.batchCode || tx.rawRecord?.batchCode || tx.rawRecord?.batchNo || null,
        bedenganCode: tx.bedenganCode || tx.rawRecord?.bedenganCode || tx.rawRecord?.bedengan || null,
        estateId: tx.rawRecord?.targetEstateId || tx.rawRecord?.estateId || tx.rawRecord?.sourceEstateId || user?.estateId || 'EST-TBS',
        divisionId: tx.rawRecord?.targetDivisionId || tx.rawRecord?.divisionId || tx.rawRecord?.sourceDivisionId || user?.divisionId || 'DIV-001',
        verificationStatus: VERIFICATION_STATUS.MENUNGGU_VERIFIKASI,
        findings: [],
        notes: '',
        submittedByUserId: user?.id || user?.userId || 'MANTRI',
        submittedByName: user?.name || 'Mantri Bibitan',
        submittedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }

    submittedItems.push(tx);
  });

  storage.set(VERIFICATION_STORAGE_KEY, allVerifs);

  return {
    success: true,
    submittedCount: submittedItems.length,
    submittedItems,
    message: `${submittedItems.length} transaksi berhasil dikirim ke Asisten Bibitan untuk verifikasi.`
  };
}

/**
 * Service Submission per Modul: Mengirim seluruh transaksi eligible dalam 1 modul ke Asisten Bibitan.
 * Memastikan pengiriman atomik di level modul tanpa menghilangkan identitas transaksi individual.
 * Action Gate: Menolak pengiriman bila seluruh transaksi pada modul expired.
 * 
 * @param {string} moduleType - Kode modul (e.g. 'PENERIMAAN', 'PENYEMAIAN', etc.)
 * @param {object|null} userContext - Logged-in user context
 * @param {Date|string|number} [currentTime=null] - Waktu evaluasi (opsional)
 */
export function submitModuleTransactions(moduleType, userContext = null, currentTime = null) {
  if (!moduleType) {
    return {
      success: false,
      submittedCount: 0,
      submittedItems: [],
      message: 'Kode modul tidak valid.'
    };
  }

  const user = userContext || getCurrentUserContext() || resolveUserContext();
  const allToday = getMantriTodayTransactions(user, null, currentTime);

  const targetModuleTxs = allToday.filter(tx => 
    String(tx.moduleType).toUpperCase() === String(moduleType).toUpperCase() &&
    (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || tx.status === MANTRI_TRANSACTION_STATUS.REVISION) &&
    getSubmissionWindowInfo(tx, currentTime).canSubmit
  );

  if (targetModuleTxs.length === 0) {
    const modLabel = MODULE_LABELS[moduleType] || moduleType;
    return {
      success: true,
      submittedCount: 0,
      submittedItems: [],
      message: `Tidak ada transaksi baru pada modul ${modLabel} yang memenuhi syarat untuk dikirim ke Asisten.`
    };
  }

  const txIds = targetModuleTxs.map(tx => tx.id);
  const result = submitMantriTransactions(txIds, user, moduleType, currentTime);
  const modLabel = MODULE_LABELS[moduleType] || moduleType;

  return {
    ...result,
    moduleType,
    moduleLabel: modLabel,
    message: `${result.submittedCount} transaksi ${modLabel} berhasil dikirim ke Asisten Bibitan untuk verifikasi.`
  };
}

/**
 * Service Submission Data Lewat Waktu: Mengirim seluruh transaksi lewat waktu pada tanggal tertentu ke Asisten Bibitan.
 * 
 * @param {string} targetDate - Tanggal bisnis target format DD/MM/YYYY atau YYYY-MM-DD
 * @param {object|null} [userContext=null] - Logged-in user context
 * @param {Date|string|number} [currentTime=null] - Waktu eksekusi
 * @returns {object} Result payload { success, submittedCount, submittedItems, message }
 */
export function submitOverdueTransactionsByDate(targetDate, userContext = null, currentTime = null) {
  if (!targetDate || targetDate === 'ALL') {
    return {
      success: false,
      submittedCount: 0,
      submittedItems: [],
      message: 'Silakan pilih tanggal spesifik untuk mengirimkan data lewat waktu.'
    };
  }

  const user = userContext || getCurrentUserContext() || resolveUserContext();
  // Global Attendance Gate (wajib presensi datang hari ini untuk mengirimkan tugas)
  assertAttendanceGateOrThrow(user);

  const normTarget = normalizeDateStr(targetDate);
  const allTxs = getMantriTodayTransactions(user, null, currentTime);

  const targetItems = allTxs.filter(tx => {
    const isPending = (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || tx.status === MANTRI_TRANSACTION_STATUS.REVISION);
    const dateMatches = (normalizeDateStr(tx.date) === normTarget);
    return isPending && tx.isSubmissionExpired && dateMatches;
  });

  if (targetItems.length === 0) {
    return {
      success: true,
      submittedCount: 0,
      submittedItems: [],
      message: `Tidak ada transaksi lewat waktu pada tanggal ${targetDate} yang perlu dikirim ke Asisten.`
    };
  }

  const nowIso = (currentTime instanceof Date ? currentTime : (currentTime ? new Date(currentTime) : new Date())).toISOString();
  const allVerifs = storage.get(VERIFICATION_STORAGE_KEY, []);
  const submittedItems = [];

  targetItems.forEach(tx => {
    // 1. Update status pada data raw source
    if (tx.moduleType === MODULE_TYPES.SELEKSI_PRA_OKULASI) {
      const preDocs = storage.get('pre_grafting_selection_documents', []);
      const pIdx = preDocs.findIndex(d => d.id === tx.id || d.docNo === tx.docNo);
      if (pIdx !== -1) {
        preDocs[pIdx].status = 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN';
        preDocs[pIdx].verificationStatus = 'MENUNGGU_VERIFIKASI';
        preDocs[pIdx].submittedAt = nowIso;
        preDocs[pIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
        preDocs[pIdx].submittedByName = user?.name || 'Mantri Bibitan';
        preDocs[pIdx].isOverdueSubmission = true;
        storage.set('pre_grafting_selection_documents', preDocs);
      }
    } else if (tx.storageKey) {
      const records = storage.get(tx.storageKey, []);
      const rIdx = records.findIndex(r =>
        (r.id && String(r.id) === String(tx.id)) ||
        (r.docNo && String(r.docNo) === String(tx.id)) ||
        (tx.docNo && r.docNo && String(r.docNo) === String(tx.docNo))
      );
      if (rIdx !== -1) {
        if (tx.moduleType === MODULE_TYPES.MATERIAL) {
          records[rIdx].materialSubmissionStatus = 'SUBMITTED_TO_ASB';
          records[rIdx].materialSubmittedAt = nowIso;
          records[rIdx].isOverdueSubmission = true;
        } else {
          records[rIdx].status = 'MENUNGGU_VERIFIKASI';
          records[rIdx].submissionStatus = 'SUBMITTED_TO_ASB';
          records[rIdx].submittedAt = nowIso;
          records[rIdx].isOverdueSubmission = true;
          if (tx.moduleType === MODULE_TYPES.PEMELIHARAAN && Array.isArray(records[rIdx].pekerja)) {
            records[rIdx].pekerja = records[rIdx].pekerja.map(worker => ({
              ...worker,
              asistenVerificationStatus: null,
              asistenReturnReason: '',
              asistenVerifiedByUserId: null,
              asistenVerifiedByName: null,
              asistenVerifiedAt: null
            }));
          }
        }
        records[rIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
        records[rIdx].submittedByName = user?.name || 'Mantri Bibitan';
        storage.set(tx.storageKey, records);
      }
    }

    // 2. Buat / perbarui catatan di verification_transactions secara IDEMPOTENT
    const existingIdx = allVerifs.findIndex(v =>
      ((v.referenceId && String(v.referenceId) === String(tx.id)) ||
       (v.referenceDocNo && String(v.referenceDocNo) === String(tx.docNo))) &&
      ((v.referenceType || v.moduleType || '').toUpperCase() === (tx.referenceType || tx.moduleType || '').toUpperCase())
    );

    if (existingIdx !== -1) {
      allVerifs[existingIdx].verificationStatus = VERIFICATION_STATUS.MENUNGGU_VERIFIKASI;
      allVerifs[existingIdx].submittedAt = nowIso;
      allVerifs[existingIdx].submittedByUserId = user?.id || user?.userId || 'MANTRI';
      allVerifs[existingIdx].submittedByName = user?.name || 'Mantri Bibitan';
      allVerifs[existingIdx].updatedAt = nowIso;
      allVerifs[existingIdx].isOverdueSubmission = true;
      if (tx.moduleType === MODULE_TYPES.PEMELIHARAAN) allVerifs[existingIdx].workerDecisions = {};
    } else {
      const vNo = `VRF-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
      allVerifs.push({
        verificationId: `VRF-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        verificationNo: vNo,
        referenceType: tx.referenceType || tx.activityType || tx.moduleType,
        referenceId: tx.id,
        referenceDocNo: tx.docNo,
        moduleType: tx.moduleType,
        sourceModule: tx.sourceModule || (tx.moduleType === MODULE_TYPES.MATERIAL ? 'material' : undefined),
        sourceTransactionType: tx.sourceTransactionType || (tx.moduleType === MODULE_TYPES.MATERIAL ? 'PINDAH_SEMAI_MATERIAL' : undefined),
        issueDocNo: tx.issueDocNo || tx.rawRecord?.issueDocNo || null,
        itemCode: tx.itemCode || tx.rawRecord?.itemCode || null,
        itemName: tx.itemName || tx.rawRecord?.itemName || null,
        quantityUsed: tx.quantityUsed !== undefined ? tx.quantityUsed : (tx.rawRecord?.totalPolybag || null),
        uom: tx.uom || tx.rawRecord?.uom || null,
        batchCode: tx.batchCode || tx.rawRecord?.batchCode || tx.rawRecord?.batchNo || null,
        bedenganCode: tx.bedenganCode || tx.rawRecord?.bedenganCode || tx.rawRecord?.bedengan || null,
        estateId: tx.rawRecord?.targetEstateId || tx.rawRecord?.estateId || tx.rawRecord?.sourceEstateId || user?.estateId || 'EST-TBS',
        divisionId: tx.rawRecord?.targetDivisionId || tx.rawRecord?.divisionId || tx.rawRecord?.sourceDivisionId || user?.divisionId || 'DIV-001',
        verificationStatus: VERIFICATION_STATUS.MENUNGGU_VERIFIKASI,
        isOverdueSubmission: true,
        findings: [],
        notes: 'Pengajuan data lewat waktu oleh Mantri',
        submittedByUserId: user?.id || user?.userId || 'MANTRI',
        submittedByName: user?.name || 'Mantri Bibitan',
        submittedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }

    submittedItems.push(tx);
  });

  storage.set(VERIFICATION_STORAGE_KEY, allVerifs);

  return {
    success: true,
    submittedCount: submittedItems.length,
    submittedItems,
    targetDate,
    message: `${submittedItems.length} transaksi lewat waktu (Tanggal ${targetDate}) berhasil dikirim ke Asisten Bibitan untuk verifikasi.`
  };
}

