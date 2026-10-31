/**
 * js/modules/verification/verification-landing.js
 * Workspace Verifikasi Data Asisten Bibitan
 * Sesuai Desain Acuan 10-Screen Mobile Reference
 * 
 * Alur Views:
 * 1. MODULE_GRID (Screen 3): 10 Modul Card Grid + CTA Tinjau Data Hari Ini
 * 2. TRANSACTION_LIST (Screen 5): Daftar Transaksi per Modul + Filter Tanggal
 * 3. TRANSACTION_DETAIL (Screen 6): Detail Transaksi + [ Kembalikan ] [ Setujui ]
 * 4. TINJAU_FILTER (Screen 7): Tinjau Data Hari Ini - Form Filter
 * 5. TINJAU_SUMMARY (Screen 8 / 10): Tinjau Data Hari Ini - Ringkasan 10 Modul & Kirim Data
 * 6. TINJAU_DETAIL (Screen 9): Detail Transaksi Terverifikasi (Read-only)
 */

import { session } from '../../core/session.js';
import { openDrawer } from '../../components/drawer.js';
import { openModal, closeModal } from '../../components/modal.js';
import { navigate } from '../../core/router.js';
import { toast } from '../../components/toast.js';
import { todayISO, todayDDMMYYYY, esc } from '../../core/utils.js';
import { getCurrentUserContext, resolveUserContext, ROLES } from '../../core/user-context.js';
import { renderAsbBottomNav, attachAsbBottomNavEvents } from '../../components/bottom-nav-asb.js';
import { renderVerifikasiSummaryCardHtml } from './asb-summary-cards.js';
import { getStandardWorkHoursForDate } from '../../data/standard-work-hour-master.js';
import { getWorkAllocationByCode } from '../../data/work-allocation-master.js';
import {
  VERIFICATION_10_MODULES,
  VERIFICATION_STATUS,
  REFERENCE_TYPE_LABELS,
  getActionableRecordsForAsb,
  getVerificationRecordsByScope,
  getVerifiedTransactionsByScope,
  get10ModulesSummary,
  canSubmitFinalVerificationToServer,
  submitFinalVerificationToServer,
  approveVerification,
  approveMaintenanceWorker,
  returnVerification,
  returnMaintenanceWorker,
  findSourceRecord,
  getVerificationDetailData,
  getAllVerifications
} from './verification-manager.js';

// State Halaman
let currentVerifView = 'MODULE_GRID'; // 'MODULE_GRID' | 'TRANSACTION_LIST' | 'TRANSACTION_DETAIL' | 'TINJAU_FILTER' | 'TINJAU_SUMMARY' | 'TINJAU_DETAIL' | 'SYNC_CONFIRMATION' | 'SYNC_SUCCESS' | 'SYNC_HISTORY'
let previousVerifView = 'MODULE_GRID'; // 'MODULE_GRID' | 'TINJAU_SUMMARY'
let activeModuleId = null; // e.g. 'TIDAK_HADIR', 'OKULASI', etc.
let selectedTxItem = null; // Transaksi yang dibuka di detail (berisi normalizedData)
let selectedMaintenanceWorkerId = null;
let lastSyncResult = null; // Menyimpan hasil sinkronisasi terakhir untuk SYNC_SUCCESS
let syncHistoryDate = todayISO(); // Filter tanggal untuk halaman riwayat pengiriman
let syncHistoryStatusFilter = 'ALL'; // 'ALL' | 'BERHASIL' | 'GAGAL'
let syncHistorySourceView = 'TINJAU_SUMMARY'; // Halaman asal sebelum membuka riwayat
let activeFilterDate = todayDDMMYYYY();
let tinjauFilter = {
  date: todayDDMMYYYY(),
  estateId: '',
  divisionId: ''
};

const MODULE_ICONS = {
  team: `
    <svg viewBox="2 3 26 22" width="56" height="56" fill="#116834">
      <circle cx="11" cy="9" r="4.3" fill="#116834"/>
      <path d="M4 23 C4 18 7.5 15.5 11 15.5 C14.5 15.5 18 18 18 23 Z" fill="#116834"/>
      <circle cx="21" cy="10.5" r="3.5" fill="#116834"/>
      <path d="M16.8 23 C17 19.8 18.8 17.8 21 17.8 C23.5 17.8 26.5 19.8 26.5 23 Z" fill="#116834"/>
    </svg>
  `,
  documentPlus: `
    <svg viewBox="3 2 26 27" width="56" height="56" fill="#116834">
      <rect x="5" y="4" width="22" height="24" rx="4.5" fill="#116834"/>
      <line x1="9" y1="12" x2="19" y2="12" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="16" x2="19" y2="16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="20" x2="16" y2="20" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="23" cy="7" r="4.2" fill="#116834" stroke="#ffffff" stroke-width="1.5"/>
      <line x1="23" y1="4.8" x2="23" y2="9.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="20.8" y1="7" x2="25.2" y2="7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,
  sprout: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  scissors: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  documentSearch: `
    <svg viewBox="3 2 26 27" width="56" height="56" fill="#116834">
      <rect x="5" y="4" width="22" height="24" rx="4.5" fill="#116834"/>
      <line x1="9" y1="12" x2="19" y2="12" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="16" x2="19" y2="16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="20" x2="16" y2="20" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="23" cy="7" r="4.2" fill="#116834" stroke="#ffffff" stroke-width="1.5"/>
      <line x1="23" y1="4.8" x2="23" y2="9.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="20.8" y1="7" x2="25.2" y2="7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,
  leafCheck: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  tree: `
    <svg viewBox="2 2 28 28" width="56" height="56" fill="#116834">
      <path d="M14 26 C14 26 14 13 14 9 C14 5.5 17.5 3 22 2.5 C22.5 7 19.5 10.5 15.8 11 C15.8 13 15.8 17 15.8 26 Z" fill="#116834"/>
      <path d="M14 16.5 C10.5 16.5 6.5 14 6 10 C10 9.5 13.5 12 14 15 Z" fill="#116834"/>
      <circle cx="14" cy="24" r="2.5" fill="#116834"/>
    </svg>
  `,
  entres: `
    <svg viewBox="2 2 28 28" width="56" height="56" fill="#116834">
      <path d="M14 26 C14 26 14 13 14 9 C14 5.5 17.5 3 22 2.5 C22.5 7 19.5 10.5 15.8 11 C15.8 13 15.8 17 15.8 26 Z" fill="#116834"/>
      <path d="M14 16.5 C10.5 16.5 6.5 14 6 10 C10 9.5 13.5 12 14 15 Z" fill="#116834"/>
      <circle cx="14" cy="24" r="2.5" fill="#116834"/>
    </svg>
  `,
  material: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  plantCare: `
    <svg viewBox="3 2 26 27" width="56" height="56" fill="#116834">
      <rect x="5" y="4" width="22" height="24" rx="4.5" fill="#116834"/>
      <line x1="9" y1="12" x2="19" y2="12" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="16" x2="19" y2="16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="20" x2="16" y2="20" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="23" cy="7" r="4.2" fill="#116834" stroke="#ffffff" stroke-width="1.5"/>
      <line x1="23" y1="4.8" x2="23" y2="9.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="20.8" y1="7" x2="25.2" y2="7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `,
  dispatch: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `
};

export function renderVerificationLanding() {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;

  const currentUser = session.getUser ? session.getUser() : (session.get ? session.get() : null);
  const userCtx = getCurrentUserContext() || resolveUserContext(currentUser);

  if (userCtx) {
    tinjauFilter.date = todayDDMMYYYY();
    tinjauFilter.estateId = userCtx.estateName || userCtx.estateId || '';
    tinjauFilter.divisionId = userCtx.divisionName || userCtx.divisionId || '';
  }

  if (currentVerifView === 'MODULE_GRID') {
    renderModuleGridView(app, userCtx);
  } else if (currentVerifView === 'TRANSACTION_LIST') {
    renderTransactionListView(app, userCtx);
  } else if (currentVerifView === 'TRANSACTION_DETAIL') {
    renderTransactionDetailView(app, userCtx);
  } else if (currentVerifView === 'MAINTENANCE_WORKER_DETAIL') {
    renderMaintenanceWorkerDetailView(app, userCtx);
  } else if (currentVerifView === 'TINJAU_FILTER') {
    renderTinjauSummaryView(app, userCtx);
  } else if (currentVerifView === 'TINJAU_SUMMARY') {
    renderTinjauSummaryView(app, userCtx);
  } else if (currentVerifView === 'TINJAU_DETAIL') {
    renderTinjauDetailView(app, userCtx);
  } else if (currentVerifView === 'SYNC_CONFIRMATION') {
    renderSyncConfirmationView(app, userCtx);
  } else if (currentVerifView === 'SYNC_SUCCESS') {
    renderSyncSuccessView(app, userCtx);
  } else if (currentVerifView === 'SYNC_HISTORY') {
    renderSyncHistoryView(app, userCtx);
  }
}

/**
 * SCREEN 3: Grid 10 Modul Verifikasi
 */
function renderModuleGridView(app, userCtx) {
  const actionableList = getActionableRecordsForAsb(userCtx);

  const moduleCards = VERIFICATION_10_MODULES.map((mod) => {
    const modCount = actionableList.filter(item => mod.types.includes(item.referenceType) || item.moduleCategory === mod.id).length;
    const iconSvg = MODULE_ICONS[mod.iconName] || MODULE_ICONS.sprout;

    return `
      <button class="beranda-menu-card verif-grid-card" data-module-id="${mod.id}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${iconSvg}</div>
        <div class="beranda-card-title">${mod.label}</div>
        ${modCount > 0 ? `
          <span style="position: absolute; top: 6px; right: 6px; background: #EF4444; color: #FFFFFF; font-size: 0.62rem; font-weight: 800; min-width: 18px; height: 18px; border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 0 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.15); z-index: 5;">
            ${modCount}
          </span>
        ` : ''}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <button id="verif-drawer-btn" type="button" aria-label="Menu" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0; letter-spacing: -0.01em;">Verifikasi</h1>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="verif-refresh-btn" type="button" aria-label="Segarkan" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
          <button id="verif-notif-btn" type="button" aria-label="Notifikasi" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </button>
        </div>
      </header>

      <!-- BODY: VERIFIKASI SUMMARY CARD + 10 MODULES GRID -->
      <main class="beranda-body" style="flex: 1; min-height: 0; overflow-y: auto; padding: 12px 10px 14px; display: flex; flex-direction: column; gap: 10px;">
        ${renderVerifikasiSummaryCardHtml(userCtx)}

        <div class="beranda-grid">
          ${moduleCards}
        </div>

        <!-- CTA TINJAU DATA HARI INI -->
        <div style="margin-top: auto; padding-top: 10px;">
          <button id="btn-open-tinjau" type="button" style="width: 100%; height: 42px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.84rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Tinjau Data Hari Ini</span>
          </button>
        </div>
      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  // Attach drawer
  app.querySelector('#verif-drawer-btn')?.addEventListener('click', openDrawer);

  // Refresh
  app.querySelector('#verif-refresh-btn')?.addEventListener('click', () => {
    toast('Data verifikasi diperbarui', 'info');
    renderVerificationLanding();
  });

  // Notif
  app.querySelector('#verif-notif-btn')?.addEventListener('click', () => {
    toast('Tidak ada notifikasi baru', 'info');
  });

  // Module card clicks -> open Screen 5
  app.querySelectorAll('.verif-grid-card').forEach((card) => {
    card.addEventListener('click', () => {
      activeModuleId = card.dataset.moduleId;
      previousVerifView = 'MODULE_GRID';
      currentVerifView = 'TRANSACTION_LIST';
      renderVerificationLanding();
    });
  });

  // Open Tinjau Data -> Langsung Final Review (TINJAU_SUMMARY)
  app.querySelector('#btn-open-tinjau')?.addEventListener('click', () => {
    previousVerifView = 'MODULE_GRID';
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
  });

  attachAsbBottomNavEvents(app);
}

