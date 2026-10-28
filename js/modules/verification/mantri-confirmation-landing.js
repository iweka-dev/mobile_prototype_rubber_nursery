/**
 * js/modules/verification/mantri-confirmation-landing.js
 * Halaman Landing "Konfirmasi untuk Verifikasi" Mantri Bibitan.
 * Unified UI/UX Pattern across ALL Modules based on Canonical Design System.
 */

import { storage } from '../../core/storage.js';
import { session } from '../../core/session.js';
import { navigate } from '../../core/router.js';
import { toast } from '../../components/toast.js';
import { esc, todayDDMMYYYY } from '../../core/utils.js';
import { getCurrentUserContext, resolveUserContext } from '../../core/user-context.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { renderStatusDots } from '../../core/status-dot-renderer.js';
import { VERIFICATION_STORAGE_KEY } from './verification-manager.js';
import {
  getMantriTodayTransactions,
  submitModuleTransactions,
  MANTRI_TRANSACTION_STATUS,
  MODULE_TYPES,
  MODULE_LABELS,
  normalizeDateStr,
  formatSafeNumber,
  matchActor
} from './mantri-confirmation-service.js';
import { getSelectionStageLabel } from '../selection/selection-manager.js';
import { getStandardWorkHoursForDate } from '../../data/standard-work-hour-master.js';
import { getWorkAllocationByCode } from '../../data/work-allocation-master.js';

let activeTabFilter = null; // Menyimpan modul aktif (e.g. 'TIDAK_HADIR', 'PENERIMAAN', etc.)
const moduleCheckedStates = new Map(); // Menyimpan state centang per modul
let selectedTxForModal = null; // Menyimpan transaksi yang sedang dilihat detailnya
let isSubmitting = false; // Double-click protection
let showLoadingModal = false; // Loading modal state
let showSuccessModal = false; // Success modal state

// Canonical Section Titles matching reference design screens
const MODULE_SECTION_TITLES = {
  [MODULE_TYPES.TIDAK_HADIR]: 'Tidak Hadir',
  [MODULE_TYPES.PENERIMAAN]: 'Penerimaan',
  [MODULE_TYPES.PENYEMAIAN]: 'Penyemaian',
  [MODULE_TYPES.DEDERAN]: 'Pemeriksaan Dederan',
  [MODULE_TYPES.OKULASI]: 'Okulasi',
  [MODULE_TYPES.PEMERIKSAAN_OKULASI]: 'Pemeriksaan Okulasi',
  [MODULE_TYPES.PENYELEKSIAN]: 'Penyeleksian',
  [MODULE_TYPES.KEBUN_ENTRES]: 'Kebun Entres',
  [MODULE_TYPES.MATERIAL]: 'Material & Bahan',
  [MODULE_TYPES.PEMELIHARAAN]: 'Rekam Pemeliharaan',
  [MODULE_TYPES.PENGELUARAN]: 'Pengeluaran'
};

const SUBMITTED_LIFECYCLE_STATUSES = new Set([
  MANTRI_TRANSACTION_STATUS.SUBMITTED_TO_ASB,
  MANTRI_TRANSACTION_STATUS.PENDING_ASB,
  MANTRI_TRANSACTION_STATUS.VERIFIED,
  MANTRI_TRANSACTION_STATUS.APPROVED,
  MANTRI_TRANSACTION_STATUS.REVISION
].filter(Boolean).map(status => String(status).toUpperCase()));
const SUBMITTED_STATUS_LABELS = new Set([
  'SUBMITTED_TO_ASB', 'PENDING_ASB', 'DIKIRIM_KE_ASISTEN',
  'MENUNGGU_VERIFIKASI', 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
  'TERVERIFIKASI', 'DISETUJUI', 'VERIFIED', 'APPROVED',
  'DIKEMBALIKAN', 'REVISION', 'DATA_TERKONFIRMASI', 'TERKONFIRMASI'
]);

function hasBeenSentForVerification(tx) {
  const raw = tx.rawRecord || {};
  const statuses = [
    tx.status, tx.verificationStatus,
    raw.status, raw.verificationStatus, raw.submissionStatus,
    tx.latestVerification?.verificationStatus, tx.latestVerification?.status
  ].filter(Boolean).map(status => String(status).trim().toUpperCase());
  const explicitSubmittedAt = [tx.latestVerification?.submittedAt, raw.submittedAt, raw.confirmedAt]
    .some(value => Boolean(value && String(value).trim() && String(value).trim() !== '-'));

  return Boolean(tx.latestVerification) || explicitSubmittedAt ||
    statuses.some(status => SUBMITTED_LIFECYCLE_STATUSES.has(status) || SUBMITTED_STATUS_LABELS.has(status));
}

