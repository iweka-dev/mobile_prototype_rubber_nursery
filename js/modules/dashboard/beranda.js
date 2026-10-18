/**
 * modules/dashboard/beranda.js — Halaman Beranda Mantri Bibitan.
 * Sesuai desain acuan: 3x3 Grid Menu (Presensi, Penerimaan, Penyemaian, Okulasi,
 * Pemeriksaan, Penyeleksian, Material & Bahan, Rekam Pemeliharaan, Permintaan)
 * dan 2 tombol bottom (Konfirmasi untuk Konsolidasi, Konfirmasi untuk Verifikasi).
 */

import { session } from '../../core/session.js';
import { storage } from '../../core/storage.js';
import { openDrawer } from '../../components/drawer.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { navigate } from '../../core/router.js';
import { formatStandardDocNo, esc } from '../../core/utils.js';
import { ROLE_LABELS, ROLES } from '../../core/permissions.js';
import { getWorkflowStatusPresentation } from '../../core/workflow-status-presentation.js';
import { 
  syncAllSeedingsToSelectionPool, 
  syncAllSeedingsToPreGraftingSelectionDocuments, 
  syncAllApprovedPreGraftingSelectionDocuments,
  filterSelectionByScope, 
  hasActionableSelection, 
  getActionableSelectionCount 
} from '../selection/selection-manager.js';
import {
  syncDederanIndukDocuments,
  getDederanIndukDocuments,
  getDederanTransactions,
  getBedenganInspectionSummary,
  syncAllDederanRejectionsToSelectionPool
} from '../seeding/dederan-manager.js';
import { getEligiblePindahSemaiSources } from '../seeding/dederan-pindah-semai-adapter.js';
import { getMantriTodayTransactions } from '../verification/mantri-confirmation-service.js';
import { renderAsbBottomNav, attachAsbBottomNavEvents } from '../../components/bottom-nav-asb.js';
import { getAuthorizedTransactions } from '../../core/transaction-actor.js';

/* SVG Icons sesuai desain acuan - proporsional & tajam */
const ICONS = {
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
  entres: `
    <svg viewBox="2 2 28 28" width="56" height="56" fill="#116834">
      <path d="M14 26 C14 26 14 13 14 9 C14 5.5 17.5 3 22 2.5 C22.5 7 19.5 10.5 15.8 11 C15.8 13 15.8 17 15.8 26 Z" fill="#116834"/>
      <path d="M14 16.5 C10.5 16.5 6.5 14 6 10 C10 9.5 13.5 12 14 15 Z" fill="#116834"/>
      <circle cx="14" cy="24" r="2.5" fill="#116834"/>
    </svg>
  `
};

const MENU_ITEMS = [
  { id: 'presensi', title: 'Presensi', icon: ICONS.team, route: '/attendance' },
  { id: 'penerimaan', title: 'Penerimaan', icon: ICONS.documentPlus, route: '/reception' },
  { id: 'penyemaian', title: 'Penyemaian', icon: ICONS.sprout, route: '/seeding' },
  { id: 'okulasi', title: 'Okulasi', icon: ICONS.sprout, route: '/budding' },
  { id: 'pemeriksaan', title: 'Pemeriksaan', icon: ICONS.documentPlus, route: '/inspection' },
  { id: 'penyeleksian', title: 'Penyeleksian', icon: ICONS.sprout, route: '/selection' },
  { id: 'kebun-entres', title: 'Kebun<br>Entres', icon: ICONS.entres, route: '/entres' },
  { id: 'material', title: 'Material &<br>Bahan', icon: ICONS.sprout, route: '/material' },
  { id: 'pemeliharaan', title: 'Rekam<br>Pemeliharaan', icon: ICONS.documentPlus, route: '/nursery-activity' },
  { id: 'pengeluaran', title: 'Pengeluaran', icon: ICONS.sprout, route: '/dispatch' },
  { id: 'permintaan-bibit', title: 'Permintaan<br>Bibit', icon: ICONS.documentPlus, route: '/request' }
];

import { getCurrentUserContext, resolveUserContext } from '../../core/user-context.js';
import { requestRepository } from '../../db/repositories.js';
import { 
  filterIncomingRequests as filterIncomingKspRequests, 
  getActionableIncomingCount as getActionableIncomingKspCount 
} from '../request/request-kebun-sepupu-landing.js';
import {
  filterIncomingRequests as filterIncomingSendiriRequests,
  getActionableIncomingCount as getActionableIncomingSendiriCount,
  getActionableSendiriCount
} from '../request/request-kebun-sendiri-landing.js';
import { getActionableMataEntresCount, getActionableMataEntresReceiptCount } from '../request/request-mata-entres-landing.js';
import { filterReceiptKspRequests, getActionableReceiptCount } from '../receipt/receipt-kebun-sepupu-landing.js';
import { getActionableDestructionCount } from '../destruction/destruction-manager.js';
import { getActionableDispatchCount } from '../dispatch/dispatch-landing.js';
import { getPendingVerificationCount } from '../verification/verification-manager.js';
import { getPendingMandoranConsolidationCount, getSavedMandoranConsolidationCount } from '../maintenance/mandoran-consolidation.js';
import { hasActionableInspection, hasReturnedInspection, hasActionablePreGraftingInspection } from '../inspection/inspection-landing.js';
import { ASISTEN_BIBITAN_MAIN_MENUS } from '../../core/menu-registry.js';

export function hasActionablePermintaan(requests, userCtx) {
  if (!requests || !userCtx) return false;
  const kspIncoming = filterIncomingKspRequests(requests, userCtx);
  const kspCount = getActionableIncomingKspCount(kspIncoming, userCtx);

  const sendiriCount = getActionableSendiriCount(requests, userCtx);

  const mataEntresCount = getActionableMataEntresCount(requests, userCtx);

  return (kspCount + sendiriCount + mataEntresCount) > 0;
}

