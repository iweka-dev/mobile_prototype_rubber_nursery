import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { formatStandardDocNo, todayDDMMYYYY, esc, isCullDocNo } from '../../core/utils.js';
import { toast } from '../../components/toast.js';
import { session } from '../../core/session.js';
import { openDrawer } from '../../components/drawer.js';
import { getCurrentUserContext, resolveUserContext, ROLES } from '../../core/user-context.js';
import { hasActionableSelection } from '../selection/selection-manager.js';
import { getActionableDestructionCount, getEligibleSelectionDocsForBapb } from '../destruction/destruction-manager.js';
import { renderAsbBottomNav, attachAsbBottomNavEvents } from '../../components/bottom-nav-asb.js';
import { CONFIG } from '../../core/config.js';
import { getPhysicalStockActionableCount } from '../physical-stock-inspection/physical-stock-inspection-manager.js';
import {
  syncDederanIndukDocuments,
  getDederanIndukDocuments,
  getDederanTransactions,
  getBedenganInspectionSummary,
  deleteDederanInspection,
  DEDERAN_STORAGE_KEYS
} from '../seeding/dederan-manager.js';
import { isTransactionLockedForMantri } from '../verification/mantri-confirmation-service.js';
import { guardDependency } from '../../core/dependency-guard.js';
import { getAuthorizedTransactions, canUserAccessTransaction } from '../../core/transaction-actor.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { renderStatusDots } from '../../core/status-dot-renderer.js';
import { getBuddingInspectionGate } from '../../core/budding-workflow-service.js';
import {
  normalizeDateStr,
  renderCalendarHeaderButton,
  renderDateFilterBannerHtml,
  renderDatePickerModalHtml,
  attachDatePickerModalEvents
} from '../../components/date-filter-modal.js';
import { openModal, closeModal } from '../../components/modal.js';
import {
  SELECTION_STATUS,
  SELECTION_STAGES,
  SELECTION_TYPES,
  SELECTION_STORAGE_KEY,
  PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY,
  filterSelectionByScope,
  getPreGraftingSelectionDocuments,
  getSeleksi1ExecutionsByDocument,
  getSeleksi2ExecutionsByDocument,
  getSeleksi3ExecutionsByDocument,
  deleteSeleksi1ExecutionTransaction,
  deleteSeleksi2ExecutionTransaction,
  deleteSeleksi3ExecutionTransaction,
  syncAllSeedingsToPreGraftingSelectionDocuments,
  syncAllApprovedPreGraftingSelectionDocuments
} from '../selection/selection-manager.js';
import {
  groupPreGraftingDocsByProgram,
  calculateBatchMetrics,
  renderProgramBatchCompactView,
  handleBatchRowClick,
  renderGlobalChildTransactionsSection
} from '../selection/selection-landing.js?v=188';

let activeInspectionModuleTab = 'DEDERAN'; // 'DEDERAN' | 'SELEKSI_PRA_OKULASI' | 'OKULASI'
let activePreGraftingTab = 'SELEKSI_1'; // 'SELEKSI_1' | 'SELEKSI_2' | 'SELEKSI_3'
const inspectionTabEventRoots = new WeakSet();
const inspectionListControls = {
  DEDERAN: { program: 'ALL', search: '', filter: 'ALL', sort: 'PRIORITY', kind: 'ALL' },
  SELEKSI_PRA_OKULASI: { program: 'ALL', search: '', filter: 'ALL', sort: 'PRIORITY', kind: 'ALL' },
  OKULASI: { program: 'ALL', search: '', filter: 'ALL', sort: 'PRIORITY', kind: 'ALL' }
};
let selectedInspectionDate = todayDDMMYYYY();

function normalizeInspectionProgram(value) {
  return String(value || '').trim();
}

function renderInspectionListControls({ module, programs = [], searchPlaceholder = 'Cari batch, bedengan, atau dokumen...' }) {
  const state = inspectionListControls[module];
  if (!state) return '';
  const controlId = module.toLowerCase().replace(/_/g, '-');
  const uniquePrograms = [...new Set(programs.map(normalizeInspectionProgram).filter(Boolean))];
  if (state.program !== 'ALL' && !uniquePrograms.includes(state.program)) state.program = 'ALL';
  const showProgramControl = uniquePrograms.length > 0 || module === 'OKULASI';
  const programControl = showProgramControl ? `
    <div style="margin-bottom: 10px;">
      <label for="inspection-program-filter-${controlId}" style="display:block;font-size:.72rem;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px;">Program Pembibitan</label>
      <div style="position:relative;">
        <select id="inspection-program-filter-${controlId}" data-inspection-control="program" data-module="${module}" ${uniquePrograms.length === 0 ? 'disabled' : ''} style="width:100%;box-sizing:border-box;height:38px;padding:0 32px 0 12px;font-size:.80rem;font-weight:600;color:#1E293B;background:#FFF;border:1px solid #CBD5E1;border-radius:8px;">
          <option value="ALL" ${state.program === 'ALL' ? 'selected' : ''}>Semua Program</option>
          ${uniquePrograms.map(p => `<option value="${esc(p)}" ${state.program === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
      </div>
    </div>` : '';
  return `${programControl}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:0 0 14px;align-items:center;">
      <div style="grid-column:1 / -1;min-width:0;position:relative;">
        <input id="inspection-list-search-${controlId}" data-inspection-control="search" data-module="${module}" type="search" value="${esc(state.search)}" placeholder="${esc(searchPlaceholder)}" aria-label="Cari transaksi pemeriksaan" style="width:100%;box-sizing:border-box;height:38px;padding:0 10px;font-size:.78rem;border:1px solid #CBD5E1;border-radius:8px;background:#FFF;color:#0F172A;outline:none;">
      </div>
      <select id="inspection-list-filter-${controlId}" data-inspection-control="filter" data-module="${module}" aria-label="Filter status" style="width:100%;min-width:0;height:38px;padding:0 8px;font-size:.76rem;color:#334155;background:#FFF;border:1px solid #CBD5E1;border-radius:8px;">
        <option value="ALL" ${state.filter === 'ALL' ? 'selected' : ''}>Filter: Semua</option>
        <option value="PENDING" ${state.filter === 'PENDING' ? 'selected' : ''}>Perlu periksa</option>
        <option value="IN_PROGRESS" ${state.filter === 'IN_PROGRESS' ? 'selected' : ''}>Berjalan</option>
        <option value="DONE" ${state.filter === 'DONE' ? 'selected' : ''}>Selesai</option>
        ${module === 'OKULASI' ? `<option value="GRAFTING" ${state.filter === 'GRAFTING' ? 'selected' : ''}>Okulasi</option><option value="REGRAFTING" ${state.filter === 'REGRAFTING' ? 'selected' : ''}>Okulasi Janda</option>` : ''}
      </select>
      <select id="inspection-list-sort-${controlId}" data-inspection-control="sort" data-module="${module}" aria-label="Urutkan daftar" style="width:100%;min-width:0;height:38px;padding:0 8px;font-size:.76rem;color:#334155;background:#FFF;border:1px solid #CBD5E1;border-radius:8px;">
        <option value="PRIORITY" ${state.sort === 'PRIORITY' ? 'selected' : ''}>Urut: Prioritas</option>
        <option value="NEWEST" ${state.sort === 'NEWEST' ? 'selected' : ''}>Terbaru</option>
        <option value="OLDEST" ${state.sort === 'OLDEST' ? 'selected' : ''}>Terlama</option>
        <option value="BATCH" ${state.sort === 'BATCH' ? 'selected' : ''}>Batch A–Z</option>
      </select>
    </div>`;
}

function applyInspectionListControls(app, module) {
  const state = inspectionListControls[module];
  if (!state) return;
  const query = state.search.trim().toLocaleLowerCase('id-ID');
  const program = state.program;
  const cardGroups = [{
    selector: `[data-inspection-list-card="${module}"]`,
    container: app.querySelector(module === 'DEDERAN' ? '#deder-inspection-cards' : module === 'OKULASI' ? '#insp-cards-container' : '.program-batch-compact-container')
  }];
  if (module === 'OKULASI') {
    cardGroups.push({
      selector: '[data-inspection-transaction-card="OKULASI"]',
      container: app.querySelector('#insp-summary-cards-container')
    });
  }

  cardGroups.forEach(({ selector, container }) => {
    if (!container) return;
    const cards = [...container.querySelectorAll(selector)];
    cards.forEach(card => {
      const haystack = String(card.dataset.search || '').toLocaleLowerCase('id-ID');
      const matchesProgram = program === 'ALL' || card.dataset.program === program;
      const cardState = card.dataset.state || 'PENDING';
      const kindFilter = ['GRAFTING', 'REGRAFTING'].includes(state.filter) ? state.filter : state.kind;
      const matchesStatus = ['GRAFTING', 'REGRAFTING'].includes(state.filter) || state.filter === 'ALL' || cardState === state.filter;
      const matchesKind = module !== 'OKULASI' || kindFilter === 'ALL' || card.dataset.kind === kindFilter;
      card.style.display = matchesProgram && matchesStatus && matchesKind && (!query || haystack.includes(query)) ? '' : 'none';
    });
    cards.sort((a, b) => {
      if (state.sort === 'BATCH') return (a.dataset.batch || '').localeCompare(b.dataset.batch || '', 'id');
      if (state.sort === 'NEWEST' || state.sort === 'OLDEST') {
        const delta = (Date.parse(b.dataset.date || '') || 0) - (Date.parse(a.dataset.date || '') || 0);
        return state.sort === 'NEWEST' ? delta : -delta;
      }
      if (module === 'OKULASI' || module === 'DEDERAN') {
        const aNeed = a.dataset.state !== 'DONE';
        const bNeed = b.dataset.state !== 'DONE';
        if (aNeed !== bNeed) return aNeed ? -1 : 1;
        if ((a.dataset.state === 'PENDING') !== (b.dataset.state === 'PENDING')) return a.dataset.state === 'PENDING' ? -1 : 1;
      }
      const pendingOrder = ({ PENDING: 0, IN_PROGRESS: 1, DONE: 2 });
      return (pendingOrder[a.dataset.state] ?? 3) - (pendingOrder[b.dataset.state] ?? 3) || (a.dataset.batch || '').localeCompare(b.dataset.batch || '', 'id');
    });
    cards.forEach(card => container.appendChild(card));
  });
}

function attachInspectionListControlEvents(app, module) {
  const state = inspectionListControls[module];
  if (!state) return;
  app.querySelector(`[data-inspection-control="program"][data-module="${module}"]`)?.addEventListener('change', e => {
    state.program = e.target.value;
    applyInspectionListControls(app, module);
  });
  app.querySelector(`[data-inspection-control="search"][data-module="${module}"]`)?.addEventListener('input', e => {
    state.search = e.target.value;
    applyInspectionListControls(app, module);
  });
  app.querySelector(`[data-inspection-control="filter"][data-module="${module}"]`)?.addEventListener('change', e => {
    state.filter = e.target.value;
    if (module === 'OKULASI') {
      state.kind = ['GRAFTING', 'REGRAFTING'].includes(state.filter) ? state.filter : 'ALL';
      app.querySelectorAll('.btn-filter-insp-tab').forEach(tab => {
        const selected = tab.dataset.filter === state.kind;
        tab.style.background = selected ? '#116834' : '#FFFFFF';
        tab.style.color = selected ? '#FFFFFF' : '#374151';
        tab.style.border = selected ? '1px solid #116834' : '1px solid #D1D5DB';
      });
    }
    applyInspectionListControls(app, module);
  });
  app.querySelector(`[data-inspection-control="sort"][data-module="${module}"]`)?.addEventListener('change', e => {
    state.sort = e.target.value;
    applyInspectionListControls(app, module);
  });
  applyInspectionListControls(app, module);
}

export function countPendingPreGraftingDocuments(docs = []) {
  const actionableDocs = docs.filter(doc => {
    const statuses = [doc.status, doc.verificationStatus, doc.approvalStatus, doc.submissionStatus]
      .filter(Boolean)
      .map(status => String(status).trim().toUpperCase());
    const isRemoved = doc.isDeleted || doc.deleted || statuses.some(status =>
      ['DELETED', 'DIBATALKAN', 'CANCELLED', 'CANCELED', 'VOID'].includes(status)
    );
    if (isRemoved) return false;

    const isReturned = statuses.some(status =>
      ['DIKEMBALIKAN', 'REVISION', 'RETURNED'].includes(status)
    );
    if (isReturned) return true;

    const isFinal = Boolean(doc.isFinal || doc.verifiedAt) || statuses.some(status =>
      ['DISETUJUI', 'APPROVED', 'VERIFIED', 'TERVERIFIKASI', 'DATA_TERKONFIRMASI', 'FINAL'].includes(status)
    );
    return !isFinal;
  });

  // Kartu UI dikelompokkan pada level Tahap + Program + Batch. Badge harus
  // memakai unit hitung yang sama agar beberapa parent/Bedengan pada satu
  // Batch tidak menaikkan notifikasi secara ganda.
  const actionableBatchKeys = new Set(actionableDocs.map(doc => {
    const rawStage = String(doc.selectionStage || doc.stage || 'SELEKSI_I').trim().toUpperCase();
    const stage = ['SELEKSI_I', 'SELEKSI_1'].includes(rawStage)
      ? 'SELEKSI_1'
      : (['SELEKSI_II', 'SELEKSI_2'].includes(rawStage) ? 'SELEKSI_2' : (['SELEKSI_III', 'SELEKSI_3'].includes(rawStage) ? 'SELEKSI_3' : rawStage));
    const program = String(doc.programCode || doc.programId || doc.programName || 'PROGRAM-UNKNOWN').trim().toUpperCase();
    const batch = String(doc.batchCode || doc.batchNo || doc.batchId || doc.id || doc.docNo || 'BATCH-UNKNOWN').trim().toUpperCase();
    return `${stage}::${program}::${batch}`;
  }));
  return actionableBatchKeys.size;
}

export function setActiveFilterProgram(prog) {
  inspectionListControls.SELEKSI_PRA_OKULASI.program = prog || 'ALL';
}

export function getActiveFilterProgram() {
  return inspectionListControls.SELEKSI_PRA_OKULASI.program;
}

export function setActiveInspectionModuleTab(tab) {
  activeInspectionModuleTab = tab;
}

export function getActiveInspectionModuleTab() {
  return activeInspectionModuleTab;
}

export function setActivePreGraftingTab(tab) {
  activePreGraftingTab = tab;
}

export function getActivePreGraftingTab() {
  return activePreGraftingTab;
}

export function setSelectedInspectionDate(dateStr) {
  selectedInspectionDate = normalizeDateStr(dateStr) || todayDDMMYYYY();
}

export function getSelectedInspectionDate() {
  return selectedInspectionDate;
}

export function isDederInspectionReturned(insp) {
  if (!insp) return false;
  if (insp.isCorrected || insp.status === 'MENUNGGU_VERIFIKASI_MANTRI' || insp.status === 'PENDING_SUBMISSION' || insp.status === 'APPROVED' || insp.status === 'DISETUJUI') {
    return false;
  }
  return insp.status === 'DIKEMBALIKAN' || insp.verificationStatus === 'DIKEMBALIKAN' || insp.status === 'REVISION';
}

export function isOkulasiInspectionReturned(insp) {
  if (!insp) return false;
  if (insp.isCorrected || insp.status === 'MENUNGGU_VERIFIKASI_MANTRI' || insp.status === 'PENDING_SUBMISSION' || insp.status === 'APPROVED' || insp.status === 'DISETUJUI') {
    return false;
  }
  return insp.status === 'DIKEMBALIKAN' || insp.verificationStatus === 'DIKEMBALIKAN' || insp.status === 'REVISION';
}

const ASB_INSP_ICONS = {
  sprout: `
    <svg viewBox="2 1.5 28 19" width="56" height="56" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  document: `
    <svg viewBox="3 2 26 27" width="56" height="56" fill="#116834">
      <rect x="5" y="4" width="22" height="24" rx="4.5" fill="#116834"/>
      <line x1="9" y1="12" x2="19" y2="12" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="16" x2="19" y2="16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="9" y1="20" x2="16" y2="20" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `
};

export const ASISTEN_BIBITAN_PEMERIKSAAN_MENUS = Object.freeze([
  {
    id: 'pemeriksaan-stok-fisik',
    title: 'Pemeriksaan<br>Stok Fisik',
    label: 'Pemeriksaan Stok Fisik',
    route: '/inspection/physical-stock',
    icon: ASB_INSP_ICONS.document,
    feature: 'PHYSICAL_STOCK_INSPECTION'
  },
  {
    id: 'pemusnahan-bibit',
    title: 'Pemusnahan<br>Bibit',
    label: 'Pemusnahan Bibit',
    route: '/destruction',
    icon: ASB_INSP_ICONS.document
  }
]);

function renderInspectionLandingAsistenBibitan() {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;

  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  const allDestructions = storage.get('destruction_transactions', []);
  const hasActionableDestruction = getActionableDestructionCount(allDestructions, userCtx) > 0;
  const eligibleBapbSourceCount = getEligibleSelectionDocsForBapb(userCtx).length;

  const physicalStockActionable = getPhysicalStockActionableCount(userCtx);
  const menuCards = ASISTEN_BIBITAN_PEMERIKSAAN_MENUS.filter(item => !item.feature || CONFIG.FEATURES?.[item.feature]).map((item) => {
    let badgeHtml = '';
    if (item.id === 'pemusnahan-bibit' && (hasActionableDestruction || eligibleBapbSourceCount > 0)) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot bapb-menu-notif-dot" title="${eligibleBapbSourceCount > 0 ? `${eligibleBapbSourceCount} dokumen afkir perlu dibuatkan berita acara` : 'Ada pemusnahan bibit yang perlu diproses'}" aria-label="Notifikasi Pemusnahan Bibit" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pemeriksaan-stok-fisik' && physicalStockActionable > 0) {
      badgeHtml = `<div class="beranda-menu-badge-dot notif-dot" style="position:absolute;top:12px;right:12px;width:11px;height:11px;background-color:#D32F2F;border-radius:50%;box-shadow:0 0 0 2px #FFFFFF;z-index:5"></div>`;
    }

    return `
      <button class="beranda-menu-card inspection-asb-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${item.icon}</div>
        <div class="beranda-card-title">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page inspection-asb-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <button id="insp-drawer-btn" type="button" aria-label="Menu" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0; letter-spacing: -0.01em;">Pemeriksaan</h1>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="insp-refresh-btn" type="button" aria-label="Segarkan" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
          <button id="insp-notif-btn" type="button" aria-label="Notifikasi" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </button>
        </div>
      </header>

      <!-- BODY / CARDS GRID -->
      <main class="beranda-body" style="flex: 1; min-height: 0; overflow-y: auto; padding: 12px 10px 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${menuCards}
        </div>
      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('pemeriksaan')}

    </div>
  `;

  // Attach drawer
  app.querySelector('#insp-drawer-btn')?.addEventListener('click', openDrawer);

  // Refresh
  app.querySelector('#insp-refresh-btn')?.addEventListener('click', () => {
    toast('Data pemeriksaan diperbarui', 'info');
    renderInspectionLandingAsistenBibitan();
  });

  // Notif
  app.querySelector('#insp-notif-btn')?.addEventListener('click', () => {
    toast('Tidak ada notifikasi baru', 'info');
  });

  // Menu clicks
  app.querySelectorAll('.inspection-asb-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        toast('Modul akan segera dibuka', 'info');
      }
    });
  });

  // Attach bottom nav events
  attachAsbBottomNavEvents(app);
}