export function renderMantriConfirmationLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const currentUser = getCurrentUserContext();

  const todayStr = todayDDMMYYYY();
  const allRawTxs = getMantriTodayTransactions(currentUser, todayStr);

  // Hitung jumlah transaksi lewat waktu dari hari-hari sebelumnya
  const overdueCount = allRawTxs.filter(tx => 
    (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || tx.status === MANTRI_TRANSACTION_STATUS.REVISION) &&
    tx.isSubmissionExpired
  ).length;

  // Halaman Utama Konfirmasi HANYA menampilkan transaksi hari ini yang TIDAK lewat waktu
  const allTodayTxs = allRawTxs.filter(tx => !tx.isSubmissionExpired);

  // Hitung modul-modul yang aktif
  const activeModulesMap = new Map();
  allTodayTxs.forEach(tx => {
    const mType = tx.moduleType;
    let count = 1;
    if (mType === MODULE_TYPES.TIDAK_HADIR && tx.rawRecord?.detailPekerja) {
      count = tx.rawRecord.detailPekerja.length;
    }
    const currentCount = activeModulesMap.get(mType) || 0;
    activeModulesMap.set(mType, currentCount + (mType === MODULE_TYPES.TIDAK_HADIR ? count : 1));
  });

  const activeModules = Array.from(activeModulesMap.entries()).map(([type, count]) => ({
    type,
    label: MODULE_LABELS[type] || type,
    count
  }));

  // Jika activeTabFilter belum di-set atau tidak ada di activeModules, pilih modul pertama
  if (!activeTabFilter || !activeModulesMap.has(activeTabFilter)) {
    activeTabFilter = activeModules.length > 0 ? activeModules[0].type : null;
  }

  // Filter transaksi sesuai tab modul yang dipilih
  const currentModuleType = activeTabFilter;
  const currentModuleLabel = MODULE_LABELS[currentModuleType] || currentModuleType || 'Modul';
  const currentSectionTitle = MODULE_SECTION_TITLES[currentModuleType] || currentModuleLabel;
  const visibleTxs = currentModuleType
    ? allTodayTxs.filter(tx => tx.moduleType === currentModuleType)
    : [];
  // Unsubmitted documents lead in every tab; previously submitted/revision records follow.
  // Sorting this display-only array leaves transaction storage and submission flow untouched.
  visibleTxs.sort((a, b) => Number(hasBeenSentForVerification(a)) - Number(hasBeenSentForVerification(b)));

  // Hitung status eligibilitas modul (hanya item yang belum expired & canSubmit !== false)
  const moduleEligibleTxs = visibleTxs.filter(tx =>
    (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM ||
     tx.status === MANTRI_TRANSACTION_STATUS.REVISION) &&
    tx.canSubmit !== false &&
    !tx.isSubmissionExpired
  );
  const hasEligibleTxs = moduleEligibleTxs.length > 0;
  const isStatementChecked = Boolean(moduleCheckedStates.get(currentModuleType));
  const canSubmitModule = hasEligibleTxs && isStatementChecked && !isSubmitting;

  const isAllModuleSubmitted = visibleTxs.length > 0 && !hasEligibleTxs && visibleTxs.some(tx =>
    tx.status === MANTRI_TRANSACTION_STATUS.SUBMITTED_TO_ASB || tx.status === MANTRI_TRANSACTION_STATUS.PENDING_ASB
  );
  const isAllModuleVerified = visibleTxs.length > 0 && !hasEligibleTxs && visibleTxs.every(tx =>
    tx.status === MANTRI_TRANSACTION_STATUS.VERIFIED || tx.status === MANTRI_TRANSACTION_STATUS.APPROVED
  );

  // Resolve submission timestamp for confirmed modules
  const submissionTimestamp = getModuleSubmissionTimestamp(currentModuleType, visibleTxs);

  // Statement text canonical for all modules
  const statementText = 'Saya dengan ini menyatakan bahwa informasi di atas adalah benar dan sesuai dengan kondisi lapangan.';

  app.innerHTML = `
    <div class="page mantri-confirmation-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; position: relative;">
      
      <!-- 1. HEADER (Fixed 56px, Flex-shrink 0) -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <button id="btn-back-home" type="button" aria-label="Kembali ke Beranda" style="background: transparent; border: none; padding: 6px; margin-left: -6px; color: #057A55; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <div style="min-width: 0; flex: 1;">
            <h1 style="font-size: 0.96rem; font-weight: 800; color: #0F172A; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Konfirmasi untuk Verifikasi</h1>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button id="btn-open-overdue-history" type="button" aria-label="Data Lewat Waktu" title="Data Lewat Waktu${overdueCount > 0 ? ` (${overdueCount} tertunda)` : ''}" style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; width: 34px; height: 34px; color: #057A55; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; transition: all 0.15s ease;">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            ${overdueCount > 0 ? `
              <span style="position: absolute; top: -3px; right: -3px; width: 9px; height: 9px; background: #DC2626; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 1px 2px rgba(220,38,38,0.4);"></span>
            ` : ''}
          </button>
        </div>
      </header>

      <!-- 2. TAB BAR (Flex-shrink 0, Horizontal Scroll) -->
      ${activeModules.length > 0 ? `
        <nav style="display: flex; overflow-x: auto; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 12px; gap: 12px; flex-shrink: 0; width: 100%; min-width: 0; scrollbar-width: none; -webkit-overflow-scrolling: touch;">
          ${activeModules.map(m => {
    const isActive = activeTabFilter === m.type;
    return `
              <button class="dynamic-tab-btn" data-module="${esc(m.type)}" style="flex-shrink: 0; padding: 10px 6px; font-size: 0.80rem; font-weight: ${isActive ? '800' : '600'}; color: ${isActive ? '#057A55' : '#64748B'}; background: transparent; border: none; border-bottom: 2.5px solid ${isActive ? '#057A55' : 'transparent'}; cursor: pointer; white-space: nowrap; transition: all 0.15s ease;">
                ${esc(m.label)} (${m.count})
              </button>
            `;
  }).join('')}
        </nav>
      ` : ''}

      <!-- 3. MAIN CONTENT (Flex 1, Vertically Scrollable) -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
        ${activeModules.length === 0 ? renderEmptyStateCard({
    title: 'Tidak Ada Transaksi Hari Ini',
    description: 'Belum ada transaksi operasional yang dicatat untuk hari ini. Silakan input transaksi melalui modul menu Beranda.'
  }) : `
          <!-- Section Header with Title & Info Icon (i) -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 4px;">
            <h2 style="font-size: 0.95rem; font-weight: 800; color: #0284C7; margin: 0; letter-spacing: -0.2px;">
              ${esc(currentSectionTitle)}
            </h2>
            <button id="btn-section-info" type="button" aria-label="Informasi Modul" style="background: #0284C7; color: #FFFFFF; border: none; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; cursor: pointer; line-height: 1; flex-shrink: 0; box-shadow: 0 1px 2px rgba(2,132,199,0.3);">
              i
            </button>
          </div>

          <!-- Module Specific List (Row Mode for Tidak Hadir, Group Mode for Kebun Entres, Card Mode for Transactions) -->
          ${currentModuleType === MODULE_TYPES.TIDAK_HADIR
      ? renderTidakHadirList(visibleTxs)
      : currentModuleType === MODULE_TYPES.KEBUN_ENTRES
      ? renderKebunEntresGroupedList(visibleTxs)
      : `
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${visibleTxs.map(tx => currentModuleType === MODULE_TYPES.PEMELIHARAAN
      ? renderMaintenanceVerificationCard(tx)
      : renderUniversalCard(tx)).join('')}
              </div>
            `
    }
        `}
      </main>

      <!-- 4. BOTTOM ACTION AREA (Flex-shrink 0, Fixed at bottom of device frame) -->
      ${activeModules.length > 0 ? `
        <div class="module-submit-area" style="flex-shrink: 0; width: 100%; padding: 12px 14px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 -2px 6px rgba(0,0,0,0.03); z-index: 10;">
          ${(isAllModuleSubmitted || isAllModuleVerified) ? `
            <!-- DATA TERKONFIRMASI STATE -->
            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 4px 0;">
              <div style="width: 28px; height: 28px; border-radius: 50%; background: #DEF7EC; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#057A55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                <span style="font-size: 0.84rem; font-weight: 800; color: #0F172A; line-height: 1.3;">Data Terkonfirmasi</span>
                <span style="font-size: 0.72rem; color: #64748B; line-height: 1.35;">${submissionTimestamp ? submissionTimestamp : 'Selesai'}</span>
              </div>
            </div>
          ` : `
            <!-- PERNYATAAN + SUBMIT BUTTON STATE -->
            <div style="font-size: 0.82rem; font-weight: 800; color: #0F172A;">
              Pernyataan
            </div>

            <label style="display: flex; align-items: flex-start; gap: 8px; cursor: ${hasEligibleTxs && !isSubmitting ? 'pointer' : 'default'}; font-size: 0.72rem; color: #334155; line-height: 1.45;">
              <input type="checkbox" id="chk-statement-${esc(currentModuleType)}" class="chk-module-statement" data-module="${esc(currentModuleType)}" style="margin-top: 2px; width: 16px; height: 16px; accent-color: #057A55; cursor: ${hasEligibleTxs && !isSubmitting ? 'pointer' : 'not-allowed'}; flex-shrink: 0;" ${isStatementChecked ? 'checked' : ''} ${hasEligibleTxs && !isSubmitting ? '' : 'disabled'} />
              <span>${statementText}</span>
            </label>

            <button type="button" id="btn-submit-module-${esc(currentModuleType)}" class="btn-submit-module" data-module="${esc(currentModuleType)}" ${canSubmitModule ? '' : 'disabled'} style="width: 100%; height: 42px; background: ${canSubmitModule ? '#057A55' : '#D1D5DB'}; color: ${canSubmitModule ? '#FFFFFF' : '#9CA3AF'}; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: ${canSubmitModule ? 'pointer' : 'not-allowed'}; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: ${canSubmitModule ? '0 2px 5px rgba(5,122,85,0.25)' : 'none'}; transition: all 0.2s ease;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Kirim Data ke Asisten</span>
            </button>
          `}
        </div>
      ` : ''}

      <!-- 5. DETAIL TRANSACTION MODAL (Rendered if selectedTxForModal is set) -->
      ${selectedTxForModal ? renderDetailModal(selectedTxForModal, currentUser) : ''}

      <!-- 6. LOADING MODAL (Rendered during submission) -->
      ${showLoadingModal ? renderLoadingModal() : ''}

      <!-- 7. SUCCESS MODAL (Rendered after successful submission) -->
      ${showSuccessModal ? renderSuccessModal() : ''}

    </div>
  `;

  attachEvents(allTodayTxs, currentUser, currentSectionTitle);
}