export function hasActionablePenerimaan(receipts, requests, userCtx) {
  if (!userCtx) return false;
  const estateReceipts = filterReceiptKspRequests(receipts || [], userCtx);
  const bibitCount = getActionableReceiptCount(estateReceipts, userCtx);
  const entresCount = getActionableMataEntresReceiptCount(requests || [], userCtx);
  return (bibitCount + entresCount) > 0;
}

const PENGURUS_MENU_ITEMS = [
  { id: 'penerimaan', title: 'Penerimaan', icon: ICONS.documentPlus, route: '/reception/kebun-sepupu' },
  { id: 'permintaan-bibit', title: 'Permintaan', icon: ICONS.documentPlus, route: '/request' },
  { id: 'pengeluaran-bibit', title: 'Pengeluaran', icon: ICONS.sprout, route: '/dispatch' },
  { id: 'pemusnahan-bibit', title: 'Pemusnahan<br>Bibit', icon: ICONS.documentPlus, route: '/destruction' }
];

const ASKEP_MENU_ITEMS = [
  { id: 'penerimaan', title: 'Penerimaan', icon: ICONS.documentPlus, route: '/reception/kebun-sepupu' },
  { id: 'permintaan-bibit', title: 'Permintaan', icon: ICONS.documentPlus, route: '/request' },
  { id: 'pengeluaran-bibit', title: 'Pengeluaran', icon: ICONS.sprout, route: '/dispatch' },
  { id: 'pemusnahan-bibit', title: 'Pemusnahan<br>Bibit', icon: ICONS.documentPlus, route: '/destruction' }
];

const ASISTEN_MENU_ITEMS = [
  { id: 'penerimaan', title: 'Penerimaan', icon: ICONS.documentPlus, route: '/reception/kebun-sepupu' },
  { id: 'permintaan-bibit', title: 'Permintaan', icon: ICONS.documentPlus, route: '/request' }
];

function getPengurusRequestNotifications(requests, receipts, userCtx) {
  const estateId = String(userCtx?.estateId || '').trim().toUpperCase();
  const userIds = [userCtx?.userId, userCtx?.id, userCtx?.code, userCtx?.loginCode]
    .filter(Boolean).map(value => String(value).trim().toUpperCase());
  const requestRoutes = {
    KEBUN_SEPUPU: { label: 'Permintaan Bibit Kebun Sepupu', route: '/request/kebun-sepupu' },
    KEBUN_SENDIRI: { label: 'Permintaan Bibit Kebun Sendiri', route: '/request/kebun-sendiri' },
    MATA_ENTRES: { label: 'Permintaan Mata Entres', route: '/request/mata-entres' }
  };
  const statusLabels = {
    DIAJUKAN: 'Diajukan',
    MENUNGGU_VERIFIKASI_ASISTEN_KEPALA: 'Menunggu Verifikasi Asisten Kepala',
    MENUNGGU_VERIFIKASI_PENGURUS: 'Menunggu Tinjauan Pengurus',
    MENUNGGU_REVIEW_PENGURUS: 'Menunggu Tinjauan Pengurus',
    PERLU_REVISI_PENGURUS: 'Perlu Revisi Pengurus',
    MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN: 'Menunggu Verifikasi Asisten Bibitan',
    MENUNGGU_VERIFIKASI_ASISTEN: 'Menunggu Verifikasi Asisten Bibitan',
    TERVERIFIKASI: 'Terverifikasi',
    MENUNGGU_PENGELUARAN_BIBIT: 'Menunggu Pengeluaran Bibit',
    PENGELUARAN_BERJALAN: 'Pengeluaran Berjalan',
    MENUNGGU_PENERIMAAN_PENGURUS: 'Menunggu Penerimaan',
    MENUNGGU_PENERIMAAN: 'Menunggu Penerimaan',
    SELESAI: 'Selesai',
    DITOLAK: 'Ditolak',
    PERLU_REVISI_ASISTEN_KEPALA: 'Perlu Revisi Asisten Kepala',
    MENUNGGU_PENGELUARAN: 'Menunggu Pengeluaran',
    MENUNGGU_PENERIMAAN_MANTRI_BIBITAN: 'Menunggu Penerimaan Mantri Bibitan',
    DIKEMBALIKAN_KE_PENGURUS: 'Dikembalikan ke Pengurus'
  };
  const isRelatedToPengurus = (record) => {
    if (!record || !estateId) return false;
    const relatedEstates = [
      record.estateId, record.sourceEstateId, record.requesterEstateId, record.requesterEstate,
      record.targetEstateId, record.targetEstate, record.targetNextEstateId,
      record.senderEstateId, record.pengeluaran?.capturedByEstateId
    ].filter(Boolean).map(value => String(value).trim().toUpperCase());
    const actorIds = [record.userId, record.createdByUserId, record.requesterUserId, record.submittedByUserId, record.createdByLoginCode]
      .filter(Boolean).map(value => String(value).trim().toUpperCase());
    return relatedEstates.includes(estateId) || actorIds.some(id => userIds.includes(id));
  };
  const formatNotificationDate = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const requestItems = (Array.isArray(requests) ? requests : []).flatMap(record => {
    const type = String(record.type || record.transactionType || '').toUpperCase();
    const routeInfo = requestRoutes[type] || (String(record.docNo || '').includes('/NIR/') ? requestRoutes.KEBUN_SEPUPU : null);
    if (!routeInfo || !isRelatedToPengurus(record)) return [];
    const status = String(record.status || 'DIAJUKAN').toUpperCase();
    const auditEntries = Array.isArray(record.auditTrail) ? record.auditTrail : Array.isArray(record.auditLog) ? record.auditLog : [];
    const latestAudit = auditEntries[auditEntries.length - 1];
    return [{
      id: `request:${record.id || record.docNo || Math.random()}`,
      category: routeInfo.label,
      docNo: record.docNo || record.nomorDokumen || 'Dokumen permintaan',
      status: getWorkflowStatusPresentation(status, statusLabels[status]).label,
      detail: latestAudit?.details || latestAudit?.note || latestAudit?.description || record.statusNote || record.returnReason || record.revisionReason || '',
      date: formatNotificationDate(record.updatedAt || record.submittedAt || record.createdAt || record.date),
      route: routeInfo.route,
      sortDate: new Date(record.updatedAt || record.submittedAt || record.createdAt || record.date || 0).getTime() || 0
    }];
  });
  const receiptItems = (Array.isArray(receipts) ? receipts : []).flatMap(record => {
    if (!isRelatedToPengurus(record)) return [];
    const status = String(record.status || '').toUpperCase();
    const label = getWorkflowStatusPresentation(status, statusLabels[status]).label;
    return [{
      id: `receipt:${record.id || record.receiptDocNo || record.docNo || Math.random()}`,
      category: 'Penerimaan Bibit',
      docNo: record.receiptDocNo || record.docNo || 'Dokumen penerimaan',
      status: label,
      detail: record.returnReason || record.notes || '',
      date: formatNotificationDate(record.updatedAt || record.submittedAt || record.createdAt || record.date),
      route: '/reception/kebun-sepupu',
      sortDate: new Date(record.updatedAt || record.submittedAt || record.createdAt || record.date || 0).getTime() || 0
    }];
  });
  return [...requestItems, ...receiptItems].sort((a, b) => b.sortDate - a.sortDate).slice(0, 20);
}