/**
 * SCREEN 5: Verifikasi - Daftar Transaksi per Modul
 */
function renderTransactionListView(app, userCtx) {
  const currentMod = VERIFICATION_10_MODULES.find(m => m.id === activeModuleId) || VERIFICATION_10_MODULES[0];
  const allRecords = getVerificationRecordsByScope(userCtx);

  // Filter items matching this module and sort: Menunggu at top, Terverifikasi at bottom
  const combinedList = allRecords
    .filter(item => currentMod.types.includes(item.referenceType) || item.moduleCategory === currentMod.id)
    .sort((a, b) => {
      const isVerifiedA = a.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || a.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
      const isReturnedA = a.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || a.currentStatus === 'DIKEMBALIKAN' || a.currentStatus === 'REVISION' || a.rawRecord?.status === 'DIKEMBALIKAN';
      const prioA = (!isVerifiedA && !isReturnedA) ? 1 : (isReturnedA ? 2 : 3);

      const isVerifiedB = b.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || b.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
      const isReturnedB = b.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || b.currentStatus === 'DIKEMBALIKAN' || b.currentStatus === 'REVISION' || b.rawRecord?.status === 'DIKEMBALIKAN';
      const prioB = (!isVerifiedB && !isReturnedB) ? 1 : (isReturnedB ? 2 : 3);

      if (prioA !== prioB) return prioA - prioB;

      const timeA = new Date(a.submittedAt || a.date || a.createdAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.date || b.createdAt || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;

      return String(b.referenceDocNo || b.docNo || b.id || '').localeCompare(String(a.referenceDocNo || a.docNo || a.id || ''));
    });

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-to-grid" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">${currentMod.label}</h1>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="verif-refresh-btn2" type="button" aria-label="Segarkan" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
          <button id="verif-notif-btn2" type="button" aria-label="Notifikasi" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </button>
        </div>
      </header>

      <!-- DATE FILTER SELECTOR -->
      <div style="padding: 12px 14px 6px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between; border: 1px solid #CBD5E1; border-radius: 8px; padding: 8px 12px; background: #FFFFFF;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; color: #111827;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#116834" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${activeFilterDate}</span>
          </div>
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="#64748B" stroke-width="2" fill="none" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      <!-- TRANSACTION LIST -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        ${combinedList.length === 0 ? `
          <div style="background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px; padding: 32px 16px; text-align: center; color: #64748B;">
            <div style="font-size: 1.8rem; margin-bottom: 8px;">📋</div>
            <div style="font-size: 0.88rem; font-weight: 700; color: #1E293B;">Belum Ada Transaksi ${currentMod.label}</div>
            <div style="font-size: 0.74rem; margin-top: 4px;">Transaksi dari Mantri akan muncul di sini setelah dikirim via Central Hub.</div>
          </div>
        ` : combinedList.map(item => {
    const isVerified = item.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || item.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
    const isReturned = item.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || item.currentStatus === 'DIKEMBALIKAN' || item.currentStatus === 'REVISION' || item.rawRecord?.status === 'DIKEMBALIKAN';

    let badgeText = 'Menunggu';
    let badgeBg = '#FEF3C7';
    let badgeColor = '#92400E';

    if (isVerified) {
      badgeText = 'Terverifikasi';
      badgeBg = '#DEF7EC';
      badgeColor = '#03543F';
    } else if (isReturned) {
      badgeText = 'Dikembalikan';
      badgeBg = '#FEF2F2';
      badgeColor = '#DC2626';
    }

    const docNo = item.referenceDocNo || item.docNo || item.id;
    const dateStr = item.date ? String(item.date).substring(0, 10) : activeFilterDate;
    const workerName = item.submittedByName || item.rawRecord?.mantri || item.rawRecord?.actorName || 'Mantri Bibitan';
    const summaryText = item.normalizedData?.summary || item.summary || '';

    return `
            <div class="verif-tx-item" data-ref-type="${item.referenceType}" data-ref-id="${item.referenceId}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.02); gap: 10px;">
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                <div style="width: 36px; height: 36px; border-radius: 8px; background: #E8F5E9; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="#116834">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  </svg>
                </div>
                <div style="min-width: 0; flex: 1;">
                  <div style="font-size: 0.82rem; font-weight: 800; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${esc(docNo)}
                  </div>
                  ${summaryText ? `
                    <div style="font-size: 0.72rem; font-weight: 600; color: #334155; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${esc(summaryText)}
                    </div>
                  ` : ''}
                  <div style="font-size: 0.68rem; color: #64748B; margin-top: 2px;">
                    ${esc(workerName)} &bull; ${esc(dateStr)}
                  </div>
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span style="font-size: 0.65rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor};">
                  ${badgeText}
                </span>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#94A3B8" stroke-width="2.2" fill="none">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
          `;
  }).join('')}
      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  // Back button
  app.querySelector('#btn-back-to-grid')?.addEventListener('click', () => {
    currentVerifView = previousVerifView || 'MODULE_GRID';
    renderVerificationLanding();
  });

  // Refresh
  app.querySelector('#verif-refresh-btn2')?.addEventListener('click', () => {
    toast('Data diperbarui', 'info');
    renderVerificationLanding();
  });

  // Click transaction -> Screen 6
  app.querySelectorAll('.verif-tx-item').forEach((card) => {
    card.addEventListener('click', () => {
      const refType = card.dataset.refType;
      const refId = card.dataset.refId;
      const target = combinedList.find(t => t.referenceType === refType && String(t.referenceId) === String(refId));
      if (target) {
        selectedTxItem = target;
        currentVerifView = 'TRANSACTION_DETAIL';
        renderVerificationLanding();
      }
    });
  });

  attachAsbBottomNavEvents(app);
}

function isMaintenanceVerificationItem(item) {
  return ['PEMELIHARAAN', 'REKAM_PEMELIHARAAN', 'NURSERY_ACTIVITY'].includes(String(item?.referenceType || '').toUpperCase()) ||
    item?.moduleCategory === 'REKAM_PEMELIHARAAN';
}

function isMaintenanceWorkerApprovalItem(item) {
  const raw = item?.rawRecord || {};
  return isMaintenanceVerificationItem(item) && (
    raw.activityEntryMode === 'MANDORAN' || Boolean(raw.workGroupRoleCode || raw.workGroup?.workGroupRoleCode)
  ) && Array.isArray(raw.pekerja) && raw.pekerja.length > 0;
}

function getMaintenanceVerificationWorkers(raw) {
  const workers = Array.isArray(raw?.pekerja) ? raw.pekerja : [];
  const rawDate = raw.activityDate || raw.tanggal || raw.date || raw.createdAt;
  const workDate = new Date(rawDate || '');
  const standard = Number.isNaN(workDate.getTime()) ? null : getStandardWorkHoursForDate(workDate);
  const standardHours = standard?.workHours ?? null;
  const taskQuantity = Number(raw.taskQuantity) || Number(getWorkAllocationByCode(raw.allocationCode)?.taskQuantity) || 0;
  const standardOutput = standard?.dayName === 'Jumat' && taskQuantity > 0
    ? Math.round(taskQuantity * 5 / 7)
    : taskQuantity;

  return workers.map((worker) => {
    const result = Number(worker.inputHasil ?? worker.result ?? worker.quantity ?? 0) || 0;
    const isBelowTask = standardOutput > 0 && result < standardOutput;
    const effectiveCutDecision = worker.asistenPotongJamDecision || worker.potongJamDecision || '';
    const noCutApproved = effectiveCutDecision === 'TIDAK_SETUJU';
    const isPotongJam = isBelowTask && !noCutApproved;
    const proportionalHours = standardOutput > 0 && standardHours !== null
      ? Math.round((result / standardOutput) * standardHours)
      : null;
    const assistantOverrodeMantriToCut = worker.asistenPotongJamDecision === 'SETUJU' && worker.potongJamDecision === 'TIDAK_SETUJU';
    const hours = noCutApproved || !isBelowTask
      ? standardHours
      : (assistantOverrodeMantriToCut ? proportionalHours : Number(worker.durationHours) > 0 ? Number(worker.durationHours) : proportionalHours);

    return {
      workerId: String(worker.id || worker.workerId || `${worker.code || worker.workerCode || ''}-${worker.name || worker.workerName || ''}`),
      name: worker.name || worker.workerName || 'Pekerja',
      code: worker.code || worker.workerCode || worker.id || worker.workerId || '-',
      result,
      hours,
      isBelowTask,
      isPotongJam,
      mantriPotongJamDecision: worker.potongJamDecision || '',
      mantriPotongJamReason: worker.potongJamReason || '',
      asistenPotongJamDecision: worker.asistenPotongJamDecision || '',
      taskQuantity: standardOutput,
      standardHours,
      uom: raw.uomCode || raw.uom || raw.aktivitas?.uom || '',
      allocationCode: raw.allocationCode || '',
      allocationName: raw.allocationName || raw.workGroupRoleName || raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan',
      roleCode: raw.workGroupRoleCode || raw.workGroup?.roleCode || raw.workGroup?.workGroupRoleCode || '-',
      decisionStatus: worker.asistenVerificationStatus || '',
      returnReason: worker.asistenReturnReason || ''
    };
  });
}

function renderMaintenanceVerificationDetails(item, interactive = false) {
  const raw = item.rawRecord || {};
  const workers = getMaintenanceVerificationWorkers(raw);
  const allocationCode = raw.allocationCode || '';
  const allocationName = raw.allocationName || raw.workGroupRoleName || raw.aktivitas?.nama || raw.activityType || 'Pemeliharaan';
  const roleCode = raw.workGroupRoleCode || raw.workGroup?.roleCode || raw.workGroup?.workGroupRoleCode || '-';
  const location = raw.bedengan || raw.location || raw.lokasiBlok || raw.blok || '-';
  const uom = raw.uomCode || raw.uom || raw.aktivitas?.uom || '';
  const total = workers.reduce((sum, worker) => sum + worker.result, 0);
  const reviewedCount = workers.filter((worker) => ['DISETUJUI', 'DIKEMBALIKAN'].includes(worker.decisionStatus)).length;
  const title = allocationCode ? `${allocationCode} - ${allocationName}` : allocationName;

  return `
    <section style="overflow:hidden; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,.04);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; padding:12px; border-bottom:1px solid #D8D8D8;">
        <div style="min-width:0;">
          <div style="font-size:.86rem; line-height:1.35; font-weight:800; color:#116834; overflow-wrap:anywhere;">${esc(title)}</div>
          <div style="margin-top:4px; font-size:.72rem; color:#64748B;">${esc(roleCode)} · Lokasi: ${esc(location)}</div>
        </div>
        <span style="flex-shrink:0; font-size:.76rem; font-weight:800; color:#111827;">${esc(uom)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; gap:8px; padding:8px 12px; border-bottom:1px solid #222; font-size:.72rem; font-weight:800; color:#111827;">
        <span>Nama Pekerja</span><span>Hasil${uom ? ` (${esc(uom)})` : ''}</span>
      </div>
      ${workers.length ? workers.map((worker, index) => `
        <button type="button" class="asb-maintenance-worker-row" data-maint-worker-id="${esc(worker.workerId)}" ${interactive ? '' : 'disabled'} style="width:100%; display:grid; grid-template-columns:minmax(0,1fr) auto auto ${interactive ? 'auto' : ''}; text-align:left; background:#FFFFFF; align-items:center; gap:10px; padding:9px 12px; border:0; ${index < workers.length - 1 ? 'border-bottom:1px solid #E5E7EB;' : ''} ${interactive ? 'cursor:pointer;' : 'cursor:default;'}">
          <div style="min-width:0; display:flex; align-items:center; gap:8px;">
            <span aria-label="${worker.isPotongJam ? 'Di bawah Task Quantity' : 'Normal'}" style="width:13px; height:13px; flex:0 0 13px; border-radius:50%; background:${worker.isPotongJam ? '#F41424' : '#43B649'};"></span>
            <span style="min-width:0; display:flex; flex-direction:column; gap:3px;">
              <span style="font-size:.78rem; line-height:1.3; font-weight:750; color:#111827; overflow-wrap:anywhere;">${esc(worker.name)}</span>
              <span style="font-size:.68rem; color:#64748B;">${esc(worker.code)}</span>
            </span>
          </div>
          ${worker.decisionStatus ? `<span style="padding:4px 6px; border-radius:5px; background:${worker.decisionStatus === 'DISETUJUI' ? '#DEF7EC' : '#FEF2F2'}; color:${worker.decisionStatus === 'DISETUJUI' ? '#057A55' : '#DC2626'}; font-size:.6rem; line-height:1.2; font-weight:800; white-space:nowrap;">${worker.decisionStatus === 'DISETUJUI' ? 'DISETUJUI' : 'DIKEMBALIKAN'}</span>` : ''}
          <div style="text-align:right; white-space:nowrap;">
            <div style="font-size:.8rem; font-weight:800; color:#111827;">${worker.result.toLocaleString('id-ID')}</div>
            ${worker.hours !== null ? `<div style="margin-top:3px; font-size:.71rem; font-weight:700; color:${worker.isPotongJam ? '#DC2626' : '#16A34A'};">${Math.round(worker.hours).toLocaleString('id-ID')} Jam</div>` : ''}
          </div>
          ${interactive ? '<span aria-hidden="true" style="font-size:1.2rem; line-height:1; color:#087A3C;">›</span>' : ''}
        </button>
      `).join('') : `
        <div style="padding:12px; font-size:.76rem; color:#64748B;">Rincian hasil pekerja tidak tersedia pada dokumen ini.</div>
      `}
      <div style="display:flex; justify-content:space-between; gap:8px; padding:10px 12px; background:#F0FDF4; border-top:1px solid #D1FAE5; font-size:.78rem; font-weight:800; color:#116834;">
        <span>Volume Realisasi</span><span>${total.toLocaleString('id-ID')} ${esc(uom)}</span>
      </div>
      ${interactive ? `<div style="padding:8px 12px; border-top:1px solid #E5E7EB; font-size:.7rem; color:#64748B;">Persetujuan pekerja: ${reviewedCount}/${workers.length} selesai</div>` : ''}
    </section>
  `;
}

/**
 * SCREEN 6: Verifikasi - Detail Transaksi
 */
function renderTransactionDetailView(app, userCtx) {
  if (!selectedTxItem) {
    currentVerifView = 'MODULE_GRID';
    renderVerificationLanding();
    return;
  }

  // Gunakan normalizedData yang sudah terlampir pada selectedTxItem (Single Source of Truth)
  const norm = selectedTxItem.normalizedData || getVerificationDetailData(selectedTxItem.rawRecord, userCtx, selectedTxItem.referenceType);
  const currentMod = VERIFICATION_10_MODULES.find(m => m.id === selectedTxItem.moduleCategory || m.types.includes(selectedTxItem.referenceType)) || VERIFICATION_10_MODULES[0];
  const docNo = selectedTxItem.referenceDocNo || selectedTxItem.docNo || selectedTxItem.id;
  const isVerified = selectedTxItem.verificationStatus === VERIFICATION_STATUS.TERVERIFIKASI || selectedTxItem.verificationStatus === VERIFICATION_STATUS.DATA_TERKONFIRMASI;
  const isReturned = selectedTxItem.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN || selectedTxItem.currentStatus === 'DIKEMBALIKAN' || selectedTxItem.currentStatus === 'REVISION' || selectedTxItem.rawRecord?.status === 'DIKEMBALIKAN' || selectedTxItem.rawRecord?.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN;

  let badgeText = 'Menunggu';
  let badgeBg = '#FEF3C7';
  let badgeColor = '#92400E';

  if (isVerified) {
    badgeText = 'Terverifikasi';
    badgeBg = '#DEF7EC';
    badgeColor = '#03543F';
  } else if (isReturned) {
    badgeText = 'Dikembalikan';
    badgeBg = '#FEF2F2';
    badgeColor = '#DC2626';
  }

  const returnReasonText = selectedTxItem.returnReason || selectedTxItem.rawRecord?.returnReason || selectedTxItem.latestVerification?.returnReason || norm.returnReason;
  const dateStr = selectedTxItem.date ? String(selectedTxItem.date).substring(0, 10) : activeFilterDate;
  const workerName = selectedTxItem.submittedByName || selectedTxItem.rawRecord?.mantri || selectedTxItem.rawRecord?.actorName || userCtx?.name || 'Mantri';
  const isWorkerLevelMaintenance = isMaintenanceWorkerApprovalItem(selectedTxItem);
  const rawMaintenance = selectedTxItem.rawRecord || {};
  const maintenanceRoleCode = rawMaintenance.workGroupRoleCode || rawMaintenance.workGroup?.roleCode || rawMaintenance.workGroup?.workGroupRoleCode || '-';
  const rawItem = selectedTxItem.rawRecord || {};
  const photoUrl = rawItem.photoUrl || rawItem.evidencePhoto || rawItem.photo || rawItem.foto || rawItem.fotoUrl || selectedTxItem.photoUrl || selectedTxItem.evidencePhoto;

  // Render Rincian Data dinamis dari normalized fields (Zero hardcoding)
  const detailRows = (norm.fields || []).map(f => `
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F1F5F9;">
      <span style="color: #64748B;">${esc(f.label)}</span>
      <strong style="color: ${f.highlight ? '#116834' : '#0F172A'}; text-align: right;">${f.value}</strong>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-to-list" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Detail Transaksi</h1>
        </div>
      </header>

      <!-- BODY -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- CARD HEADER DOKUMEN -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div>
            <div style="font-size: 0.95rem; font-weight: 800; color: #111827;">${esc(norm.title || currentMod.label)}</div>
            <div style="font-size: 0.74rem; font-weight: 700; color: #116834; margin-top: 1px;">${esc(docNo)}</div>
            <div style="font-size: 0.7rem; color: #64748B; margin-top: 2px;">${esc(workerName)} &bull; ${esc(dateStr)}</div>
          </div>
          <span style="font-size: 0.65rem; font-weight: 700; padding: 4px 10px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor};">
            ${badgeText}
          </span>
        </div>

        <!-- CATATAN PENGEMBALIAN JIKA ADA -->
        ${returnReasonText ? `
          <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="font-size: 0.82rem; font-weight: 800; color: #DC2626; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="#DC2626" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              Catatan Pengembalian
            </div>
            <div style="font-size: 0.78rem; color: #991B1B; line-height: 1.4;">
              ${esc(returnReasonText)}
            </div>
          </div>
        ` : ''}

        <!-- INFORMASI UMUM -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="font-size: 0.84rem; font-weight: 800; color: #111827; margin-bottom: 10px; border-bottom: 1.5px solid #F1F5F9; padding-bottom: 6px;">
            Informasi Umum
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem;">
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Tanggal</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(dateStr)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Kebun</span>
              <span style="color: #0F172A; font-weight: 600;">Tanah Besih</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Divisi</span>
              <span style="color: #0F172A; font-weight: 600;">Divisi I</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Mantri</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(workerName)}</span>
            </div>
            ${isWorkerLevelMaintenance ? `
              <div style="display: flex; justify-content: space-between; gap:8px; padding: 4px 0;">
                <span style="color: #64748B;">Kode Mandoran</span>
                <span style="color: #116834; font-weight: 700; text-align:right;">${esc(maintenanceRoleCode)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                <span style="color: #64748B;">Nomor Dokumen</span>
                <span style="color: #116834; font-weight: 700;">${esc(docNo)}</span>
              </div>
            `}
          </div>
        </div>

        <!-- RINCIAN DATA -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="font-size: 0.84rem; font-weight: 800; color: #111827; margin-bottom: 10px; border-bottom: 1.5px solid #F1F5F9; padding-bottom: 6px;">
            Rincian Data
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem;">
            ${isWorkerLevelMaintenance ? renderMaintenanceVerificationDetails(selectedTxItem, true) : detailRows}
          </div>
        </div>

        <!-- LAMPIRAN FOTO DOKUMENTASI (JIKA ADA) -->
        ${photoUrl ? `
          <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="font-size: 0.84rem; font-weight: 800; color: #111827; margin-bottom: 8px; border-bottom: 1.5px solid #F1F5F9; padding-bottom: 6px;">
              Dokumentasi Foto Lapangan
            </div>
            <div style="border-radius: 8px; overflow: hidden; max-height: 240px; background: #0F172A; display: flex; align-items: center; justify-content: center;">
              <img src="${photoUrl}" alt="Dokumentasi Lapangan" style="width: 100%; height: auto; max-height: 240px; object-fit: contain;">
            </div>
          </div>
        ` : ''}

        <!-- ACTION BUTTONS IF PENDING, OR STATUS NOTICE -->
        ${isReturned ? `
          <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px; text-align: center; color: #DC2626; font-size: 0.78rem; font-weight: 700; margin-top: 8px;">
            ⚠ Dokumen ini telah dikembalikan ke Mantri untuk perbaikan
          </div>
        ` : (isVerified ? `
          <div style="background: #DEF7EC; border: 1px solid #A7F3D0; border-radius: 8px; padding: 12px; text-align: center; color: #03543F; font-size: 0.78rem; font-weight: 700; margin-top: 8px;">
            ✓ Dokumen ini telah selesai diverifikasi
          </div>
        ` : (isWorkerLevelMaintenance ? `
          <div style="margin-top:10px; padding:12px; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; color:#166534; font-size:.76rem; line-height:1.45; font-weight:700;">
            Buka rincian setiap pekerja untuk memberikan keputusan. Dokumen selesai setelah semua pekerja disetujui atau dikembalikan.
          </div>
        ` : `
          <div style="display: flex; gap: 10px; margin-top: 10px; padding-bottom: 10px;">
            ${!['TIDAK_HADIR', 'PHYSICAL_STOCK_RECONCILIATION'].includes(selectedTxItem.referenceType) ? `
              <button id="btn-tx-return" type="button" style="flex: 1; height: 42px; background: #FFFFFF; border: 1.5px solid #EF4444; color: #DC2626; border-radius: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                Kembalikan
              </button>
            ` : ''}
            <button id="btn-tx-approve" type="button" style="flex: 1; height: 42px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
              ${selectedTxItem.referenceType === 'PHYSICAL_STOCK_RECONCILIATION' ? 'Terapkan Rekonsiliasi' : 'Setujui'}
            </button>
          </div>
        `))}

      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  // Back button
  app.querySelector('#btn-back-to-list')?.addEventListener('click', () => {
    selectedMaintenanceWorkerId = null;
    currentVerifView = 'TRANSACTION_LIST';
    renderVerificationLanding();
  });

  app.querySelectorAll('.asb-maintenance-worker-row').forEach((button) => {
    button.addEventListener('click', () => {
      selectedMaintenanceWorkerId = button.dataset.maintWorkerId || null;
      currentVerifView = 'MAINTENANCE_WORKER_DETAIL';
      renderVerificationLanding();
    });
  });

  // Approve
  app.querySelector('#btn-tx-approve')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
      await approveVerification({
        referenceType: selectedTxItem.referenceType,
        referenceId: selectedTxItem.referenceId,
        currentUser: userCtx
      });
      toast(selectedTxItem.referenceType === 'PHYSICAL_STOCK_RECONCILIATION'
        ? `Rekonsiliasi ${docNo} berhasil diterapkan ke Inventory Ledger`
        : `Dokumen ${docNo} berhasil disetujui`, 'success');
      currentVerifView = 'TRANSACTION_LIST';
      renderVerificationLanding();
    } catch (err) {
      toast(err.message || 'Gagal menyetujui dokumen', 'error');
      if (btn) btn.disabled = false;
    }
  });

  // Return
  app.querySelector('#btn-tx-return')?.addEventListener('click', () => {
    openModal({
      title: 'Kembalikan Hasil Pemeriksaan',
      body: `
        <div style="font-size: 0.84rem; color: #334155; line-height: 1.5;">
          <p style="margin: 0 0 12px 0;">
            Kembalikan dokumen pemeriksaan <strong>${esc(docNo)}</strong> ke Mantri untuk perbaikan atau penyesuaian data.
          </p>
          <div style="margin-bottom: 14px;">
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #0F172A; margin-bottom: 4px;">Alasan Pengembalian (Wajib) <span style="color: #DC2626;">*</span></label>
            <textarea id="modal-return-reason" rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.82rem;" placeholder="Jelaskan alasan pengembalian..."></textarea>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="btn-cancel-modal" type="button" style="flex: 1; height: 38px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 6px; font-weight: 600; cursor: pointer;">Batal</button>
            <button id="btn-confirm-return" type="button" style="flex: 1; height: 38px; background: #DC2626; color: #FFF; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Kembalikan</button>
          </div>
        </div>
      `
    });

    document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-confirm-return')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn?.disabled) return;
      const reason = document.getElementById('modal-return-reason')?.value || '';
      if (!reason.trim()) {
        toast('Alasan pengembalian wajib diisi.', 'error');
        return;
      }
      if (btn) btn.disabled = true;
      try {
        returnVerification({
          referenceType: selectedTxItem.referenceType,
          referenceId: selectedTxItem.referenceId,
          returnReason: reason.trim(),
          currentUser: userCtx
        });
        closeModal();
        toast(`Dokumen ${docNo} dikembalikan untuk revisi`, 'info');
        currentVerifView = 'TRANSACTION_LIST';
        renderVerificationLanding();
      } catch (err) {
        if (btn) btn.disabled = false;
        toast(err.message || 'Gagal mengembalikan dokumen', 'error');
      }
    });
  });

  attachAsbBottomNavEvents(app);
}

function renderMaintenanceWorkerDetailView(app, userCtx) {
  if (!selectedTxItem || !isMaintenanceVerificationItem(selectedTxItem)) {
    currentVerifView = 'TRANSACTION_LIST';
    renderVerificationLanding();
    return;
  }

  const raw = selectedTxItem.rawRecord || {};
  const worker = getMaintenanceVerificationWorkers(raw).find((item) => item.workerId === String(selectedMaintenanceWorkerId));
  if (!worker) {
    currentVerifView = 'TRANSACTION_DETAIL';
    renderVerificationLanding();
    return;
  }
  const variance = worker.result - worker.taskQuantity;
  const isDecided = ['DISETUJUI', 'DIKEMBALIKAN'].includes(worker.decisionStatus);
  const isReturned = worker.decisionStatus === 'DIKEMBALIKAN';
  const statusColor = worker.isPotongJam ? '#DC2626' : '#16A34A';
  const finalCutDecision = worker.asistenPotongJamDecision || worker.mantriPotongJamDecision || '';
  const transactionDateYMD = extractDateYMD(selectedTxItem.date);
  const transactionDate = transactionDateYMD
    ? (() => {
        const [year, month, day] = transactionDateYMD.split('-').map(Number);
        return new Date(year, month - 1, day).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      })()
    : (selectedTxItem.date || '-');
  app.innerHTML = `
    <div class="page verif-page" style="position:relative; display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; background:#EEEEEE; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <header style="height:52px; flex-shrink:0; display:flex; align-items:center; gap:10px; padding:0 14px; background:#FFFFFF; border-bottom:1px solid #D9DDE2;">
        <button id="btn-back-maint-worker" type="button" aria-label="Kembali" style="padding:6px; margin-left:-6px; border:0; background:transparent; color:#116834; cursor:pointer; display:flex;">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <h1 style="font-size:1.05rem; font-weight:800; color:#111827; margin:0 0 0 4px;">Data Pekerja Bibitan</h1>
      </header>
      <div style="flex-shrink:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; padding:11px 17px; background:#FFFFFF; border-bottom:1px solid #E1E1E1;">
        <div style="min-width:0;">
          <div style="font-size:.95rem; font-weight:800; color:#111827;">${esc(worker.name)}</div>
          <div style="margin-top:4px; font-size:.75rem; color:#7B8188;">${esc(worker.code)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.86rem; line-height:1.2; color:${statusColor}; font-weight:800;">${worker.result.toLocaleString('id-ID')} ${esc(worker.uom)}</div>
          <div style="margin-top:3px; font-size:.72rem; font-weight:700; color:${statusColor};">${worker.hours === null ? 'Jam belum tersedia' : `${Math.round(worker.hours).toLocaleString('id-ID')} Jam`}</div>
        </div>
      </div>
      <main style="flex:1; min-height:0; overflow-y:auto; padding:13px 15px 18px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 10px;">
          <h2 style="margin:0; font-size:.94rem; font-weight:800; color:#111827;">Data Pemeliharaan</h2>
          ${isDecided ? `<span style="padding:5px 7px; border-radius:5px; background:${isReturned ? '#FEF2F2' : '#DEF7EC'}; color:${isReturned ? '#DC2626' : '#057A55'}; font-size:.62rem; font-weight:900;">${isReturned ? 'DIKEMBALIKAN' : 'DISETUJUI'}</span>` : worker.isPotongJam ? '<span style="padding:5px 7px; border-radius:4px; background:#F41424; color:#FFFFFF; font-size:.57rem; font-weight:900;">POTONG JAM</span>' : '<span style="padding:5px 7px; border-radius:4px; background:#E8F5E9; color:#116834; font-size:.62rem; font-weight:900;">NORMAL</span>'}
        </div>
        <section style="overflow:hidden; margin-bottom:18px; background:#FFFFFF; border:1px solid #DDDDDD; border-radius:9px; box-shadow:0 2px 4px rgba(0,0,0,.1);">
          <div style="display:flex; justify-content:space-between; gap:10px; padding:11px 13px; border-bottom:1px solid #E1E1E1; font-size:.83rem; font-weight:750; color:#111827;"><span>Kode Mandoran</span><span style="text-align:right;">${esc(worker.roleCode)}</span></div>
          <div style="display:flex; justify-content:space-between; gap:10px; padding:11px 13px; border-bottom:1px solid #E1E1E1; font-size:.83rem; font-weight:750; color:#111827;"><span style="min-width:0; overflow-wrap:anywhere;">${esc(worker.allocationCode ? `${worker.allocationCode} - ${worker.allocationName}` : worker.allocationName)}</span><span style="flex-shrink:0; text-align:right;">${esc(worker.uom)}</span></div>
          <div style="display:flex; justify-content:space-between; gap:10px; padding:11px 22px; border-bottom:1px solid #E1E1E1; font-size:.83rem; color:#111827;"><span style="font-weight:750;">${esc(worker.name)} <small style="font-weight:500; color:#555;">(${esc(worker.code)})</small></span><span style="font-weight:800; color:${statusColor}; text-align:right;">${worker.result.toLocaleString('id-ID')}</span></div>
          <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 22px; border-bottom:1px solid #E1E1E1; font-size:.81rem; color:#111827;"><span>Norma / Basis Borong</span><span style="font-weight:750; text-align:right;">${worker.taskQuantity.toLocaleString('id-ID')}</span></div>
          <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 22px; border-bottom:1px solid #E1E1E1; font-size:.81rem; color:#111827;"><span>Lebih (Kurang) Basis</span><span style="font-weight:800; color:${variance < 0 ? '#DC2626' : '#111827'}; text-align:right;">${variance.toLocaleString('id-ID')} ${esc(worker.uom)}</span></div>
          ${worker.isBelowTask ? `
            <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 22px; border-bottom:1px solid #E1E1E1; font-size:.81rem; color:#111827;"><span>Keputusan Potong Jam Mantri</span><span style="font-weight:750; text-align:right; color:${worker.mantriPotongJamDecision === 'SETUJU' ? '#DC2626' : worker.mantriPotongJamDecision === 'TIDAK_SETUJU' ? '#116834' : '#64748B'};">${worker.mantriPotongJamDecision === 'SETUJU' ? 'Ya, Potong Jam' : worker.mantriPotongJamDecision === 'TIDAK_SETUJU' ? 'Tidak Potong Jam' : 'Belum ditetapkan'}</span></div>
            ${worker.mantriPotongJamReason ? `<div style="display:flex; justify-content:space-between; gap:10px; padding:8px 22px; border-bottom:1px solid #E1E1E1; font-size:.77rem; color:#64748B;"><span>Alasan Mantri</span><span style="font-weight:600; text-align:right; color:#334155;">${esc(worker.mantriPotongJamReason)}</span></div>` : ''}
          ` : ''}
          ${isDecided && worker.asistenPotongJamDecision ? `<div style="display:flex; justify-content:space-between; gap:10px; padding:10px 22px; border-bottom:1px solid #E1E1E1; font-size:.81rem; color:#111827;"><span>Keputusan Final Asisten</span><span style="font-weight:750; text-align:right; color:${worker.asistenPotongJamDecision === 'SETUJU' ? '#DC2626' : '#116834'};">${worker.asistenPotongJamDecision === 'SETUJU' ? 'Ya, Potong Jam' : 'Tidak Potong Jam'}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 22px; font-size:.81rem; color:#111827;"><span>Tanggal Transaksi</span><span style="font-weight:750; text-align:right;">${esc(transactionDate)}</span></div>
        </section>
        ${worker.isBelowTask && !isDecided ? `
          <section style="margin:0 0 14px; padding:12px; background:#FFFFFF; border:1px solid #D9DDE2; border-radius:9px;">
            <h2 style="margin:0 0 9px; font-size:.86rem; font-weight:800; color:#111827;">Keputusan Final Asisten: Potong Jam</h2>
            <div style="display:flex; gap:24px; align-items:center;">
              <label style="display:flex; align-items:center; gap:7px; font-size:.84rem; color:#222; cursor:pointer;"><input type="radio" name="asisten-potong-jam-decision" value="TIDAK_SETUJU" ${finalCutDecision === 'TIDAK_SETUJU' ? 'checked' : ''} style="width:19px; height:19px; accent-color:#43A047;">Tidak</label>
              <label style="display:flex; align-items:center; gap:7px; font-size:.84rem; color:#222; cursor:pointer;"><input type="radio" name="asisten-potong-jam-decision" value="SETUJU" ${finalCutDecision === 'SETUJU' ? 'checked' : ''} style="width:19px; height:19px; accent-color:#43A047;">Ya</label>
            </div>
            <div style="margin-top:7px; font-size:.71rem; line-height:1.4; color:#64748B;">Pilihan ini menjadi keputusan akhir Asisten atas keputusan Mantri.</div>
          </section>
        ` : ''}
        ${isReturned ? `<div style="padding:11px; background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; color:#991B1B; font-size:.77rem; line-height:1.45;"><strong>Alasan pengembalian:</strong> ${esc(worker.returnReason || selectedTxItem.latestVerification?.workerDecisions?.[worker.workerId]?.returnReason || '-')}</div>` : ''}
      </main>
      <footer style="flex-shrink:0; padding:12px 16px 14px; background:#FFFFFF; border-top:1px solid #D9DDE2;">
        ${isDecided ? `<button id="btn-return-maint-worker-detail" type="button" style="width:100%; height:44px; border:1px solid #116834; border-radius:7px; background:#FFFFFF; color:#116834; font-size:.9rem; font-weight:700; cursor:pointer;">Kembali ke Rincian Dokumen</button>` : `
          <div style="display:flex; gap:9px;">
            <button id="btn-return-maint-worker" type="button" style="flex:1; height:44px; border:1.5px solid #EF4444; border-radius:7px; background:#FFFFFF; color:#DC2626; font-size:.86rem; font-weight:700; cursor:pointer;">Kembalikan</button>
            <button id="btn-approve-maint-worker" type="button" style="flex:1; height:44px; border:0; border-radius:7px; background:#116834; color:#FFFFFF; font-size:.86rem; font-weight:700; cursor:pointer;">Setujui Pekerja</button>
          </div>
        `}
      </footer>
      ${renderAsbBottomNav('verifikasi')}
    </div>
  `;

  const backToDocument = () => {
    selectedMaintenanceWorkerId = null;
    currentVerifView = 'TRANSACTION_DETAIL';
    renderVerificationLanding();
  };
  app.querySelector('#btn-back-maint-worker')?.addEventListener('click', backToDocument);
  app.querySelector('#btn-return-maint-worker-detail')?.addEventListener('click', backToDocument);
  const refreshDocument = () => {
    const refreshed = getActionableRecordsForAsb(userCtx).find((item) =>
      item.referenceType === selectedTxItem.referenceType && String(item.referenceId) === String(selectedTxItem.referenceId)
    );
    selectedMaintenanceWorkerId = null;
    if (refreshed) {
      selectedTxItem = refreshed;
      currentVerifView = 'TRANSACTION_DETAIL';
    } else {
      selectedTxItem = null;
      currentVerifView = 'TRANSACTION_LIST';
    }
    renderVerificationLanding();
  };

  app.querySelector('#btn-approve-maint-worker')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const asistenPotongJamDecision = worker.isBelowTask
      ? app.querySelector('input[name="asisten-potong-jam-decision"]:checked')?.value || ''
      : '';
    if (worker.isBelowTask && !asistenPotongJamDecision) {
      toast('Pilih keputusan final Potong Jam terlebih dahulu.', 'warning');
      return;
    }
    button.disabled = true;
    try {
      const result = approveMaintenanceWorker({ referenceId: selectedTxItem.referenceId, workerId: worker.workerId, asistenPotongJamDecision, currentUser: userCtx });
      toast(result.allWorkersApproved ? 'Semua pekerja telah disetujui. Dokumen terverifikasi.' : `Hasil ${worker.name} disetujui.`, 'success');
      refreshDocument();
    } catch (error) {
      button.disabled = false;
      toast(error.message || 'Gagal menyetujui pekerja.', 'error');
    }
  });

  app.querySelector('#btn-return-maint-worker')?.addEventListener('click', () => {
    openModal({
      title: 'Kembalikan Hasil Pekerja',
      body: `
        <div style="font-size:.84rem; color:#334155; line-height:1.5;">
          <p style="margin:0 0 12px;">Kembalikan hasil <strong>${esc(worker.name)}</strong> pada ${esc(worker.roleCode)} ke Mantri untuk diperbaiki.</p>
          <label for="modal-maint-worker-return-reason" style="display:block; font-size:.78rem; font-weight:700; color:#0F172A; margin-bottom:4px;">Alasan Pengembalian (Wajib) *</label>
          <textarea id="modal-maint-worker-return-reason" rows="3" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #CBD5E1; border-radius:6px; font-size:.82rem;" placeholder="Jelaskan alasan pengembalian..."></textarea>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button id="btn-cancel-maint-worker-return" type="button" style="flex:1; height:38px; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; font-weight:600; cursor:pointer;">Batal</button>
            <button id="btn-confirm-maint-worker-return" type="button" style="flex:1; height:38px; background:#DC2626; color:#FFFFFF; border:0; border-radius:6px; font-weight:700; cursor:pointer;">Kembalikan</button>
          </div>
        </div>
      `
    });
    document.getElementById('btn-cancel-maint-worker-return')?.addEventListener('click', closeModal);
    document.getElementById('btn-confirm-maint-worker-return')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      const reason = document.getElementById('modal-maint-worker-return-reason')?.value?.trim() || '';
      if (!reason) {
        toast('Alasan pengembalian wajib diisi.', 'error');
        return;
      }
      button.disabled = true;
      try {
        const result = returnMaintenanceWorker({ referenceId: selectedTxItem.referenceId, workerId: worker.workerId, returnReason: reason, currentUser: userCtx });
        closeModal();
        toast(result.verificationStatus === VERIFICATION_STATUS.DIKEMBALIKAN
          ? `Keputusan pekerja tersimpan. Dokumen dikembalikan ke Mantri untuk revisi.`
          : `Hasil ${worker.name} dikembalikan ke Mantri.`, 'info');
        refreshDocument();
      } catch (error) {
        button.disabled = false;
        toast(error.message || 'Gagal mengembalikan pekerja.', 'error');
      }
    });
  });
  attachAsbBottomNavEvents(app);
}

/**
 * SCREEN 7: Tinjau Data Hari Ini (Form Filter)
 */
function renderTinjauFilterView(app, userCtx) {
  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-to-grid2" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Tinjau Data Hari Ini</h1>
        </div>
      </header>

      <!-- BODY: FILTER FORM -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 16px;">
        
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 16px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          
          <!-- Periode Data -->
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #64748B; margin-bottom: 6px;">Periode Data</label>
            <div style="display: flex; align-items: center; justify-content: space-between; border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; background: #FFFFFF;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.84rem; font-weight: 700; color: #111827;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#116834" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span>${tinjauFilter.date}</span>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="#64748B" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>

          <!-- Kebun -->
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #64748B; margin-bottom: 6px;">Kebun</label>
            <div style="display: flex; align-items: center; justify-content: space-between; border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; background: #FFFFFF;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.84rem; font-weight: 700; color: #111827;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#116834" stroke-width="2"><path d="M12 22V12 M12 12C12 7 8 4 8 4s-1 4 4 8z M12 12c0-5 4-8 4-8s1 4-4 8z"></path></svg>
                <span>${tinjauFilter.estateId}</span>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="#64748B" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>

          <!-- Divisi -->
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #64748B; margin-bottom: 6px;">Divisi</label>
            <div style="display: flex; align-items: center; justify-content: space-between; border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; background: #FFFFFF;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.84rem; font-weight: 700; color: #111827;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#116834" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                <span>${tinjauFilter.divisionId}</span>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="#64748B" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>

          <!-- Tombol Lihat Data -->
          <div style="margin-top: 8px;">
            <button id="btn-submit-tinjau-filter" type="button" style="width: 100%; height: 44px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.86rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="#FFFFFF" stroke-width="2.2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Lihat Data</span>
            </button>
          </div>

        </div>

      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  app.querySelector('#btn-back-to-grid2')?.addEventListener('click', () => {
    currentVerifView = 'MODULE_GRID';
    renderVerificationLanding();
  });

  app.querySelector('#btn-submit-tinjau-filter')?.addEventListener('click', () => {
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
  });

  attachAsbBottomNavEvents(app);
}

/**
 * SCREEN 8 & 10: Tinjau Data Hari Ini - Daftar Transaksi Ringkasan 10 Modul
 */
function renderTinjauSummaryView(app, userCtx) {
  const summary10 = get10ModulesSummary(userCtx);
  const canSend = canSubmitFinalVerificationToServer(userCtx);

  const moduleRows = summary10.map(mod => {
    const iconSvg = MODULE_ICONS[VERIFICATION_10_MODULES.find(m => m.id === mod.id)?.iconName] || MODULE_ICONS.sprout;

    return `
      <div class="tinjau-mod-row" data-mod-id="${mod.id}" style="display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: #116834;">
            ${iconSvg}
          </div>
          <span style="font-size: 0.82rem; font-weight: 700; color: #111827;">${mod.label}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.74rem; font-weight: 700; color: ${mod.verifiedCount > 0 ? '#116834' : '#64748B'};">
            ${mod.verifiedCount} transaksi
          </span>
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="#94A3B8" stroke-width="2.2" fill="none">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER: DENGAN ICON DOKUMEN RIWAYAT SEJAJAR TINJAU DATA HARI INI -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-to-filter" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Tinjau Data Hari Ini</h1>
        </div>
        <button id="btn-sync-history-from-tinjau" type="button" aria-label="Riwayat Pengiriman Server" title="Lihat Riwayat Pengiriman Data ke Server" style="background: transparent; border: none; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834; border-radius: 8px;">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
      </header>

      <!-- BODY -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- LIST OF 10 MODULES -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${moduleRows}
        </div>

        <!-- SCREEN 10 CHECKMARK & KIRIM DATA -->
        <div style="margin-top: 10px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          ${canSend ? `
            <div style="width: 52px; height: 52px; border-radius: 50%; background: #116834; display: flex; align-items: center; justify-content: center; color: #FFFFFF; margin-bottom: 2px;">
              <svg viewBox="0 0 24 24" width="30" height="30" stroke="#FFFFFF" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <div style="font-size: 0.95rem; font-weight: 800; color: #111827;">Semua transaksi sudah diverifikasi</div>
            <div style="font-size: 0.74rem; color: #64748B; margin-bottom: 8px;">Data siap dikirim ke server.</div>
            <button id="btn-send-to-server" type="button" style="width: 100%; height: 44px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.88rem; font-weight: 700; cursor: pointer; text-align: center; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
              Kirim Data ke Server
            </button>
          ` : `
            <div style="font-size: 0.84rem; font-weight: 700; color: #B45309;">Masih ada transaksi yang belum selesai diverifikasi</div>
            <div style="font-size: 0.72rem; color: #64748B; margin-bottom: 8px;">Selesaikan verifikasi seluruh modul sebelum mengirim ke server.</div>
            <button id="btn-send-to-server" type="button" disabled style="width: 100%; height: 44px; background: #E2E8F0; color: #94A3B8; border: none; border-radius: 8px; font-size: 0.88rem; font-weight: 700; cursor: not-allowed; text-align: center;">
              Kirim Data ke Server
            </button>
          `}
        </div>

      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  // Back button -> kembali langsung ke halaman Verifikasi utama (MODULE_GRID)
  app.querySelector('#btn-back-to-filter')?.addEventListener('click', () => {
    currentVerifView = 'MODULE_GRID';
    renderVerificationLanding();
  });

  // Click module row -> ALWAYS open Daftar Transaksi (Screen 5) for this module
  app.querySelectorAll('.tinjau-mod-row').forEach((row) => {
    row.addEventListener('click', () => {
      const modId = row.dataset.modId;
      const modSummary = summary10.find(m => m.id === modId);
      if (modSummary && (modSummary.verifiedCount > 0 || modSummary.pendingCount > 0)) {
        activeModuleId = modId;
        previousVerifView = 'TINJAU_SUMMARY';
        currentVerifView = 'TRANSACTION_LIST';
        renderVerificationLanding();
      } else {
        toast(`Belum ada transaksi untuk modul ini`, 'info');
      }
    });
  });

  // Kirim ke server -> Pindah ke Full Screen Konfirmasi Pengiriman
  app.querySelector('#btn-send-to-server')?.addEventListener('click', () => {
    if (!canSend) return;
    currentVerifView = 'SYNC_CONFIRMATION';
    renderVerificationLanding();
  });

  // Icon dokumen riwayat pengiriman data ke server
  app.querySelector('#btn-sync-history-from-tinjau')?.addEventListener('click', () => {
    syncHistorySourceView = 'TINJAU_SUMMARY';
    currentVerifView = 'SYNC_HISTORY';
    renderVerificationLanding();
  });

  attachAsbBottomNavEvents(app);
}

/**
 * Helper format tanggal & waktu penuh dengan detik (DD/MM/YYYY HH:mm:ss WIB)
 */
function formatSyncTimestamp(dateIso = null) {
  const d = dateIso ? new Date(dateIso) : new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} WIB`;
}

/**
 * TAMPILAN FULL SCREEN: Konfirmasi & Proses Pengiriman Dokumen ke Server
 * Dilengkapi animasi loading berurutan per dokumen, centang hijau sukses,
 * dan timestamp pengiriman. Tombol dan header tetap clean text tanpa icon tambahan.
 */
function renderSyncConfirmationView(app, userCtx) {
  const verifiedList = getVerifiedTransactionsByScope(userCtx);
  if (!verifiedList || verifiedList.length === 0) {
    toast('Tidak ada transaksi terverifikasi untuk dikirim', 'warning');
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
    return;
  }

  // Siapkan item terverifikasi yang akan dikirim
  const itemsToSend = verifiedList.map(v => {
    const mod = VERIFICATION_10_MODULES.find(m => m.id === v.moduleCategory || m.types.includes(v.referenceType));
    const docNo = v.referenceDocNo || v.docNo || v.id;
    return {
      docNo,
      moduleLabel: mod ? mod.label : (v.referenceType || 'Transaksi'),
      submittedByName: v.submittedByName || v.rawRecord?.mantri || userCtx?.name || 'Mantri Bibitan',
      referenceType: v.referenceType,
      referenceId: v.referenceId,
      syncedAt: null
    };
  });

  app.innerHTML = `
    <style>
      @keyframes syncSpin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER BERSIH TANPA ICON TAMBAHAN -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-sync-confirm" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 id="sync-header-title" style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Kirim Data ke Server</h1>
        </div>
      </header>

      <!-- BODY SCROLLABLE -->
      <main id="sync-main-container" style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- CARD RINGKASAN & STATUS PROGRESS -->
        <div id="sync-banner-card" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: all 0.3s ease;">
          <div id="sync-banner-title" style="font-size: 1.05rem; font-weight: 800; color: #111827; margin-bottom: 4px;">
            ${itemsToSend.length} Dokumen Terverifikasi
          </div>
          <div id="sync-banner-sub" style="font-size: 0.78rem; color: #64748B; line-height: 1.45;">
            Seluruh dokumen di bawah ini telah selesai diverifikasi dan siap untuk di kirim ke server.
          </div>
          <!-- Progress bar animatif -->
          <div id="sync-progress-bar-container" style="display: none; margin-top: 12px; width: 100%; background: #E2E8F0; height: 6px; border-radius: 999px; overflow: hidden;">
            <div id="sync-progress-bar" style="background: #116834; height: 100%; width: 0%; transition: width 0.25s ease;"></div>
          </div>
          <div id="sync-progress-label" style="display: none; margin-top: 5px; font-size: 0.68rem; font-weight: 700; color: #116834; text-align: right;"></div>
        </div>

        <!-- LIST NOMOR DOKUMEN -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div id="sync-list-header-label" style="font-size: 0.82rem; font-weight: 700; color: #475569;">
            Rincian Nomor Dokumen yang Dikirim:
          </div>

          <div id="sync-doc-list" style="display: flex; flex-direction: column; gap: 8px;">
            ${itemsToSend.map((item, idx) => `
              <div id="sync-item-${idx}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: all 0.25s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <div style="font-size: 0.88rem; font-weight: 800; color: #116834; word-break: break-all;">
                    ${esc(item.docNo)}
                  </div>
                  <div id="sync-badge-container-${idx}">
                    <span style="font-size: 0.7rem; font-weight: 700; background: #DEF7EC; color: #03543F; padding: 4px 10px; border-radius: 6px; white-space: nowrap;">
                      Siap Kirim
                    </span>
                  </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px;">
                  <span style="min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.72rem; color: #64748B;">${esc(item.moduleLabel)} &bull; ${esc(item.submittedByName)}</span>
                  <span id="sync-time-${idx}" style="font-size: 0.64rem; font-weight: 600; color: #64748B; white-space: nowrap; flex-shrink: 0; letter-spacing: -0.2px;"></span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

      </main>

      <!-- BOTTOM ACTION BAR: TOMBOL BERSIH TANPA ICON TAMBAHAN -->
      <footer id="sync-footer-bar" style="padding: 12px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; display: flex; gap: 10px; flex-shrink: 0;">
        <button id="btn-cancel-sync-screen" type="button" style="flex: 1; height: 46px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 8px; font-weight: 700; font-size: 0.88rem; color: #475569; cursor: pointer; text-align: center;">
          Batal
        </button>
        <button id="btn-confirm-sync-screen" type="button" style="flex: 1.5; height: 46px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-align: center; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
          Kirim Sekarang
        </button>
      </footer>

    </div>
  `;

  // Listener Batal & Kembali
  const backBtn = app.querySelector('#btn-back-sync-confirm');
  const cancelBtn = app.querySelector('#btn-cancel-sync-screen');
  const confirmBtn = app.querySelector('#btn-confirm-sync-screen');

  backBtn?.addEventListener('click', () => {
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
  });
  cancelBtn?.addEventListener('click', () => {
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
  });

  // Listener Kirim Sekarang dengan Animasi Loading Berurutan per Dokumen
  confirmBtn?.addEventListener('click', async () => {
    // Kunci tombol tindakan agar proses tidak terinterupsi
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Sedang Mengirim...';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (backBtn) backBtn.style.visibility = 'hidden';

    const headerTitle = app.querySelector('#sync-header-title');
    const bannerTitle = app.querySelector('#sync-banner-title');
    const bannerSub = app.querySelector('#sync-banner-sub');
    const progressBarContainer = app.querySelector('#sync-progress-bar-container');
    const progressBar = app.querySelector('#sync-progress-bar');
    const progressLabel = app.querySelector('#sync-progress-label');
    const footerBar = app.querySelector('#sync-footer-bar');
    const listHeaderLabel = app.querySelector('#sync-list-header-label');

    if (headerTitle) headerTitle.textContent = 'Mengirim Data ke Server...';
    if (progressBarContainer) progressBarContainer.style.display = 'block';
    if (progressLabel) {
      progressLabel.style.display = 'block';
      progressLabel.textContent = `0/${itemsToSend.length} berhasil`;
    }
    if (listHeaderLabel) listHeaderLabel.textContent = 'Proses Pengiriman Dokumen Berurutan:';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const delayPerDoc = Math.max(240, Math.min(420, Math.round(5000 / itemsToSend.length)));

    // Proses pengiriman berurutan dari dokumen paling awal sampai akhir
    for (let i = 0; i < itemsToSend.length; i++) {
      const item = itemsToSend[i];
      const itemEl = app.querySelector(`#sync-item-${i}`);
      const badgeContainer = app.querySelector(`#sync-badge-container-${i}`);
      const timeEl = app.querySelector(`#sync-time-${i}`);

      // Update informasi progress di banner
      if (bannerTitle) {
        bannerTitle.textContent = `Mengirim Dokumen (${i + 1}/${itemsToSend.length})`;
      }
      if (bannerSub) {
        bannerSub.textContent = `Sedang memproses ${esc(item.docNo)} (${esc(item.moduleLabel)})...`;
      }
      if (progressBar) {
        progressBar.style.width = `${Math.round(((i) / itemsToSend.length) * 100)}%`;
      }

      // Highlight item yang sedang dikirim & scroll ke posisinya
      if (itemEl) {
        itemEl.style.borderColor = '#CBD5E1';
        itemEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Tampilkan animasi loading spinner pada dokumen aktif
      if (badgeContainer) {
        badgeContainer.innerHTML = `
          <span style="font-size: 0.7rem; font-weight: 700; background: #FEF3C7; color: #92400E; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">
            <span style="display: inline-block; width: 11px; height: 11px; border: 2px solid #D97706; border-top-color: transparent; border-radius: 50%; animation: syncSpin 0.65s linear infinite;"></span>
            Mengirim...
          </span>
        `;
      }

      // Tunggu jeda animasi dokumen saat ini
      await sleep(delayPerDoc);

      // Selesai pengiriman untuk dokumen ini: centang hijau + badge terkirim + timestamp
      const nowIso = new Date().toISOString();
      const docTimestamp = formatSyncTimestamp(nowIso);
      item.syncedAt = nowIso;

      if (itemEl) {
        itemEl.style.borderColor = '#E2E8F0';
        itemEl.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
      }

      if (badgeContainer) {
        badgeContainer.innerHTML = `
          <span style="font-size: 0.7rem; font-weight: 700; background: #DEF7EC; color: #03543F; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="#03543F" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Terkirim
          </span>
        `;
      }

      if (timeEl) {
        timeEl.textContent = docTimestamp;
      }

      if (progressBar) {
        progressBar.style.width = `${Math.round(((i + 1) / itemsToSend.length) * 100)}%`;
      }
      if (progressLabel) {
        progressLabel.textContent = `${i + 1}/${itemsToSend.length} berhasil`;
      }
    }

    // Seluruh dokumen selesai dikirim: submit final ke storage
    try {
      const result = submitFinalVerificationToServer(userCtx);
      lastSyncResult = {
        ...result,
        items: itemsToSend
      };
    } catch (err) {
      toast(err.message || 'Gagal merekam sinkronisasi ke storage', 'warning');
    }

    // Update status header & banner menjadi Pengiriman Berhasil
    if (headerTitle) headerTitle.textContent = 'Pengiriman Berhasil';
    if (bannerTitle) {
      bannerTitle.style.color = '#116834';
      bannerTitle.textContent = 'Data Berhasil Dikirim ke Server';
    }
    if (bannerSub) {
      bannerSub.innerHTML = `Sebanyak <strong>${itemsToSend.length} dokumen</strong> telah terkirim ke server.`;
    }
    if (listHeaderLabel) {
      listHeaderLabel.textContent = 'Bukti & Timestamp Pengiriman per Dokumen:';
    }
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.style.background = '#116834';
    }
    if (progressLabel) {
      progressLabel.textContent = `${itemsToSend.length}/${itemsToSend.length} berhasil`;
    }

    // Update tombol bawah: Hanya 2 tombol (Kembali ke Beranda & Kirim Ulang)
    if (footerBar) {
      footerBar.innerHTML = `
        <button id="btn-sync-finish-home-screen" type="button" style="flex: 1; height: 46px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 8px; font-weight: 700; font-size: 0.88rem; color: #475569; cursor: pointer; text-align: center;">
          Kembali ke Beranda
        </button>
        <button id="btn-sync-retry-screen" type="button" style="flex: 1; height: 46px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-align: center; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
          Kirim Ulang
        </button>
      `;

      footerBar.querySelector('#btn-sync-finish-home-screen')?.addEventListener('click', () => {
        navigate('/home');
      });

      footerBar.querySelector('#btn-sync-retry-screen')?.addEventListener('click', () => {
        currentVerifView = 'SYNC_CONFIRMATION';
        renderVerificationLanding();
      });
    }
  });
}