export function renderInspectionLanding() {
  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  if (userCtx?.role === ROLES.ASISTEN_BIBITAN || user?.role === ROLES.ASISTEN_BIBITAN) {
    renderInspectionLandingAsistenBibitan();
    return;
  }

  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;

  // Load all budding transactions (both Grafting & Regrafting) and inspection transactions
  const rawBuddingTxs = storage.get('budding_transactions', []);
  const buddingTxs = getAuthorizedTransactions(rawBuddingTxs, userCtx);
  let rawInspectionTxs = storage.get('inspection_transactions', []);

  // Normalize legacy doc numbers to 2026/INS/xxx
  let hasMigration = false;
  const inspectionTxs = rawInspectionTxs.map((insp, i) => {
    let doc = insp.docNo || formatStandardDocNo(2026, 'INS', i + 1);
    if (doc.includes('/PRK/') || doc.includes('/INSP/')) {
      doc = doc.replace('/PRK/', '/INS/').replace('/INSP/', '/INS/');
      hasMigration = true;
    }
    return { ...insp, docNo: doc };
  });

  if (hasMigration) {
    storage.set('inspection_transactions', inspectionTxs);
  }

  const authorizedInspectionTxs = getAuthorizedTransactions(inspectionTxs, userCtx);
  const rawRegraftingPools = storage.get('regrafting_pool', []);
  const regraftingPools = Array.isArray(rawRegraftingPools) ? rawRegraftingPools : [];
  const buddingIndexById = new Map();
  const buddingIndexByDocNo = new Map();
  rawBuddingTxs.forEach((tx, index) => {
    if (tx?.id) buddingIndexById.set(tx.id, index);
    if (tx?.docNo) buddingIndexByDocNo.set(tx.docNo, index);
  });
  const buddingByDocNo = new Map(buddingTxs.filter(tx => tx?.docNo).map(tx => [tx.docNo, tx]));
  const regraftingPoolByDocNo = new Map(regraftingPools.filter(pool => pool?.docNo).map(pool => [pool.docNo, pool]));
  const regraftingPoolByInspectionDocNo = new Map(regraftingPools.filter(pool => pool?.inspectionDocNo).map(pool => [pool.inspectionDocNo, pool]));
  const inspectionsByBuddingDocNo = new Map();
  const inspectionsByBuddingIndex = new Map();
  authorizedInspectionTxs.forEach(insp => {
    if (insp.buddingDocNo) {
      if (!inspectionsByBuddingDocNo.has(insp.buddingDocNo)) inspectionsByBuddingDocNo.set(insp.buddingDocNo, []);
      inspectionsByBuddingDocNo.get(insp.buddingDocNo).push(insp);
    }
    if (insp.buddingIndex !== undefined && insp.buddingIndex !== null && String(insp.buddingIndex).trim() !== '') {
      const index = Number(insp.buddingIndex);
      if (!inspectionsByBuddingIndex.has(index)) inspectionsByBuddingIndex.set(index, []);
      inspectionsByBuddingIndex.get(index).push(insp);
    }
  });

  // Group or map budding transactions with cumulative inspection stats (Strict per Dokumen Okulasi)
  const items = buddingTxs.map((btx, idx) => {
    const rawIndex = (btx.id ? buddingIndexById.get(btx.id) : undefined)
      ?? (btx.docNo ? buddingIndexByDocNo.get(btx.docNo) : undefined)
      ?? -1;
    const populasiDiokulasi = parseInt(btx.jumlah || 0);
    const isRegrafting = String(btx.type || '').toUpperCase() === 'REGRAFTING';
    const linkedRegraftingPool = isRegrafting
      ? ((btx.regraftPoolDocNo && regraftingPoolByDocNo.get(btx.regraftPoolDocNo))
        || (btx.inspectionDocNo && regraftingPoolByInspectionDocNo.get(btx.inspectionDocNo)))
      : null;
    const originalBudding = linkedRegraftingPool?.sourceBuddingDocNo
      ? buddingByDocNo.get(linkedRegraftingPool.sourceBuddingDocNo)
      : null;
    const relatedInspectionSet = new Set([
      ...(btx.docNo ? inspectionsByBuddingDocNo.get(btx.docNo) || [] : []),
      ...(inspectionsByBuddingIndex.get(idx) || [])
    ]);
    const relatedInspections = [...relatedInspectionSet];
    const inspectionGate = getBuddingInspectionGate(btx);
    
    let totalDiperiksa = 0;
    let totalJadi = 0;
    let totalGagal = 0;
    let totalRegrafting = 0;
    let totalSelection = 0;

    relatedInspections.forEach(insp => {
      const dip = parseInt(insp.totalDiperiksa || (parseInt(insp.jumlahJadi || 0) + parseInt(insp.jumlahGagal || 0)));
      const jadi = parseInt(insp.jumlahJadi || 0);
      const gagal = parseInt(insp.jumlahGagal || 0);

      let regraft = 0;
      let seleksi = 0;
      if (insp.totalToRegrafting !== undefined) {
        regraft = parseInt(insp.totalToRegrafting || 0);
        seleksi = insp.totalToSelection !== undefined ? parseInt(insp.totalToSelection || 0) : Math.max(0, gagal - regraft);
      } else {
        regraft = gagal;
        seleksi = 0;
      }

      totalDiperiksa += dip;
      totalJadi += jadi;
      totalGagal += gagal;
      totalRegrafting += regraft;
      totalSelection += seleksi;
    });

    const sisaBelumDiperiksa = Math.max(0, populasiDiokulasi - totalDiperiksa);
    
    // Perhitungan persentase progres pemeriksaan (Total Diperiksa / Populasi Diokulasi)
    const progressPercent = populasiDiokulasi > 0 ? (totalDiperiksa / populasiDiokulasi) * 100 : 0;
    let progressDiperiksaDisplay = '0%';
    if (progressPercent >= 100) {
      progressDiperiksaDisplay = '100%';
    } else if (progressPercent % 1 === 0) {
      progressDiperiksaDisplay = `${progressPercent}%`;
    } else {
      progressDiperiksaDisplay = `${progressPercent.toFixed(1)}%`;
    }

    // Perhitungan persentase keberhasilan (% Jadi) untuk rincian detail transaksi
    let persenJadiDisplay = '0%';
    let rawPercent = 0;
    if (totalDiperiksa > 0) {
      rawPercent = (totalJadi / totalDiperiksa) * 100;
      if (totalGagal === 0 && totalJadi === totalDiperiksa) {
        persenJadiDisplay = '100%';
      } else if (rawPercent % 1 === 0) {
        persenJadiDisplay = `${rawPercent}%`;
      } else {
        persenJadiDisplay = `${rawPercent.toFixed(1)}%`;
      }
    }

    let statusText = 'Perlu Pemeriksaan';
    let statusBg = '#E53935';
    let statusColor = '#FFFFFF';
    let statusBorder = 'none';

    if (totalDiperiksa === 0) {
      statusText = 'Perlu Pemeriksaan';
      statusBg = '#E53935';
      statusColor = '#FFFFFF';
    } else if (sisaBelumDiperiksa <= 0) {
      statusText = `Selesai (${progressDiperiksaDisplay})`;
      statusBg = '#E8F5E9';
      statusColor = '#116834';
      statusBorder = '1px solid #116834';
    } else {
      statusText = `Sisa ${sisaBelumDiperiksa} Pkk`;
      statusBg = '#FFF8E1';
      statusColor = '#F57F17';
      statusBorder = '1px solid #FFE082';
    }

    return {
      ...btx,
      programCode: btx.programCode || originalBudding?.programCode || '',
      programId: btx.programId || originalBudding?.programId || '',
      originalIndex: rawIndex >= 0 ? rawIndex : idx,
      isRegrafting,
      canInspect: inspectionGate.allowed,
      inspectionGateReason: inspectionGate.reason,
      typeLabel: isRegrafting ? 'Okulasi Janda (Regrafting)' : 'Okulasi (Grafting)',
      typeBadgeBg: isRegrafting ? '#FFFBEB' : '#F0FDF4',
      typeBadgeColor: isRegrafting ? '#B45309' : '#116834',
      typeBadgeBorder: isRegrafting ? '1px solid #FDE68A' : '1px solid #BBF7D0',
      populasiDiokulasi,
      totalDiperiksa,
      totalJadi,
      totalGagal,
      totalRegrafting,
      totalSelection,
      sisaBelumDiperiksa,
      persenJadiDisplay,
      statusText,
      statusBg,
      statusColor,
      statusBorder,
      relatedInspections,
      inspectionsCount: relatedInspections.length
    };
  });

  // Urutkan: Dokumen yang memiliki label "Perlu Pemeriksaan" / belum selesai berada di posisi PALING ATAS
  items.sort((a, b) => {
    const aNeed = a.sisaBelumDiperiksa > 0;
    const bNeed = b.sisaBelumDiperiksa > 0;
    if (aNeed !== bNeed) {
      return aNeed ? -1 : 1;
    }
    const aPerlu = a.statusText === 'Perlu Pemeriksaan';
    const bPerlu = b.statusText === 'Perlu Pemeriksaan';
    if (aPerlu !== bPerlu) {
      return aPerlu ? -1 : 1;
    }
    return 0;
  });

  const graftingCount = items.filter(i => !i.isRegrafting).length;
  const regraftingCount = items.filter(i => i.isRegrafting).length;
  // Dederan Inspections data
  syncDederanIndukDocuments();
  const dederIndukDocs = getAuthorizedTransactions(getDederanIndukDocuments(), userCtx);
  const dederTxs = getAuthorizedTransactions(getDederanTransactions(), userCtx);
  const rawDederInspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  const authorizedDederInspections = getAuthorizedTransactions(rawDederInspections, userCtx);

  // Separate returned vs normal Dederan inspections
  const returnedDederInspections = authorizedDederInspections.filter(insp => isDederInspectionReturned(insp));
  const normalDederInspections = authorizedDederInspections.filter(insp => !isDederInspectionReturned(insp));

  // Separate returned vs normal Okulasi inspections
  const returnedOkulasiInspections = authorizedInspectionTxs.filter(insp => isOkulasiInspectionReturned(insp));
  const normalOkulasiInspections = authorizedInspectionTxs.filter(insp => !isOkulasiInspectionReturned(insp));

  // Calculate pending Dederan inspection count
  let pendingDederInspCount = 0;
  dederTxs.forEach(dtx => {
    const parent = dederIndukDocs.find(d => d.docNo === dtx.parentDederIndukDocNo || d.id === dtx.parentDederIndukId);
    if (parent && parent.sisaBelumDeder === 0) {
      const summary = getBedenganInspectionSummary(dtx);
      if (!summary.isComplete && summary.sisaBelumDiperiksa > 0) {
        pendingDederInspCount++;
      }
    }
  });

  // Filtered lists for Ringkasan Transaksi display based on selectedInspectionDate
  const filteredDederInspections = normalDederInspections.filter(insp => {
    const d = normalizeDateStr(insp.tanggalPemeriksaan || insp.tanggal || insp.date || insp.createdAt);
    return d === selectedInspectionDate;
  });
  const filteredInspectionTxs = normalOkulasiInspections.filter(insp => {
    const d = normalizeDateStr(insp.tanggal || insp.date || insp.createdAt);
    return d === selectedInspectionDate;
  });

  // Sync Pre-Grafting selection docs
  try {
    syncAllSeedingsToPreGraftingSelectionDocuments(userCtx);
    syncAllApprovedPreGraftingSelectionDocuments(userCtx);
  } catch (err) {
    console.warn('[renderInspectionLanding] Gagal sinkronisasi data seleksi pra-okulasi:', err);
  }

  const rawPreGraftingDocs = getPreGraftingSelectionDocuments({}, userCtx);
  const activePreGraftingDocs = filterSelectionByScope(rawPreGraftingDocs, userCtx).filter(d => !d.isSplit && !d.isLegacyAggregateSplit);
  const preGraftingTotalCount = countPendingPreGraftingDocuments(activePreGraftingDocs);

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; position: relative;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #D9D9D9; flex-shrink: 0;">
        <div style="display: flex; align-items: center;">
          <button id="btn-back" type="button" aria-label="Kembali" style="padding: 8px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 700; color: #111111; margin: 0; letter-spacing: -0.01em;">Pemeriksaan</h1>
        </div>
        <div>
          ${renderCalendarHeaderButton('btn-open-date-filter', selectedInspectionDate)}
        </div>
      </header>

      <!-- TAB SELEKTOR MODUL: PEMERIKSAAN DEDERAN vs SELEKSI PRA-OKULASI vs OKULASI -->
      <div class="no-scrollbar" style="display: flex; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 16px; gap: 20px; flex-shrink: 0; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
        <button id="tab-insp-dederan" type="button" style="padding: 12px 2px; font-size: 0.82rem; font-weight: ${activeInspectionModuleTab === 'DEDERAN' ? '700' : '600'}; color: ${activeInspectionModuleTab === 'DEDERAN' ? '#116834' : '#64748B'}; border: none; border-bottom: 2.5px solid ${activeInspectionModuleTab === 'DEDERAN' ? '#116834' : 'transparent'}; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; margin-bottom: -1px; transition: color 0.15s ease;">
          <span>Pemeriksaan Dederan</span>
          ${pendingDederInspCount > 0 ? `<span style="background: ${activeInspectionModuleTab === 'DEDERAN' ? '#116834' : '#64748B'}; color: #FFFFFF; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${pendingDederInspCount}</span>` : ''}
        </button>
        <button id="tab-insp-seleksi-pra-okulasi" type="button" style="padding: 12px 2px; font-size: 0.82rem; font-weight: ${activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI' ? '700' : '600'}; color: ${activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI' ? '#116834' : '#64748B'}; border: none; border-bottom: 2.5px solid ${activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI' ? '#116834' : 'transparent'}; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; margin-bottom: -1px; transition: color 0.15s ease;">
          <span>Pemeriksaan Pra-Okulasi</span>
          ${preGraftingTotalCount > 0 ? `<span title="${preGraftingTotalCount} Batch perlu tindakan" style="background: ${activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI' ? '#116834' : '#64748B'}; color: #FFFFFF; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${preGraftingTotalCount}</span>` : ''}
        </button>
        <button id="tab-insp-okulasi" type="button" style="padding: 12px 2px; font-size: 0.82rem; font-weight: ${activeInspectionModuleTab === 'OKULASI' ? '700' : '600'}; color: ${activeInspectionModuleTab === 'OKULASI' ? '#116834' : '#64748B'}; border: none; border-bottom: 2.5px solid ${activeInspectionModuleTab === 'OKULASI' ? '#116834' : 'transparent'}; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; margin-bottom: -1px; transition: color 0.15s ease;">
          <span>Pemeriksaan Okulasi</span>
          ${items.length > 0 ? `<span style="background: ${activeInspectionModuleTab === 'OKULASI' ? '#116834' : '#64748B'}; color: #FFFFFF; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${items.length}</span>` : ''}
        </button>
      </div>

      <!-- MAIN CONTENT -->
      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        ${activeInspectionModuleTab === 'DEDERAN'
          ? renderDederanInspectionSection(dederTxs, filteredDederInspections, dederIndukDocs, returnedDederInspections)
          : (activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI'
            ? renderPreGraftingInspectionSection(user, userCtx, activePreGraftingDocs)
            : renderOkulasiInspectionSection(items, graftingCount, regraftingCount, filteredInspectionTxs, returnedOkulasiInspections))}

        <!-- MODAL DIALOG KONFIRMASI HAPUS -->
        <div id="modal-delete-insp-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.45); z-index: 1000; backdrop-filter: blur(2px);"></div>
        
        <div id="dialog-delete-insp" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 88%; max-width: 320px; background: #FFFFFF; border-radius: 12px; padding: 20px 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 1001; text-align: center; box-sizing: border-box;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #FEE2E2; color: #DC2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </div>
          <h3 style="font-size: 1.02rem; font-weight: 800; color: #111111; margin: 0 0 6px 0;">Hapus Transaksi?</h3>
          <p id="dialog-delete-insp-msg" style="font-size: 0.78rem; color: #666666; margin: 0 0 18px 0; line-height: 1.45;">
            Apakah Anda yakin ingin menghapus data pemeriksaan ini? Data yang terhubung ke Okulasi Janda & Seleksi juga akan dibersihkan.
          </p>
          <div style="display: flex; gap: 8px;">
            <button id="btn-cancel-delete-insp" type="button" style="flex: 1; height: 38px; background: #F3F4F6; color: #374151; border: none; border-radius: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
              Batal
            </button>
            <button id="btn-confirm-delete-insp" type="button" style="flex: 1; height: 38px; background: #DC2626; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
              Ya, Hapus
            </button>
          </div>
        </div>

        <!-- MODAL DIALOG JIKA BATCH TELAH 100% SELESAI DIPERIKSA -->
        <div id="modal-completed-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.45); z-index: 1000; backdrop-filter: blur(2px);"></div>
        
        <div id="dialog-batch-completed" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 88%; max-width: 320px; background: #FFFFFF; border-radius: 12px; padding: 20px 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 1001; text-align: center; box-sizing: border-box;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #E8F5E9; color: #116834; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
            <svg viewBox="0 0 24 24" width="26" height="26" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h3 style="font-size: 1.02rem; font-weight: 800; color: #111111; margin: 0 0 6px 0;">Pemeriksaan Selesai</h3>
          <p id="dialog-completed-desc" style="font-size: 0.78rem; color: #666666; margin: 0 0 18px 0; line-height: 1.45;">
            Seluruh populasi pada batch ini telah selesai diperiksa 100%. Tidak ada pemeriksaan yang perlu dilakukan lagi.
          </p>
          <button id="btn-close-completed-dialog" type="button" style="width: 100%; height: 42px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.86rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(17,104,52,0.2);">
            Tutup Pesan
          </button>
        </div>

      </main>

      <!-- MODAL FILTER TANGGAL (HARI INI, KEMARIN, PILIH TANGGAL) -->
      ${renderDatePickerModalHtml(selectedInspectionDate)}
    </div>
  `;

  // Event Listener: Back button
  app.querySelector('#btn-back')?.addEventListener('click', () => {
    navigate('/home');
  });

  // Capture tab clicks at the app root so they still work if nested controls stop bubbling.
  // Attach once: renderInspectionLanding replaces app.innerHTML, not the root element.
  if (!inspectionTabEventRoots.has(app)) {
    app.addEventListener('click', (event) => {
      const tab = event.target.closest('#tab-insp-dederan, #tab-insp-seleksi-pra-okulasi, #tab-insp-okulasi, #subtab-seleksi-1, #subtab-seleksi-2, #subtab-seleksi-3');
      if (!tab || !app.contains(tab)) return;

      const tabStates = {
        'tab-insp-dederan': ['activeInspectionModuleTab', 'DEDERAN'],
        'tab-insp-seleksi-pra-okulasi': ['activeInspectionModuleTab', 'SELEKSI_PRA_OKULASI'],
        'tab-insp-okulasi': ['activeInspectionModuleTab', 'OKULASI'],
        'subtab-seleksi-1': ['activePreGraftingTab', 'SELEKSI_1'],
        'subtab-seleksi-2': ['activePreGraftingTab', 'SELEKSI_2'],
        'subtab-seleksi-3': ['activePreGraftingTab', 'SELEKSI_3']
      };
      const [stateName, value] = tabStates[tab.id] || [];
      if (!stateName || (stateName === 'activeInspectionModuleTab' && activeInspectionModuleTab === value) || (stateName === 'activePreGraftingTab' && activePreGraftingTab === value)) return;

      event.preventDefault();
      event.stopPropagation();
      if (stateName === 'activeInspectionModuleTab') activeInspectionModuleTab = value;
      else activePreGraftingTab = value;
      renderInspectionLanding();
    }, true);
    inspectionTabEventRoots.add(app);
  }

  // Attach tab-specific events
  if (activeInspectionModuleTab === 'DEDERAN') {
    attachDederanInspectionEvents(app);
    attachInspectionListControlEvents(app, 'DEDERAN');
  } else if (activeInspectionModuleTab === 'SELEKSI_PRA_OKULASI') {
    attachPreGraftingInspectionEvents(app, user, userCtx, activePreGraftingDocs);
    attachInspectionListControlEvents(app, 'SELEKSI_PRA_OKULASI');
  } else {
    attachOkulasiInspectionEvents(app, items, inspectionTxs);
    attachInspectionListControlEvents(app, 'OKULASI');
  }

  // Modal Events for Date Filter
  attachDatePickerModalEvents({
    container: app,
    currentDateStr: selectedInspectionDate,
    onDateSelect: (newDateStr) => {
      setSelectedInspectionDate(newDateStr);
      renderInspectionLanding();
    },
    onDateReset: () => {
      setSelectedInspectionDate(todayDDMMYYYY());
      renderInspectionLanding();
    }
  });
}

/**
 * Render Section Pemeriksaan Dederan
 */
function renderDederanInspectionSection(dederTxs, dederInspections, dederIndukDocs, returnedDederInspections = []) {
  if (dederTxs.length === 0 && returnedDederInspections.length === 0) {
    return renderEmptyStateCard({
      title: 'Belum Ada Transaksi Dederan',
      description: 'Lakukan transaksi Dederan di modul <strong>Penyemaian</strong> terlebih dahulu.',
      customStyle: 'margin-top: 16px; margin-bottom: 20px;'
    });
  }

  return `
    <!-- SECTION: TRANSAKSI PEMERIKSAAN DEDERAN PERLU PERBAIKAN -->
    ${returnedDederInspections.length > 0 ? `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 3px; height: 14px; border-radius: 2px; background: #DC2626;"></span>
            <h2 style="font-size: 0.92rem; font-weight: 700; color: #0F172A; margin: 0;">
              Transaksi Pemeriksaan Dederan Perlu Perbaikan
            </h2>
          </div>
          <span style="font-size: 0.68rem; font-weight: 600; background: #FEF2F2; color: #DC2626; padding: 2px 8px; border-radius: 9999px; border: 1px solid #FECACA;">
            ${returnedDederInspections.length} dokumen menunggu koreksi
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${returnedDederInspections.map((insp, idx) => {
            const docNo = insp.docNo || formatStandardDocNo(2026, 'DED-INS', idx + 1);
            const returnNote = insp.returnReason || insp.lastReturnReason || 'Perlu perbaikan data.';
            const jlhDiperiksa = parseInt(insp.jumlahDiperiksa || 0);
            const jlhBerhasil = parseInt(insp.jumlahBerhasil || 0);
            const jlhTidakBerhasil = parseInt(insp.jumlahTidakBerhasil || 0);
            const bedenganStr = insp.bedenganCode || insp.bedengan || 'BED-001';
            const dederTxDoc = insp.dederanTxDocNo || '-';

            return `
              <div class="card-summary-wrapper card-returned-deder-insp-wrapper" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 0.78rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); position: relative;">
                
                <!-- BARIS 1: IDENTITAS DOKUMEN & BADGE DIKEMBALIKAN (RATA KANAN) -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-weight: 800; font-size: 0.95rem; color: #0F172A; letter-spacing: -0.01em;">${esc(docNo)}</span>
                  <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    <span style="width: 5px; height: 5px; border-radius: 50%; background: #DC2626;"></span>
                    Dikembalikan
                  </span>
                </div>
                
                <!-- METADATA HIRARKI RAPI (KIRI - KANAN) -->
                <div style="display: flex; flex-direction: column; gap: 3px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748B; line-height: 1.35;">
                    <div>Sumber Deder: <strong style="color: #0F172A; font-weight: 600;">${esc(dederTxDoc)}</strong></div>
                    <div style="text-align: right;">Tgl: <span style="color: #334155; font-weight: 500;">${esc(insp.tanggalPemeriksaan || insp.tanggal || '-')}</span></div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748B; line-height: 1.35;">
                    <div>Bedengan: <strong style="color: #0F172A; font-weight: 600;">${esc(bedenganStr)}</strong></div>
                  </div>
                </div>

                <!-- BARIS 4: CATATAN PENGEMBALIAN -->
                <div style="background: #FEF2F2; border: 1px solid #FEE2E2; border-left: 3px solid #DC2626; border-radius: 6px; padding: 7px 10px; margin-top: 6px; font-size: 0.74rem;">
                  <div style="font-size: 0.68rem; font-weight: 700; color: #991B1B; margin-bottom: 2px;">
                    Catatan Pengembalian:
                  </div>
                  <div style="color: #450A0A; font-weight: 500; word-break: break-word; line-height: 1.35;">
                    "${esc(returnNote)}"
                  </div>
                </div>

                <!-- BARIS 5: METRICS 3-KOLOM -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px 10px; font-size: 0.72rem; text-align: center; margin-top: 8px;">
                  <div>
                    <span style="color: #64748B; font-size: 0.68rem;">Diperiksa</span>
                    <div style="font-weight: 800; color: #0F172A; font-size: 0.85rem; margin-top: 1px;">
                      ${jlhDiperiksa.toLocaleString('id-ID')} Butir
                    </div>
                  </div>
                  <div>
                    <span style="color: #116834; font-size: 0.68rem;">Berhasil</span>
                    <div style="font-weight: 800; color: #116834; font-size: 0.85rem; margin-top: 1px;">
                      ${jlhBerhasil.toLocaleString('id-ID')} Butir
                    </div>
                  </div>
                  <div>
                    <span style="color: #DC2626; font-size: 0.68rem;">Tdk Berhasil</span>
                    <div style="font-weight: 800; color: #DC2626; font-size: 0.85rem; margin-top: 1px;">
                      ${jlhTidakBerhasil.toLocaleString('id-ID')} Butir
                    </div>
                  </div>
                </div>

                <!-- BARIS 6: DIRECT ACTION BUTTON -->
                <button type="button" class="btn-koreksi-deder-insp" data-doc="${esc(insp.docNo || insp.id || docNo)}" data-tx="${esc(insp.dederanTxDocNo || insp.dederanTxId || '')}" style="width: 100%; height: 38px; margin-top: 10px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.80rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 2px rgba(17,104,52,0.15); transition: all 0.15s ease;">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#FFFFFF" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  <span>Edit / Koreksi Pemeriksaan Dederan</span>
                </button>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    ${renderInspectionListControls({ module: 'DEDERAN', programs: dederTxs.map(tx => tx.programCode || tx.programId || tx.program) })}

    <div style="margin-bottom: 12px;">
      <h2 style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0 0 10px 0;">Daftar Bedengan Dederan Siap Periksa (${dederTxs.length})</h2>
    </div>

    <div id="deder-inspection-cards" data-inspection-list-container="DEDERAN" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
      ${dederTxs.map((dtx) => {
        const summary = getBedenganInspectionSummary(dtx);
        const inspectionState = summary.isComplete ? 'DONE' : (summary.totalDiperiksa > 0 ? 'IN_PROGRESS' : 'PENDING');

        let statusText = 'Siap Diperiksa';
        let statusBg = '#E53935';
        let statusColor = '#FFFFFF';
        let statusBorder = 'none';

        if (summary.isComplete) {
          statusText = 'Selesai (100%)';
          statusBg = '#E8F5E9';
          statusColor = '#116834';
          statusBorder = '1px solid #116834';
        } else if (summary.totalDiperiksa > 0) {
          statusText = `Sisa ${summary.sisaBelumDiperiksa} Butir`;
          statusBg = '#FFF8E1';
          statusColor = '#F57F17';
          statusBorder = '1px solid #FFE082';
        }

        // Perhitungan derived display metric % Berhasil Pindah Semai
        const populasiDeder = parseInt(dtx.jumlahDeder || 0, 10);
        const totalBerhasil = parseInt(summary.totalBerhasil || 0, 10);
        let persenBerhasilDisplay = '0%';
        if (populasiDeder > 0) {
          const rawPercent = (totalBerhasil / populasiDeder) * 100;
          if (rawPercent >= 100) {
            persenBerhasilDisplay = '100%';
          } else if (rawPercent <= 0) {
            persenBerhasilDisplay = '0%';
          } else if (rawPercent % 1 === 0) {
            persenBerhasilDisplay = `${rawPercent}%`;
          } else {
            persenBerhasilDisplay = `${rawPercent.toFixed(1)}%`;
          }
        }

        return `
          <div class="card-deder-insp-wrapper" data-inspection-list-card="DEDERAN" data-program="${esc(dtx.programCode || dtx.programId || dtx.program || '')}" data-state="${inspectionState}" data-batch="${esc(dtx.batchCode || dtx.batchNo || '')}" data-date="${esc(normalizeDateStr(dtx.tanggalDeder || dtx.tanggal || dtx.createdAt) || '')}" data-search="${esc([dtx.docNo, dtx.parentDederIndukDocNo, dtx.sourceReceiptDocNo, dtx.bedenganCode, dtx.klon, dtx.batchCode, dtx.batchNo].filter(Boolean).join(' '))}" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); box-sizing: border-box;">
            <!-- BARIS 1: BEDENGAN & KLON (KIRI) | STATUS BADGE (KANAN) -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; gap: 8px;">
              <div style="font-size: 0.95rem; font-weight: 800; color: #116834; letter-spacing: -0.01em; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                <span>${esc(dtx.bedenganCode || 'Bedengan')}</span>
                <span style="font-size: 0.74rem; font-weight: 600; color: #64748B;">• Klon: <strong style="color: #0F172A; font-weight: 700;">${esc(dtx.klon || 'GT 1')}</strong></span>
              </div>
              <span style="background: ${statusBg}; color: ${statusColor}; font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; white-space: nowrap; border: ${statusBorder}; flex-shrink: 0;">
                ${statusText}
              </span>
            </div>

            <!-- BARIS 2 & 3: DOK. INDUK (KIRI) & DOK DEDER (KIRI) | TGL (KANAN) -->
            <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; font-size: 0.74rem; color: #64748B; line-height: 1.35;">
              <div>Dok. Induk: <strong style="color: #0F172A; font-weight: 600;">${esc(dtx.parentDederIndukDocNo || '-')}</strong></div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div><strong style="color: #0F172A; font-weight: 800; font-size: 0.84rem;">${esc(dtx.docNo)}</strong></div>
                <div style="text-align: right;">Tgl: <span style="color: #334155; font-weight: 500;">${esc(dtx.tanggalDeder || dtx.tanggal || '-')}</span></div>
              </div>
            </div>

            <hr style="border: none; border-top: 1px solid #F3F4F6; margin: 0 0 10px 0;" />

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; text-align: center; margin-bottom: ${!summary.isComplete ? '10px' : '0'};">
              <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 2px;">
                <div style="font-size: 0.62rem; color: #6B7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Populasi Deder</div>
                <div style="font-size: 0.80rem; font-weight: 800; color: #111827; margin-top: 1px;">${(dtx.jumlahDeder || 0).toLocaleString('id-ID')}</div>
              </div>
              <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 2px;">
                <div style="font-size: 0.62rem; color: #116834; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Berhasil</div>
                <div style="font-size: 0.80rem; font-weight: 800; color: #116834; margin-top: 1px;">${(summary.totalBerhasil || 0).toLocaleString('id-ID')}</div>
              </div>
              <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 2px;">
                <div style="font-size: 0.62rem; color: ${summary.sisaBelumDiperiksa > 0 ? '#D97706' : '#116834'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Sisa Periksa</div>
                <div style="font-size: 0.80rem; font-weight: 800; color: ${summary.sisaBelumDiperiksa > 0 ? '#D97706' : '#116834'}; margin-top: 1px;">${(summary.sisaBelumDiperiksa || 0).toLocaleString('id-ID')}</div>
              </div>
              <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 2px;">
                <div style="font-size: 0.62rem; color: #116834; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">% Berhasil</div>
                <div style="font-size: 0.80rem; font-weight: 800; color: #116834; margin-top: 1px;">${persenBerhasilDisplay}</div>
              </div>
            </div>

            ${!summary.isComplete ? `
              <button type="button" class="btn-rekam-pemeriksaan-deder" data-id="${dtx.id || dtx.docNo}" style="width: 100%; height: 38px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 2px rgba(17,104,52,0.2);">
                Rekam Pemeriksaan Dederan
              </button>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>

    <!-- HISTORI PEMERIKSAAN DEDERAN -->
    ${renderDateFilterBannerHtml(selectedInspectionDate, 'btn-reset-date-filter')}

    ${dederInspections.length > 0 ? `
      <div style="margin: 20px 0 10px 0;">
        <h2 style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0 0 10px 0;">Ringkasan Data Pemeriksaan Dederan (${dederInspections.length})</h2>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${dederInspections.map((insp, idx) => {
            const isDederLocked = isTransactionLockedForMantri(insp);
            const isReturned = (insp.status === 'DIKEMBALIKAN' || insp.verificationStatus === 'DIKEMBALIKAN');
            const hasReturnReason = isReturned && typeof insp.returnReason === 'string' && insp.returnReason.trim().length > 0;
            return `
            <div class="card-deder-insp-summary-wrapper" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; font-size: 0.78rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03); position: relative;">
              
              <!-- BARIS 1: JUDUL DOKUMEN & 3-DOTS ACTION -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  ${isReturned ? renderStatusDots([{
                    key: 'CENTRAL_DIKEMBALIKAN',
                    label: 'Perlu Revisi'
                  }]) : (isDederLocked ? renderStatusDots([{
                    key: insp.status === 'DISETUJUI' || insp.verificationStatus === 'TERVERIFIKASI' ? 'CENTRAL_TERVERIFIKASI' : 'TX_LOCKED_VERIF',
                    label: insp.status === 'DISETUJUI' || insp.verificationStatus === 'TERVERIFIKASI' ? 'Terverifikasi' : 'Menunggu Verifikasi (Terkunci)'
                  }]) : '')}
                  <strong style="color: #116834; font-size: 0.90rem; font-weight: 800;">${insp.docNo}</strong>
                </div>

                <!-- TOMBOL AKSI 3-DOTS (HANYA DITAMPILKAN JIKA BELUM LOCKED) -->
                ${!isDederLocked ? `
                  <div style="position: relative;">
                    <button type="button" class="btn-deder-insp-action-trigger" data-index="${idx}" aria-label="Menu Aksi" style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #4B5563; padding: 0;">
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1.2" fill="currentColor"></circle>
                        <circle cx="19" cy="12" r="1.2" fill="currentColor"></circle>
                        <circle cx="5" cy="12" r="1.2" fill="currentColor"></circle>
                      </svg>
                    </button>

                    <!-- POPUP MENU -->
                    <div class="deder-insp-action-menu" style="display: none; position: absolute; right: 0; top: 32px; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); z-index: 100; min-width: 130px; overflow: hidden;">
                      <button type="button" class="menu-action-edit-deder-insp" data-doc="${insp.docNo}" data-tx="${insp.dederanTxDocNo || insp.dederanTxId}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #116834; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #F3F4F6;">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#116834" stroke-width="2.2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        <span>Edit</span>
                      </button>
                      <button type="button" class="menu-action-delete-deder-insp" data-doc="${insp.docNo}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #DC2626; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#DC2626" stroke-width="2.2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <span>Hapus</span>
                      </button>
                    </div>
                  </div>
                ` : ''}
              </div>

              <!-- BARIS 2: BEDENGAN -->
              <div style="color: #4B5563; font-size: 0.72rem; margin-bottom: 2px;">
                Bedengan: <strong style="color: #0F172A;">${insp.bedenganCode || '-'}</strong>
              </div>

              <!-- BARIS 3: SUMBER DEDER & TANGGAL -->
              <div style="display: flex; justify-content: space-between; align-items: center; color: #4B5563; font-size: 0.72rem; margin-bottom: 8px;">
                <div>Sumber Deder: <strong style="color: #0F172A;">${insp.dederanTxDocNo || '-'}</strong></div>
                <span style="color: #6B7280; font-size: 0.70rem;">${insp.tanggalPemeriksaan || '-'}</span>
              </div>

              <!-- BARIS 2.5: CATATAN PENGEMBALIAN DARI ASISTEN (JIKA STATUS DIKEMBALIKAN) -->
              ${hasReturnReason ? `
                <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; padding: 8px 10px; font-size: 0.72rem; color: #991B1B; line-height: 1.4; margin-bottom: 8px; overflow-wrap: anywhere; word-break: normal;">
                  <strong style="display: block; font-size: 0.68rem; color: #DC2626; margin-bottom: 2px;">Catatan Pengembalian Asisten:</strong>
                  ${esc(insp.returnReason.trim())}
                </div>
              ` : ''}

              <!-- BARIS 3: STATISTIK 3-KOLOM -->
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 6px 8px; font-size: 0.72rem; text-align: center;">
                <div>
                  <span style="color: #64748B; font-size: 0.65rem;">Diperiksa:</span>
                  <div style="font-weight: 800; color: #0F172A; margin-top: 1px;">${(insp.jumlahDiperiksa || 0).toLocaleString('id-ID')}</div>
                </div>
                <div>
                  <span style="color: #116834; font-size: 0.65rem;">Berhasil:</span>
                  <div style="font-weight: 800; color: #116834; margin-top: 1px;">${(insp.jumlahBerhasil || 0).toLocaleString('id-ID')}</div>
                </div>
                <div>
                  <span style="color: #DC2626; font-size: 0.65rem;">Tidak Berhasil:</span>
                  <div style="font-weight: 800; color: #DC2626; margin-top: 1px;">${(insp.jumlahTidakBerhasil || 0).toLocaleString('id-ID')}</div>
                </div>
              </div>

            </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

/**
 * Render Section Pemeriksaan Okulasi (Existing)
 */
function renderOkulasiInspectionSection(items, graftingCount, regraftingCount, inspectionTxs, returnedOkulasiInspections = []) {
  const okulasiPrograms = [...new Set(items.map(i => i.programCode || i.programId).filter(Boolean))];
  const itemsByDocNo = new Map(items.filter(item => item.docNo).map(item => [item.docNo, item]));
  return `
    <!-- SECTION: TRANSAKSI PEMERIKSAAN OKULASI PERLU PERBAIKAN -->
    ${returnedOkulasiInspections.length > 0 ? `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 3px; height: 14px; border-radius: 2px; background: #DC2626;"></span>
            <h2 style="font-size: 0.92rem; font-weight: 700; color: #0F172A; margin: 0;">
              Transaksi Pemeriksaan Okulasi Perlu Perbaikan
            </h2>
          </div>
          <span style="font-size: 0.68rem; font-weight: 600; background: #FEF2F2; color: #DC2626; padding: 2px 8px; border-radius: 9999px; border: 1px solid #FECACA;">
            ${returnedOkulasiInspections.length} dokumen menunggu koreksi
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${returnedOkulasiInspections.map((insp, idx) => {
            const docNo = insp.docNo ? insp.docNo.replace('/PRK/', '/INS/').replace('/INSP/', '/INS/') : formatStandardDocNo(2026, 'INS', idx + 1);
            const returnNote = insp.returnReason || insp.lastReturnReason || 'Perlu perbaikan data.';
            const isRegraftInsp = String(insp.buddingType || '').toUpperCase() === 'REGRAFTING';
            const inspGagal = parseInt(insp.jumlahGagal || 0);
            const regraftTotal = insp.totalToRegrafting !== undefined ? parseInt(insp.totalToRegrafting || 0) : inspGagal;
            const selectionTotal = insp.totalToSelection !== undefined ? parseInt(insp.totalToSelection || 0) : Math.max(0, inspGagal - regraftTotal);
            const jlhJadi = parseInt(insp.jumlahJadi || 0);
            const persenJadi = insp.persenJadi !== undefined ? insp.persenJadi : 100;
            const bedenganStr = insp.bedengan || 'Bedengan 01';
            const klonStr = insp.klonEntres || 'PB 260';
            const batchStr = insp.batchNo || 'Batch-01';

            return `
              <div class="card-summary-wrapper card-returned-okulasi-insp-wrapper" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 0.78rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); position: relative;">
                
                <!-- BARIS 1: IDENTITAS DOKUMEN, TYPE & STATUS BADGE (RATA KANAN) -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span style="font-weight: 800; font-size: 0.95rem; color: #0F172A; letter-spacing: -0.01em;">${esc(docNo)}</span>
                    <span style="font-size: 0.62rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${isRegraftInsp ? '#FFFBEB' : '#F0FDF4'}; color: ${isRegraftInsp ? '#B45309' : '#116834'}; border: ${isRegraftInsp ? '1px solid #FDE68A' : '1px solid #BBF7D0'};">
                      ${isRegraftInsp ? 'Regrafting' : 'Okulasi'}
                    </span>
                  </div>
                  <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    <span style="width: 5px; height: 5px; border-radius: 50%; background: #DC2626;"></span>
                    Dikembalikan
                  </span>
                </div>
                
                <!-- METADATA HIRARKI RAPI (KIRI - KANAN) -->
                <div style="display: flex; flex-direction: column; gap: 3px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748B; line-height: 1.35;">
                    <div>Batch: <strong style="color: #0F172A; font-weight: 600;">${esc(batchStr)}</strong></div>
                    <div style="text-align: right;">Klon: <strong style="color: #0F172A; font-weight: 600;">${esc(klonStr)}</strong></div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748B; line-height: 1.35;">
                    <div>Bedengan: <strong style="color: #0F172A; font-weight: 600;">${esc(bedenganStr)}</strong></div>
                    <div style="text-align: right;">Tgl: <span style="color: #334155; font-weight: 500;">${esc(insp.tanggal || insp.date || '-')}</span></div>
                  </div>
                </div>

                <!-- BARIS 4: CATATAN PENGEMBALIAN -->
                <div style="background: #FEF2F2; border: 1px solid #FEE2E2; border-left: 3px solid #DC2626; border-radius: 6px; padding: 7px 10px; margin-top: 6px; font-size: 0.74rem;">
                  <div style="font-size: 0.68rem; font-weight: 700; color: #991B1B; margin-bottom: 2px;">
                    Catatan Pengembalian:
                  </div>
                  <div style="color: #450A0A; font-weight: 500; word-break: break-word; line-height: 1.35;">
                    "${esc(returnNote)}"
                  </div>
                </div>

                <!-- BARIS 5: METRICS 3-KOLOM -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px 10px; font-size: 0.72rem; text-align: center; margin-top: 8px;">
                  <div>
                    <span style="color: #64748B; font-size: 0.68rem;">Keberhasilan</span>
                    <div style="font-weight: 800; color: #116834; font-size: 0.85rem; margin-top: 1px;">
                      ${persenJadi}%
                    </div>
                  </div>
                  <div>
                    <span style="color: #116834; font-size: 0.68rem;">Berhasil</span>
                    <div style="font-weight: 800; color: #116834; font-size: 0.85rem; margin-top: 1px;">
                      ${jlhJadi.toLocaleString('id-ID')} Pkk
                    </div>
                  </div>
                  <div>
                    <span style="color: ${regraftTotal > 0 ? '#D97706' : (selectionTotal > 0 ? '#DC2626' : '#64748B')}; font-size: 0.68rem;">
                      Tidak Berhasil
                    </span>
                    <div style="font-weight: 800; color: ${regraftTotal > 0 ? '#D97706' : (selectionTotal > 0 ? '#DC2626' : '#64748B')}; font-size: 0.85rem; margin-top: 1px;">
                      ${(regraftTotal > 0 ? regraftTotal : selectionTotal).toLocaleString('id-ID')} Pkk
                    </div>
                  </div>
                </div>

                <!-- BARIS 6: DIRECT ACTION BUTTON -->
                <button type="button" class="btn-koreksi-okulasi-insp" data-doc="${esc(insp.docNo || '')}" style="width: 100%; height: 38px; margin-top: 10px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.80rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 2px rgba(17,104,52,0.15); transition: all 0.15s ease;">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#FFFFFF" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  <span>Edit / Koreksi Pemeriksaan Okulasi</span>
                </button>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    ${renderInspectionListControls({ module: 'OKULASI', programs: okulasiPrograms, searchPlaceholder: 'Cari batch, bedengan, atau dokumen...' })}

    <div style="margin-bottom: 12px;">
      <h2 style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0 0 10px 0;">Daftar Hasil Okulasi Siap Periksa</h2>

      <!-- TAB FILTER KLASIFIKASI SUMBER DOKUMEN -->
      <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;">
        <button type="button" class="btn-filter-insp-tab" data-filter="ALL" style="padding: 6px 12px; font-size: 0.72rem; font-weight: 700; border-radius: 20px; border: 1px solid ${inspectionListControls.OKULASI.kind === 'ALL' ? '#116834' : '#D1D5DB'}; background: ${inspectionListControls.OKULASI.kind === 'ALL' ? '#116834' : '#FFFFFF'}; color: ${inspectionListControls.OKULASI.kind === 'ALL' ? '#FFFFFF' : '#374151'}; cursor: pointer; white-space: nowrap; box-sizing: border-box;">
          Semua (${items.length})
        </button>
        <button type="button" class="btn-filter-insp-tab" data-filter="GRAFTING" style="padding: 6px 12px; font-size: 0.72rem; font-weight: 700; border-radius: 20px; border: 1px solid ${inspectionListControls.OKULASI.kind === 'GRAFTING' ? '#116834' : '#D1D5DB'}; background: ${inspectionListControls.OKULASI.kind === 'GRAFTING' ? '#116834' : '#FFFFFF'}; color: ${inspectionListControls.OKULASI.kind === 'GRAFTING' ? '#FFFFFF' : '#374151'}; cursor: pointer; white-space: nowrap; box-sizing: border-box;">
          Okulasi (${graftingCount})
        </button>
        <button type="button" class="btn-filter-insp-tab" data-filter="REGRAFTING" style="padding: 6px 12px; font-size: 0.72rem; font-weight: 700; border-radius: 20px; border: 1px solid ${inspectionListControls.OKULASI.kind === 'REGRAFTING' ? '#116834' : '#FDE68A'}; background: ${inspectionListControls.OKULASI.kind === 'REGRAFTING' ? '#116834' : '#FFFBEB'}; color: ${inspectionListControls.OKULASI.kind === 'REGRAFTING' ? '#FFFFFF' : '#B45309'}; cursor: pointer; white-space: nowrap; box-sizing: border-box;">
          Okulasi Janda (${regraftingCount})
        </button>
      </div>
    </div>

    <!-- EMPTY STATE CONTAINER UNTUK DAFTAR OKULASI SIAP PERIKSA -->
    ${renderEmptyStateCard({
      id: 'insp-empty-state',
      title: 'Belum Ada Data Okulasi',
      description: items.length === 0 ? 'Lakukan proses <strong>Okulasi (Grafting)</strong> terlebih dahulu agar data batch otomatis masuk ke tahap Pemeriksaan.' : 'Tidak ditemukan dokumen okulasi untuk diperiksa',
      customStyle: `display: ${items.length === 0 ? 'block' : 'none'}; margin-top: 16px; margin-bottom: 20px;`
    })}

    ${items.length > 0 ? `
      <div id="insp-cards-container" data-inspection-list-container="OKULASI" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
        ${items.map((item, idx) => {
          const workers = item.workers || [];
          return `
            <div class="card-inspection-wrapper" data-inspection-list-card="OKULASI" data-type="${item.isRegrafting ? 'REGRAFTING' : 'GRAFTING'}" data-kind="${item.isRegrafting ? 'REGRAFTING' : 'GRAFTING'}" data-program="${esc(item.programCode || item.programId || '')}" data-state="${item.sisaBelumDiperiksa <= 0 ? 'DONE' : (item.totalDiperiksa > 0 ? 'IN_PROGRESS' : 'PENDING')}" data-batch="${esc(item.batchNo || '')}" data-date="${esc(normalizeDateStr(item.tanggal || item.createdAt) || '')}" data-search="${esc([item.batchNo, item.docNo, item.sourceDocNo, item.regraftPoolDocNo, item.bedengan, item.klonEntres, item.programCode, ...(Array.isArray(item.workers) ? item.workers.flatMap(worker => [worker.name, worker.code]) : [])].filter(Boolean).join(' '))}" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); box-sizing: border-box;">
              
              <!-- HEADER BARIS 1: NOMOR BATCH & STATUS BADGE -->
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:6px;">
                <div style="display:flex;align-items:center;gap:6px;min-width:0;">
                  ${renderStatusDots([{
                    key: item.totalDiperiksa === 0 ? 'INSP_PERLU' : (item.sisaBelumDiperiksa <= 0 ? 'INSP_DONE_PCT' : 'INSP_SISA'),
                    label: item.statusText
                  }])}
                  <div style="font-size: 0.95rem; font-weight: 800; color: #116834; white-space: nowrap; letter-spacing: -0.01em;">
                    ${item.batchNo || 'Batch-01'}
                  </div>
                </div>
                ${item.sisaBelumDiperiksa <= 0 ? `<div class="card-action-periksa" data-index="${item.originalIndex}" data-completed="true" data-batch="${item.batchNo || 'Batch'}" data-total="${item.populasiDiokulasi}" style="display:inline-flex;align-items:center;flex-shrink:0;padding:3px 9px;border-radius:999px;background:#DCFCE7;border:1px solid #BBF7D0;color:#116834;font-size:.64rem;font-weight:700;line-height:1.2;cursor:pointer;">Selesai</div>` : ''}
              </div>

              <!-- HEADER BARIS 2: BADGE SUMBER & DOKUMEN -->
              ${item.sisaBelumDiperiksa <= 0 ? `
                <div style="display:flex;align-items:center;justify-content:flex-start;margin-bottom:2px;">
                  <span style="font-size:0.78rem;font-weight:700;color:#111827;">${item.docNo || `OKL/2026/0${idx + 1}`}</span>
                </div>
              ` : `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; gap: 6px; flex-wrap: wrap;">
                  <span style="background: ${item.typeBadgeBg}; color: ${item.typeBadgeColor}; font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: ${item.typeBadgeBorder}; white-space: nowrap;">
                    ${item.typeLabel}
                  </span>
                  <span style="font-size: 0.78rem; font-weight: 700; color: #111827;">
                    ${item.docNo || `OKL/2026/0${idx + 1}`}
                  </span>
                </div>
              `}

              <!-- HEADER BARIS 3: TANGGAL & DOKUMEN ASAL -->
              <div style="font-size: 0.72rem; color: #888888; margin-bottom: 10px;">
                ${item.isRegrafting ? `Regrafting: ${item.tanggal || 'Hari ini'} • Pool: ${item.regraftPoolDocNo || '-'}` : `Okulasi: ${item.tanggal || 'Hari ini'} • Asal: ${item.sourceDocNo || '-'}`}
              </div>

              <hr style="border: none; border-top: 1px solid #F3F4F6; margin: 0 0 10px 0;" />

              <!-- GRID DETAIL 2x2 -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-bottom: 10px;">
                <div>
                  <div style="font-size: 0.7rem; color: #6B7280; margin-bottom: 2px;">Klon Entres</div>
                  <div style="font-size: 0.84rem; font-weight: 800; color: #116834;">${item.klonEntres || 'PB 260'}</div>
                </div>
                <div>
                  <div style="font-size: 0.7rem; color: #6B7280; margin-bottom: 2px;">Lokasi Bedengan</div>
                  <div style="font-size: 0.82rem; font-weight: 700; color: #111111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.bedengan || 'Bedengan 01'}</div>
                </div>
                <div>
                  <div style="font-size: 0.7rem; color: #6B7280; margin-bottom: 2px;">${item.isRegrafting ? 'Populasi Regrafting' : 'Populasi Diokulasi'}</div>
                  <div style="font-size: 0.82rem; font-weight: 700; color: #116834;">${item.populasiDiokulasi} Pkk</div>
                </div>
                <div>
                  <div style="font-size: 0.7rem; color: #6B7280; margin-bottom: 2px;">Belum Diperiksa</div>
                  <div style="font-size: 0.82rem; font-weight: 700; color: ${item.sisaBelumDiperiksa > 0 ? '#D32F2F' : '#116834'};">${item.sisaBelumDiperiksa} Pkk</div>
                </div>
              </div>

              <!-- TOMBOL TOGGLE EXPAND DETAIL -->
              <div style="margin-bottom: 6px;">
                <button type="button" class="btn-toggle-expand-insp" style="background: #F0FDF4; border: 1px solid #DCFCE7; border-radius: 6px; width: 100%; padding: 6px 10px; font-size: 0.74rem; font-weight: 700; color: #116834; cursor: pointer; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box;">
                  <span class="text-expand-insp">Tampilkan Detail Akumulasi</span>
                  <svg class="icon-expand-insp" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease;">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              </div>

              <!-- EXPANDABLE ACCORDION DETAIL AKUMULASI -->
              <div class="insp-expand-content" style="display: none; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; font-size: 0.74rem;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #6B7280;">Klon Batang Bawah:</span>
                    <span style="font-weight: 700; color: #111827; text-align: right;">${item.klonRootstock || 'GT-01'}</span>
                  </div>
                  ${item.isRegrafting ? `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #6B7280;">Pemeriksaan Asal:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right;">${item.inspectionDocNo || '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #6B7280;">Penyebab Okulasi Ulang:</span>
                      <span style="font-weight: 700; color: #D97706; text-align: right;">${item.alasan || 'Okulasi Ulang'}</span>
                    </div>
                  ` : `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #6B7280;">Bibit Ditolak Okulasi:</span>
                      <span style="font-weight: 700; color: #D32F2F; text-align: right;">${item.jumlahDitolak || 0} Pkk</span>
                    </div>
                  `}
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #6B7280;">Jumlah Kayu Okulasi:</span>
                    <span style="font-weight: 700; color: #111827; text-align: right;">${item.jumlahKayu || 0} Batang</span>
                  </div>
                </div>

                <!-- REKAPITULASI AKUMULASI PEMERIKSAAN -->
                <div style="background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px 12px; margin: 10px 0; display: flex; flex-direction: column; gap: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #374151; font-weight: 600;">Telah Diperiksa:</span>
                    <span style="font-weight: 800; color: #111827; text-align: right;">${item.totalDiperiksa} Pkk</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #116834; font-weight: 600;">Berhasil:</span>
                    <span style="font-weight: 800; color: #116834; text-align: right;">${item.totalJadi} Pkk (${item.persenJadiDisplay})</span>
                  </div>
                  ${item.totalRegrafting > 0 ? `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #D97706; font-weight: 600;">Okulasi Janda:</span>
                      <span style="font-weight: 800; color: #D97706; text-align: right;">${item.totalRegrafting} Pkk</span>
                    </div>
                  ` : ''}
                  ${item.totalSelection > 0 ? `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #DC2626; font-weight: 600;">Gagal (Mati):</span>
                      <span style="font-weight: 800; color: #DC2626; text-align: right;">${item.totalSelection} Pkk</span>
                    </div>
                  ` : ''}
                </div>

                <!-- PEKERJA OKULASI -->
                ${workers.length > 0 ? `
                  <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #D1D5DB;">
                    <div style="font-weight: 700; color: #374151; margin-bottom: 6px; font-size: 0.74rem;">Pekerja Okulasi:</div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                      ${workers.map(w => `
                        <div style="display: flex; justify-content: space-between; align-items: center; color: #4B5563;">
                          <span>• ${w.name} <span style="color: #9CA3AF;">(${w.code})</span></span>
                          <span style="font-weight: 700; color: #116834; text-align: right;">${w.qty || 0} Pkk</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>

              <!-- FOOTER ACTION ROW -->
              ${item.sisaBelumDiperiksa > 0 && item.canInspect ? `
                <div class="card-action-periksa" data-index="${item.originalIndex}" data-completed="false" data-batch="${item.batchNo || 'Batch'}" data-total="${item.populasiDiokulasi}" style="display: flex; justify-content: space-between; align-items: center; background: #116834; color: #FFFFFF; border-radius: 6px; padding: 10px 14px; margin-top: 10px; cursor: pointer; box-shadow: 0 2px 4px rgba(17,104,52,0.22); transition: opacity 0.15s ease;">
                  <span style="font-size: 0.78rem; color: #FFFFFF; font-weight: 700; letter-spacing: -0.01em;">Ketuk untuk Rekam Pemeriksaan</span>
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              ` : (item.sisaBelumDiperiksa > 0 ? `
                <div style="margin-top:10px;padding:9px 11px;border:1px solid #FDE68A;border-radius:6px;background:#FFFBEB;color:#92400E;font-size:.72rem;font-weight:600;line-height:1.4;">
                  ${esc(item.inspectionGateReason || 'Menunggu persetujuan Asisten Bibitan.')}
                </div>
              ` : '')}

            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    <!-- HISTORI PEMERIKSAAN OKULASI -->
    ${renderDateFilterBannerHtml(selectedInspectionDate, 'btn-reset-date-filter')}

    ${inspectionTxs.length > 0 ? `
      <div id="insp-summary-section" style="margin: 20px 0 10px 0;">
        <div id="insp-summary-header" style="margin-bottom: 10px;">
          <h2 id="insp-summary-title" style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0;">Ringkasan Data Pemeriksaan (${inspectionTxs.length})</h2>
        </div>
        <div id="insp-summary-cards-container" style="display: flex; flex-direction: column; gap: 8px;">
          ${inspectionTxs.map((insp, idx) => {
            const inspGagal = parseInt(insp.jumlahGagal || 0);
            const regraftTotal = insp.totalToRegrafting !== undefined ? parseInt(insp.totalToRegrafting || 0) : inspGagal;
            const selectionTotal = insp.totalToSelection !== undefined ? parseInt(insp.totalToSelection || 0) : Math.max(0, inspGagal - regraftTotal);
            const isRegraftInsp = String(insp.buddingType || '').toUpperCase() === 'REGRAFTING';
            const sourceItem = itemsByDocNo.get(insp.buddingDocNo);
            const transactionProgram = insp.programCode || insp.programId || sourceItem?.programCode || sourceItem?.programId || '';
            const transactionState = sourceItem
              ? (sourceItem.sisaBelumDiperiksa <= 0 ? 'DONE' : (sourceItem.totalDiperiksa > 0 ? 'IN_PROGRESS' : 'PENDING'))
              : 'DONE';

            const isOkulasiInspLocked = isTransactionLockedForMantri(insp);

            return `
              <div class="card-insp-summary-wrapper" data-inspection-transaction-card="OKULASI" data-kind="${isRegraftInsp ? 'REGRAFTING' : 'GRAFTING'}" data-program="${esc(transactionProgram)}" data-state="${transactionState}" data-batch="${esc(insp.batchNo || sourceItem?.batchNo || '')}" data-date="${esc(normalizeDateStr(insp.tanggal || insp.date || insp.createdAt) || '')}" data-search="${esc([insp.batchNo, insp.docNo, insp.buddingDocNo, sourceItem?.docNo, insp.sourceDocNo, insp.bedengan, insp.klonEntres, transactionProgram, ...(Array.isArray(insp.workers) ? insp.workers.flatMap(worker => [worker.name, worker.code]) : [])].filter(Boolean).join(' '))}" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; font-size: 0.78rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03); box-sizing: border-box; position: relative;">
                
                <!-- BARIS 1: JUDUL BATCH & TOMBOL AKSI 3-DOTS -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-weight: 800; font-size: 0.88rem; color: #111827;">${insp.batchNo || 'Batch'} - ${insp.klonEntres || 'PB 260'}</span>
                    <span style="font-size: 0.62rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${isRegraftInsp ? '#FFFBEB' : '#F0FDF4'}; color: ${isRegraftInsp ? '#B45309' : '#116834'}; border: ${isRegraftInsp ? '1px solid #FDE68A' : '1px solid #BBF7D0'};">
                      ${isRegraftInsp ? 'Regrafting' : 'Okulasi'}
                    </span>
                  </div>

                  <!-- TOMBOL AKSI 3-DOTS -->
                  <div style="position: relative;">
                    <button type="button" class="btn-tx-action-trigger" data-index="${idx}" aria-label="Menu Aksi" style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #4B5563; padding: 0;">
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1.2" fill="currentColor"></circle>
                        <circle cx="19" cy="12" r="1.2" fill="currentColor"></circle>
                        <circle cx="5" cy="12" r="1.2" fill="currentColor"></circle>
                      </svg>
                    </button>

                    <!-- DROPDOWN POPUP MENU -->
                    <div class="tx-action-menu" style="display: none; position: absolute; right: 0; top: 32px; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); z-index: 100; min-width: 130px; overflow: hidden;">
                      <button type="button" class="menu-action-rincian" data-index="${idx}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #374151; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #F3F4F6;">
                        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#116834" stroke-width="2.2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        <span class="text-menu-rincian">Rincian</span>
                      </button>
                      ${!isOkulasiInspLocked ? `
                        <button type="button" class="menu-action-edit" data-index="${idx}" data-doc="${insp.docNo || ''}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #116834; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #F3F4F6;">
                          <svg viewBox="0 0 24 24" width="13" height="13" stroke="#116834" stroke-width="2.2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          <span>Edit</span>
                        </button>
                        <button type="button" class="menu-action-delete" data-index="${idx}" data-doc="${insp.docNo || ''}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #DC2626; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                          <svg viewBox="0 0 24 24" width="13" height="13" stroke="#DC2626" stroke-width="2.2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          <span>Hapus</span>
                        </button>
                      ` : ''}
                    </div>
                  </div>
                </div>

                <!-- BARIS 2: LOKASI & TANGGAL -->
                <div style="font-size: 0.72rem; color: #6B7280; margin-bottom: 8px;">
                  ${insp.bedengan || 'Bedengan 01'} • ${insp.tanggal || 'Hari ini'}
                </div>

                <!-- BARIS 3: METRIK STATISTIK SIMETRIS 3-KOLOM -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 6px; padding: 7px 4px; text-align: center;">
                  <div>
                    <div style="font-size: 0.65rem; color: #6B7280;">Keberhasilan</div>
                    <div style="font-size: 0.82rem; font-weight: 800; color: #116834; margin-top: 1px;">${insp.persenJadi || 100}%</div>
                  </div>
                  <div>
                    <div style="font-size: 0.65rem; color: #116834;">Berhasil</div>
                    <div style="font-size: 0.82rem; font-weight: 800; color: #116834; margin-top: 1px;">${insp.jumlahJadi || 0} Pkk</div>
                  </div>
                  <div>
                    <div style="font-size: 0.65rem; color: ${regraftTotal > 0 ? '#D97706' : (selectionTotal > 0 ? '#DC2626' : '#6B7280')};">
                      ${regraftTotal > 0 ? 'Okulasi Janda' : 'Mati / Gagal'}
                    </div>
                    <div style="font-size: 0.82rem; font-weight: 800; color: ${regraftTotal > 0 ? '#D97706' : (selectionTotal > 0 ? '#DC2626' : '#6B7280')}; margin-top: 1px;">
                      ${inspGagal} Pkk
                    </div>
                  </div>
                </div>
                <div class="insp-transaction-detail" style="display:none;margin-top:8px;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:7px;font-size:.72rem;line-height:1.45;">
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;"><span style="color:#64748B;">Dokumen Pemeriksaan</span><strong style="color:#0F172A;text-align:right;overflow-wrap:anywhere;">${esc(insp.docNo || '-')}</strong></div>
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;"><span style="color:#64748B;">Dokumen Okulasi</span><strong style="color:#0F172A;text-align:right;overflow-wrap:anywhere;">${esc(insp.buddingDocNo || '-')}</strong></div>
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;"><span style="color:#64748B;">Total diperiksa</span><strong style="color:#0F172A;">${Number(insp.totalDiperiksa ?? (Number(insp.jumlahJadi || 0) + inspGagal)).toLocaleString('id-ID')} Pkk</strong></div>
                  <div style="font-weight:700;color:#334155;margin-bottom:5px;">Rincian pekerja</div>
                  ${(Array.isArray(insp.workers) && insp.workers.length ? insp.workers : []).map(worker => {
                    const workerGagal = Number(worker.jlhTidakBerhasil || 0);
                    const workerRegraft = worker.perluRegrafting ? workerGagal : 0;
                    const workerSelection = workerGagal - workerRegraft;
                    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid #E2E8F0;"><span style="min-width:0;overflow-wrap:anywhere;color:#334155;">${esc(worker.name || 'Pekerja')}</span><span style="flex-shrink:0;text-align:right;color:#475569;">Periksa ${Number(worker.jlhDiperiksa || 0).toLocaleString('id-ID')} · Jadi ${Number(worker.jlhBerhasil || 0).toLocaleString('id-ID')} · Gagal ${workerGagal.toLocaleString('id-ID')}<br><span style="color:#B45309;">Janda ${workerRegraft.toLocaleString('id-ID')}</span> · <span style="color:#DC2626;">Seleksi ${workerSelection.toLocaleString('id-ID')}</span></span></div>`;
                  }).join('') || '<div style="color:#64748B;">Rincian pekerja tidak tersedia pada transaksi ini.</div>'}
                  ${insp.catatan ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid #E2E8F0;"><span style="color:#64748B;">Catatan:</span> ${esc(insp.catatan)}</div>` : ''}
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

/**
 * Event listeners for Dederan Inspection
 */
function attachDederanInspectionEvents(app) {
  const userCtx = getCurrentUserContext() || resolveUserContext();

  // Action: Rekam Pemeriksaan Dederan (New)
  app.querySelectorAll('.btn-rekam-pemeriksaan-deder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const txId = e.currentTarget.dataset.id;
      storage.remove('editing_dederan_inspection_id');
      storage.set('active_dederan_inspection_tx_id', txId);
      navigate('/inspection/dederan/form');
    });
  });

  // 3-dots action popup toggle
  app.querySelectorAll('.btn-deder-insp-action-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrapper = e.currentTarget.closest('.card-deder-insp-summary-wrapper');
      const menu = wrapper?.querySelector('.deder-insp-action-menu');
      app.querySelectorAll('.deder-insp-action-menu').forEach(m => {
        if (m !== menu) m.style.display = 'none';
      });
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    });
  });

  document.addEventListener('click', () => {
    app.querySelectorAll('.deder-insp-action-menu').forEach(m => m.style.display = 'none');
  });

  // Action: Edit / Koreksi Dederan Inspection
  const handleEditDederInsp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const docNo = e.currentTarget.dataset.doc;
    const txDocNo = e.currentTarget.dataset.tx;
    const allDeder = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
    const targetInsp = allDeder.find(d => d.docNo === docNo || d.id === docNo);
    if (!targetInsp) {
      toast('Data transaksi pemeriksaan dederan tidak ditemukan.', 'error');
      return;
    }
    if (!canUserAccessTransaction(targetInsp, userCtx, 'EDIT')) {
      toast('Anda tidak memiliki otorisasi untuk mengedit transaksi ini.', 'error');
      return;
    }
    const isReturned = isDederInspectionReturned(targetInsp);
    if (!isReturned && isTransactionLockedForMantri(targetInsp)) {
      toast('Data pemeriksaan tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.', 'warning');
      return;
    }
    storage.set('editing_dederan_inspection_id', docNo || targetInsp.id);
    storage.set('active_dederan_inspection_tx_id', txDocNo || targetInsp.dederanTxDocNo || targetInsp.dederanTxId);
    navigate('/inspection/dederan/form');
  };

  app.querySelectorAll('.menu-action-edit-deder-insp, .btn-koreksi-deder-insp').forEach(btn => {
    btn.addEventListener('click', handleEditDederInsp);
  });

  // Delete dialog handling for Dederan
  const modalDeleteOverlay = app.querySelector('#modal-delete-insp-overlay');
  const dialogDelete = app.querySelector('#dialog-delete-insp');
  const dialogDeleteMsg = app.querySelector('#dialog-delete-insp-msg');
  const btnCancelDelete = app.querySelector('#btn-cancel-delete-insp');
  const btnConfirmDelete = app.querySelector('#btn-confirm-delete-insp');
  let pendingDeleteDederDocNo = null;

  function closeDeleteDialog() {
    if (modalDeleteOverlay) modalDeleteOverlay.style.display = 'none';
    if (dialogDelete) dialogDelete.style.display = 'none';
    pendingDeleteDederDocNo = null;
  }

  btnCancelDelete?.addEventListener('click', closeDeleteDialog);
  modalDeleteOverlay?.addEventListener('click', closeDeleteDialog);

  app.querySelectorAll('.menu-action-delete-deder-insp').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pendingDeleteDederDocNo = e.currentTarget.dataset.doc;
      const allDeder = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
      const targetInsp = allDeder.find(d => d.docNo === pendingDeleteDederDocNo || d.id === pendingDeleteDederDocNo);
      if (!targetInsp || !canUserAccessTransaction(targetInsp, userCtx, 'DELETE')) {
        toast.error('Anda tidak memiliki otoritas untuk menghapus data pemeriksaan ini.');
        return;
      }
      if (isTransactionLockedForMantri(targetInsp)) {
        toast.error('Data pemeriksaan tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
        return;
      }
      if (guardDependency(targetInsp || pendingDeleteDederDocNo, 'Pemeriksaan Dederan', 'Dihapus')) {
        return;
      }
      if (dialogDeleteMsg) {
        dialogDeleteMsg.innerHTML = `Apakah Anda yakin ingin menghapus data pemeriksaan dederan <strong>${pendingDeleteDederDocNo}</strong>? Data yang terhubung ke Seleksi Bibit juga akan disinkronisasikan kembali.`;
      }
      if (modalDeleteOverlay) modalDeleteOverlay.style.display = 'block';
      if (dialogDelete) dialogDelete.style.display = 'block';
    });
  });

  btnConfirmDelete?.addEventListener('click', () => {
    if (pendingDeleteDederDocNo) {
      const res = deleteDederanInspection(pendingDeleteDederDocNo);
      if (res.success) {
        toast.success(`Data pemeriksaan ${pendingDeleteDederDocNo} berhasil dihapus`);
      } else {
        toast.error(res.message || 'Gagal menghapus data pemeriksaan');
      }
      closeDeleteDialog();
      renderInspectionLanding();
    }
  });
}

/**
 * Event listeners for Okulasi Inspection
 */
function attachOkulasiInspectionEvents(app, items, inspectionTxs) {
  const userCtx = getCurrentUserContext() || resolveUserContext();

  // Toggle detail expand
  app.querySelectorAll('.btn-toggle-expand-insp').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.currentTarget.closest('.card-inspection-wrapper');
      if (!card) return;
      const content = card.querySelector('.insp-expand-content');
      const textSpan = card.querySelector('.text-expand-insp');
      const icon = card.querySelector('.icon-expand-insp');
      if (!content) return;

      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? 'block' : 'none';
      if (textSpan) textSpan.textContent = isHidden ? 'Sembunyikan Detail' : 'Tampilkan Detail Akumulasi';
      if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    });
  });

  // Action periksa okulasi
  app.querySelectorAll('.card-action-periksa').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const isCompleted = e.currentTarget.dataset.completed === 'true';
      if (isCompleted) {
        const overlay = app.querySelector('#modal-completed-overlay');
        const dialog = app.querySelector('#dialog-batch-completed');
        if (overlay) overlay.style.display = 'block';
        if (dialog) dialog.style.display = 'block';
      } else {
        const index = e.currentTarget.dataset.index;
        storage.remove('editing_inspection_index');
        storage.set('selected_inspection_budding_index', index);
        storage.remove('active_inspection_budding_index');
        navigate('/inspection/form');
      }
    });
  });

  app.querySelector('#btn-close-completed-dialog')?.addEventListener('click', () => {
    const overlay = app.querySelector('#modal-completed-overlay');
    const dialog = app.querySelector('#dialog-batch-completed');
    if (overlay) overlay.style.display = 'none';
    if (dialog) dialog.style.display = 'none';
  });

  // Filter tabs
  app.querySelectorAll('.btn-filter-insp-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const filter = e.currentTarget.dataset.filter;
      inspectionListControls.OKULASI.kind = filter;
      inspectionListControls.OKULASI.filter = 'ALL';
      const statusFilter = app.querySelector('[data-inspection-control="filter"][data-module="OKULASI"]');
      if (statusFilter) statusFilter.value = 'ALL';
      app.querySelectorAll('.btn-filter-insp-tab').forEach(t => {
        const isSelected = t === e.currentTarget;
        t.style.background = isSelected ? '#116834' : '#FFFFFF';
        t.style.color = isSelected ? '#FFFFFF' : '#374151';
        t.style.border = isSelected ? '1px solid #116834' : '1px solid #D1D5DB';
      });

      applyInspectionListControls(app, 'OKULASI');
    });
  });

  // 3-dots actions
  app.querySelectorAll('.btn-tx-action-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrapper = e.currentTarget.closest('.card-insp-summary-wrapper');
      const menu = wrapper?.querySelector('.tx-action-menu');
      app.querySelectorAll('.tx-action-menu').forEach(m => {
        if (m !== menu) m.style.display = 'none';
      });
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    });
  });

  app.querySelectorAll('.menu-action-rincian').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = e.currentTarget.closest('.card-insp-summary-wrapper');
      const detail = card?.querySelector('.insp-transaction-detail');
      if (!detail) return;
      const willOpen = detail.style.display === 'none';
      detail.style.display = willOpen ? 'block' : 'none';
      const menu = e.currentTarget.closest('.tx-action-menu');
      if (menu) menu.style.display = 'none';
    });
  });

  document.addEventListener('click', () => {
    app.querySelectorAll('.tx-action-menu').forEach(m => m.style.display = 'none');
  });

  // Action: Edit / Koreksi Okulasi Inspection
  const handleEditOkulasiInsp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const docNo = e.currentTarget.dataset.doc;
    const allInsp = storage.get('inspection_transactions', []);
    let targetIndex = -1;
    if (docNo) {
      targetIndex = allInsp.findIndex(i => i.docNo === docNo || i.id === docNo);
    }
    if (targetIndex === -1 && e.currentTarget.dataset.index !== undefined) {
      targetIndex = parseInt(e.currentTarget.dataset.index);
    }
    const targetInsp = allInsp[targetIndex];
    if (!targetInsp) {
      toast('Data transaksi pemeriksaan okulasi tidak ditemukan.', 'error');
      return;
    }
    if (!canUserAccessTransaction(targetInsp, userCtx, 'EDIT')) {
      toast('Anda tidak memiliki otorisasi untuk mengedit transaksi ini.', 'error');
      return;
    }
    const isReturned = isOkulasiInspectionReturned(targetInsp);
    if (!isReturned && isTransactionLockedForMantri(targetInsp)) {
      toast('Data pemeriksaan tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.', 'warning');
      return;
    }
    const allBudding = storage.get('budding_transactions', []);
    let buddingIdx = allBudding.findIndex(b => b.docNo === targetInsp.buddingDocNo);
    if (buddingIdx < 0 && targetInsp.buddingIndex !== undefined) {
      buddingIdx = targetInsp.buddingIndex;
    }
    if (buddingIdx < 0) buddingIdx = 0;

    storage.set('selected_inspection_budding_index', buddingIdx);
    storage.set('editing_inspection_index', targetIndex);
    navigate('/inspection/form');
  };

  app.querySelectorAll('.menu-action-edit, .btn-koreksi-okulasi-insp').forEach(btn => {
    btn.addEventListener('click', handleEditOkulasiInsp);
  });

  // Delete dialog for Okulasi
  const modalDeleteOverlay = app.querySelector('#modal-delete-insp-overlay');
  const dialogDelete = app.querySelector('#dialog-delete-insp');
  const dialogDeleteMsg = app.querySelector('#dialog-delete-insp-msg');
  const btnCancelDelete = app.querySelector('#btn-cancel-delete-insp');
  const btnConfirmDelete = app.querySelector('#btn-confirm-delete-insp');
  let pendingDeleteDocNo = null;

  function closeDeleteDialog() {
    if (modalDeleteOverlay) modalDeleteOverlay.style.display = 'none';
    if (dialogDelete) dialogDelete.style.display = 'none';
    pendingDeleteDocNo = null;
  }

  btnCancelDelete?.addEventListener('click', closeDeleteDialog);
  modalDeleteOverlay?.addEventListener('click', closeDeleteDialog);

  app.querySelectorAll('.menu-action-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pendingDeleteDocNo = e.currentTarget.dataset.doc;
      const allInsp = storage.get('inspection_transactions', []);
      const targetInsp = allInsp.find(i => i.docNo === pendingDeleteDocNo || i.id === pendingDeleteDocNo);
      if (!targetInsp || !canUserAccessTransaction(targetInsp, userCtx, 'DELETE')) {
        toast.error('Anda tidak memiliki otoritas untuk menghapus data pemeriksaan ini.');
        return;
      }
      if (isTransactionLockedForMantri(targetInsp)) {
        toast.error('Data pemeriksaan tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
        return;
      }
      if (guardDependency(targetInsp || pendingDeleteDocNo, 'Pemeriksaan Okulasi', 'Dihapus')) {
        return;
      }
      if (dialogDeleteMsg) {
        dialogDeleteMsg.innerHTML = `Apakah Anda yakin ingin menghapus data pemeriksaan okulasi <strong>${pendingDeleteDocNo}</strong>?`;
      }
      if (modalDeleteOverlay) modalDeleteOverlay.style.display = 'block';
      if (dialogDelete) dialogDelete.style.display = 'block';
    });
  });

  btnConfirmDelete?.addEventListener('click', () => {
    if (pendingDeleteDocNo) {
      let currentInspTxs = storage.get('inspection_transactions', []);
      const targetInsp = currentInspTxs.find(i => i.docNo === pendingDeleteDocNo || i.id === pendingDeleteDocNo);
      if (isTransactionLockedForMantri(targetInsp)) {
        toast.error('Data pemeriksaan tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
        closeDeleteDialog();
        return;
      }
      currentInspTxs = currentInspTxs.filter(i => i.docNo !== pendingDeleteDocNo && i.id !== pendingDeleteDocNo);
      storage.set('inspection_transactions', currentInspTxs);
      toast.success(`Data pemeriksaan ${pendingDeleteDocNo} berhasil dihapus`);
    }
    closeDeleteDialog();
    renderInspectionLanding();
  });
}