export function getPengurusNotificationUnreadStatus(requests, receipts, userCtx) {
  const notifItems = getPengurusRequestNotifications(requests, receipts, userCtx);
  if (!notifItems.length) return false;

  const userKey = userCtx?.userId || userCtx?.id || userCtx?.code || userCtx?.role || 'default';
  const lastSeen = Number(storage.get(`notif_last_seen_${userKey}`, 0)) || 0;

  if (lastSeen === 0) {
    return notifItems.length > 0;
  }

  return notifItems.some(item => (item.sortDate || 0) > lastSeen);
}

export function markPengurusNotificationAsViewed(userCtx) {
  const userKey = userCtx?.userId || userCtx?.id || userCtx?.code || userCtx?.role || 'default';
  storage.set(`notif_last_seen_${userKey}`, Date.now());
}

function showPengurusRequestNotifications(items) {
  const body = items.length ? `
    <div style="display:flex; flex-direction:column; gap:9px; max-height:58vh; overflow-y:auto;">
      ${items.map(item => `
        <button type="button" class="pengurus-request-notification" data-route="${item.route}" style="width:100%; text-align:left; padding:11px 12px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:9px; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <span style="font-size:.72rem; font-weight:750; color:#116834;">${esc(item.category)}</span>
            <span style="font-size:.66rem; font-weight:700; color:#64748B; text-align:right;">${esc(item.date)}</span>
          </div>
          <div style="margin-top:4px; font-size:.82rem; font-weight:800; color:#111827; overflow-wrap:anywhere;">${esc(item.docNo)}</div>
          <div style="margin-top:5px; font-size:.74rem; font-weight:700; color:#334155;">${esc(item.status)}</div>
          ${item.detail ? `<div style="margin-top:4px; font-size:.7rem; line-height:1.4; color:#64748B;">${esc(item.detail)}</div>` : ''}
        </button>
      `).join('')}
    </div>
  ` : '<div style="padding:18px 10px; text-align:center; color:#64748B; font-size:.82rem;">Belum ada proses permintaan atau pengajuan yang tercatat.</div>';

  openModal({
    title: 'Notifikasi Proses',
    body: `<div style="font-size:.76rem; color:#64748B; margin-bottom:10px;">Status terbaru permintaan dan pengajuan yang terkait dengan kebun Anda.</div>${body}`,
    footer: `<button id="btn-close-pengurus-notifications" type="button" style="width:100%; min-height:42px; border:1px solid #116834; border-radius:8px; background:#FFFFFF; color:#116834; font-weight:700; cursor:pointer;">Tutup</button>`
  });

  document.getElementById('modal-root')?.querySelectorAll('.pengurus-request-notification').forEach(button => {
    button.addEventListener('click', () => {
      const route = button.dataset.route;
      closeModal();
      if (route) navigate(route);
    });
  });
  document.getElementById('modal-root')?.querySelector('#btn-close-pengurus-notifications')?.addEventListener('click', closeModal);
}