function renderMaintenanceVerificationCard(tx) {
  const raw = tx.rawRecord || {};
  const workers = Array.isArray(raw.pekerja) ? raw.pekerja : [];
  const allocationName = raw.allocationName || raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan';
  const allocationCode = raw.allocationCode || '';
  const uom = raw.uomCode || raw.uom || raw.aktivitas?.uom || '';
  const dateText = normalizeDateStr(tx.date);
  const date = new Date(raw.activityDate || raw.tanggal || raw.date || raw.createdAt || tx.date || '');
  const standardHours = Number.isFinite(date.getTime())
    ? (getStandardWorkHoursForDate(date)?.workHours ?? null)
    : null;
  const isMandoran = raw.activityEntryMode === 'MANDORAN';

  const rows = workers.map((worker) => {
    const name = worker.name || worker.workerName || '-';
    const code = worker.code || worker.workerCode || worker.id || worker.workerId || '-';
    const result = Number(worker.inputHasil ?? worker.result ?? worker.quantity ?? 0);
    const taskQuantity = Number(raw.taskQuantity) || Number(getWorkAllocationByCode(raw.allocationCode)?.taskQuantity) || 0;
    const effectiveTaskQuantity = standardHours === 5 && taskQuantity > 0
      ? Math.round(taskQuantity * 5 / 7)
      : taskQuantity;
    const potongJam = isMandoran && effectiveTaskQuantity > 0 && result < effectiveTaskQuantity && worker.potongJamDecision !== 'TIDAK_SETUJU';
    const hours = potongJam
      ? worker.durationHours || null
      : standardHours;
    return { name, code, result, potongJam, hours };
  });

  const heading = allocationCode ? `${allocationCode} - ${allocationName}` : allocationName;

  return `
    <article class="card-compact-item card-universal-item" data-tx-id="${esc(tx.id)}" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.04);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 12px; border-bottom:1px solid #D8D8D8;">
        <span style="font-size:.82rem; font-weight:800; color:#116834;">${esc(heading)}</span>
        <button type="button" class="btn-maintenance-info" data-tx-id="${esc(tx.id)}" aria-label="Informasi aktivitas" style="width:22px; height:22px; border:0; border-radius:50%; background:#116834; color:#FFFFFF; font-size:.78rem; font-weight:800; cursor:pointer; flex-shrink:0;">i</button>
      </div>
      <div style="display:flex; justify-content:space-between; gap:10px; padding:8px 12px; border-bottom:1px solid #222; font-size:.72rem; font-weight:800; color:#111;">
        <span>Nama Pekerja</span><span>Hasil${uom ? ` (${esc(uom)})` : ''}</span>
      </div>
      ${rows.length ? rows.map((row, index) => `
        <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; padding:8px 12px; ${index < rows.length - 1 ? 'border-bottom:1px solid #E5E5E5;' : ''}">
          <div style="min-width:0;">
            <div style="font-size:.76rem; font-weight:700; color:#111; overflow-wrap:anywhere;">${esc(row.name)}</div>
            <div style="margin-top:2px; font-size:.67rem; color:#64748B;">${esc(row.code)}</div>
          </div>
          <div style="text-align:right; white-space:nowrap;">
            <div style="font-size:.78rem; font-weight:800; color:#111;">${formatSafeNumber(row.result)}</div>
            ${row.hours !== null ? `<div style="margin-top:2px; font-size:.70rem; font-weight:700; color:${row.potongJam ? '#DC2626' : '#16A34A'};">${formatSafeNumber(row.hours)} Jam</div>` : ''}
          </div>
        </div>
      `).join('') : `
        <div style="padding:12px; font-size:.74rem; color:#64748B;">Data pekerja belum tersedia.</div>
      `}
      <div style="display:flex; justify-content:space-between; gap:8px; padding:9px 12px; background:#F8FAFC; border-top:1px solid #E2E8F0; font-size:.72rem; color:#64748B;">
        <span>${esc(tx.docNo || tx.id || '-')}</span><span>${esc(dateText)}</span>
      </div>
    </article>
  `;
}

/**
 * Helper: Merender Row-Mode untuk Modul Tidak Hadir sesuai Reference Screen 1
 */