/**
 * TAMPILAN FULL SCREEN: Bukti Pengiriman Berhasil
 * Tanpa icon tambahan pada tombol dan header,
 * dilengkapi centang hijau dan timestamp per masing-masing nomor dokumen.
 */
function renderSyncSuccessView(app, userCtx) {
  const syncRes = lastSyncResult || {};
  const syncTimestamp = formatSyncTimestamp(syncRes.syncedAt);
  const items = syncRes.items || [];
  const syncedCount = syncRes.syncedCount || items.length;

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER BERSIH TANPA ICON TAMBAHAN -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Pengiriman Berhasil</h1>
      </header>

      <!-- BODY SCROLLABLE -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- CARD SUKSES (BERSIH, TANPA ICON TAMBAHAN) -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="font-size: 1.05rem; font-weight: 800; color: #116834; margin-bottom: 4px;">
            Data Berhasil Dikirim ke Server
          </div>
          <div style="font-size: 0.78rem; color: #64748B; line-height: 1.45;">
            Sebanyak <strong>${syncedCount} dokumen</strong> telah terkirim ke server.
          </div>
          <!-- Progress bar -->
          <div style="margin-top: 12px; width: 100%; background: #E2E8F0; height: 6px; border-radius: 999px; overflow: hidden;">
            <div style="background: #116834; height: 100%; width: 100%;"></div>
          </div>
          <div style="margin-top: 5px; font-size: 0.68rem; font-weight: 700; color: #116834; text-align: right;">
            ${syncedCount}/${syncedCount} berhasil
          </div>
        </div>

        <!-- LIST NOMOR DOKUMEN DENGAN CENTANG HIJAU & TIMESTAMP -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 0.82rem; font-weight: 700; color: #475569;">
            Bukti & Timestamp Pengiriman per Dokumen:
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${items.map((item, idx) => `
              <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 0.88rem; font-weight: 800; color: #116834; word-break: break-all;">
                    ${esc(item.docNo)}
                  </span>
                  <span style="font-size: 0.7rem; font-weight: 700; background: #DEF7EC; color: #03543F; padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;">
                    <svg viewBox="0 0 24 24" width="13" height="13" stroke="#03543F" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Terkirim
                  </span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px;">
                  <span style="min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.72rem; color: #64748B;">
                    ${esc(item.moduleLabel)} &bull; ${esc(item.submittedByName || 'Mantri')}
                  </span>
                  <span style="font-size: 0.64rem; font-weight: 600; color: #64748B; white-space: nowrap; flex-shrink: 0; letter-spacing: -0.2px;">
                    ${formatSyncTimestamp(item.syncedAt || syncRes.syncedAt)}
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

      </main>

      <!-- BOTTOM ACTION BAR: 2 TOMBOL BERSIH TANPA ICON TAMBAHAN -->
      <footer style="padding: 12px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; display: flex; gap: 10px; flex-shrink: 0;">
        <button id="btn-sync-finish-home-screen" type="button" style="flex: 1; height: 46px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 8px; font-weight: 700; font-size: 0.88rem; color: #475569; cursor: pointer; text-align: center;">
          Kembali ke Beranda
        </button>
        <button id="btn-sync-retry-screen" type="button" style="flex: 1; height: 46px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-align: center; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
          Kirim Ulang
        </button>
      </footer>

    </div>
  `;

  app.querySelector('#btn-sync-finish-home-screen')?.addEventListener('click', () => {
    navigate('/home');
  });

  app.querySelector('#btn-sync-retry-screen')?.addEventListener('click', () => {
    currentVerifView = 'SYNC_CONFIRMATION';
    renderVerificationLanding();
  });
}

/**
 * Helper ekstraksi tanggal YYYY-MM-DD dari berbagai format
 */
function extractDateYMD(dateVal) {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
    const parts = str.split('/');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

/**
 * Mengambil seluruh data riwayat pengiriman data ke server
 */
function getSyncHistoryRecords(userCtx) {
  const allVerifs = getAllVerifications();
  const historyList = [];
  const seenDocNos = new Set();

  allVerifs.forEach(v => {
    const isSynced = v.serverSyncStatus === 'SYNCED' || !!v.syncedAt;
    const isFailed = v.serverSyncStatus === 'FAILED';
    if (!isSynced && !isFailed) return;

    if (userCtx?.estateId && v.estateId && v.estateId !== userCtx.estateId) return;
    if (userCtx?.divisionId && v.divisionId && v.divisionId !== userCtx.divisionId) return;

    const docNo = v.referenceDocNo || v.docNo || v.id;
    if (!docNo || seenDocNos.has(docNo)) return;
    seenDocNos.add(docNo);

    const mod = VERIFICATION_10_MODULES.find(m => m.id === v.moduleCategory || m.types?.includes(v.referenceType));
    const syncTime = v.syncedAt || v.verifiedAt || v.createdAt || new Date().toISOString();

    historyList.push({
      docNo,
      moduleLabel: mod ? mod.label : (v.referenceType || 'Transaksi'),
      submittedByName: v.submittedByName || v.rawRecord?.mantri || userCtx?.name || 'Wagiman',
      syncedAt: syncTime,
      dateYMD: extractDateYMD(syncTime),
      status: isFailed ? 'GAGAL' : 'BERHASIL'
    });
  });

  if (lastSyncResult?.items) {
    lastSyncResult.items.forEach(item => {
      const docNo = item.docNo;
      const syncTime = item.syncedAt || lastSyncResult.syncedAt || new Date().toISOString();
      const isFailed = item.status === 'GAGAL' || item.serverSyncStatus === 'FAILED';

      if (!seenDocNos.has(docNo)) {
        seenDocNos.add(docNo);
        historyList.push({
          docNo,
          moduleLabel: item.moduleLabel || 'Transaksi',
          submittedByName: item.submittedByName || userCtx?.name || 'Wagiman',
          syncedAt: syncTime,
          dateYMD: extractDateYMD(syncTime),
          status: isFailed ? 'GAGAL' : 'BERHASIL'
        });
      } else {
        const existing = historyList.find(h => h.docNo === docNo);
        if (existing) {
          existing.syncedAt = syncTime;
          existing.dateYMD = extractDateYMD(syncTime);
          existing.status = isFailed ? 'GAGAL' : 'BERHASIL';
        }
      }
    });
  }

  return historyList.sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
}

/**
 * TAMPILAN FULL SCREEN: Riwayat Pengiriman Data ke Server
 * Filter tanggal pengiriman data beserta status label per masing-masing dokumen berhasil/gagal terkirim.
 */
function renderSyncHistoryView(app, userCtx) {
  const allHistory = getSyncHistoryRecords(userCtx);

  // Filter berdasarkan tanggal jika dipilih
  const dateFiltered = syncHistoryDate
    ? allHistory.filter(item => item.dateYMD === syncHistoryDate)
    : allHistory;

  // Hitung jumlah status pada tanggal yang dipilih
  const countAll = dateFiltered.length;
  const countSuccess = dateFiltered.filter(item => item.status === 'BERHASIL').length;
  const countFailed = dateFiltered.filter(item => item.status === 'GAGAL').length;

  // Filter lanjutan berdasarkan status label
  const displayedItems = dateFiltered.filter(item => {
    if (syncHistoryStatusFilter === 'BERHASIL') return item.status === 'BERHASIL';
    if (syncHistoryStatusFilter === 'GAGAL') return item.status === 'GAGAL';
    return true;
  });

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-sync-history" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Riwayat Pengiriman Server</h1>
        </div>
      </header>

      <!-- BODY SCROLLABLE -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- CARD FILTER TANGGAL & STATUS LABEL -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label for="sync-history-date-input" style="font-size: 0.76rem; font-weight: 700; color: #475569;">
              Filter Tanggal Pengiriman Data:
            </label>
            <input type="date" id="sync-history-date-input" value="${syncHistoryDate}"
              style="height: 40px; padding: 0 12px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.84rem; font-weight: 600; color: #0F172A; background: #FFFFFF; width: 100%; box-sizing: border-box;" />
          </div>

          <!-- STATUS LABEL FILTER PILLS -->
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="history-status-pill" data-status="ALL" type="button"
              style="flex: 1; padding: 7px 4px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; border: 1px solid ${syncHistoryStatusFilter === 'ALL' ? '#116834' : '#E2E8F0'}; background: ${syncHistoryStatusFilter === 'ALL' ? '#116834' : '#F8FAFC'}; color: ${syncHistoryStatusFilter === 'ALL' ? '#FFFFFF' : '#475569'}; text-align: center;">
              Semua (${countAll})
            </button>
            <button class="history-status-pill" data-status="BERHASIL" type="button"
              style="flex: 1; padding: 7px 4px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; border: 1px solid ${syncHistoryStatusFilter === 'BERHASIL' ? '#116834' : '#E2E8F0'}; background: ${syncHistoryStatusFilter === 'BERHASIL' ? '#116834' : '#F8FAFC'}; color: ${syncHistoryStatusFilter === 'BERHASIL' ? '#FFFFFF' : '#475569'}; text-align: center;">
              Berhasil (${countSuccess})
            </button>
            <button class="history-status-pill" data-status="GAGAL" type="button"
              style="flex: 1; padding: 7px 4px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; border: 1px solid ${syncHistoryStatusFilter === 'GAGAL' ? '#991B1B' : '#E2E8F0'}; background: ${syncHistoryStatusFilter === 'GAGAL' ? '#991B1B' : '#F8FAFC'}; color: ${syncHistoryStatusFilter === 'GAGAL' ? '#FFFFFF' : '#475569'}; text-align: center;">
              Gagal (${countFailed})
            </button>
          </div>
        </div>

        <!-- DAFTAR DOKUMEN RIWAYAT -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 2px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #475569;">
              Daftar Dokumen (${displayedItems.length}):
            </span>
            <span style="font-size: 0.7rem; color: #64748B;">
              ${syncHistoryDate || 'Semua Tanggal'}
            </span>
          </div>

          ${displayedItems.length === 0 ? `
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 28px 16px; text-align: center; color: #64748B;">
              <div style="font-size: 0.86rem; font-weight: 700; color: #334155; margin-bottom: 4px;">
                Tidak Ada Riwayat Pengiriman
              </div>
              <div style="font-size: 0.76rem; color: #94A3B8;">
                Tidak ada dokumen dengan status <strong>${syncHistoryStatusFilter}</strong> pada tanggal terpilih.
              </div>
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${displayedItems.map((item, idx) => `
                <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 0.88rem; font-weight: 800; color: ${item.status === 'GAGAL' ? '#B91C1C' : '#116834'}; word-break: break-all;">
                      ${esc(item.docNo)}
                    </span>
                    ${item.status === 'BERHASIL' ? `
                      <span style="font-size: 0.7rem; font-weight: 700; background: #DEF7EC; color: #03543F; padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#03543F" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Berhasil Terkirim
                      </span>
                    ` : `
                      <span style="font-size: 0.7rem; font-weight: 700; background: #FEE2E2; color: #991B1B; padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#991B1B" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        Gagal Terkirim
                      </span>
                    `}
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px;">
                    <span style="min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.72rem; color: #64748B;">
                      ${esc(item.moduleLabel)} &bull; ${esc(item.submittedByName || 'Mantri')}
                    </span>
                    <span style="font-size: 0.64rem; font-weight: 600; color: #64748B; white-space: nowrap; flex-shrink: 0; letter-spacing: -0.2px;">
                      ${formatSyncTimestamp(item.syncedAt)}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

      </main>

      <!-- BOTTOM ACTION BAR: 2 TOMBOL BERSIH TANPA ICON TAMBAHAN -->
      <footer style="padding: 12px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; display: flex; gap: 10px; flex-shrink: 0;">
        <button id="btn-sync-history-back" type="button" style="flex: 1; height: 46px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 8px; font-weight: 700; font-size: 0.88rem; color: #475569; cursor: pointer; text-align: center;">
          Kembali
        </button>
        <button id="btn-sync-history-home" type="button" style="flex: 1; height: 46px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-align: center; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
          Kembali ke Beranda
        </button>
      </footer>

    </div>
  `;

  // Event handler tombol kembali
  const goBackFromHistory = () => {
    currentVerifView = syncHistorySourceView || 'TINJAU_SUMMARY';
    renderVerificationLanding();
  };

  app.querySelector('#btn-back-sync-history')?.addEventListener('click', goBackFromHistory);
  app.querySelector('#btn-sync-history-back')?.addEventListener('click', goBackFromHistory);

  // Event handler kembali ke beranda
  app.querySelector('#btn-sync-history-home')?.addEventListener('click', () => {
    navigate('/home');
  });

  // Event handler filter tanggal
  const dateInput = app.querySelector('#sync-history-date-input');
  dateInput?.addEventListener('change', (e) => {
    syncHistoryDate = e.target.value;
    renderVerificationLanding();
  });

  // Event handler filter status pill
  app.querySelectorAll('.history-status-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.getAttribute('data-status');
      syncHistoryStatusFilter = status;
      renderVerificationLanding();
    });
  });
}

/**
 * SCREEN 9: Tinjau Data Hari Ini - Detail Transaksi (Read-Only)
 */
function renderTinjauDetailView(app, userCtx) {
  if (!selectedTxItem) {
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
    return;
  }

  // Gunakan normalizedData yang sudah terlampir pada selectedTxItem (Single Source of Truth)
  const norm = selectedTxItem.normalizedData || getVerificationDetailData(selectedTxItem.rawRecord, userCtx, selectedTxItem.referenceType);
  const currentMod = VERIFICATION_10_MODULES.find(m => m.id === selectedTxItem.moduleCategory || m.types.includes(selectedTxItem.referenceType)) || VERIFICATION_10_MODULES[0];
  const docNo = selectedTxItem.referenceDocNo || selectedTxItem.docNo || selectedTxItem.id;
  const dateStr = selectedTxItem.date ? String(selectedTxItem.date).substring(0, 10) : (tinjauFilter.date || todayDDMMYYYY());
  const workerName = selectedTxItem.submittedByName || selectedTxItem.rawRecord?.mantri || selectedTxItem.rawRecord?.actorName || userCtx?.name || 'Mantri';
  const estateName = selectedTxItem.estateName || selectedTxItem.estateId || userCtx?.estateName || userCtx?.estateId || tinjauFilter.estateId || '-';
  const divisionName = selectedTxItem.divisionName || selectedTxItem.divisionId || userCtx?.divisionName || userCtx?.divisionId || tinjauFilter.divisionId || '-';
  const isWorkerLevelMaintenance = isMaintenanceWorkerApprovalItem(selectedTxItem);
  const rawMaintenance = selectedTxItem.rawRecord || {};
  const maintenanceRoleCode = rawMaintenance.workGroupRoleCode || rawMaintenance.workGroup?.roleCode || rawMaintenance.workGroup?.workGroupRoleCode || '-';

  // Render Rincian Data dinamis dari normalized fields (Zero hardcoding)
  const detailRows = (norm.fields || []).map(f => `
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F1F5F9;">
      <span style="color: #64748B;">${esc(f.label)}</span>
      <strong style="color: ${f.highlight ? '#116834' : '#0F172A'}; text-align: right;">${f.value}</strong>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="page verif-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="btn-back-to-tinjau-summary" type="button" aria-label="Kembali" style="background: transparent; border: none; padding: 4px; margin-left: -4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0;">Detail Transaksi</h1>
        </div>
      </header>

      <!-- BODY -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- CARD HEADER DOKUMEN -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div>
            <div style="font-size: 0.95rem; font-weight: 800; color: #111827;">${esc(norm.title || currentMod.label)}</div>
            <div style="font-size: 0.74rem; font-weight: 700; color: #116834; margin-top: 1px;">${esc(docNo)}</div>
            <div style="font-size: 0.7rem; color: #64748B; margin-top: 2px;">${esc(workerName)} &bull; ${esc(dateStr)}</div>
          </div>
          <span style="font-size: 0.65rem; font-weight: 700; padding: 4px 10px; border-radius: 4px; background: #DEF7EC; color: #03543F;">
            Terverifikasi
          </span>
        </div>

        <!-- INFORMASI UMUM -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="font-size: 0.84rem; font-weight: 800; color: #111827; margin-bottom: 10px; border-bottom: 1.5px solid #F1F5F9; padding-bottom: 6px;">
            Informasi Umum
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem;">
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Periode Data</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(tinjauFilter.date || dateStr)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Kebun</span>
              <span style="color: #0F172A; font-weight: 600;">Tanah Besih</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Divisi</span>
              <span style="color: #0F172A; font-weight: 600;">Divisi I</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Mantri</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(workerName)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span style="color: #64748B;">Tanggal Transaksi</span>
              <span style="color: #0F172A; font-weight: 600;">${esc(dateStr)}</span>
            </div>
            ${isWorkerLevelMaintenance ? `
              <div style="display: flex; justify-content: space-between; gap:8px; padding: 4px 0;">
                <span style="color: #64748B;">Kode Mandoran</span>
                <span style="color: #116834; font-weight: 700; text-align:right;">${esc(maintenanceRoleCode)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                <span style="color: #64748B;">Nomor Dokumen</span>
                <span style="color: #116834; font-weight: 700;">${esc(docNo)}</span>
              </div>
            `}
          </div>
        </div>

        <!-- RINCIAN DATA -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="font-size: 0.84rem; font-weight: 800; color: #111827; margin-bottom: 10px; border-bottom: 1.5px solid #F1F5F9; padding-bottom: 6px;">
            Rincian Data
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem;">
            ${isMaintenanceWorkerApprovalItem(selectedTxItem) ? renderMaintenanceVerificationDetails(selectedTxItem, false) : detailRows}
          </div>
        </div>

      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('verifikasi')}

    </div>
  `;

  app.querySelector('#btn-back-to-tinjau-summary')?.addEventListener('click', () => {
    currentVerifView = 'TINJAU_SUMMARY';
    renderVerificationLanding();
  });

  attachAsbBottomNavEvents(app);
}