function renderBerandaAskep() {
  const app = document.getElementById('app');
  if (!app) return;

  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  const allRequests = storage.get('requests_transactions', []);
  const hasActionableRequest = hasActionablePermintaan(allRequests, userCtx);
  const hasActionableDispatch = getActionableDispatchCount(allRequests, userCtx) > 0;

  const allReceipts = storage.get('receipt_ksp_transactions', []);
  const hasActionableReceipt = hasActionablePenerimaan(allReceipts, allRequests, userCtx);
  const allDestructions = storage.get('destruction_transactions', []);
  const hasActionableDestruction = getActionableDestructionCount(allDestructions, userCtx) > 0;
  const hasUnseenNotifications = getPengurusNotificationUnreadStatus(allRequests, allReceipts, userCtx);

  // Background sync from IndexedDB if available
  requestRepository.list().then((dbList) => {
    if (dbList && dbList.length > 0) {
      const dbHasActionable = hasActionablePermintaan(dbList, userCtx);
      if (dbHasActionable !== hasActionableRequest) {
        const badgeEl = app.querySelector('[data-menu-id="permintaan-bibit"] .notif-dot');
        if (dbHasActionable && !badgeEl) {
          renderBerandaAskep();
        } else if (!dbHasActionable && badgeEl) {
          renderBerandaAskep();
        }
      }
    }
  }).catch(() => {});

  const menuCards = ASKEP_MENU_ITEMS.map((item) => {
    let badgeHtml = '';
    if (item.id === 'permintaan-bibit' && hasActionableRequest) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'penerimaan' && hasActionableReceipt) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pengeluaran-bibit' && hasActionableDispatch) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pemusnahan-bibit' && hasActionableDestruction) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    }

    return `
      <button class="beranda-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${item.icon}</div>
        <div class="beranda-card-title">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page beranda-page">
      <header class="beranda-header" style="display:flex; align-items:center;">
        <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <h1 class="beranda-header-title" style="flex:1; margin:0;">Beranda</h1>
        <button id="beranda-notif-btn" type="button" aria-label="Notifikasi proses permintaan" title="Notifikasi proses permintaan" style="position:relative; width:38px; height:38px; flex:0 0 38px; display:flex; align-items:center; justify-content:center; border:0; border-radius:50%; background:transparent; color:#116834; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="23" height="23" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
          ${hasUnseenNotifications ? '<span aria-hidden="true" style="position:absolute; top:5px; right:5px; width:9px; height:9px; border:2px solid #FFFFFF; border-radius:50%; background:#D71920;"></span>' : ''}
        </button>
      </header>

      <main class="beranda-body">
        <div class="beranda-grid">
          ${menuCards}
        </div>
      </main>
    </div>
  `;

  // Drawer Toggle
  app.querySelector('#beranda-drawer-btn')?.addEventListener('click', openDrawer);

  app.querySelector('#beranda-notif-btn')?.addEventListener('click', async () => {
    markPengurusNotificationAsViewed(userCtx);
    const dot = app.querySelector('#beranda-notif-btn span');
    if (dot) dot.remove();

    let latestRequests = Array.isArray(allRequests) ? [...allRequests] : [];
    try {
      const databaseRequests = await requestRepository.list();
      if (Array.isArray(databaseRequests)) {
        const requestMap = new Map();
        [...latestRequests, ...databaseRequests].forEach((request) => {
          const key = String(request.id || request.docNo || `${request.type || request.transactionType || ''}-${request.createdAt || ''}`);
          requestMap.set(key, { ...(requestMap.get(key) || {}), ...request });
        });
        latestRequests = [...requestMap.values()];
      }
    } catch (_) {
      // Gunakan cache lokal jika IndexedDB tidak tersedia.
    }
    const latestReceipts = storage.get('receipt_ksp_transactions', []);
    showPengurusRequestNotifications(getPengurusRequestNotifications(latestRequests, latestReceipts, userCtx));
  });

  // Menu clicks
  app.querySelectorAll('.beranda-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        const title = card.querySelector('.beranda-card-title')?.textContent.trim() || 'Modul';
        toast(`Modul ${title} akan segera dibuka`, 'info');
      }
    });
  });
}

function renderBerandaAsisten() {
  const app = document.getElementById('app');
  if (!app) return;

  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  const allRequests = storage.get('requests_transactions', []);
  const hasActionableRequest = hasActionablePermintaan(allRequests, userCtx);

  const allReceipts = storage.get('receipt_ksp_transactions', []);
  const hasActionableReceipt = hasActionablePenerimaan(allReceipts, allRequests, userCtx);

  // Background sync from IndexedDB if available
  requestRepository.list().then((dbList) => {
    if (dbList && dbList.length > 0) {
      const dbHasActionable = hasActionablePermintaan(dbList, userCtx);
      if (dbHasActionable !== hasActionableRequest) {
        const badgeEl = app.querySelector('[data-menu-id="permintaan-bibit"] .notif-dot');
        if (dbHasActionable && !badgeEl) {
          renderBerandaAsisten();
        } else if (!dbHasActionable && badgeEl) {
          renderBerandaAsisten();
        }
      }
    }
  }).catch(() => {});

  const menuCards = ASISTEN_MENU_ITEMS.map((item) => {
    let badgeHtml = '';
    if (item.id === 'permintaan-bibit' && hasActionableRequest) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'penerimaan' && hasActionableReceipt) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    }

    return `
      <button class="beranda-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${item.icon}</div>
        <div class="beranda-card-title">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page beranda-page">
      <header class="beranda-header">
        <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <h1 class="beranda-header-title">Beranda</h1>
      </header>

      <main class="beranda-body">
        <div class="beranda-grid">
          ${menuCards}
        </div>
      </main>
    </div>
  `;

  // Drawer Toggle
  app.querySelector('#beranda-drawer-btn')?.addEventListener('click', openDrawer);

  // Menu clicks
  app.querySelectorAll('.beranda-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        const title = card.querySelector('.beranda-card-title')?.textContent.trim() || 'Modul';
        toast(`Modul ${title} akan segera dibuka`, 'info');
      }
    });
  });
}