/**
 * Menghitung jumlah batch okulasi yang membutuhkan tindakan pemeriksaan
 */
export function getActionableInspectionCount(currentUser) {
  const userCtx = currentUser || getCurrentUserContext();
  const buddingTxs = getAuthorizedTransactions(storage.get('budding_transactions', []), userCtx);
  const inspectionTxs = getAuthorizedTransactions(storage.get('inspection_transactions', []), userCtx);

  let count = 0;
  buddingTxs.forEach((btx, i) => {
    if (!getBuddingInspectionGate(btx).allowed) return;
    const populasiDiokulasi = parseInt(btx.jumlah || 0);
    let totalDiperiksa = 0;
    inspectionTxs.filter(insp => insp.buddingDocNo === btx.docNo || insp.buddingIndex === i).forEach(insp => {
      totalDiperiksa += parseInt(insp.totalDiperiksa || (parseInt(insp.jumlahJadi || 0) + parseInt(insp.jumlahGagal || 0)));
    });
    if (populasiDiokulasi - totalDiperiksa > 0) {
      count++;
    }
  });

  return count;
}

export function getReturnedInspectionCount(currentUser) {
  const userCtx = currentUser || getCurrentUserContext();
  const rawDederInspections = storage.get(DEDERAN_STORAGE_KEYS.INSPECTIONS, []);
  const authorizedDederInspections = getAuthorizedTransactions(rawDederInspections, userCtx);
  const returnedDeder = authorizedDederInspections.filter(insp => {
    if (userCtx?.divisionId && insp.divisionId && insp.divisionId !== userCtx.divisionId) return false;
    if (insp.isCorrected || insp.status === 'MENUNGGU_VERIFIKASI_MANTRI' || insp.status === 'PENDING_SUBMISSION' || insp.status === 'APPROVED' || insp.status === 'DISETUJUI') {
      return false;
    }
    return (insp.status === 'DIKEMBALIKAN' || insp.verificationStatus === 'DIKEMBALIKAN' || insp.status === 'REVISION');
  });

  const rawInspectionTxs = storage.get('inspection_transactions', []);
  const authorizedInspectionTxs = getAuthorizedTransactions(rawInspectionTxs, userCtx);
  const returnedOkulasi = authorizedInspectionTxs.filter(insp => {
    if (userCtx?.divisionId && insp.divisionId && insp.divisionId !== userCtx.divisionId) return false;
    if (insp.isCorrected || insp.status === 'MENUNGGU_VERIFIKASI_MANTRI' || insp.status === 'PENDING_SUBMISSION' || insp.status === 'APPROVED' || insp.status === 'DISETUJUI') {
      return false;
    }
    return (insp.status === 'DIKEMBALIKAN' || insp.verificationStatus === 'DIKEMBALIKAN' || insp.status === 'REVISION');
  });

  return returnedDeder.length + returnedOkulasi.length;
}