function renderTidakHadirList(txs) {
  const workers = [];
  txs.forEach(tx => {
    if (tx.rawRecord && Array.isArray(tx.rawRecord.detailPekerja)) {
      tx.rawRecord.detailPekerja.forEach(w => workers.push(w));
    }
  });

  if (workers.length === 0) {
    return `
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; text-align: center; color: #64748B; font-size: 0.78rem;">
        Tidak ada data pekerja tidak hadir hari ini.
      </div>
    `;
  }

  return `
    <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
      <!-- Table Subheader -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #E2E8F0; background: #FFFFFF;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #64748B;">Nama Pekerja</span>
        <span style="font-size: 0.75rem; font-weight: 700; color: #64748B;">Status Kehadiran</span>
      </div>

      <!-- Workers List -->
      <div style="display: flex; flex-direction: column;">
        ${workers.map((w, idx) => {
    const type = (w.absentType || 'C').toUpperCase();
    let badgeBg = '#3B82F6'; // C (Cuti/Izin) -> Blue
    if (type === 'M' || type === 'ALPHA') {
      badgeBg = '#EF4444'; // M (Mangkir) -> Red
    } else if (type === 'S') {
      badgeBg = '#F59E0B'; // S (Sakit) -> Amber
    }

    const isLast = idx === workers.length - 1;

    return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; ${isLast ? '' : 'border-bottom: 1px solid #F1F5F9;'}">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <span style="font-size: 0.82rem; font-weight: 700; color: #0F172A;">${esc(w.name || '-')}</span>
                <span style="font-size: 0.70rem; color: #64748B;">${esc(w.code || '-')}</span>
              </div>
              <div>
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: ${badgeBg}; color: #FFFFFF; font-size: 0.76rem; font-weight: 800;">
                  ${esc(type)}
                </span>
              </div>
            </div>
          `;
  }).join('')}
      </div>
    </div>
  `;
}

/**
 * Helper: Merender transaksi Kebun Entres terkelompok berdasarkan MENUNAS dan TOPPING
 */
function renderKebunEntresGroupedList(txs) {
  const activityType = tx => (tx.activityType || tx.rawRecord?.type || tx.type || '').toUpperCase();

  if (!txs.some(tx => ['MENUNAS', 'TOPPING'].includes(activityType(tx)))) {
    return `
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; text-align: center; color: #64748B; font-size: 0.78rem;">
        Tidak ada data transaksi Kebun Entres hari ini.
      </div>
    `;
  }

  const renderActivityGroup = (title, list) => list.length > 0 ? `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:.74rem;font-weight:800;color:#116834;letter-spacing:.5px;text-transform:uppercase;padding-left:2px;">${title}</div>
      <div style="display:flex;flex-direction:column;gap:10px;">${list.map(tx => renderUniversalCard(tx)).join('')}</div>
    </div>` : '';
  const renderSentSection = (sent, label) => {
    const scopedTxs = txs.filter(tx => hasBeenSentForVerification(tx) === sent);
    if (scopedTxs.length === 0) return '';
    return `
      <section style="display:flex;flex-direction:column;gap:10px;">
        <h3 style="margin:0;font-size:.78rem;font-weight:800;color:#334155;">${label}</h3>
        ${renderActivityGroup('MENUNAS', scopedTxs.filter(tx => activityType(tx) === 'MENUNAS'))}
        ${renderActivityGroup('TOPPING', scopedTxs.filter(tx => activityType(tx) === 'TOPPING'))}
      </section>`;
  };

  return `<div style="display:flex;flex-direction:column;gap:14px;">
    ${renderSentSection(false, 'Belum Pernah Dikirim')}
    ${renderSentSection(true, 'Sudah Pernah Dikirim')}
  </div>`;
}

/**
 * Mapper Konfigurasi Card Universal per Modul
 */
export function getUniversalCardConfig(tx) {
  const raw = tx.rawRecord || {};
  const disp = tx.display || {};
  const dateFormatted = normalizeDateStr(tx.date);

  switch (tx.moduleType) {
    case MODULE_TYPES.MATERIAL: {
      const itemName = tx.itemName || raw.itemName || raw.materialName || 'Material & Bahan';
      const issueDoc = tx.issueDocNo || raw.issueDocNo || raw.noIssue || '-';
      const rawQty = tx.quantityUsed !== undefined ? tx.quantityUsed : (raw.totalPolybag !== undefined ? raw.totalPolybag : (raw.rows?.[0]?.polybag || 0));
      const formattedQty = formatSafeNumber(rawQty);
      const uom = tx.uom || raw.uom || raw.satuan || 'LBR';
      const refSow = tx.referenceDocNo || tx.docNo || raw.docNo || '-';
      const batch = tx.batchCode || raw.batchCode || raw.batchNo || '-';
      const bedengan = tx.bedenganCode || raw.bedenganCode || raw.bedengan || '-';

      return {
        moduleLabel: 'MATERIAL & BAHAN',
        primaryEntity: itemName,
        primaryDoc: issueDoc,
        quantityText: `${formattedQty} ${uom}`,
        breakdownText: '',
        referenceText: `Referensi: ${refSow}`,
        contextText: `Batch: ${batch} · Bedengan: ${bedengan}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PENYEMAIAN: {
      const primaryEntity = disp.title || 'Penyemaian Benih';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.totalDisemai || raw.qty || 0)} Bibit`;
      const batch = raw.batchNo || '-';
      const bedengan = raw.bedengan || raw.bedenganCode || '-';
      const klon = raw.klonAwal || raw.klon || '';

      let contextParts = [];
      if (batch && batch !== '-') contextParts.push(`Batch: ${batch}`);
      if (bedengan && bedengan !== '-') contextParts.push(`Bedengan: ${bedengan}`);
      if (klon && klon !== '-') contextParts.push(`Klon: ${klon}`);
      const contextText = contextParts.join(' · ') || disp.info || '-';

      return {
        moduleLabel: 'PENYEMAIAN',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: raw.program ? `Program: ${raw.program}` : '',
        contextText,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PENERIMAAN: {
      const primaryEntity = disp.title || 'Penerimaan Benih';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.qty || raw.quantity || 0)} Butir`;
      const klon = raw.klon || raw.clone || '-';
      const tipeAsal = raw.tipeAsal || raw.asal || raw.sumber || raw.sourceType || 'Kebun Induk';
      const sir = raw.sir || '';

      return {
        moduleLabel: 'PENERIMAAN',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: sir ? `No. SIR: ${sir}` : (raw.sumber ? `Sumber: ${raw.sumber}` : ''),
        contextText: `Klon: ${klon} · ${tipeAsal}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.DEDERAN: {
      const primaryEntity = disp.title || 'Germinasi / Dederan';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.jumlahDeder || raw.totalDeder || raw.qty || 0)} Butir Deder`;
      const bedengan = raw.bedenganCode || raw.bedengan || '-';
      const klon = raw.klon || raw.varietas || '-';

      return {
        moduleLabel: 'DEDERAN',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: '',
        contextText: `Bedengan: ${bedengan} · Klon: ${klon}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.KEBUN_ENTRES: {
      const actType = (tx.activityType || raw.type || '').toUpperCase();
      const isTopping = actType === 'TOPPING';
      const primaryEntity = isTopping ? 'Entres Topping' : 'Entres Menunas';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || (isTopping ? `${formatSafeNumber(raw.jumlahKayu || 0)} Btg · ${formatSafeNumber(raw.jumlahPerisai || 0)} Perisai` : `${formatSafeNumber(raw.jumlahPohonDitunas || raw.jumlahPokok || 0)} Pokok Ditunas`);
      const plot = raw.kodePlot || raw.plotId || raw.plotNo || '-';
      const klon = raw.namaKlon || raw.klon || '-';
      const budwood = raw.budwoodCode ? `Kebun: ${raw.budwoodCode}` : '';

      return {
        moduleLabel: isTopping ? 'ENTRES TOPPING' : 'ENTRES MENUNAS',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: budwood,
        contextText: `Plot: ${plot} · Klon: ${klon}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.OKULASI: {
      const primaryEntity = disp.title || 'Okulasi Bibitan';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.jumlah || raw.qty || 0)} Pkk`;
      const typeLabel = raw.type === 'REGRAFTING' ? 'Regrafting' : 'Grafting';
      const bedengan = raw.bedengan || '-';
      const klon = raw.klonEntres || raw.klon || '-';

      return {
        moduleLabel: 'OKULASI',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: `Tipe: ${typeLabel}`,
        contextText: `Bedengan: ${bedengan} · Klon: ${klon}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PEMERIKSAAN: {
      const primaryEntity = disp.title || 'Pemeriksaan Okulasi';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.totalDiperiksa || raw.qty || 0)} Diperiksa`;
      const breakdown = disp.breakdown || '';
      const bedengan = raw.bedengan || '-';
      const klon = raw.klonEntres || '-';

      return {
        moduleLabel: 'PEMERIKSAAN OKULASI',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: breakdown,
        referenceText: '',
        contextText: `Bedengan: ${bedengan} · Klon: ${klon}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PEMERIKSAAN_DEDERAN: {
      const primaryEntity = disp.title || 'Pemeriksaan Dederan';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.jumlahDiperiksa || raw.totalDiperiksa || 0)} Diperiksa`;
      const breakdown = disp.breakdown || '';
      const bedengan = raw.bedenganCode || raw.bedengan || '-';
      const klon = raw.klon || '-';

      return {
        moduleLabel: 'PEMERIKSAAN DEDERAN',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: breakdown,
        referenceText: '',
        contextText: `Bedengan: ${bedengan} · Klon: ${klon}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.SELEKSI_PRA_OKULASI: {
      const stageLabel = getSelectionStageLabel(raw);
      const primaryEntity = disp.title || `Pemeriksaan Pra-Okulasi (${stageLabel})`;
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.totalLayak || raw.finalBibitQty || 0)} Layak`;
      const batch = raw.batchCode || '-';
      const bedengan = raw.bedengan || '-';
      // Kartu transaksi pelaksanaan menyimpan jumlah afkir pada field kanonis
      // actualBibitSelectedQty, bukan pada totalAfkir milik dokumen induk.
      const afkirRaw = raw.actualBibitSelectedQty !== undefined && raw.actualBibitSelectedQty !== null
        ? raw.actualBibitSelectedQty
        : (raw.bibitReject !== undefined && raw.bibitReject !== null
          ? raw.bibitReject
          : (raw.jumlahAfkir !== undefined && raw.jumlahAfkir !== null
            ? raw.jumlahAfkir
            : (raw.totalAfkir !== undefined && raw.totalAfkir !== null
              ? raw.totalAfkir
              : (raw.rejectedBibitQty || 0))));
      const afkir = formatSafeNumber(afkirRaw);

      return {
        moduleLabel: 'PEMERIKSAAN PRA-OKULASI',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: `${afkir} Afkir`,
        referenceText: `Tahap: ${stageLabel}`,
        contextText: `Batch: ${batch} · Bedengan: ${bedengan}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PENYELEKSIAN: {
      const stageLabel = getSelectionStageLabel(raw);
      const primaryEntity = disp.title || 'Penyeleksian Bibit';
      const primaryDoc = tx.docNo;
      const mainQty = disp.mainQty || `${formatSafeNumber(raw.actualBibitSelectedQty || raw.bibitReject || raw.jumlahAfkir || 0)} Bibit Afkir`;
      const bedengan = raw.bedengan || raw.bedenganCode || raw.lokasi || '-';

      return {
        moduleLabel: 'PENYELEKSIAN',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: `Tahap: ${stageLabel}`,
        contextText: `Bedengan: ${bedengan}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PEMELIHARAAN: {
      const actName = raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan';
      const primaryEntity = disp.title || `Rekam Pemeliharaan`;
      const primaryDoc = tx.docNo;
      const vol = raw.volumePkk !== undefined ? raw.volumePkk : (raw.aktivitas?.volume !== undefined ? raw.aktivitas?.volume : (raw.volume || raw.qty || 0));
      const mainQty = `${formatSafeNumber(vol)} Pkk`;
      const loc = raw.bedengan || raw.location || raw.lokasiBlok || raw.blok || '-';

      return {
        moduleLabel: 'PEMELIHARAAN',
        primaryEntity: actName || primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: actName !== primaryEntity ? `Aktivitas: ${actName}` : '',
        contextText: `Lokasi: ${loc}`,
        dateText: dateFormatted
      };
    }

    case MODULE_TYPES.PENGELUARAN: {
      const primaryEntity = disp.title || 'Pengeluaran Bibit';
      const primaryDoc = tx.docNo;
      const isMataEntres = String(raw.transactionType || '').toUpperCase().includes('MATA_ENTRES') ||
        String(raw.type || '').toUpperCase() === 'MATA_ENTRES' ||
        raw.jumlahMataEntresDikeluarkan !== undefined || raw.details?.some(detail => detail?.mataQty !== undefined);
      const qty = isMataEntres
        ? (raw.jumlahMataEntresDikeluarkan ?? raw.details?.reduce((total, detail) => total + (Number(detail?.mataQty) || 0), 0) ?? raw.issuedQty ?? 0)
        : (raw.issuedQty ?? raw.qtyDispatched ?? raw.quantity ?? raw.qty ?? 0);
      const unit = isMataEntres ? 'Mata' : 'Pkk';
      const mainQty = disp.mainQty || `${formatSafeNumber(qty)} ${unit}`;
      const clone = raw.clone || raw.klon || raw.details?.[0]?.klon || '-';
      const destination = isMataEntres
        ? (raw.sourceEstateName || raw.sourceEstateId || raw.requesterEstate || raw.requesterEstateId || raw.targetNextEstateName || raw.targetNextEstateId || '-')
        : (raw.targetEstateName || raw.targetEstateId || raw.destination || raw.targetDivisionName || raw.targetDivisionId || raw.targetDivision || '-');
      const source = isMataEntres
        ? (raw.dispatchedFromEstateName || raw.estateName || raw.targetEstateName || raw.dispatchedFromEstateId || raw.estateId || raw.targetEstateId || '-')
        : (raw.sourceEstateName || raw.sourceEstateId || raw.dispatchedFromEstateName || raw.dispatchedFromEstateId || raw.estateName || raw.estateId || '-');
      const vehicle = raw.vehiclePlate ? `Kendaraan: ${raw.vehiclePlate}` : '';

      return {
        moduleLabel: isMataEntres ? 'PENGELUARAN MATA ENTRES' : 'PENGELUARAN BIBIT',
        primaryEntity,
        primaryDoc,
        quantityText: mainQty,
        breakdownText: disp.breakdown || '',
        referenceText: vehicle,
        contextText: isMataEntres
          ? `Asal: ${source} · Tujuan: ${destination} · Klon: ${clone}`
          : `Tujuan: ${destination} · Klon: ${clone}`,
        dateText: dateFormatted
      };
    }

    default: {
      return {
        moduleLabel: (tx.moduleLabel || 'TRANSAKSI').toUpperCase(),
        primaryEntity: disp.title || tx.moduleLabel || 'Transaksi Operasional',
        primaryDoc: tx.docNo || '-',
        quantityText: disp.mainQty || tx.summary || '1 Transaksi',
        breakdownText: disp.breakdown || '',
        referenceText: '',
        contextText: disp.info && disp.info !== '-' ? disp.info : '-',
        dateText: dateFormatted
      };
    }
  }
}

/**
 * Helper: Merender Card Universal Transaksi (Design System Universal Acuan Material)
 */
export function renderUniversalCard(tx) {
  const isRevision = tx.status === MANTRI_TRANSACTION_STATUS.REVISION;
  const isSubmitted = tx.status === MANTRI_TRANSACTION_STATUS.SUBMITTED_TO_ASB || tx.status === MANTRI_TRANSACTION_STATUS.PENDING_ASB;
  const isVerified = tx.status === MANTRI_TRANSACTION_STATUS.VERIFIED || tx.status === MANTRI_TRANSACTION_STATUS.APPROVED;
  const isExpired = Boolean(tx.isSubmissionExpired) && (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || isRevision);

  let centralFlags = [{ key: 'CENTRAL_SIAP_KIRIM', label: 'Siap Dikirim' }];
  if (isVerified) {
    centralFlags = [{ key: 'CENTRAL_TERVERIFIKASI', label: 'Terverifikasi' }];
  } else if (isRevision) {
    centralFlags = [{ key: 'CENTRAL_DIKEMBALIKAN', label: 'Perlu Revisi' }];
  } else if (isSubmitted) {
    centralFlags = [{ key: 'CENTRAL_SUDAH_DIAJUKAN', label: 'Menunggu Verifikasi' }];
  } else if (isExpired) {
    centralFlags = [{ key: 'CENTRAL_LEWAT_WAKTU', label: 'Lewat Waktu' }];
  }

  const config = getUniversalCardConfig(tx);
  const extraCardClass = tx.moduleType === MODULE_TYPES.MATERIAL ? ' card-material-item' : '';

  return `
    <div class="card-compact-item card-universal-item${extraCardClass}" data-tx-id="${esc(tx.id)}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 11px 13px; display: flex; flex-direction: column; gap: 3px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); cursor: pointer; transition: all 0.15s ease;">
      
      <!-- Baris 1: Header Tag & Status Dot + Lewat Waktu Badge -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
          ${renderStatusDots(centralFlags)}
          <span style="font-size: 0.72rem; font-weight: 800; color: #116834; letter-spacing: 0.4px; text-transform: uppercase; overflow-wrap: anywhere; word-break: normal;">
            ${esc(config.moduleLabel)}
          </span>
        </div>
        ${isExpired ? `
          <div style="display: inline-flex; align-items: center; gap: 4px; background: #FEF2F2; border: 1px solid #FECACA; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;">
            <span style="font-size: 0.65rem; font-weight: 800; color: #DC2626; letter-spacing: 0.3px;">LEWAT WAKTU</span>
            <button type="button" class="btn-expired-info" data-tx-id="${esc(tx.id)}" aria-label="Informasi Lewat Waktu" style="background: #DC2626; color: #FFFFFF; border: none; border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; cursor: pointer; line-height: 1; padding: 0;">i</button>
          </div>
        ` : ''}
      </div>

      <!-- Baris 2: Primary Entity -->
      <div style="font-size: 0.88rem; font-weight: 800; color: #0F172A; line-height: 1.35; margin-top: 2px; overflow-wrap: anywhere; word-break: normal;">
        ${esc(config.primaryEntity)}
      </div>

      <!-- Baris 3: Primary Document -->
      <div style="font-size: 0.78rem; font-weight: 700; color: #0284C7; line-height: 1.3; overflow-wrap: anywhere; word-break: normal;">
        ${esc(config.primaryDoc)}
      </div>

      <!-- Baris 4: Quantity + UOM (+ Optional Breakdown) -->
      <div style="font-size: 0.84rem; font-weight: 800; color: #0F172A; line-height: 1.3; margin-top: 1px; overflow-wrap: anywhere; word-break: normal;">
        ${esc(config.quantityText)}
      </div>
      ${config.breakdownText ? `
        <div style="font-size: 0.70rem; color: #64748B; font-weight: 600; line-height: 1.3; margin-top: 1px; overflow-wrap: anywhere; word-break: normal;">
          ${esc(config.breakdownText)}
        </div>
      ` : ''}

      <!-- Baris 5: Separator Horizontal -->
      <div style="border-top: 1px solid #E2E8F0; margin: 4px 0 3px 0;"></div>

      <!-- Baris 6: Reference Information (Optional) -->
      ${config.referenceText ? `
        <div style="font-size: 0.74rem; font-weight: 600; color: #475569; line-height: 1.3; overflow-wrap: anywhere; word-break: normal;">
          ${esc(config.referenceText)}
        </div>
      ` : ''}

      <!-- Baris 7: Context Information (Left) + Tanggal (Bottom-Right) -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; margin-top: 1px;">
        <div style="font-size: 0.72rem; color: #64748B; font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; word-break: normal; flex: 1; min-width: 0;">
          ${esc(config.contextText)}
        </div>
        <div style="font-size: 0.72rem; font-weight: 600; color: #64748B; flex-shrink: 0; text-align: right; white-space: nowrap;">
          ${esc(config.dateText)}
        </div>
      </div>

    </div>
  `;
}

/**
 * Helper: Merender Card Khusus Modul Material & Bahan (Alias ke renderUniversalCard)
 */
function renderMaterialCard(tx) {
  return renderUniversalCard(tx);
}

/**
 * Helper: Merender Compact Card per Transaksi (Alias ke renderUniversalCard)
 */
function renderCompactTransactionCard(tx) {
  return renderUniversalCard(tx);
}

/**
 * Helper: Merender Detail Modal Popup sesuai Screen 11 (Detail Transaksi)
 */
export function renderDetailModal(tx, user) {
  const raw = tx.rawRecord || {};
  const disp = tx.display || {};
  const dateFormatted = normalizeDateStr(tx.date);
  const timeFormatted = raw.createdAt ? new Date(raw.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '09:15';
  const fullDateTime = `${dateFormatted}, ${timeFormatted}`;

  const actorName = tx.actor || raw.submittedByName || raw.createdByName || raw.mantri || user?.name || 'Mantri Bibitan';
  const actorCode = raw.actorCode || raw.userCode || user?.code || user?.userId || 'MNT001';
  const rawNotes = raw.notes || raw.catatan || raw.keterangan || raw.remarks;
  const isLegacySystemFallback = Boolean(rawNotes && raw.alasan && String(rawNotes).trim() === String(raw.alasan).trim());
  const notes = (!isLegacySystemFallback && rawNotes !== undefined && rawNotes !== null && String(rawNotes).trim() !== '' && String(rawNotes).trim() !== '-') ? String(rawNotes).trim() : '-';
  const returnReason = tx.returnReason || raw.returnReason || tx.latestVerification?.returnReason || null;
  const isRevision = tx.status === MANTRI_TRANSACTION_STATUS.REVISION || Boolean(returnReason);
  const canRepair = matchActor(raw, user) || matchActor(tx, user);

  let repairRoute = '/home';
  switch (tx.moduleType) {
    case MODULE_TYPES.PENYELEKSIAN:
    case MODULE_TYPES.SELEKSI_PRA_OKULASI:
      repairRoute = '/selection';
      break;
    case MODULE_TYPES.PEMERIKSAAN:
    case MODULE_TYPES.PEMERIKSAAN_DEDERAN:
    case MODULE_TYPES.PEMERIKSAAN_OKULASI:
      repairRoute = '/inspection';
      break;
    case MODULE_TYPES.PENYEMAIAN:
    case MODULE_TYPES.DEDERAN:
      repairRoute = '/seeding';
      break;
    case MODULE_TYPES.PENERIMAAN:
      repairRoute = '/receipt';
      break;
    case MODULE_TYPES.OKULASI:
      repairRoute = '/grafting';
      break;
    case MODULE_TYPES.PEMELIHARAAN:
      repairRoute = '/nursery-activity';
      break;
    case MODULE_TYPES.KEBUN_ENTRES:
    case MODULE_TYPES.MENUNAS:
    case MODULE_TYPES.TOPPING:
      repairRoute = '/entres';
      break;
    case MODULE_TYPES.PENGELUARAN:
      repairRoute = '/dispatch';
      break;
    case MODULE_TYPES.MATERIAL:
      repairRoute = '/material';
      break;
    default:
      repairRoute = '/home';
  }

  // Khusus Modul MATERIAL: Tampilkan struktur dua section (DOKUMEN MATERIAL + REFERENSI TRANSAKSI)
  if (tx.moduleType === MODULE_TYPES.MATERIAL) {
    const itemName = tx.itemName || raw.itemName || raw.materialName || 'Material & Bahan';
    const issueDoc = tx.issueDocNo || raw.issueDocNo || raw.noIssue || '-';
    const rawQty = tx.quantityUsed !== undefined ? tx.quantityUsed : (raw.totalPolybag !== undefined ? raw.totalPolybag : (raw.rows?.[0]?.polybag || 0));
    const formattedQty = formatSafeNumber(rawQty);
    const uom = tx.uom || raw.uom || raw.satuan || 'LBR';
    const refSow = tx.referenceDocNo || tx.docNo || raw.docNo || '-';
    const batch = tx.batchCode || raw.batchCode || raw.batchNo || '-';
    const bedengan = tx.bedenganCode || raw.bedenganCode || raw.bedengan || '-';
    const rawCategory = raw.category || raw.kategori;

    return `
      <div id="modal-tx-detail-backdrop" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(2px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;">
        
        <div style="background: #FFFFFF; border-radius: 12px; width: 100%; max-width: 380px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.25); display: flex; flex-direction: column; animation: modalFadeIn 0.2s ease-out;">
          
          <!-- Modal Header -->
          <div style="background: #FFFFFF; color: #0F172A; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9;">
            <h3 style="margin: 0; font-size: 0.94rem; font-weight: 800; color: #0F172A;">
              Material &amp; Bahan
            </h3>
            <button id="btn-close-modal-x" type="button" aria-label="Tutup" style="background: transparent; border: none; color: #64748B; font-size: 1.15rem; cursor: pointer; padding: 2px 6px; display: flex; align-items: center; justify-content: center;">
              ✕
            </button>
          </div>

          <!-- Modal Body (Two Sections: DOKUMEN MATERIAL + REFERENSI TRANSAKSI) -->
          <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; font-size: 0.76rem; color: #334155; max-height: 70vh; overflow-y: auto;">
            
            <!-- SECTION 1: DOKUMEN MATERIAL -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #116834; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1.5px solid #E2E8F0; padding-bottom: 3px;">
                DOKUMEN MATERIAL
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">No. Dokumen Material</span>
                <span style="color: #64748B;">:</span>
                <span style="font-weight: 800; color: #0284C7; overflow-wrap: anywhere; word-break: normal;">${esc(issueDoc)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Tanggal</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 600;">${esc(fullDateTime)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Material</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 700; overflow-wrap: anywhere; word-break: normal;">${esc(itemName)}</span>
              </div>

              ${rawCategory ? `
                <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                  <span style="color: #64748B; font-weight: 600;">Kategori</span>
                  <span style="color: #64748B;">:</span>
                  <span style="color: #0F172A; font-weight: 600;">${esc(rawCategory)}</span>
                </div>
              ` : ''}

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Jumlah Digunakan</span>
                <span style="color: #64748B;">:</span>
                <span style="font-weight: 800; color: #057A55;">${esc(formattedQty)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Satuan</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 600;">${esc(uom)}</span>
              </div>
            </div>

            <!-- SECTION 2: REFERENSI TRANSAKSI -->
            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #64748B; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1.5px solid #E2E8F0; padding-bottom: 3px;">
                REFERENSI TRANSAKSI
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Dokumen SOW</span>
                <span style="color: #64748B;">:</span>
                <span style="font-weight: 700; color: #0F172A; overflow-wrap: anywhere; word-break: normal;">${esc(refSow)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Batch</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 600; overflow-wrap: anywhere; word-break: normal;">${esc(batch)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Bedengan</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 600; overflow-wrap: anywhere; word-break: normal;">${esc(bedengan)}</span>
              </div>

              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">Dicatat Oleh</span>
                <span style="color: #64748B;">:</span>
                <span style="color: #0F172A; font-weight: 600; overflow-wrap: anywhere; word-break: normal;">${esc(actorName)} (${esc(actorCode)})</span>
              </div>
            </div>

            <!-- Catatan Pengembalian jika ada -->
            ${returnReason ? `
              <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px; margin-top: 4px;">
                <div style="font-size: 0.72rem; font-weight: 800; color: #DC2626; margin-bottom: 2px;">
                  Catatan Pengembalian Asisten
                </div>
                <div style="font-size: 0.74rem; color: #991B1B; line-height: 1.4;">
                  ${esc(returnReason)}
                </div>
              </div>
            ` : ''}

            <!-- Catatan Section with Shaded Box -->
            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
              <span style="color: #64748B; font-weight: 600;">Catatan</span>
              <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; color: #475569; font-size: 0.74rem; line-height: 1.45; overflow-wrap: anywhere; word-break: normal;">
                ${esc(notes)}
              </div>
            </div>

          </div>

          <!-- Modal Footer -->
          ${isRevision && canRepair ? `
            <div style="padding: 12px 16px; border-top: 1px solid #F1F5F9; background: #FFFFFF; display: flex; gap: 8px;">
              <button id="btn-close-modal-footer" type="button" style="flex: 1; height: 38px; background: #FFFFFF; border: 1.5px solid #64748B; color: #475569; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer; transition: all 0.15s ease;">
                Tutup
              </button>
              <button id="btn-repair-doc" data-route="${esc(repairRoute)}" data-tx-id="${esc(tx.id || tx.docNo)}" type="button" style="flex: 1.5; height: 38px; background: #116834; color: #FFFFFF; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 4px rgba(17,104,52,0.25); transition: all 0.15s ease;">
                Perbaiki Dokumen
              </button>
            </div>
          ` : `
            <div style="padding: 12px 16px; border-top: 1px solid #F1F5F9; background: #FFFFFF;">
              <button id="btn-close-modal-footer" type="button" style="width: 100%; height: 38px; background: #FFFFFF; border: 1.5px solid #057A55; color: #057A55; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer; transition: all 0.15s ease;">
                Tutup
              </button>
            </div>
          `}

        </div>

      </div>
    `;
  }

  const isMaintenanceTransaction = tx.moduleType === MODULE_TYPES.PEMELIHARAAN;
  const maintenanceWorkers = Array.isArray(raw.pekerja) ? raw.pekerja : [];
  const maintenanceRealizedVolume = maintenanceWorkers.reduce((total, worker) =>
    total + (Number(worker.inputHasil ?? worker.result ?? worker.quantity) || 0), 0);
  const workGroupRoleCode = raw.workGroupRoleCode || raw.workGroup?.roleCode || raw.workGroup?.workGroupRoleCode || '-';
  const fields = isMaintenanceTransaction
    ? [
        { label: 'Jenis Pemeliharaan', value: esc(raw.allocationName || raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan') },
        { label: 'Lokasi / Bedengan', value: esc(raw.bedengan || raw.location || raw.lokasiBlok || raw.blok || '-') },
        { label: 'Volume Realisasi', value: `${formatSafeNumber(maintenanceRealizedVolume)} ${esc(raw.uomCode || raw.uom || '')}`, highlight: true }
      ]
    : disp.fields || [];

  return `
    <div id="modal-tx-detail-backdrop" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(2px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;">
      
      <div style="background: #FFFFFF; border-radius: 12px; width: 100%; max-width: 380px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.25); display: flex; flex-direction: column; animation: modalFadeIn 0.2s ease-out;">
        
        <!-- Modal Header (Clean White with Title & Close Icon X) -->
        <div style="background: #FFFFFF; color: #0F172A; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9;">
          <h3 style="margin: 0; font-size: 0.94rem; font-weight: 800; color: #0F172A; overflow-wrap: anywhere; word-break: normal;">
            ${esc(disp.title || tx.moduleLabel)}
          </h3>
          <button id="btn-close-modal-x" type="button" aria-label="Tutup" style="background: transparent; border: none; color: #64748B; font-size: 1.15rem; cursor: pointer; padding: 2px 6px; display: flex; align-items: center; justify-content: center;">
            ✕
          </button>
        </div>

        <!-- Modal Body (Two-Section Standard Hierarchy) -->
        <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; font-size: 0.76rem; color: #334155; max-height: 70vh; overflow-y: auto;">
          
          <!-- SECTION 1: DOKUMEN / TRANSAKSI UTAMA -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 0.72rem; font-weight: 800; color: #116834; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1.5px solid #E2E8F0; padding-bottom: 3px;">
              DOKUMEN TRANSAKSI
            </div>

            <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
              <span style="color: #64748B; font-weight: 600;">${isMaintenanceTransaction ? 'Work Group Role Code' : 'No. Dokumen'}</span>
              <span style="color: #64748B;">:</span>
              <span style="font-weight: 800; color: #0284C7; overflow-wrap: anywhere; word-break: normal;">${esc(isMaintenanceTransaction ? workGroupRoleCode : tx.docNo)}</span>
            </div>

            <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
              <span style="color: #64748B; font-weight: 600;">Tanggal</span>
              <span style="color: #64748B;">:</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(fullDateTime)}</span>
            </div>

            <!-- Dynamic Canonical Display Fields -->
            ${fields.map(f => `
              <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
                <span style="color: #64748B; font-weight: 600;">${esc(f.label)}</span>
                <span style="color: #64748B;">:</span>
                <span style="font-weight: ${f.highlight ? '800' : '600'}; color: ${f.highlight ? '#057A55' : '#0F172A'}; overflow-wrap: anywhere; word-break: normal;">
                  ${f.value}
                </span>
              </div>
            `).join('')}
          </div>

          <!-- SECTION 2: INFORMASI PENCATATAN & REFERENSI -->
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
            <div style="font-size: 0.72rem; font-weight: 800; color: #64748B; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1.5px solid #E2E8F0; padding-bottom: 3px;">
              INFORMASI PENCATATAN
            </div>

            <div style="display: grid; grid-template-columns: 130px 10px 1fr; align-items: baseline; gap: 2px;">
              <span style="color: #64748B; font-weight: 600;">Dicatat Oleh</span>
              <span style="color: #64748B;">:</span>
              <span style="color: #0F172A; font-weight: 600; overflow-wrap: anywhere; word-break: normal;">${esc(actorName)} (${esc(actorCode)})</span>
            </div>
          </div>

          <!-- Catatan Pengembalian jika ada -->
          ${returnReason ? `
            <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px; margin-top: 4px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #DC2626; margin-bottom: 2px;">
                Catatan Pengembalian Asisten
              </div>
              <div style="font-size: 0.74rem; color: #991B1B; line-height: 1.4;">
                ${esc(returnReason)}
              </div>
            </div>
          ` : ''}

          <!-- Catatan Section with Shaded Box -->
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
            <span style="color: #64748B; font-weight: 600;">Catatan</span>
            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; color: #475569; font-size: 0.74rem; line-height: 1.45; overflow-wrap: anywhere; word-break: normal;">
              ${esc(notes)}
            </div>
          </div>

        </div>

        <!-- Modal Footer -->
        ${isRevision && canRepair ? `
          <div style="padding: 12px 16px; border-top: 1px solid #F1F5F9; background: #FFFFFF; display: flex; gap: 8px;">
            <button id="btn-close-modal-footer" type="button" style="flex: 1; height: 38px; background: #FFFFFF; border: 1.5px solid #64748B; color: #475569; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer; transition: all 0.15s ease;">
              Tutup
            </button>
            <button id="btn-repair-doc" data-route="${esc(repairRoute)}" data-tx-id="${esc(tx.id || tx.docNo)}" type="button" style="flex: 1.5; height: 38px; background: #116834; color: #FFFFFF; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 4px rgba(17,104,52,0.25); transition: all 0.15s ease;">
              Perbaiki Dokumen
            </button>
          </div>
        ` : `
          <div style="padding: 12px 16px; border-top: 1px solid #F1F5F9; background: #FFFFFF;">
            <button id="btn-close-modal-footer" type="button" style="width: 100%; height: 38px; background: #FFFFFF; border: 1.5px solid #057A55; color: #057A55; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer; transition: all 0.15s ease;">
              Tutup
            </button>
          </div>
        `}

      </div>

    </div>
  `;
}

/**
 * Helper: Render Loading Modal Overlay inside mobile device frame
 */
function renderLoadingModal() {
  return `
    <div id="modal-loading-backdrop" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(2px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;">
      <div style="background: #FFFFFF; border-radius: 16px; width: 240px; padding: 32px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.25); animation: modalFadeIn 0.2s ease-out;">
        <div style="width: 48px; height: 48px; border: 3px solid #E2E8F0; border-top: 3px solid #0284C7; border-radius: 50%; animation: spinLoader 1s linear infinite;"></div>
        <div style="text-align: center;">
          <div style="font-size: 0.88rem; font-weight: 800; color: #0F172A; margin-bottom: 4px;">Mengirim data...</div>
          <div style="font-size: 0.74rem; color: #64748B;">Mohon tunggu, data sedang dikirim ke Asisten Bibitan.</div>
        </div>
      </div>
    </div>
    <style>
      @keyframes spinLoader {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;
}

/**
 * Helper: Render Success Modal Overlay inside mobile device frame
 */
function renderSuccessModal() {
  return `
    <div id="modal-success-backdrop" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(2px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;">
      <div style="background: #FFFFFF; border-radius: 16px; width: 280px; padding: 28px 24px 20px; display: flex; flex-direction: column; align-items: center; gap: 14px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.25); animation: modalFadeIn 0.2s ease-out;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #DEF7EC; display: flex; align-items: center; justify-content: center;">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#057A55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.92rem; font-weight: 800; color: #0F172A; margin-bottom: 6px; line-height: 1.3;">Data berhasil terkirim ke Asisten Bibitan</div>
          <div style="font-size: 0.74rem; color: #64748B; line-height: 1.45;">Data telah berhasil dikonfirmasi dan menunggu verifikasi oleh Asisten Bibitan.</div>
        </div>
        <button type="button" id="btn-success-ok" style="width: 100%; height: 40px; background: #057A55; color: #FFFFFF; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; margin-top: 4px; box-shadow: 0 2px 5px rgba(5,122,85,0.25); transition: all 0.15s ease;">OK</button>
      </div>
    </div>
  `;
}

/**
 * Helper: Format confirmation timestamp in Indonesian locale & Asia/Jakarta (WIB) timezone
 * Output: "Selesai, DD NamaBulan YYYY, HH:mm:ss" (e.g. "Selesai, 01 Oktober 2026, 20:45:30")
 */
export function formatConfirmationTimestamp(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(d);
  const getPart = type => parts.find(p => p.type === type)?.value || '';

  const day = getPart('day').padStart(2, '0');
  let month = getPart('month');
  if (month) {
    month = month.charAt(0).toUpperCase() + month.slice(1);
  }
  const year = getPart('year');
  let hour = getPart('hour').padStart(2, '0');
  if (hour === '24') hour = '00';
  const minute = getPart('minute').padStart(2, '0');
  const second = getPart('second').padStart(2, '0');

  return `Selesai, ${day} ${month} ${year}, ${hour}:${minute}:${second}`;
}

/**
 * Helper: Resolve submission timestamp for a module that has been submitted
 */
export function getModuleSubmissionTimestamp(moduleType, txs = []) {
  const candidateTimestamps = [];

  // 1. Check tx objects, their rawRecords, and their latestVerification
  for (const tx of txs) {
    if (tx.submittedAt) candidateTimestamps.push(tx.submittedAt);
    if (tx.latestVerification?.submittedAt) candidateTimestamps.push(tx.latestVerification.submittedAt);
    const raw = tx.rawRecord || {};
    if (raw.submittedAt) candidateTimestamps.push(raw.submittedAt);
  }

  // 2. Lookup in verification_transactions storage via storage wrapper
  try {
    const allVerifs = storage.get(VERIFICATION_STORAGE_KEY, []);
    for (const tx of txs) {
      const v = allVerifs.find(vr =>
        (vr.referenceId && String(vr.referenceId) === String(tx.id)) ||
        (vr.referenceDocNo && String(vr.referenceDocNo) === String(tx.docNo)) ||
        (vr.referenceType && String(vr.referenceType).toUpperCase() === String(tx.moduleType).toUpperCase()) ||
        (vr.referenceType && String(vr.referenceType).toUpperCase() === String(tx.referenceType || tx.activityType || '').toUpperCase())
      );
      if (v && v.submittedAt) {
        candidateTimestamps.push(v.submittedAt);
      }
    }

    // Module-level verif record
    const modVerifs = allVerifs.filter(vr =>
      vr.referenceType && (
        String(vr.referenceType).toUpperCase() === String(moduleType).toUpperCase() ||
        (moduleType === MODULE_TYPES.KEBUN_ENTRES && (String(vr.referenceType).toUpperCase() === 'MENUNAS' || String(vr.referenceType).toUpperCase() === 'TOPPING'))
      ) && vr.submittedAt
    );
    for (const mv of modVerifs) {
      candidateTimestamps.push(mv.submittedAt);
    }
  } catch (e) {
    // ignore
  }

  // 3. Lookup in individual transaction raw storage if available
  try {
    for (const tx of txs) {
      if (tx.storageKey && tx.storageKey !== 'virtual_tidak_hadir') {
        const records = storage.get(tx.storageKey, []);
        const r = records.find(rec => String(rec.id || rec.docNo || '') === String(tx.id));
        if (r && r.submittedAt) {
          candidateTimestamps.push(r.submittedAt);
        }
      }
    }
  } catch (e) {
    // ignore
  }

  // Filter valid timestamps and get the latest
  const validTimestamps = candidateTimestamps
    .filter(t => Boolean(t) && !isNaN(new Date(t).getTime()))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  if (validTimestamps.length > 0) {
    return formatConfirmationTimestamp(validTimestamps[0]);
  }

  return '';
}

function attachEvents(allTxs, user, currentSectionTitle) {
  // Kembali ke Beranda
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    navigate('/home');
  });

  // Navigasi ke Halaman Data Lewat Waktu
  document.getElementById('btn-open-overdue-history')?.addEventListener('click', () => {
    navigate('/mantri-confirmation/overdue');
  });

  // Dynamic Tab Switching
  document.querySelectorAll('.dynamic-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedModule = btn.getAttribute('data-module');
      if (selectedModule) {
        activeTabFilter = selectedModule;
        renderMantriConfirmationLanding();
      }
    });
  });

  // Info Icon (i) Click
  document.getElementById('btn-section-info')?.addEventListener('click', () => {
    toast(`Informasi Modul: ${currentSectionTitle} - Periksa rincian sebelum konfirmasi dan kirim data ke Asisten.`, 'info');
  });

  // Lewat Waktu Info Icon (i) Click
  document.querySelectorAll('.btn-expired-info').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast('Lewat Waktu, Silahkan hubungi KTU untuk dapat di proses selanjutnya', 'warning');
    });
  });

  document.querySelectorAll('.btn-maintenance-info').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const txId = button.getAttribute('data-tx-id');
      const foundTx = allTxs.find(tx => String(tx.id) === String(txId) || String(tx.docNo) === String(txId));
      if (!foundTx) return;
      selectedTxForModal = foundTx;
      renderMantriConfirmationLanding();
    });
  });

  // Klik Transaction Card -> Buka Detail Modal
  document.querySelectorAll('.card-compact-item').forEach(card => {
    card.addEventListener('click', () => {
      const txId = card.getAttribute('data-tx-id');
      const foundTx = allTxs.find(t => String(t.id) === String(txId) || String(t.docNo) === String(txId));
      if (foundTx) {
        selectedTxForModal = foundTx;
        renderMantriConfirmationLanding();
      }
    });
  });

  // Tutup Modal
  const closeModal = () => {
    selectedTxForModal = null;
    renderMantriConfirmationLanding();
  };

  document.getElementById('btn-close-modal-x')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-modal-footer')?.addEventListener('click', closeModal);
  document.getElementById('btn-repair-doc')?.addEventListener('click', (e) => {
    const route = e.currentTarget.getAttribute('data-route') || '/home';
    selectedTxForModal = null;
    navigate(route);
  });
  document.getElementById('modal-tx-detail-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-tx-detail-backdrop') {
      closeModal();
    }
  });

  // Checkbox Pernyataan Modul
  document.querySelectorAll('.chk-module-statement').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const mType = chk.getAttribute('data-module');
      if (mType) {
        moduleCheckedStates.set(mType, e.target.checked);
        const submitBtn = document.getElementById(`btn-submit-module-${mType}`);
        if (submitBtn) {
          if (e.target.checked) {
            submitBtn.removeAttribute('disabled');
            submitBtn.style.background = '#057A55';
            submitBtn.style.color = '#FFFFFF';
            submitBtn.style.cursor = 'pointer';
            submitBtn.style.boxShadow = '0 2px 5px rgba(5,122,85,0.25)';
          } else {
            submitBtn.setAttribute('disabled', 'true');
            submitBtn.style.background = '#D1D5DB';
            submitBtn.style.color = '#9CA3AF';
            submitBtn.style.cursor = 'not-allowed';
            submitBtn.style.boxShadow = 'none';
          }
        }
      }
    });
  });

  // Submit Module Button — with loading modal (3 seconds) and success flow
  document.querySelectorAll('.btn-submit-module').forEach(btn => {
    btn.addEventListener('click', () => {
      const mType = btn.getAttribute('data-module');
      if (!mType) return;

      // Double-click protection
      if (isSubmitting) return;

      const isChecked = moduleCheckedStates.get(mType);
      if (!isChecked) {
        toast('Silakan centang pernyataan modul terlebih dahulu.', 'warning');
        return;
      }

      // Lock submission immediately
      isSubmitting = true;

      // Disable checkbox and button immediately
      const chk = document.getElementById(`chk-statement-${mType}`);
      if (chk) chk.disabled = true;
      btn.disabled = true;
      btn.style.background = '#D1D5DB';
      btn.style.color = '#9CA3AF';
      btn.style.cursor = 'not-allowed';
      btn.style.boxShadow = 'none';

      // Step 1: Execute existing submit logic FIRST
      let submitResult = null;
      let submitError = null;
      try {
        submitResult = submitModuleTransactions(mType, user);
      } catch (err) {
        submitError = err;
      }

      // Step 2: Show loading modal regardless (3 second simulation)
      showLoadingModal = true;
      showSuccessModal = false;
      renderMantriConfirmationLanding();

      // Step 3: After 3 seconds, show result
      setTimeout(() => {
        showLoadingModal = false;

        if (submitError || !submitResult || !submitResult.success || submitResult.submittedCount === 0) {
          // FAILURE: Reset state and show error
          isSubmitting = false;
          showSuccessModal = false;
          moduleCheckedStates.set(mType, true); // Preserve checkbox state for retry
          renderMantriConfirmationLanding();
          toast(submitError?.message || submitResult?.message || 'Data gagal dikirim ke Asisten Bibitan.', 'error');
          return;
        }

        // SUCCESS: Show success modal
        showSuccessModal = true;
        renderMantriConfirmationLanding();

        // Attach OK button handler for success modal
        const okBtn = document.getElementById('btn-success-ok');
        if (okBtn) {
          okBtn.addEventListener('click', () => {
            showSuccessModal = false;
            isSubmitting = false;
            moduleCheckedStates.set(mType, false);
            renderMantriConfirmationLanding();
          });
        }
      }, 3000);
    });
  });

  // Success Modal OK button (re-attach in case of re-render)
  const successOkBtn = document.getElementById('btn-success-ok');
  if (successOkBtn) {
    successOkBtn.addEventListener('click', () => {
      showSuccessModal = false;
      isSubmitting = false;
      renderMantriConfirmationLanding();
    });
  }
}