function renderBerandaPengurus() {
  const app = document.getElementById('app');
  if (!app) return;

  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  const allRequests = storage.get('requests_transactions', []);
  const hasActionableRequest = hasActionablePermintaan(allRequests, userCtx);
  const hasActionableDispatch = getActionableDispatchCount(allRequests, userCtx) > 0;

  const allReceipts = storage.get('receipt_ksp_transactions', []);
  const hasActionableReceipt = hasActionablePenerimaan(allReceipts, allRequests, userCtx);
  const allDestructions = storage.get('destruction_transactions', []);
  const hasActionableDestruction = getActionableDestructionCount(allDestructions, userCtx) > 0;
  const hasUnseenNotifications = getPengurusNotificationUnreadStatus(allRequests, allReceipts, userCtx);

  // Background sync from IndexedDB if available
  requestRepository.list().then((dbList) => {
    if (dbList && dbList.length > 0) {
      const dbHasActionable = hasActionablePermintaan(dbList, userCtx);
      if (dbHasActionable !== hasActionableRequest) {
        const badgeEl = app.querySelector('[data-menu-id="permintaan-bibit"] .notif-dot');
        if (dbHasActionable && !badgeEl) {
          renderBerandaPengurus();
        } else if (!dbHasActionable && badgeEl) {
          renderBerandaPengurus();
        }
      }
    }
  }).catch(() => {});

  const menuCards = PENGURUS_MENU_ITEMS.map((item) => {
    let badgeHtml = '';
    if (item.id === 'permintaan-bibit' && hasActionableRequest) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'penerimaan' && hasActionableReceipt) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pengeluaran-bibit' && hasActionableDispatch) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pemusnahan-bibit' && hasActionableDestruction) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    }

    return `
      <button class="beranda-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${item.icon}</div>
        <div class="beranda-card-title">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page beranda-page">
      <header class="beranda-header">
        <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <h1 class="beranda-header-title" style="flex:1; margin:0;">Beranda</h1>
        <button id="beranda-notif-btn" type="button" aria-label="Notifikasi proses" title="Notifikasi proses" style="position:relative; display:flex; align-items:center; justify-content:center; width:40px; height:40px; margin-left:auto; border:0; border-radius:10px; background:transparent; color:#116834; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
            <path d="M10 21h4"></path>
          </svg>
          ${hasUnseenNotifications ? '<span style="position:absolute; top:5px; right:5px; width:9px; height:9px; border-radius:50%; background:#D32F2F; box-shadow:0 0 0 2px #FFFFFF;"></span>' : ''}
        </button>
      </header>

      <main class="beranda-body">
        <div class="beranda-grid">
          ${menuCards}
        </div>
      </main>
    </div>
  `;

  // Drawer Toggle
  app.querySelector('#beranda-drawer-btn')?.addEventListener('click', openDrawer);

  app.querySelector('#beranda-notif-btn')?.addEventListener('click', async () => {
    markPengurusNotificationAsViewed(userCtx);
    const dot = app.querySelector('#beranda-notif-btn span');
    if (dot) dot.remove();

    let latestRequests = Array.isArray(allRequests) ? [...allRequests] : [];
    try {
      const dbRequests = await requestRepository.list();
      if (Array.isArray(dbRequests) && dbRequests.length) {
        const merged = new Map();
        [...latestRequests, ...dbRequests].forEach((record, index) => {
          const key = String(record?.id || record?.docNo || record?.nomorDokumen || `request-${index}`);
          merged.set(key, record);
        });
        latestRequests = [...merged.values()];
      }
    } catch (_) {}

    const latestReceipts = storage.get('receipt_ksp_transactions', []);
    showPengurusRequestNotifications(getPengurusRequestNotifications(latestRequests, latestReceipts, userCtx));
  });

  // Menu clicks
  app.querySelectorAll('.beranda-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        const title = card.querySelector('.beranda-card-title')?.textContent.trim() || 'Modul';
        toast(`Modul ${title} akan segera dibuka`, 'info');
      }
    });
  });
}

function renderRoleDevelopmentHome(user) {
  const app = document.getElementById('app');
  const roleLabel = ROLE_LABELS[user?.role] || user?.position || 'Pengguna';
  const userName = user?.name || roleLabel;

  app.innerHTML = `
    <div class="page beranda-page">
      <header class="beranda-header">
        <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <h1 class="beranda-header-title">Beranda</h1>
      </header>

      <main class="beranda-body" style="display: flex; align-items: center; justify-content: center; padding: 24px;">
        <section style="width: 100%; max-width: 340px; text-align: center;">
          <div style="width: 88px; height: 88px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #E8F3EC; color: #116834; font-size: 42px;">🛠️</div>
          <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; margin-bottom: 16px; border: 1px solid #FDE68A; border-radius: 999px; background: #FEF3C7; color: #92400E; font-size: 0.78rem; font-weight: 700;">DALAM PENGEMBANGAN</div>
          <h2 style="margin: 0 0 10px; color: #111827; font-size: 1.3rem; line-height: 1.35;">Beranda ${roleLabel}</h2>
          <p style="margin: 0 0 8px; color: #374151; font-size: 0.95rem; line-height: 1.55;">Halo, ${userName}.</p>
          <p style="margin: 0; color: #6B7280; font-size: 0.9rem; line-height: 1.55;">Navigasi dan fitur khusus untuk role ini sedang disiapkan untuk kebutuhan review prototype.</p>
        </section>
      </main>
    </div>
  `;

  app.querySelector('#beranda-drawer-btn')?.addEventListener('click', openDrawer);
}

export const ASISTEN_BIBITAN_BERANDA_MENUS = Object.freeze([
  { id: 'penerimaan', title: 'Penerimaan', label: 'Penerimaan', iconName: 'documentPlus', route: '/reception/kebun-sepupu' },
  { id: 'permintaan-bibit', title: 'Permintaan', label: 'Permintaan', iconName: 'documentPlus', route: '/request' },
  { id: 'pengeluaran-bibit', title: 'Pengeluaran', label: 'Pengeluaran', iconName: 'sprout', route: '/dispatch' }
]);