export function hasReturnedInspection(currentUser) {
  return getReturnedInspectionCount(currentUser) > 0;
}

/**
 * Render Section Seleksi Pra-Okulasi (Pelaksanaan Fisik Seleksi I, II, III)
 */
export function renderPreGraftingInspectionSection(user, userCtx, preGraftingDocs = []) {
  const seleksi1Docs = preGraftingDocs.filter(d => {
    const s = d.selectionStage || 'SELEKSI_I';
    return s === 'SELEKSI_I' || s === 'SELEKSI_1';
  });
  const seleksi2Docs = preGraftingDocs.filter(d => {
    const s = d.selectionStage || '';
    return s === 'SELEKSI_II' || s === 'SELEKSI_2';
  });
  const seleksi3Docs = preGraftingDocs.filter(d => {
    const s = d.selectionStage || '';
    return s === 'SELEKSI_III' || s === 'SELEKSI_3';
  });

  // A completed physical inspection stays counted while awaiting Mantri
  // confirmation or Asisten approval. Final/verified documents are excluded.
  const pendingSeleksi1Count = countPendingPreGraftingDocuments(seleksi1Docs);
  const pendingSeleksi2Count = countPendingPreGraftingDocuments(seleksi2Docs);
  const pendingSeleksi3Count = countPendingPreGraftingDocuments(seleksi3Docs);

  // Available programs
  const availableProgramsSet = new Set();
  preGraftingDocs.forEach(d => {
    const p = d.programCode || d.programId || d.programName;
    if (p) availableProgramsSet.add(p);
  });
  if (availableProgramsSet.size === 0) {
    availableProgramsSet.add('2026/TB/RNUR/001');
  }
  const preControls = inspectionListControls.SELEKSI_PRA_OKULASI;
  const preAvailablePrograms = Array.from(availableProgramsSet);
  if (preControls.program !== 'ALL' && !preAvailablePrograms.includes(preControls.program)) preControls.program = 'ALL';

  const selectedPreSearch = preControls.search.trim().toLocaleLowerCase('id-ID');
  const normalizeSelectionStage = value => String(value || '').toUpperCase().replace('SELEKSI_I', 'SELEKSI_1').replace('SELEKSI_II', 'SELEKSI_2').replace('SELEKSI_III', 'SELEKSI_3');
  const filterPreDocs = docs => {
    let result = docs.filter(d => preControls.program === 'ALL' || (d.programCode || d.programId || d.programName) === preControls.program);
    if (selectedPreSearch) result = result.filter(d => [d.batchCode, d.batchNo, d.programCode, d.programId, d.programName, d.docNo, d.sourceDocNo, d.bedenganCode]
      .filter(Boolean).join(' ').toLocaleLowerCase('id-ID').includes(selectedPreSearch));
    result = result.filter(d => {
      const stage = normalizeSelectionStage(d.selectionStage || 'SELEKSI_I');
      const metricStage = stage === 'SELEKSI_2' ? 'SELEKSI_2' : stage === 'SELEKSI_3' ? 'SELEKSI_3' : 'SELEKSI_1';
      const metrics = calculateBatchMetrics({ batchCode: d.batchCode || d.batchNo, docs: [d] }, metricStage);
      const isDone = (metrics.inspectedPercent >= 100 && metrics.totalInspectedPolybag > 0) ||
        ((d.isCompleted || String(d.status || '').toUpperCase() === 'COMPLETED') && (d.totalLayak !== undefined || (d.inspectedPolybag !== undefined && d.inspectedPolybag > 0)));
      const isSubmitted = ['MENUNGGU_VERIFIKASI', 'DIAJUKAN', 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN'].includes(String(d.status || '').toUpperCase()) ||
        d.submissionStatus === 'SUBMITTED_TO_ASB' || d.isSubmitted;
      const isInspected = metrics.totalInspectedPolybag > 0;
      const status = isDone || isSubmitted ? 'DONE' : (isInspected ? 'IN_PROGRESS' : 'PENDING');
      return preControls.filter === 'ALL' || preControls.filter === status;
    });
    return result;
  };
  const sortPreDocs = docs => [...docs].sort((a, b) => {
    if (preControls.sort === 'NEWEST' || preControls.sort === 'OLDEST') {
      const delta = (Date.parse(normalizeDateStr(b.tanggal || b.date || b.createdAt) || '') || 0) - (Date.parse(normalizeDateStr(a.tanggal || a.date || a.createdAt) || '') || 0);
      return preControls.sort === 'NEWEST' ? delta : -delta;
    }
    if (preControls.sort === 'PRIORITY') {
      const getPriority = doc => {
        const stage = normalizeSelectionStage(doc.selectionStage || 'SELEKSI_I');
        const metricStage = stage === 'SELEKSI_2' ? 'SELEKSI_2' : stage === 'SELEKSI_3' ? 'SELEKSI_3' : 'SELEKSI_1';
        const metrics = calculateBatchMetrics({ batchCode: doc.batchCode || doc.batchNo, docs: [doc] }, metricStage);
        return metrics.totalInspectedPolybag <= 0 ? 0 : (metrics.inspectedPercent >= 100 ? 2 : 1);
      };
      return getPriority(a) - getPriority(b) || String(a.batchCode || a.batchNo || '').localeCompare(String(b.batchCode || b.batchNo || ''), 'id');
    }
    return String(a.batchCode || a.batchNo || '').localeCompare(String(b.batchCode || b.batchNo || ''), 'id');
  });
  const displaySeleksi1ProgGroups = groupPreGraftingDocsByProgram(sortPreDocs(filterPreDocs(seleksi1Docs)));
  const displaySeleksi2ProgGroups = groupPreGraftingDocsByProgram(sortPreDocs(filterPreDocs(seleksi2Docs)));
  const displaySeleksi3ProgGroups = groupPreGraftingDocsByProgram(sortPreDocs(filterPreDocs(seleksi3Docs)));

  // Child Transactions per Stage
  const rawAllTxs = storage.get(SELECTION_STORAGE_KEY, []);
  const authorizedAllTxs = getAuthorizedTransactions(rawAllTxs, userCtx);

  const stageChildTxs = authorizedAllTxs.filter(tx => {
    if (tx.isSuperseded) return false;
    if (
      tx.originType === 'CULL_DECLARATION' ||
      tx.isCullDeclaration ||
      tx.transactionType === 'PENYELEKSIAN_BIBIT_AFKIR' ||
      isCullDocNo(tx.docNo) ||
      isCullDocNo(tx.selectionNo) ||
      isCullDocNo(tx.selectionPoolDocNo)
    ) {
      return false;
    }
    const s = String(tx.selectionStage || tx.stage || '').toUpperCase();
    const tType = String(tx.transactionType || '').toUpperCase();
    if (activePreGraftingTab === 'SELEKSI_3') {
      return s === 'SELEKSI_3' || s === 'SELEKSI_III' || tType === 'PELAKSANAAN_SELEKSI_3' || tType === 'PELAKSANAAN_SELEKSI_III';
    }
    if (activePreGraftingTab === 'SELEKSI_2') {
      return s === 'SELEKSI_2' || s === 'SELEKSI_II' || tType === 'PELAKSANAAN_SELEKSI_2' || tType === 'PELAKSANAAN_SELEKSI_II';
    }
    return s === 'SELEKSI_1' || s === 'SELEKSI_I' || tType === 'PELAKSANAAN_SELEKSI_1' || tType === 'PELAKSANAAN_SELEKSI_I';
  });

  const filteredStageChildTxs = stageChildTxs.filter(tx => {
    const d = normalizeDateStr(tx.tanggalSeleksi || tx.tanggal || tx.date || tx.createdAt);
    return d === selectedInspectionDate;
  });

  return `
    ${renderInspectionListControls({ module: 'SELEKSI_PRA_OKULASI', programs: preAvailablePrograms, searchPlaceholder: 'Cari batch, bedengan, atau dokumen...' })}

    <!-- SUB-TAB SELEKSI PRA-OKULASI: SELEKSI I vs SELEKSI II vs SELEKSI III -->
    <div style="display: flex; background: #E8EDF3; border: 1px solid #D5DEE8; border-radius: 10px; padding: 5px; margin: 2px 0 14px; gap: 4px; box-shadow: inset 0 1px 2px rgba(15,23,42,0.04);">
      <button id="subtab-seleksi-1" type="button" style="flex: 1; height: 38px; padding: 0 8px; font-size: 0.80rem; font-weight: ${activePreGraftingTab === 'SELEKSI_1' ? '700' : '600'}; color: ${activePreGraftingTab === 'SELEKSI_1' ? '#116834' : '#64748B'}; background: ${activePreGraftingTab === 'SELEKSI_1' ? '#FFFFFF' : 'transparent'}; border: ${activePreGraftingTab === 'SELEKSI_1' ? '1px solid rgba(0,0,0,0.04)' : '1px solid transparent'}; border-radius: 6px; cursor: pointer; box-shadow: ${activePreGraftingTab === 'SELEKSI_1' ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)' : 'none'}; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease;">
        <span>Seleksi I</span>
        ${pendingSeleksi1Count > 0 ? `<span title="${pendingSeleksi1Count} Batch perlu tindakan" style="background: ${activePreGraftingTab === 'SELEKSI_1' ? '#116834' : '#64748B'}; color: #FFF; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${pendingSeleksi1Count}</span>` : ''}
      </button>
      <button id="subtab-seleksi-2" type="button" style="flex: 1; height: 38px; padding: 0 8px; font-size: 0.80rem; font-weight: ${activePreGraftingTab === 'SELEKSI_2' ? '700' : '600'}; color: ${activePreGraftingTab === 'SELEKSI_2' ? '#116834' : '#64748B'}; background: ${activePreGraftingTab === 'SELEKSI_2' ? '#FFFFFF' : 'transparent'}; border: ${activePreGraftingTab === 'SELEKSI_2' ? '1px solid rgba(0,0,0,0.04)' : '1px solid transparent'}; border-radius: 6px; cursor: pointer; box-shadow: ${activePreGraftingTab === 'SELEKSI_2' ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)' : 'none'}; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease;">
        <span>Seleksi II</span>
        ${pendingSeleksi2Count > 0 ? `<span title="${pendingSeleksi2Count} Batch perlu tindakan" style="background: ${activePreGraftingTab === 'SELEKSI_2' ? '#116834' : '#64748B'}; color: #FFF; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${pendingSeleksi2Count}</span>` : ''}
      </button>
      <button id="subtab-seleksi-3" type="button" style="flex: 1; height: 38px; padding: 0 8px; font-size: 0.80rem; font-weight: ${activePreGraftingTab === 'SELEKSI_3' ? '700' : '600'}; color: ${activePreGraftingTab === 'SELEKSI_3' ? '#116834' : '#64748B'}; background: ${activePreGraftingTab === 'SELEKSI_3' ? '#FFFFFF' : 'transparent'}; border: ${activePreGraftingTab === 'SELEKSI_3' ? '1px solid rgba(0,0,0,0.04)' : '1px solid transparent'}; border-radius: 6px; cursor: pointer; box-shadow: ${activePreGraftingTab === 'SELEKSI_3' ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)' : 'none'}; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease;">
        <span>Seleksi III</span>
        ${pendingSeleksi3Count > 0 ? `<span title="${pendingSeleksi3Count} Batch perlu tindakan" style="background: ${activePreGraftingTab === 'SELEKSI_3' ? '#116834' : '#64748B'}; color: #FFF; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; line-height: 1.2; min-width: 16px; text-align: center;">${pendingSeleksi3Count}</span>` : ''}
      </button>
    </div>

    <!-- BATCH CARDS (KOMPAK / GROUPED) -->
    ${activePreGraftingTab === 'SELEKSI_1' ? `
      ${renderProgramBatchCompactView({
        programGroups: displaySeleksi1ProgGroups,
        stage: 'SELEKSI_1',
        emptyTitle: 'Belum Ada Dokumen Seleksi I',
        emptyDesc: 'Dokumen Seleksi I otomatis dibuat dari transaksi Pindah Semai yang valid.',
        isPasca: false
      })}
    ` : activePreGraftingTab === 'SELEKSI_2' ? `
      ${renderProgramBatchCompactView({
        programGroups: displaySeleksi2ProgGroups,
        stage: 'SELEKSI_2',
        emptyTitle: 'Belum Ada Dokumen Seleksi II',
        emptyDesc: 'Dokumen Seleksi II dapat dibuat setelah Seleksi I berstatus DISETUJUI dan final.',
        isPasca: false
      })}
    ` : `
      ${renderProgramBatchCompactView({
        programGroups: displaySeleksi3ProgGroups,
        stage: 'SELEKSI_3',
        emptyTitle: 'Belum Ada Dokumen Seleksi III',
        emptyDesc: 'Dokumen Seleksi III dapat dibuat setelah Seleksi II berstatus DISETUJUI dan final.',
        isPasca: false
      })}
    `}

    <!-- RINGKASAN TRANSAKSI PELAKSANAAN (GLOBAL CHILD TRANSACTIONS) -->
    ${renderGlobalChildTransactionsSection(
      filteredStageChildTxs,
      preGraftingDocs,
      activePreGraftingTab,
      user,
      selectedInspectionDate
    )}
  `;
}

/**
 * Event Listeners for Seleksi Pra-Okulasi Section in Modul Pemeriksaan
 */
export function attachPreGraftingInspectionEvents(app, user, userCtx, preGraftingDocs = []) {
  // Program dropdown filter change
  const preControls = inspectionListControls.SELEKSI_PRA_OKULASI;
  app.querySelector('[data-inspection-control="program"][data-module="SELEKSI_PRA_OKULASI"]')?.addEventListener('change', e => { preControls.program = e.target.value; attachInspectionListControlEvents(app, 'SELEKSI_PRA_OKULASI'); });
  app.querySelector('[data-inspection-control="search"][data-module="SELEKSI_PRA_OKULASI"]')?.addEventListener('input', e => { preControls.search = e.target.value; attachInspectionListControlEvents(app, 'SELEKSI_PRA_OKULASI'); });
  app.querySelector('[data-inspection-control="filter"][data-module="SELEKSI_PRA_OKULASI"]')?.addEventListener('change', e => { preControls.filter = e.target.value; attachInspectionListControlEvents(app, 'SELEKSI_PRA_OKULASI'); });
  app.querySelector('[data-inspection-control="sort"][data-module="SELEKSI_PRA_OKULASI"]')?.addEventListener('change', e => { preControls.sort = e.target.value; attachInspectionListControlEvents(app, 'SELEKSI_PRA_OKULASI'); });

  // Batch row click for Seleksi I, II, III
  app.querySelectorAll('.row-batch-clickable').forEach(row => {
    row.addEventListener('click', (e) => {
      const stage = row.dataset.stage || activePreGraftingTab;
      const programCode = row.dataset.programCode;
      const batchCode = row.dataset.batchCode;
      handleBatchRowClick({
        stage,
        programCode,
        batchCode,
        user,
        onSaved: () => {
          renderInspectionLanding();
        }
      });
    });
  });

  // Child Transaction Toggle (expand/collapse)
  app.querySelectorAll('.btn-toggle-child-tx').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const card = toggle.closest('.card-child-tx');
      if (!card) return;
      const detail = card.querySelector('.child-tx-detail-content');
      const icon = card.querySelector('.icon-child-toggle');
      if (detail) {
        const isExpanded = detail.style.display !== 'none';
        detail.style.display = isExpanded ? 'none' : 'block';
        if (icon) {
          icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
        }
      }
    });
  });

  // Reset date filter
  app.querySelector('#btn-reset-date-filter')?.addEventListener('click', () => {
    setSelectedInspectionDate(todayDDMMYYYY());
    renderInspectionLanding();
  });

  // Safe Child Transaction Deletion with Data Protection
  app.querySelectorAll('.btn-delete-child-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const txId = btn.dataset.txId;
      const docNo = btn.dataset.docNo;
      const stage = btn.dataset.stage || activePreGraftingTab;
      const stageLabel = btn.dataset.stageLabel || 'Seleksi Pra-Okulasi';

      const allTxs = storage.get(SELECTION_STORAGE_KEY, []);
      const targetTx = allTxs.find(t => (txId && t.id === txId) || (docNo && t.docNo === docNo));
      if (!targetTx) {
        toast('Transaksi tidak ditemukan atau sudah dihapus.', 'error');
        return;
      }

      // 0. Guard against deletion if Transaction itself is already Approved / Final
      const txStatus = String(targetTx.status || '').toUpperCase();
      const txVerif = String(targetTx.verificationStatus || '').toUpperCase();
      if (txStatus === 'DISETUJUI' || txStatus === 'APPROVED' || targetTx.isFinal || txVerif === 'TERVERIFIKASI' || txVerif === 'DISETUJUI') {
        toast('Transaksi telah berstatus disetujui / final dan tidak dapat dihapus.', 'warning');
        return;
      }

      // 1. Guard against deletion if Parent Document is already Approved / Final
      const allDocs = storage.get(PRE_GRAFTING_SELECTION_DOC_STORAGE_KEY, []);
      const parentDoc = allDocs.find(d =>
        d.id === targetTx.parentSelectionDocumentId ||
        d.id === targetTx.selectionDocumentId ||
        d.docNo === targetTx.parentSelectionDocNo ||
        d.docNo === targetTx.selectionDocNo
      );
      if (parentDoc) {
        const pStatus = String(parentDoc.status || '').toUpperCase();
        const pVerif = String(parentDoc.verificationStatus || '').toUpperCase();
        if (pStatus === SELECTION_STATUS.DISETUJUI || pStatus === 'DISETUJUI' || parentDoc.isFinal || pVerif === 'TERVERIFIKASI') {
          toast('Dokumen referensi telah disetujui final oleh Asisten Bibitan. Transaksi pelaksanaan tidak dapat dihapus.', 'warning');
          return;
        }
      }

      // 2. Guard against deletion if candidate afkir is tied to submitted/approved CULL
      const pool = storage.get('selection_pool', []);
      const candidateItem = pool.find(s =>
        (targetTx.id && (s.id === `SEL-POOL-PRE-${targetTx.id}` || s.sourceTransactionId === targetTx.id)) ||
        (targetTx.docNo && s.sourceDocNo === targetTx.docNo)
      );

      if (candidateItem) {
        if (candidateItem.status !== 'PENDING_DECLARATION' || candidateItem.selectionTransactionId || candidateItem.docNo) {
          toast(`Data afkir dari transaksi ini telah diproses dalam deklarasi CULL (${candidateItem.docNo || candidateItem.selectionTransactionId || candidateItem.status}). Transaksi tidak dapat dihapus.`, 'warning');
          return;
        }
      }

      // 3. Guard against deletion if an official CULL record exists for this execution
      const officialCull = allTxs.find(t =>
        (candidateItem && (t.id === candidateItem.selectionTransactionId || t.docNo === candidateItem.docNo)) ||
        (t.sourceTransactionId === targetTx.id && (t.isCullDeclaration || t.originType === 'CULL_DECLARATION' || t.transactionType === 'PENYELEKSIAN_BIBIT_AFKIR'))
      );
      if (officialCull) {
        const cStatus = String(officialCull.status || '').toUpperCase();
        if (cStatus === SELECTION_STATUS.DISETUJUI || cStatus === 'DISETUJUI' || cStatus === SELECTION_STATUS.MENUNGGU_VERIFIKASI || officialCull.stockMutationStatus === 'COMPLETED') {
          toast(`Dokumen CULL resmi (${officialCull.docNo}) telah diajukan/disetujui. Transaksi pelaksanaan tidak dapat dihapus.`, 'warning');
          return;
        }
      }

      // Open Confirmation Modal
      openModal({
        title: `Hapus Transaksi ${stageLabel}`,
        body: `
          <div style="font-size: 0.84rem; color: #334155; line-height: 1.5;">
            <p style="margin: 0 0 10px 0;">
              Apakah Anda yakin ingin menghapus transaksi pelaksanaan <strong>${esc(targetTx.docNo || docNo)}</strong> pada Bedengan <strong>${esc(targetTx.bedenganCode || '-')}</strong>?
            </p>
            <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 0.76rem; color: #991B1B;">
              Kandidat afkir yang belum dideklarasikan akan dibersihkan dari daftar seleksi. Transaksi historis dan mutasi stok resmi tetap terlindungi.
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="btn-cancel-del-child-modal" type="button" style="flex: 1; height: 38px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 6px; font-weight: 600; cursor: pointer;">
                Batal
              </button>
              <button id="btn-confirm-del-child-modal" type="button" style="flex: 1; height: 38px; background: #DC2626; color: #FFF; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">
                Ya, Hapus
              </button>
            </div>
          </div>
        `
      });

      document.getElementById('btn-cancel-del-child-modal')?.addEventListener('click', closeModal);
      document.getElementById('btn-confirm-del-child-modal')?.addEventListener('click', () => {
        try {
          if (stage === 'SELEKSI_3' || stage === 'SELEKSI_III') {
            deleteSeleksi3ExecutionTransaction(targetTx.id || docNo, user);
          } else if (stage === 'SELEKSI_2' || stage === 'SELEKSI_II') {
            deleteSeleksi2ExecutionTransaction(targetTx.id || docNo, user);
          } else {
            deleteSeleksi1ExecutionTransaction(targetTx.id || docNo, user);
          }
          closeModal();
          toast(`Transaksi pelaksanaan ${stageLabel} (${targetTx.docNo || docNo}) berhasil dihapus.`, 'success');
          renderInspectionLanding();
        } catch (err) {
          toast(err.message || 'Gagal menghapus transaksi pelaksanaan', 'error');
        }
      });
    });
  });
}

export function hasActionableInspection(currentUser) {
  return (getActionableInspectionCount(currentUser) + getReturnedInspectionCount(currentUser)) > 0;
}

/**
 * Memeriksa apakah terdapat dokumen Seleksi Pra-Okulasi (Seleksi I/II/III)
 * yang memerlukan/siap dilakukan tindakan pemeriksaan fisik oleh Mantri
 */
export function hasActionablePreGraftingInspection(currentUser = null) {
  const userCtx = currentUser || getCurrentUserContext();
  try {
    const rawPreGraftingDocs = getPreGraftingSelectionDocuments({}, userCtx);
    const activePreGraftingDocs = filterSelectionByScope(rawPreGraftingDocs, userCtx).filter(d => !d.isSplit && !d.isLegacyAggregateSplit);
    if (!activePreGraftingDocs || activePreGraftingDocs.length === 0) return false;

    // 1. Cek apakah ada dokumen batch pra-okulasi yang belum selesai atau masih ada sisa polybag belum diperiksa
    const hasUnfinishedBatch = activePreGraftingDocs.some(d => {
      const isApprovedFinal = (d.status === 'DISETUJUI' || d.status === 'VERIFIED') && Boolean(d.isFinal);
      const hasRemainingPolybag = d.remainingPolybagQty !== undefined ? d.remainingPolybagQty > 0 : true;
      return !isApprovedFinal && hasRemainingPolybag && !d.isCompleted;
    });
    if (hasUnfinishedBatch) return true;

    // 2. Cek apakah ada transaksi pelaksanaan fisik yang dikembalikan (REVISION/DIKEMBALIKAN)
    const rawAllTxs = storage.get(SELECTION_STORAGE_KEY, []);
    const authorizedAllTxs = getAuthorizedTransactions(rawAllTxs, userCtx);
    const hasReturnedPreGrafting = authorizedAllTxs.some(tx => 
      (tx.status === 'DIKEMBALIKAN' || tx.verificationStatus === 'DIKEMBALIKAN' || tx.status === 'REVISION' || tx.returnReason || tx.lastReturnReason) &&
      (tx.selectionStage === 'SELEKSI_I' || tx.selectionStage === 'SELEKSI_II' || tx.selectionStage === 'SELEKSI_III' ||
       tx.selectionStage === 'SELEKSI_1' || tx.selectionStage === 'SELEKSI_2' || tx.selectionStage === 'SELEKSI_3' ||
       (tx.transactionType && String(tx.transactionType).startsWith('PELAKSANAAN_SELEKSI')))
    );
    if (hasReturnedPreGrafting) return true;

    // 3. Fallback: Jika ada dokumen aktif yang belum berstatus final disetujui
    return activePreGraftingDocs.some(d => !d.isFinal || (d.status !== 'DISETUJUI' && d.status !== 'VERIFIED'));
  } catch (err) {
    console.warn('[hasActionablePreGraftingInspection] Gagal:', err);
    return false;
  }
}