function renderBerandaAsistenBibitan() {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;

  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  const allRequests = storage.get('requests_transactions', []);
  const hasActionableRequest = hasActionablePermintaan(allRequests, userCtx);
  const hasActionableDispatch = getActionableDispatchCount(allRequests, userCtx) > 0;

  const allReceipts = storage.get('receipt_ksp_transactions', []);
  const hasActionableReceipt = hasActionablePenerimaan(allReceipts, allRequests, userCtx);

  // Background sync from IndexedDB if available
  requestRepository.list().then((dbList) => {
    if (dbList && dbList.length > 0) {
      const dbHasActionable = hasActionablePermintaan(dbList, userCtx);
      if (dbHasActionable !== hasActionableRequest) {
        const badgeEl = app.querySelector('[data-menu-id="permintaan-bibit"] .notif-dot');
        if (dbHasActionable && !badgeEl) {
          renderBerandaAsistenBibitan();
        } else if (!dbHasActionable && badgeEl) {
          renderBerandaAsistenBibitan();
        }
      }
    }
  }).catch(() => {});

  const menuCards = ASISTEN_BIBITAN_BERANDA_MENUS.map((item) => {
    let badgeHtml = '';
    if (item.id === 'permintaan-bibit' && hasActionableRequest) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'penerimaan' && hasActionableReceipt) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    } else if (item.id === 'pengeluaran-bibit' && hasActionableDispatch) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    }

    const iconHtml = ICONS[item.iconName] || ICONS.documentPlus;

    return `
      <button class="beranda-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px 8px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.1s ease; text-align: center; gap: 8px; min-height: 115px; position: relative;">
        <div class="beranda-card-icon" style="display: flex; align-items: center; justify-content: center;">${iconHtml}</div>
        <div class="beranda-card-title" style="font-size: 0.8rem; font-weight: 700; color: #111827; line-height: 1.25;">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page beranda-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <header class="beranda-header" style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <h1 class="beranda-header-title" style="font-size: 1.05rem; font-weight: 800; color: #111827; margin: 0; letter-spacing: -0.01em;">Beranda</h1>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="beranda-refresh-btn" type="button" aria-label="Segarkan" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
          <button id="beranda-notif-btn" type="button" aria-label="Notifikasi" style="background: transparent; border: none; padding: 4px; cursor: pointer; display: flex; align-items: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </button>
        </div>
      </header>

      <main class="beranda-body" style="flex: 1; min-height: 0; overflow-y: auto; padding: 18px 14px;">
        <div class="beranda-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
          ${menuCards}
        </div>
      </main>

      <!-- BOTTOM NAVIGATION (4 ITEMS) -->
      ${renderAsbBottomNav('beranda')}
    </div>
  `;

  // Drawer Toggle
  app.querySelector('#beranda-drawer-btn')?.addEventListener('click', openDrawer);

  // Refresh
  app.querySelector('#beranda-refresh-btn')?.addEventListener('click', () => {
    toast('Data beranda diperbarui', 'info');
    renderBerandaAsistenBibitan();
  });

  // Notif
  app.querySelector('#beranda-notif-btn')?.addEventListener('click', () => {
    toast('Tidak ada notifikasi baru', 'info');
  });

  // Menu clicks
  app.querySelectorAll('.beranda-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        const title = card.querySelector('.beranda-card-title')?.textContent.trim() || 'Modul';
        toast(`Modul ${title} akan segera dibuka`, 'info');
      }
    });
  });

  // Attach bottom nav events
  attachAsbBottomNavEvents(app);
}

export function renderBeranda() {
  const app = document.getElementById('app');
  const user = session.get();
  const userCtx = getCurrentUserContext() || resolveUserContext(user);

  if (user?.role === ROLES.PENGURUS || user?.role === ROLES.PENGURUS_KEBUN_SEPUPU) {
    renderBerandaPengurus();
    return;
  }

  if (user?.role === ROLES.ASKEP || user?.role === 'ASISTEN_KEPALA') {
    renderBerandaAskep();
    return;
  }

  if (user?.role === ROLES.ASISTEN_BIBITAN) {
    renderBerandaAsistenBibitan();
    return;
  }

  if (user?.role === ROLES.ASISTEN) {
    renderBerandaAsisten();
    return;
  }

  if (user?.role !== ROLES.MANTRI_TANAMAN) {
    renderRoleDevelopmentHome(user);
    return;
  }
  
  // Hitung pending Penyemaian (Dederan Belum Selesai ATAU Pindah Semai Eligible Belum Selesai ATAU Transaksi Dikembalikan)
  syncDederanIndukDocuments();
  const dederIndukDocs = getAuthorizedTransactions(getDederanIndukDocuments(), userCtx);
  const hasPendingDederan = dederIndukDocs.some(d => (d.sisaBelumDeder || 0) > 0);
  const eligiblePindahSemai = getEligiblePindahSemaiSources(userCtx);
  const hasPendingPindahSemai = eligiblePindahSemai.some(s => (s.remainingQty || 0) > 0);
  const authDederTxs = getAuthorizedTransactions(getDederanTransactions(), userCtx);
  const hasReturnedDeder = authDederTxs.some(tx => 
    (tx.status === 'DIKEMBALIKAN' || tx.verificationStatus === 'DIKEMBALIKAN' || tx.status === 'REVISION' || tx.returnReason || tx.lastReturnReason) &&
    tx.status !== 'MENUNGGU_VERIFIKASI_MANTRI' && tx.status !== 'PENDING_SUBMISSION' && tx.status !== 'APPROVED' && tx.status !== 'DISETUJUI'
  );
  const rawPindahSemai = storage.get('pindah_semai_transactions', []);
  const authPindahSemai = getAuthorizedTransactions(rawPindahSemai, userCtx);
  const hasReturnedPindahSemai = authPindahSemai.some(tx => 
    (tx.status === 'DIKEMBALIKAN' || tx.verificationStatus === 'DIKEMBALIKAN' || tx.status === 'REVISION' || tx.returnReason || tx.lastReturnReason) &&
    tx.status !== 'MENUNGGU_VERIFIKASI_MANTRI' && tx.status !== 'PENDING_SUBMISSION' && tx.status !== 'APPROVED' && tx.status !== 'DISETUJUI'
  );
  const hasPendingBenih = hasPendingDederan || hasPendingPindahSemai || hasReturnedDeder || hasReturnedPindahSemai;

  // Check pending grafting batches from Dokumen Seleksi III FINAL (Konsisten dengan modul Okulasi)
  const allSelectionDocs = storage.get('pre_grafting_selection_documents', []);
  const seleksi3FinalDocs = allSelectionDocs.filter(d => 
    (d.selectionStage === 'SELEKSI_III' || d.selectionStage === 'SELEKSI_3') &&
    (d.selectionType === 'PRA_OKULASI' || !d.selectionType) &&
    d.status === 'DISETUJUI' &&
    Boolean(d.isFinal)
  );
  const buddingTxs = storage.get('budding_transactions', []).filter(b => b.type === 'GRAFTING' || !b.type);
  let hasPendingOkulasi = false;

  for (let i = 0; i < seleksi3FinalDocs.length; i++) {
    const s3Doc = seleksi3FinalDocs[i];
    const populasiBibit = parseInt(
      s3Doc.totalLayak !== undefined
        ? s3Doc.totalLayak
        : (s3Doc.finalBibitQty !== undefined ? s3Doc.finalBibitQty : (s3Doc.currentBibitQty || 0)),
      10
    );
    const batchNo = s3Doc.batchCode || s3Doc.batchNo || `Batch-0${i + 1}`;
    const docNo = s3Doc.docNo;
    let ttlRealized = 0;
    buddingTxs.filter(b => 
      (b.sourceSelection3DocNo && b.sourceSelection3DocNo === docNo) ||
      (b.sourceSelection3DocumentId && s3Doc.id && b.sourceSelection3DocumentId === s3Doc.id) ||
      (b.sourceDocNo && b.sourceDocNo === docNo) ||
      (b.batchNo === batchNo && !b.sourceSelection3DocNo && !b.sourceDocNo)
    ).forEach(b => {
      ttlRealized += parseInt(b.jumlah || 0) + parseInt(b.jumlahDitolak || 0);
    });
    if (populasiBibit - ttlRealized > 0) {
      hasPendingOkulasi = true;
      break;
    }
  }

  // Sinkronisasi bibit ditolak (Rusak, Mati, Lainnya), Dederan Rejections & Dokumen Seleksi Pra-Okulasi dari transaksi penyemaian
  try {
    syncAllSeedingsToSelectionPool();
    syncAllDederanRejectionsToSelectionPool();
    syncAllSeedingsToPreGraftingSelectionDocuments(userCtx);
    syncAllApprovedPreGraftingSelectionDocuments(userCtx);
  } catch (err) {
    console.warn('[beranda] Gagal sinkronisasi data seeding/dederan:', err);
  }

  // Hitung pending pemeriksaan (Dederan Siap Periksa ATAU Seleksi Pra-Okulasi Siap Periksa ATAU Okulasi Siap Periksa ATAU Pemeriksaan Dikembalikan)
  const dederTxs = getDederanTransactions();
  let hasPendingDederanInspection = false;
  for (const dtx of dederTxs) {
    const p = dederIndukDocs.find(d => d.docNo === dtx.parentDederIndukDocNo || d.id === dtx.parentDederIndukId);
    if (p && p.sisaBelumDeder === 0) {
      const summary = getBedenganInspectionSummary(dtx);
      if (!summary.isComplete && summary.sisaBelumDiperiksa > 0) {
        hasPendingDederanInspection = true;
        break;
      }
    }
  }
  const hasPendingPreGraftingInspection = hasActionablePreGraftingInspection(userCtx);
  const hasPendingPemeriksaan = Boolean(
    hasPendingDederanInspection ||
    hasActionableInspection(userCtx) ||
    hasReturnedInspection(userCtx) ||
    hasPendingPreGraftingInspection
  );

  const regraftPool = storage.get('regrafting_pool', []);
  const regraftTxs = storage.get('budding_transactions', []).filter(b => b.type === 'REGRAFTING');
  let hasPendingRegrafting = false;
  for (let i = 0; i < regraftPool.length; i++) {
    const item = regraftPool[i];
    const qty = parseInt(item.jumlah || 0);
    if (qty <= 0) continue;

    // Lewati jika item secara eksplisit sudah selesai (status COMPLETED atau sisa <= 0)
    if (item.status === 'COMPLETED' || (item.sisaRegrafting !== undefined && parseInt(item.sisaRegrafting) <= 0)) {
      continue;
    }

    let done = 0;
    regraftTxs.filter(r => (r.regraftPoolDocNo && r.regraftPoolDocNo === item.docNo) || (r.inspectionDocNo && item.inspectionDocNo && r.inspectionDocNo === item.inspectionDocNo)).forEach(r => {
      done += parseInt(r.jumlah || 0) + parseInt(r.jumlahDitolak || 0);
    });
    if (qty - done > 0) {
      hasPendingRegrafting = true;
      break;
    }
  }

  // Hitung apakah terdapat tindakan penyeleksian (Dokumen Seleksi Pra-Okulasi ATAU Selection Pool)
  const hasPendingPenyeleksian = hasActionableSelection(userCtx);

  // Hitung pending pengeluaran bibit untuk Mantri Bibitan menggunakan helper standar getActionableDispatchCount
  const allRequests = storage.get('requests_transactions', []);
  const hasPendingPengeluaran = getActionableDispatchCount(allRequests, userCtx) > 0;

  // Hitung pending penerimaan (Bibit & Mata Entres) untuk Mantri Bibitan
  const allReceipts = storage.get('receipt_ksp_transactions', []);
  const hasPendingPenerimaan = hasActionablePenerimaan(allReceipts, allRequests, userCtx);

  // Hitung pending konsolidasi untuk Mantri
  const pendingMandoranWorkerCount = getPendingMandoranConsolidationCount(userCtx);
  const savedMandoranConsolidationCount = getSavedMandoranConsolidationCount(userCtx);
  const canOpenKonsolidasi = pendingMandoranWorkerCount > 0 || savedMandoranConsolidationCount > 0;

  // Hitung transaksi Mantri hari ini untuk tombol Konfirmasi untuk Verifikasi
  const mantriTodayTxs = getMantriTodayTransactions(userCtx);
  const actionableMantriTxs = mantriTodayTxs.filter(tx =>
    (tx.status === 'READY_TO_CONFIRM' || tx.status === 'REVISION') &&
    tx.canSubmit !== false &&
    !tx.isSubmissionExpired
  );
  const hasActionableMantriTxs = actionableMantriTxs.length > 0;
  const hasAnyMantriTxs = mantriTodayTxs.length > 0;

  const authBudding = getAuthorizedTransactions(buddingTxs, userCtx);
  const hasReturnedBudding = authBudding.some(tx => 
    (tx.status === 'DIKEMBALIKAN' || tx.verificationStatus === 'DIKEMBALIKAN' || tx.status === 'REVISION' || tx.returnReason || tx.lastReturnReason) &&
    tx.status !== 'MENUNGGU_VERIFIKASI_MANTRI' && tx.status !== 'PENDING_SUBMISSION' && tx.status !== 'APPROVED' && tx.status !== 'DISETUJUI'
  );

  const menuCards = MENU_ITEMS.map((item) => {
    let badgeHtml = '';
    const hasNotification = (
      (item.id === 'penyeleksian' && hasPendingPenyeleksian) ||
      (item.id === 'penyemaian' && hasPendingBenih) ||
      (item.id === 'okulasi' && (hasPendingOkulasi || hasPendingRegrafting || hasReturnedBudding)) ||
      (item.id === 'pemeriksaan' && hasPendingPemeriksaan) ||
      (item.id === 'pengeluaran' && hasPendingPengeluaran) ||
      (item.id === 'penerimaan' && hasPendingPenerimaan)
    );

    if (hasNotification) {
      badgeHtml = `
        <div class="beranda-menu-badge-dot notif-dot" style="position: absolute; top: 12px; right: 12px; width: 11px; height: 11px; background-color: #D32F2F; border-radius: 50%; box-shadow: 0 0 0 2px #FFFFFF; z-index: 5;"></div>
      `;
    }

    return `
      <button class="beranda-menu-card" data-menu-id="${item.id}" data-route="${item.route}" type="button" style="position: relative;">
        <div class="beranda-card-icon">${item.icon}</div>
        <div class="beranda-card-title">${item.title}</div>
        ${badgeHtml}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page beranda-page">
      <header class="beranda-header">
        <button class="beranda-menu-btn" id="beranda-drawer-btn" type="button" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <h1 class="beranda-header-title">Beranda</h1>
      </header>

      <main class="beranda-body">
        <div class="beranda-grid">
          ${menuCards}
        </div>
      </main>

      <footer class="beranda-footer">
        <button class="beranda-action-btn ${canOpenKonsolidasi ? 'beranda-btn-active-green' : ''}" id="btn-konsolidasi" type="button" style="position: relative; ${canOpenKonsolidasi ? 'background: #116834; border-color: #0D5229; cursor: pointer;' : 'opacity: 0.65; cursor: not-allowed;'}">
          <div style="display:flex; align-items:center;">
            <span class="action-text" style="${canOpenKonsolidasi ? 'color:#FFFFFF; font-weight:700;' : ''}">Konfirmasi untuk Konsolidasi</span>
            ${pendingMandoranWorkerCount > 0 ? `<span class="badge-count" style="display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; background:#FFFFFF; color:#116834; font-size:.72rem; font-weight:800; border-radius:999px; margin-left:8px;">${pendingMandoranWorkerCount}</span>` : ''}
          </div>
          <span class="action-arrow" style="${canOpenKonsolidasi ? 'color:#FFFFFF;' : ''}">›</span>
        </button>
        <button class="beranda-action-btn ${hasAnyMantriTxs ? 'beranda-btn-active-green' : ''}" id="btn-verifikasi" type="button" style="position: relative; ${hasAnyMantriTxs ? 'background: #116834; border-color: #0D5229; cursor: pointer;' : 'opacity: 0.65; cursor: not-allowed;'}">
          <div style="display: flex; align-items: center;">
            <span class="action-text" style="${hasAnyMantriTxs ? 'color: #FFFFFF; font-weight: 700;' : ''}">Konfirmasi untuk Verifikasi</span>
            ${hasActionableMantriTxs ? `<span class="badge-count" style="display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; background-color: #FFFFFF; color: #116834; font-size: 0.72rem; font-weight: 800; border-radius: 999px; margin-left: 8px;">${actionableMantriTxs.length}</span>` : ''}
          </div>
          <span class="action-arrow" style="${hasAnyMantriTxs ? 'color: #FFFFFF;' : ''}">›</span>
        </button>
      </footer>
    </div>
  `;

  // Drawer Toggle
  app.querySelector('#beranda-drawer-btn').addEventListener('click', openDrawer);

  // Menu clicks
  app.querySelectorAll('.beranda-menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      if (route) {
        navigate(route);
      } else {
        const title = card.querySelector('.beranda-card-title')?.textContent.trim() || 'Modul';
        toast(`Modul ${title} akan segera dibuka`, 'info');
      }
    });
  });

  // Action buttons
  app.querySelector('#btn-konsolidasi').addEventListener('click', () => {
    if (canOpenKonsolidasi) {
      navigate('/nursery-activity/consolidation');
    } else {
      toast('Belum ada transaksi Mandoran untuk dikonsolidasikan', 'info');
    }
  });

  app.querySelector('#btn-verifikasi').addEventListener('click', () => {
    if (hasAnyMantriTxs) {
      navigate('/mantri-confirmation');
    } else {
      toast('Belum ada transaksi untuk diverifikasi', 'info');
    }
  });
}
