/**
 * js/modules/request/request-kebun-sendiri-landing.js
 * Halaman Pusat Permintaan Bibit Kebun Sendiri (Transaction Type: KEBUN_SENDIRI)
 *
 * Workflow:
 * 1. ASISTEN_BIBITAN / ASISTEN (Lapangan) Buat Permintaan -> Status: MENUNGGU_VERIFIKASI_ASISTEN_KEPALA (DIAJUKAN)
 * 2. ASISTEN_KEPALA Review / Koreksi / Approve -> Status: MENUNGGU_VERIFIKASI_PENGURUS
 * 3. PENGURUS KEBUN ASAL Review / Koreksi / Approve -> Status: MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN
 * 4. ASISTEN_BIBITAN PEMENUH Review Stok / Verify -> Status: TERVERIFIKASI
 * 5. MANTRI_BIBITAN Pengeluaran Bibit (Dispatch) -> Status: MENUNGGU_VERIFIKASI_PENGELUARAN
 * 6. ASISTEN_BIBITAN PEMENUH Verifikasi Aktual Pengeluaran -> Status: MENUNGGU_PENERIMAAN
 * 7. ASISTEN PEMOHON (Requester Asli) Penerimaan Fisik (Layak/Rusak + Camera Only) -> Status: SELESAI
 */

import { navigate } from '../../core/router.js';
import { session } from '../../core/session.js';
import { getCurrentUserContext, normalizeRole, ROLES } from '../../core/user-context.js';
import { storage } from '../../core/storage.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { requestRepository, batchRepository } from '../../db/repositories.js';
import { resolveEstate } from '../../data/estate-master.js';
import { getActiveKlons, resolveKlon } from '../../data/klon-master.js';
import { getCfnaByCode } from '../../data/cfna-master.js';
import { formatDate, formatFullDateIndonesian, nowISO, todayISO, esc } from '../../core/utils.js';
import { deductMultiBatchStock, getNurseryBatches } from '../dispatch/dispatch-landing.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';

export function formatAllocationDisplay(code) {
  if (!code || code === '-') return '-';
  const clean = String(code).trim();
  if (!clean || clean === '-') return '-';
  const cfna = getCfnaByCode(clean);
  if (cfna && cfna.name) {
    return `${clean} - ${cfna.name}`;
  }
  return `${clean} - -`;
}

/**
 * Standardize UI role display names across all screens and timeline entries
 */
export function formatRoleDisplay(rawRoleOrPosition) {
  if (!rawRoleOrPosition) return '';
  const str = String(rawRoleOrPosition).trim();
  const normalized = str.toUpperCase().replace(/[\s-]+/g, '_');

  if (
    normalized === 'ASISTEN_BIBITAN' ||
    normalized === 'ASISTEN_PEMBIBITAN' ||
    normalized === 'ASISTEN_PEMIBIBITAN' ||
    normalized === 'ASB'
  ) {
    return 'Asisten Pembibitan';
  }
  if (normalized === 'ASKEP' || normalized === 'ASISTEN_KEPALA') {
    return 'Asisten Kepala';
  }
  if (
    normalized === 'PENGURUS' ||
    normalized === 'PENGURUS_KEBUN' ||
    normalized === 'PENGURUS_KEBUN_SEPUPU'
  ) {
    return 'Pengurus Kebun';
  }
  if (
    normalized === 'ASISTEN' ||
    normalized === 'ASISTEN_LAPANGAN' ||
    normalized === 'ASISTEN_DIVISI' ||
    normalized === 'ASISTEN_PEMOHON'
  ) {
    return 'Asisten Lapangan';
  }
  if (
    normalized === 'MANTRI' ||
    normalized === 'MANTRI_BIBITAN' ||
    normalized === 'MANTRI_TANAMAN'
  ) {
    return 'Mantri Bibitan';
  }
  if (normalized === 'KTU' || normalized === 'KEPALA_TATA_USAHA') {
    return 'Kepala Tata Usaha';
  }
  if (normalized === 'TEKNIKER_I' || normalized === 'TEKNIKER') {
    return 'Tekniker I';
  }

  return str;
}

let activeTab = null; // 'MY_REQUESTS' | 'INCOMING_REQUESTS'
let lastUserRoleId = null; // Track current user role to set default tab on initial role change
let activeStatusFilter = 'SEMUA'; // 'SEMUA' | 'DIAJUKAN' | 'DIPROSES' | 'SELESAI' | 'DITOLAK'
let expandedCardIndex = -1;

/**
 * Cek apakah user berwenang membuat permohonan Kebun Sendiri
 * HANYA ASISTEN_BIBITAN & ASISTEN (Lapangan/Divisi)
 */
export function canUserCreateKebunSendiri(currentUser) {
  if (!currentUser) return false;
  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  return userRole === ROLES.ASISTEN_BIBITAN || userRole === ROLES.ASISTEN;
}

/**
 * Cek apakah user berwenang melakukan aksi verifikasi/koreksi Asisten Kepala
 */
export function canPerformAskepAction(tx, currentUser) {
  if (!tx || !currentUser) return false;
  if (tx.type !== 'KEBUN_SENDIRI' && tx.transactionType !== 'KEBUN_SENDIRI') return false;

  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  if (userRole !== ROLES.ASKEP && userRole !== 'ASISTEN_KEPALA') return false;

  const userEstateId = currentUser.estateId;
  const requestEstateId = tx.requesterEstateId || tx.estateId;
  if (!userEstateId || requestEstateId !== userEstateId) return false;

  const status = (tx.status || '').toUpperCase();
  return (
    status === 'MENUNGGU_VERIFIKASI_ASISTEN_KEPALA' ||
    status === 'DIAJUKAN' ||
    status === 'PERLU_REVISI_ASISTEN_KEPALA'
  );
}

/**
 * Cek apakah user berwenang melakukan aksi review/approval Pengurus Kebun Asal
 */
export function canPerformPengurusAction(tx, currentUser) {
  if (!tx || !currentUser) return false;
  if (tx.type !== 'KEBUN_SENDIRI' && tx.transactionType !== 'KEBUN_SENDIRI') return false;

  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  if (userRole !== ROLES.PENGURUS) return false;

  const userEstateId = currentUser.estateId;
  const requestEstateId = tx.requesterEstateId || tx.estateId;
  if (!userEstateId || requestEstateId !== userEstateId) return false;

  const status = (tx.status || '').toUpperCase();
  return (
    status === 'MENUNGGU_VERIFIKASI_PENGURUS' ||
    status === 'MENUNGGU_REVIEW_PENGURUS' ||
    status === 'PERLU_REVISI_PENGURUS'
  );
}

/**
 * Cek apakah user berwenang melakukan aksi verifikasi Asisten Bibitan Pemenuh
 */
export function canPerformAsbVerifyAction(tx, currentUser) {
  if (!tx || !currentUser) return false;
  if (tx.type !== 'KEBUN_SENDIRI' && tx.transactionType !== 'KEBUN_SENDIRI') return false;

  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  if (userRole !== ROLES.ASISTEN_BIBITAN) return false;

  const userEstateId = currentUser.estateId;
  const requestEstateId = tx.requesterEstateId || tx.estateId;
  if (!userEstateId || requestEstateId !== userEstateId) return false;

  const status = (tx.status || '').toUpperCase();
  return status === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN';
}

/**
 * Cek apakah user berwenang melakukan aksi verifikasi aktual pengeluaran (ASB Pemenuh)
 */
export function canPerformAsbDispatchVerificationAction(tx, currentUser) {
  if (!tx || !currentUser) return false;
  if (tx.type !== 'KEBUN_SENDIRI' && tx.transactionType !== 'KEBUN_SENDIRI') return false;

  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  if (userRole !== ROLES.ASISTEN_BIBITAN) return false;

  const userEstateId = currentUser.estateId;
  const requestEstateId = tx.requesterEstateId || tx.estateId;
  if (!userEstateId || requestEstateId !== userEstateId) return false;

  const currentUserId = currentUser.userId || currentUser.id || currentUser.code;
  if (tx.fulfillmentAssistantUserId && currentUserId && tx.fulfillmentAssistantUserId !== currentUserId) {
    // Jika sudah ditunjuk ASB spesifik, prioritaskan ASB tersebut
  }

  const status = (tx.status || '').toUpperCase();
  return (
    status === 'MENUNGGU_VERIFIKASI_PENGELUARAN' ||
    status === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN_PENGELUARAN' ||
    status === 'PENGELUARAN_BERJALAN'
  );
}

/**
 * Cek apakah user berwenang melakukan aksi penerimaan akhir
 * STRICT: HANYA Requester Asli (pembuat request) yang boleh melakukan penerimaan!
 */
export function canPerformRequesterReceiptAction(tx, currentUser) {
  if (!tx || !currentUser) return false;
  if (tx.type !== 'KEBUN_SENDIRI' && tx.transactionType !== 'KEBUN_SENDIRI') return false;

  const status = (tx.status || '').toUpperCase();
  if (status !== 'MENUNGGU_PENERIMAAN') return false;

  const currentUserId = String(currentUser.userId || currentUser.id || currentUser.code || '').trim().toUpperCase();
  const requesterId = String(tx.requesterUserId || tx.userId || tx.createdByUserId || tx.createdByLoginCode || '').trim().toUpperCase();

  if (!currentUserId || !requesterId) return false;
  return currentUserId === requesterId;
}

/**
 * Filter requests untuk Tab Permintaan Saya (Requester)
 */
export function filterMyRequests(requests, currentUser) {
  if (!Array.isArray(requests) || !currentUser) return [];
  const currentUserId = String(currentUser.userId || currentUser.id || currentUser.code || '').trim().toUpperCase();

  return requests.filter(tx => {
    const isKebunSendiri = tx.type === 'KEBUN_SENDIRI' || tx.transactionType === 'KEBUN_SENDIRI';
    if (!isKebunSendiri) return false;

    const requesterId = String(tx.requesterUserId || tx.userId || tx.createdByUserId || tx.createdByLoginCode || '').trim().toUpperCase();
    return requesterId === currentUserId;
  });
}

/**
 * Filter requests untuk Tab Menunggu Tindakan / Monitoring (Askep, Pengurus, ASB, Mantri)
 */
export function filterIncomingRequests(requests, currentUser) {
  if (!Array.isArray(requests) || !currentUser) return [];
  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  const userEstateId = currentUser.estateId;

  return requests.filter(tx => {
    const isKebunSendiri = tx.type === 'KEBUN_SENDIRI' || tx.transactionType === 'KEBUN_SENDIRI';
    if (!isKebunSendiri) return false;

    const reqEstate = tx.requesterEstateId || tx.estateId;
    if (userEstateId && reqEstate !== userEstateId) return false;

    if (userRole === ROLES.ASKEP || userRole === 'ASISTEN_KEPALA') {
      return true;
    }
    if (userRole === ROLES.PENGURUS) {
      return true;
    }
    if (userRole === ROLES.ASISTEN_BIBITAN) {
      return true;
    }
    if (userRole === ROLES.MANTRI_TANAMAN) {
      const status = (tx.status || '').toUpperCase();
      return status === 'TERVERIFIKASI' || status === 'MENUNGGU_VERIFIKASI_PENGELUARAN' || status === 'MENUNGGU_PENERIMAAN' || status === 'SELESAI';
    }
    return false;
  });
}

/**
 * Hitung jumlah permintaan masuk yang membutuhkan aksi aktif role saat ini (Askep / Pengurus / ASB)
 */
export function getActionableIncomingCount(incomingRequests, currentUser) {
  if (!Array.isArray(incomingRequests) || !currentUser) return 0;
  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);

  if (userRole === ROLES.ASKEP || userRole === 'ASISTEN_KEPALA') {
    return incomingRequests.filter(tx => canPerformAskepAction(tx, currentUser)).length;
  }

  if (userRole === ROLES.PENGURUS) {
    return incomingRequests.filter(tx => canPerformPengurusAction(tx, currentUser)).length;
  }

  if (userRole === ROLES.ASISTEN_BIBITAN) {
    return incomingRequests.filter(tx =>
      canPerformAsbVerifyAction(tx, currentUser) ||
      canPerformAsbDispatchVerificationAction(tx, currentUser)
    ).length;
  }

  return 0;
}

/**
 * Hitung jumlah permohonan milik sendiri (Requester) yang membutuhkan tindakan aktif (Penerimaan Bibit Fisik)
 */
export function getActionableMyRequestCount(myRequests, currentUser) {
  if (!Array.isArray(myRequests) || !currentUser) return 0;
  return myRequests.filter(tx => canPerformRequesterReceiptAction(tx, currentUser)).length;
}

/**
 * Hitung total item actionable untuk Kebun Sendiri (baik incoming verifikasi maupun requester penerimaan)
 */
export function getActionableSendiriCount(requests, currentUser) {
  if (!Array.isArray(requests) || !currentUser) return 0;
  const incomingReqs = filterIncomingRequests(requests, currentUser);
  const incomingCount = getActionableIncomingCount(incomingReqs, currentUser);

  const myReqs = filterMyRequests(requests, currentUser);
  const myCount = getActionableMyRequestCount(myReqs, currentUser);

  return incomingCount + myCount;
}

/**
 * Helper status label & badge style
 */
export function getStatusBadge(status) {
  const s = String(status || '').trim().toUpperCase();
  switch (s) {
    case 'MENUNGGU_VERIFIKASI_ASISTEN_KEPALA':
    case 'DIAJUKAN':
      return { label: 'Menunggu Askep', color: '#D97706', bg: '#FEF3C7', border: '#FDE68A' };
    case 'MENUNGGU_VERIFIKASI_PENGURUS':
    case 'MENUNGGU_REVIEW_PENGURUS':
      return { label: 'Disetujui Askep', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' };
    case 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN':
      return { label: 'Disetujui Pengurus', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' };
    case 'TERVERIFIKASI':
      return { label: 'Siap Dikeluarkan', color: '#0D9488', bg: '#CCFBF1', border: '#99F6E4' };
    case 'PENGELUARAN_BERJALAN':
      return { label: 'Pengeluaran Berjalan', color: '#D97706', bg: '#FEF3C7', border: '#FDE68A' };
    case 'MENUNGGU_VERIFIKASI_PENGELUARAN':
    case 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN_PENGELUARAN':
      return { label: 'Menunggu Verifikasi Asisten Bibitan', color: '#EA580C', bg: '#FFEDD5', border: '#FED7AA' };
    case 'MENUNGGU_PENERIMAAN':
      return { label: 'Menunggu Penerimaan', color: '#B45309', bg: '#FEF3C7', border: '#FCD34D' };
    case 'SELESAI':
      return { label: 'Selesai Diterima', color: '#16A34A', bg: '#DCFCE7', border: '#BBF7D0' };
    case 'DITOLAK':
      return { label: 'Ditolak', color: '#DC2626', bg: '#FEE2E2', border: '#FECACA' };
    case 'PERLU_REVISI_ASISTEN_KEPALA':
      return { label: 'Perlu Revisi Askep', color: '#D97706', bg: '#FEF3C7', border: '#FDE68A' };
    case 'PERLU_REVISI_PENGURUS':
      return { label: 'Perlu Revisi Pengurus', color: '#D97706', bg: '#FEF3C7', border: '#FDE68A' };
    default:
      return { label: 'Tidak Diketahui', color: '#64748B', bg: '#F1F5F9', border: '#E2E8F0' };
  }
}

/**
 * Render Main Landing Page Permintaan Kebun Sendiri
 */
export async function renderRequestKebunSendiriLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const userCtx = getCurrentUserContext();
  const user = userCtx;
  const userRole = normalizeRole(userCtx.role || userCtx.rawRole);

  // Load requests
  let allRequests = [];
  try {
    allRequests = await requestRepository.list();
  } catch (err) {
    allRequests = storage.get('requests_transactions', []);
  }
  if (!allRequests || allRequests.length === 0) {
    allRequests = storage.get('requests_transactions', []);
  }

  // Filter kebun sendiri requests
  const kebunSendiriReqs = allRequests.filter(
    tx => tx.type === 'KEBUN_SENDIRI' || tx.transactionType === 'KEBUN_SENDIRI'
  );

  const myReqs = filterMyRequests(kebunSendiriReqs, userCtx);
  const incomingReqs = filterIncomingRequests(kebunSendiriReqs, userCtx);

  // Tentukan default tab berdasarkan role hanya saat pertama kali load / ganti role
  const isRequesterRole = userRole === ROLES.ASISTEN || userRole === ROLES.ASISTEN_BIBITAN;
  const currentActorKey = `${userCtx.userId || userCtx.id || ''}_${userRole}`;
  if (lastUserRoleId !== currentActorKey || !activeTab) {
    lastUserRoleId = currentActorKey;
    if (!isRequesterRole) {
      activeTab = 'INCOMING_REQUESTS';
    } else {
      activeTab = 'MY_REQUESTS';
    }
  }

  const currentDisplayList = activeTab === 'MY_REQUESTS' ? myReqs : incomingReqs;

  // Filter status
  const filteredList = currentDisplayList.filter(tx => {
    if (activeStatusFilter === 'SEMUA') return true;
    const s = (tx.status || '').toUpperCase();
    if (activeStatusFilter === 'DIAJUKAN') {
      return s === 'MENUNGGU_VERIFIKASI_ASISTEN_KEPALA' || s === 'DIAJUKAN';
    }
    if (activeStatusFilter === 'DIPROSES') {
      return (
        s === 'MENUNGGU_VERIFIKASI_PENGURUS' ||
        s === 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN' ||
        s === 'TERVERIFIKASI' ||
        s === 'MENUNGGU_VERIFIKASI_PENGELUARAN' ||
        s === 'MENUNGGU_PENERIMAAN' ||
        s === 'PENGELUARAN_BERJALAN'
      );
    }
    if (activeStatusFilter === 'SELESAI') return s === 'SELESAI';
    if (activeStatusFilter === 'DITOLAK') return s === 'DITOLAK';
    return true;
  });

  // Tombol Buat Permintaan: HANYA muncul untuk ASISTEN_BIBITAN dan ASISTEN (Lapangan)
  const showCreateButton = canUserCreateKebunSendiri(userCtx);

  const incomingActionableCount = getActionableIncomingCount(incomingReqs, userCtx);
  const myActionableCount = getActionableMyRequestCount(myReqs, userCtx);

  // Tabs HTML
  const tabsHtml = isRequesterRole ? `
    <div style="background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 16px; flex-shrink: 0;">
      <div style="display: flex; gap: 8px;">
        <button id="tab-my-requests" type="button" style="flex: 1; padding: 12px 6px; min-height: 44px; background: transparent; border: none; border-bottom: 2.5px solid ${activeTab === 'MY_REQUESTS' ? '#116834' : 'transparent'}; color: ${activeTab === 'MY_REQUESTS' ? '#116834' : '#64748B'}; font-weight: ${activeTab === 'MY_REQUESTS' ? '700' : '600'}; font-size: 0.82rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; transition: all 0.15s ease;">
          <span>Permintaan Saya</span>
          <span style="font-size: 0.70rem; padding: 2px 7px; border-radius: 9999px; background: ${activeTab === 'MY_REQUESTS' ? '#E8F5E9' : '#F1F5F9'}; color: ${activeTab === 'MY_REQUESTS' ? '#116834' : '#64748B'}; font-weight: 700; border: 1px solid ${activeTab === 'MY_REQUESTS' ? '#C8E6C9' : '#E2E8F0'}; line-height: 1; flex-shrink: 0;">
            ${myReqs.length}
          </span>
          ${myActionableCount > 0 ? `
            <span class="notif-dot" style="display: inline-block; width: 6px; height: 6px; background-color: #DC2626; border-radius: 50%; flex-shrink: 0;"></span>
          ` : ''}
        </button>
        <button id="tab-incoming-requests" type="button" style="flex: 1; padding: 12px 6px; min-height: 44px; background: transparent; border: none; border-bottom: 2.5px solid ${activeTab === 'INCOMING_REQUESTS' ? '#116834' : 'transparent'}; color: ${activeTab === 'INCOMING_REQUESTS' ? '#116834' : '#64748B'}; font-weight: ${activeTab === 'INCOMING_REQUESTS' ? '700' : '600'}; font-size: 0.82rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; transition: all 0.15s ease;">
          <span>Daftar Permintaan</span>
          <span style="font-size: 0.70rem; padding: 2px 7px; border-radius: 9999px; background: ${activeTab === 'INCOMING_REQUESTS' ? '#E8F5E9' : '#F1F5F9'}; color: ${activeTab === 'INCOMING_REQUESTS' ? '#116834' : '#64748B'}; font-weight: 700; border: 1px solid ${activeTab === 'INCOMING_REQUESTS' ? '#C8E6C9' : '#E2E8F0'}; line-height: 1; flex-shrink: 0;">
            ${incomingReqs.length}
          </span>
          ${incomingActionableCount > 0 ? `
            <span class="notif-dot" style="display: inline-block; width: 6px; height: 6px; background-color: #DC2626; border-radius: 50%; flex-shrink: 0;"></span>
          ` : ''}
        </button>
      </div>
    </div>
  ` : `
    <div style="padding: 12px 16px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; font-size: 0.82rem; font-weight: 700; color: #1E293B; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;">
      <span>Daftar Permintaan Masuk (${incomingReqs.length})</span>
      ${incomingActionableCount > 0 ? `
        <span class="notif-dot" style="display: inline-block; width: 8px; height: 8px; background-color: #DC2626; border-radius: 50%;"></span>
      ` : ''}
    </div>
  `;

  // Status Filter Pills
  const statusFiltersHtml = `
    <div style="background: #F8FAFC; padding: 10px 16px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
      <div style="display: flex; gap: 8px; min-width: max-content;">
        ${['SEMUA', 'DIAJUKAN', 'DIPROSES', 'SELESAI', 'DITOLAK'].map(filter => {
    const isSelected = activeStatusFilter === filter;
    const label = filter === 'SEMUA' ? 'Semua' : filter.charAt(0) + filter.slice(1).toLowerCase();
    return `
            <button class="status-filter-btn" data-filter="${filter}" type="button" style="padding: 6px 14px; min-height: 32px; border-radius: 9999px; font-size: 0.76rem; font-weight: ${isSelected ? '700' : '600'}; border: 1px solid ${isSelected ? '#116834' : '#E2E8F0'}; background: ${isSelected ? '#116834' : '#FFFFFF'}; color: ${isSelected ? '#FFFFFF' : '#475569'}; cursor: pointer; white-space: nowrap; line-height: 1.2; box-shadow: ${isSelected ? '0 1px 2px rgba(17, 104, 52, 0.15)' : 'none'}; transition: all 0.15s ease;">
              ${label}
            </button>
          `;
  }).join('')}
      </div>
    </div>
  `;

  // Request Cards
  const cardsHtml = filteredList.length === 0 ? renderEmptyStateCard({
    title: 'Belum Ada Permintaan',
    description: 'Tidak ada dokumen permintaan bibit kebun sendiri pada kategori ini.'
  }) : filteredList.map((tx, idx) => {
    const isExpanded = expandedCardIndex === idx;
    const badge = getStatusBadge(tx.status);
    const requestedQty = (tx.requestedQty || tx.qty || 0).toLocaleString('id-ID');
    const approvedQty = (tx.approvedQty || tx.qty || 0).toLocaleString('id-ID');

    // Action button detection
    const canAskep = canPerformAskepAction(tx, userCtx);
    const canPengurus = canPerformPengurusAction(tx, userCtx);
    const canAsbVerify = canPerformAsbVerifyAction(tx, userCtx);
    const canAsbDispatchVerif = canPerformAsbDispatchVerificationAction(tx, userCtx);
    const canRequesterReceipt = canPerformRequesterReceiptAction(tx, userCtx);

    let actionBtnHtml = '';
    if (canAskep) {
      actionBtnHtml = `
        <button class="btn-action-askep" data-id="${esc(tx.id)}" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; border: none; font-size: 0.88rem; font-weight: 700; padding: 8px 12px; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(17,104,52,0.2);">
          Review Permintaan (Asisten Kepala)
        </button>
      `;
    } else if (canPengurus) {
      actionBtnHtml = `
        <button class="btn-action-pengurus" data-id="${esc(tx.id)}" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; border: none; font-size: 0.88rem; font-weight: 700; padding: 8px 12px; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(17,104,52,0.2);">
          Review Permintaan (Pengurus Kebun)
        </button>
      `;
    } else if (canAsbVerify) {
      actionBtnHtml = `
        <button class="btn-action-asb-verify" data-id="${esc(tx.id)}" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; font-weight: 700; font-size: 0.88rem; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(17,104,52,0.2);">
          Verifikasi dan Proses
        </button>
      `;
    } else if (canAsbDispatchVerif) {
      actionBtnHtml = `
        <button class="btn-action-asb-dispatch-verif" data-id="${esc(tx.id)}" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; font-weight: 700; font-size: 0.88rem; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(17,104,52,0.2);">
          Verifikasi Aktual Pengeluaran (Asisten Pembibitan)
        </button>
      `;
    } else if (canRequesterReceipt) {
      actionBtnHtml = `
        <button class="btn-action-requester-receipt" data-id="${esc(tx.id)}" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; font-weight: 700; font-size: 0.88rem; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(17,104,52,0.2);">
          Proses Penerimaan Bibit
        </button>
      `;
    }

    // Resolving Estate & Divisi
    const estateObj = resolveEstate(tx.requesterEstateId || tx.estateId);
    const estateName = estateObj ? estateObj.estate_name : (tx.requesterEstateId || tx.estateId || 'Kebun Sendiri');
    const divName = tx.divisionName || (tx.divisionId ? `Divisi ${tx.divisionId}` : '');
    const nurseryDivName = tx.fulfillmentDivisionName || (tx.fulfillmentDivisionId ? `Divisi ${tx.fulfillmentDivisionId}` : 'Pembibitan');

    // Deduplicate and harmonize audit trail items
    const rawAuditItems = Array.isArray(tx.auditTrail) ? [...tx.auditTrail] : (Array.isArray(tx.auditLog) ? [...tx.auditLog] : []);
    
    // Check which actors have a substantive event at each minute
    const substantiveEventKeys = new Set();
    rawAuditItems.forEach(ev => {
      const desc = String(ev?.details || ev?.note || ev?.description || ev?.event || ev?.eventType || '').trim();
      const isGeneric = desc === 'UPDATE' || desc === 'Pembaruan Dokumen' || desc === 'Pembaruan permintaan';
      if (!isGeneric) {
        const actor = String(ev?.userId || ev?.actorId || ev?.name || ev?.actorName || '').trim().toLowerCase();
        const timeKey = String(ev?.timestamp || ev?.createdAt || ev?.date || '').slice(0, 16);
        substantiveEventKeys.add(`${actor}|${timeKey}`);
      }
    });

    const seenAuditEvents = new Set();
    const auditItems = rawAuditItems.filter(event => {
      const details = String(event?.details || event?.note || event?.description || event?.event || event?.eventType || '').trim();
      const actor = String(event?.userId || event?.actorId || event?.name || event?.actorName || '').trim().toLowerCase();
      const timeKey = String(event?.timestamp || event?.createdAt || event?.date || '').slice(0, 16);

      const isGeneric = details === 'UPDATE' || details === 'Pembaruan Dokumen' || details === 'Pembaruan permintaan';
      if (isGeneric && substantiveEventKeys.has(`${actor}|${timeKey}`)) {
        return false;
      }

      const key = `${actor}|${timeKey}|${details.toLowerCase()}`;
      if (seenAuditEvents.has(key)) return false;
      seenAuditEvents.add(key);
      return true;
    });

    return `
      <div class="card-request-item" data-card-index="${idx}" style="background: #FFFFFF; border: 1px solid ${isExpanded ? '#116834' : '#E2E8F0'}; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: border-color 0.15s ease;">
        
        <!-- ROW 1: NO DOKUMEN & BADGE STATUS -->
        <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #F1F5F9; min-width:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; min-width:0;">
            <div style="font-size:.68rem; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:.05em; line-height:1.2;">Dokumen Permintaan</div>
            <span style="font-size: 0.65rem; font-weight: 700; background: ${badge.bg}; color: ${badge.color}; border: 1px solid ${badge.border}; padding: 3px 8px; border-radius: 6px; text-transform: none; flex: 0 1 auto; min-width:0; max-width:58%; text-align:center; white-space:normal; overflow-wrap:anywhere; line-height: 1.25;">
              ${esc(badge.label)}
            </span>
          </div>
          <div style="font-size:.95rem; font-weight:800; color:#116834; line-height:1.35; overflow-wrap:anywhere; word-break:break-word;">${esc(tx.docNo || tx.nir || tx.id)}</div>
        </div>

        <!-- ROW 2: KEBUN ASAL → NURSERY -->
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 0.78rem; background: #F8FAFC; padding: 6px 10px; border-radius: 6px; border: 1px solid #F1F5F9;">
          <span style="font-weight: 700; color: #1E293B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%;">${esc(estateName)}${divName ? ` (${esc(divName)})` : ''}</span>
          <span style="color: #94A3B8; font-weight: 800; flex-shrink: 0;">→</span>
          <span style="font-weight: 700; color: #116834; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%;">Nursery${nurseryDivName ? ` (${esc(nurseryDivName)})` : ''}</span>
        </div>

        <!-- ROW 3: 2x2 Grid Informasi Permintaan -->
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; font-size: 0.78rem; margin-bottom: 8px;">
          <div style="min-width: 0;">
            <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-bottom: 1px;">Pemohon:</div>
            <div style="font-weight: 700; color: #1E293B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(tx.requestedBy || tx.requesterUserId || 'Asisten')}</div>
          </div>
          <div style="min-width: 0;">
            <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-bottom: 1px;">Klon Diminta:</div>
            <div style="font-weight: 700; color: #1E293B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(tx.klon || tx.cloneId || '-')}</div>
          </div>
          <div style="min-width: 0;">
            <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-bottom: 1px;">Banyaknya Diminta:</div>
            <div style="font-weight: 800; color: #116834; white-space: nowrap;">${requestedQty} Pkk</div>
          </div>
          <div style="min-width: 0;">
            <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-bottom: 1px;">Tanggal Dibutuhkan:</div>
            <div style="font-weight: 600; color: #475569; white-space: nowrap;">${esc(formatDate(tx.requiredDate))}</div>
          </div>
        </div>

        <!-- Detail Expandable Area Toggle Button -->
        <button class="btn-toggle-expand btn-expand-card" data-index="${idx}" type="button" style="width: 100%; min-height: 36px; background: transparent; border: none; border-top: 1px dashed #E2E8F0; padding: 6px 0 2px 0; font-size: 0.74rem; color: #116834; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: color 0.15s ease;">
          <span>${isExpanded ? 'Sembunyikan Rincian' : 'Tampilkan Rincian'}</span>
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" style="transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        ${isExpanded ? `
          <!-- EXPANDED DETAIL -->
          <div class="card-expanded-detail" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E2E8F0;">
            <div style="display: grid; grid-template-columns: 40% 60%; gap: 4px; font-size: 0.75rem; padding: 0 2px;">
              <span style="color: #64748B;">Pemohon</span>
              <span style="font-weight: 700; color: #1E293B; text-align: right;">${esc(tx.requestedBy || tx.requesterUserId || 'Asisten')}</span>

              <span style="color: #64748B;">Tujuan Permintaan</span>
              <span style="font-weight: 700; color: #1E293B; text-align: right; overflow-wrap: anywhere;">${esc(tx.purpose || 'Penanaman Kebun Sendiri')}</span>

              <span style="color: #64748B;">Kode Alokasi</span>
              <span style="font-weight: 700; color: #1E293B; text-align: right; overflow-wrap: anywhere;">${esc(formatAllocationDisplay(tx.allocationCode))}</span>

              <span style="color: #64748B;">Tahapan Pertumbuhan</span>
              <span style="font-weight: 700; color: #1E293B; text-align: right; overflow-wrap: anywhere;">${esc(tx.growthStage || 'Siap Tanam')}</span>

              <span style="color: #64748B;">Tanggal Pengajuan</span>
              <span style="font-weight: 700; color: #1E293B; text-align: right;">${esc(formatDate(tx.createdAt || tx.date))}</span>

              ${tx.approvedQty !== undefined && tx.approvedQty !== null ? `
                <span style="color: #116834; font-weight: 700;">Banyaknya Disetujui</span>
                <span style="font-weight: 800; color: #116834; text-align: right;">${parseInt(tx.approvedQty, 10).toLocaleString('id-ID')} Pkk</span>
              ` : ''}

              ${tx.approvedClone ? `
                <span style="color: #116834; font-weight: 700;">Klon Disetujui</span>
                <span style="font-weight: 700; color: #116834; text-align: right;">${esc(tx.approvedClone)}</span>
              ` : ''}

              ${tx.dispatchData ? `
                <span style="color: #64748B;">Pengeluaran Mantri</span>
                <span style="font-weight: 700; color: #116834; text-align: right;">${(tx.dispatchData.issuedQty || 0).toLocaleString('id-ID')} Pkk</span>
              ` : ''}

              ${tx.dispatchVerification ? `
                <span style="color: #64748B;">Verifikasi Asisten Pembibitan</span>
                <span style="font-weight: 700; color: #116834; text-align: right;">${(tx.dispatchVerification.verifiedQty || 0).toLocaleString('id-ID')} Pkk</span>
              ` : ''}

              ${tx.receiptData ? `
                <span style="color: #64748B;">Penerimaan Fisik</span>
                <span style="font-weight: 700; color: #1E293B; text-align: right;">
                  Layak: ${(tx.receiptData.layakQty || 0).toLocaleString('id-ID')} Pkk${tx.receiptData.rusakQty ? ` | Rusak: ${(tx.receiptData.rusakQty).toLocaleString('id-ID')} Pkk` : ''}
                  ${tx.receiptData.photoUrl ? ` (<button type="button" class="btn-view-card-photo" data-photo="${esc(tx.receiptData.photoUrl)}" style="background: none; border: none; color: #116834; font-weight: 700; text-decoration: underline; cursor: pointer; padding: 0; font-size: 0.74rem;">Lihat Foto</button>)` : ''}
                </span>
              ` : ''}
            </div>

            ${tx.distributionItems && tx.distributionItems.length > 0 ? `
              <div style="margin-top: 10px; margin-bottom: 6px;">
                <div style="font-weight: 700; font-size: 0.76rem; color: #0F172A; margin-bottom: 6px;">Alokasi Blok Tanam</div>
                <div style="border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background: #FFFFFF;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 0.74rem;">
                    <thead>
                      <tr style="background: #F8FAFC; color: #475569; border-bottom: 1px solid #E2E8F0;">
                        <th style="padding: 6px 10px; text-align: left; font-weight: 700;">Klon</th>
                        <th style="padding: 6px 10px; text-align: left; font-weight: 700;">Blok</th>
                        <th style="padding: 6px 10px; text-align: right; font-weight: 700;">Banyaknya</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tx.distributionItems.map((d, dIdx) => `
                        <tr style="${dIdx === tx.distributionItems.length - 1 ? '' : 'border-bottom: 1px solid #F1F5F9;'}">
                          <td style="padding: 6px 10px; font-weight: 700; color: #0F172A;">${esc(d.cloneId || d.klon || '-')}</td>
                          <td style="padding: 6px 10px; font-weight: 600; color: #475569;">${esc(d.blockCode || d.blockName || d.blockId || '-')}</td>
                          <td style="padding: 6px 10px; text-align: right; font-weight: 800; color: #116834;">${(d.qty || 0).toLocaleString('id-ID')} Pkk</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

            <!-- TIMELINE & AUDIT TRAIL -->
            <div style="margin-top: 12px; margin-bottom: 6px; padding-top: 10px; border-top: 1px dashed #E2E8F0;">
              <div style="font-weight: 700; font-size: 0.80rem; color: #0F172A; margin-bottom: 8px;">Status Progress Permintaan</div>
              ${auditItems.length === 0 ? `
                <div style="font-size: 0.74rem; color: #94A3B8; font-style: italic; padding: 4px 0;">
                  Belum ada riwayat audit trail tersimpan.
                </div>
              ` : `
                <div style="display: flex; flex-direction: column; gap: 0; padding-left: 2px;">
                  ${auditItems.map((a, aIdx) => {
                    const isLast = aIdx === auditItems.length - 1;
                    const actorName = a.actorName || a.name || a.userName || a.createdByName || a.actorId || a.userId || tx.requestedBy || 'User';
                    const actorRole = formatRoleDisplay(a.position || a.actorRole || a.role || a.rawRole || '');
                    const eventTime = a.timestamp || a.createdAt || a.date || tx.createdAt || tx.date;
                    let eventDesc = a.note || a.details || a.description || a.event || a.eventType || 'Permintaan Bibit Diajukan';
                    eventDesc = String(eventDesc).trim();
                    if (eventDesc === 'CREATE') eventDesc = 'Permintaan Bibit Kebun Sendiri diajukan';
                    if (eventDesc === 'UPDATE') eventDesc = 'Pembaruan Dokumen';
                    if (eventDesc === 'VERIFY') eventDesc = 'Verifikasi Dokumen';
                    if (eventDesc === 'APPROVE') eventDesc = 'Persetujuan Dokumen';
                    if (eventDesc === 'SUBMIT') eventDesc = 'Dokumen Berhasil Diajukan';
                    eventDesc = eventDesc.replace(/Asisten Bibitan/gi, 'Asisten Pembibitan');

                    return `
                      <div style="display: flex; gap: 10px; position: relative;">
                        <!-- Left indicator & line -->
                        <div style="display: flex; flex-direction: column; align-items: center; width: 14px; flex-shrink: 0;">
                          <div style="width: 8px; height: 8px; border-radius: 50%; background: #116834; margin-top: 5px; flex-shrink: 0; border: 2px solid #DCFCE7;"></div>
                          ${!isLast ? `<div style="width: 2px; flex: 1; background: #CBD5E1; margin: 3px 0;"></div>` : ''}
                        </div>
                        <!-- Right content -->
                        <div style="flex: 1; padding-bottom: ${isLast ? '4px' : '12px'}; min-width: 0;">
                          <div style="font-weight: 700; font-size: 0.78rem; color: #0F172A; line-height: 1.3;">
                            <span>${esc(actorName)}</span>
                            ${actorRole ? `<span style="font-size: 0.70rem; font-weight: 600; color: #64748B; margin-left: 4px;">(${esc(actorRole)})</span>` : ''}
                          </div>
                          <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px; line-height: 1.3;">
                            <span style="font-weight: 600; color: #475569;">${esc(formatDate(eventTime))}</span>
                            <span style="margin: 0 4px; color: #94A3B8;">—</span>
                            <span style="color: #334155;">${esc(eventDesc)}</span>
                            ${(a.photoUrl || (a.eventType === 'REQUESTER_RECEIPT' && tx.receiptData?.photoUrl)) ? `
                              <button type="button" class="btn-view-card-photo" data-photo="${esc(a.photoUrl || tx.receiptData?.photoUrl)}" style="background: none; border: none; color: #116834; font-weight: 700; text-decoration: underline; cursor: pointer; padding: 0; font-size: 0.72rem; margin-left: 4px;">[Lihat Foto]</button>
                            ` : ''}
                          </div>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>

            ${actionBtnHtml ? `
              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #E2E8F0;">
                ${actionBtnHtml}
              </div>
            ` : ''}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 6px; border-top: 1px solid #F1F5F9;">
              <button class="btn-collapse-card" data-index="${idx}" type="button" style="background: transparent; border: none; color: #64748B; font-size: 0.72rem; font-weight: 600; cursor: pointer; padding: 4px 8px;">
                Tutup Detail ▲
              </button>
            </div>
          </div>
        ` : ''}

        ${!isExpanded && actionBtnHtml ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #F1F5F9;">
            ${actionBtnHtml}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #FAFAFA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0; position: sticky; top: 0; z-index: 10;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
          <button id="btn-back-request" type="button" aria-label="Kembali" style="min-width: 40px; min-height: 40px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: #116834; border-radius: 8px; flex-shrink: 0; transition: background 0.15s ease;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; letter-spacing: -0.01em;">Permintaan Bibit Kebun Sendiri</h1>
        </div>
        <button id="btn-refresh" type="button" aria-label="Refresh" style="min-width: 40px; min-height: 40px; margin-right: -8px; background: transparent; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: #116834; border-radius: 8px; flex-shrink: 0; transition: background 0.15s ease;">
          <svg id="sync-icon-svg" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.4s ease;">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </header>

      <!-- TABS -->
      ${tabsHtml}

      <!-- STATUS FILTER PILLS -->
      ${statusFiltersHtml}

      <!-- CARDS LIST BODY -->
      <main style="flex: 1; overflow-y: auto; padding: 14px 16px 24px 16px;">
        ${cardsHtml}
      </main>

      <!-- FOOTER ACTION: Tombol Buat Permintaan Bibit Kebun Sendiri (Hanya ASISTEN_BIBITAN & ASISTEN) -->
      ${showCreateButton ? `
        <footer style="position: sticky; bottom: 0; z-index: 20; background: #FFFFFF; border-top: 1px solid #E2E8F0; padding: 12px 16px; padding-bottom: max(12px, env(safe-area-inset-bottom, 12px)); box-shadow: 0 -4px 12px rgba(0,0,0,0.05); flex-shrink: 0;">
          <button id="btn-create-kebun-sendiri" type="button" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; font-weight: 700; font-size: 0.88rem; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(17,104,52,0.2); transition: background 0.15s ease, transform 0.1s ease;">
            Buat Permintaan Bibit Kebun Sendiri
          </button>
        </footer>
      ` : ''}

    </div>
  `;

  // Event Listeners
  app.querySelector('#btn-back-request')?.addEventListener('click', () => {
    const userCtx = getCurrentUserContext();
    const userRole = normalizeRole(userCtx?.role || userCtx?.rawRole);
    // Jika Mantri atau Asisten (yang tidak memiliki sub-menu hub / otomatis diarahkan dari beranda),
    // tombol kembali harus mengarahkan ke Beranda (/home) agar tidak loop redirect dengan /request
    if (userRole === 'MANTRI_TANAMAN' || userRole === 'MANTRI' || userRole === 'ASISTEN') {
      navigate('/home');
      return;
    }
    navigate('/request');
  });

  let refreshRotation = 0;
  app.querySelector('#btn-refresh')?.addEventListener('click', () => {
    refreshRotation += 360;
    const icon = app.querySelector('#sync-icon-svg');
    if (icon) icon.style.transform = `rotate(${refreshRotation}deg)`;
    renderRequestKebunSendiriLanding();
  });

  app.querySelector('#btn-create-kebun-sendiri')?.addEventListener('click', () => {
    navigate('/request/kebun-sendiri/form');
  });

  app.querySelector('#tab-my-requests')?.addEventListener('click', () => {
    activeTab = 'MY_REQUESTS';
    expandedCardIndex = -1;
    renderRequestKebunSendiriLanding();
  });

  app.querySelector('#tab-incoming-requests')?.addEventListener('click', () => {
    activeTab = 'INCOMING_REQUESTS';
    expandedCardIndex = -1;
    renderRequestKebunSendiriLanding();
  });

  app.querySelectorAll('.status-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeStatusFilter = btn.dataset.filter;
      renderRequestKebunSendiriLanding();
    });
  });

  app.querySelectorAll('.btn-toggle-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      expandedCardIndex = expandedCardIndex === idx ? -1 : idx;
      renderRequestKebunSendiriLanding();
    });
  });

  app.querySelectorAll('.btn-collapse-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      expandedCardIndex = -1;
      renderRequestKebunSendiriLanding();
    });
  });

  app.querySelectorAll('.btn-view-card-photo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const photoUrl = btn.dataset.photo;
      if (!photoUrl) return;
      openModal({
        title: 'Foto Bukti Penerimaan Bibit',
        body: `
          <div style="text-align: center; padding: 4px 0;">
            <img src="${esc(photoUrl)}" alt="Bukti Foto" style="max-width: 100%; max-height: 70vh; border-radius: 8px; object-fit: contain; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
          </div>
        `
      });
    });
  });

  // Action Buttons
  app.querySelectorAll('.btn-action-askep').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = kebunSendiriReqs.find(r => r.id === btn.dataset.id);
      if (tx) openAskepReviewModal(tx, userCtx);
    });
  });

  app.querySelectorAll('.btn-action-pengurus').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = kebunSendiriReqs.find(r => r.id === btn.dataset.id);
      if (tx) openPengurusReviewModal(tx, userCtx);
    });
  });

  app.querySelectorAll('.btn-action-asb-verify').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = kebunSendiriReqs.find(r => r.id === btn.dataset.id);
      if (tx) openAsbVerifyModal(tx, userCtx);
    });
  });

  app.querySelectorAll('.btn-action-asb-dispatch-verif').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = kebunSendiriReqs.find(r => r.id === btn.dataset.id);
      if (tx) openAsbDispatchVerificationModal(tx, userCtx);
    });
  });

  app.querySelectorAll('.btn-action-requester-receipt').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = kebunSendiriReqs.find(r => r.id === btn.dataset.id);
      if (tx) openRequesterReceiptModal(tx, userCtx);
    });
  });
}

/**
 * 1. ASISTEN KEPALA REVIEW MODAL
 * Aksi: Koreksi Qty, Koreksi Klon, Setujui, Tolak
 */
function openAskepReviewModal(tx, currentUser) {
  const activeKlons = getActiveKlons();
  const currentKlon = tx.approvedClone || tx.klon || '';
  const currentQty = tx.approvedQty || tx.requestedQty || tx.qty || 0;

  const cloneOptions = activeKlons.map(c => `
    <option value="${esc(c.canonicalName)}" ${c.canonicalName === currentKlon ? 'selected' : ''}>${esc(c.canonicalName)}</option>
  `).join('');

  openModal({
    title: 'Review Permintaan (Asisten Kepala)',
    body: `
      <div style="padding: 4px 0; font-size: 0.82rem;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen:</span>
            <span style="font-weight: 700; color: #116834;">${esc(tx.docNo || tx.nir || tx.id)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">Pemohon:</span>
            <span style="font-weight: 700; color: #1E293B;">${esc(tx.requestedBy || tx.requesterUserId)} (${esc(tx.role || tx.requesterRole)})</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748B;">Permintaan Awal:</span>
            <span style="font-weight: 700; color: #1E293B;">${(tx.requestedQty || tx.qty).toLocaleString('id-ID')} Pkk (${esc(tx.klon)})</span>
          </div>
        </div>

        <form id="form-askep-review">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Koreksi Klon Disetujui</label>
            <select id="input-askep-klon" style="width: 100%; min-height: 40px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;">
              ${cloneOptions}
            </select>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Koreksi Jumlah Disetujui (Pkk)</label>
            <input id="input-askep-qty" type="number" min="1" value="${currentQty}" style="width: 100%; min-height: 40px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem; font-weight: 700;" />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan / Alasan</label>
            <textarea id="input-askep-note" rows="2" placeholder="Masukkan catatan atau alasan koreksi..." style="width: 100%; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;"></textarea>
          </div>
        </form>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 8px; width: 100%;">
        <button id="btn-askep-reject" class="btn btn-ghost" style="border: 1px solid #EF4444; color: #DC2626; font-weight: 700; padding: 8px;">Tolak</button>
        <button id="btn-askep-approve" class="btn btn-primary" style="background: #116834; color: #FFFFFF; font-weight: 700; padding: 8px;">Setujui & Teruskan</button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  root?.querySelector('#btn-askep-reject')?.addEventListener('click', async () => {
    const note = root.querySelector('#input-askep-note')?.value?.trim();
    if (!note) {
      toast('Wajib mengisi alasan penolakan pada kolom catatan.', 'warning');
      return;
    }
    closeModal();
    await updateWorkflowStatus(tx, 'DITOLAK', {
      event: 'ASKEP_REJECT',
      note: `Ditolak oleh Askep: ${note}`,
      actor: currentUser
    });
  });

  root?.querySelector('#btn-askep-approve')?.addEventListener('click', async () => {
    const klon = root.querySelector('#input-askep-klon')?.value?.trim();
    const qty = parseInt(root.querySelector('#input-askep-qty')?.value?.trim(), 10);
    const note = root.querySelector('#input-askep-note')?.value?.trim() || 'Disetujui Asisten Kepala';

    if (isNaN(qty) || qty <= 0) {
      toast('Jumlah harus lebih besar dari 0.', 'warning');
      return;
    }

    closeModal();
    await updateWorkflowStatus(tx, 'MENUNGGU_VERIFIKASI_PENGURUS', {
      event: 'ASKEP_APPROVE',
      note,
      approvedQty: qty,
      approvedClone: klon,
      actor: currentUser
    });
  });
}

/**
 * 2. PENGURUS REVIEW MODAL
 * Aksi: Koreksi Qty, Koreksi Klon, Setujui, Tolak, Kembalikan ke Askep
 */
function openPengurusReviewModal(tx, currentUser) {
  const activeKlons = getActiveKlons();
  const currentKlon = tx.approvedClone || tx.klon || '';
  const currentQty = tx.approvedQty || tx.requestedQty || tx.qty || 0;

  const cloneOptions = activeKlons.map(c => `
    <option value="${esc(c.canonicalName)}" ${c.canonicalName === currentKlon ? 'selected' : ''}>${esc(c.canonicalName)}</option>
  `).join('');

  openModal({
    title: 'Review Permintaan (Pengurus Kebun)',
    body: `
      <div style="padding: 4px 0; font-size: 0.82rem;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen:</span>
            <span style="font-weight: 700; color: #116834;">${esc(tx.docNo || tx.nir || tx.id)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">Pemohon:</span>
            <span style="font-weight: 700; color: #1E293B;">${esc(tx.requestedBy || tx.requesterUserId)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748B;">Hasil Askep:</span>
            <span style="font-weight: 700; color: #116834;">${currentQty.toLocaleString('id-ID')} Pkk (${esc(currentKlon)})</span>
          </div>
        </div>

        <form id="form-pengurus-review">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Klon Disetujui Pengurus</label>
            <select id="input-pengurus-klon" style="width: 100%; min-height: 40px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;">
              ${cloneOptions}
            </select>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Jumlah Disetujui Pengurus (Pkk)</label>
            <input id="input-pengurus-qty" type="number" min="1" value="${currentQty}" style="width: 100%; min-height: 40px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem; font-weight: 700;" />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan Pengurus</label>
            <textarea id="input-pengurus-note" rows="2" placeholder="Masukkan catatan pengurus..." style="width: 100%; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;"></textarea>
          </div>
        </form>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 8px; width: 100%;">
        <button id="btn-pengurus-reject" class="btn btn-ghost" style="border: 1px solid #EF4444; color: #DC2626; font-weight: 700; padding: 8px;">Tolak</button>
        <button id="btn-pengurus-approve" class="btn btn-primary" style="background: #116834; color: #FFFFFF; font-weight: 700; padding: 8px;">Setujui & Teruskan ke Asisten Pembibitan</button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  root?.querySelector('#btn-pengurus-reject')?.addEventListener('click', async () => {
    const note = root.querySelector('#input-pengurus-note')?.value?.trim();
    if (!note) {
      toast('Wajib mengisi alasan penolakan pada kolom catatan.', 'warning');
      return;
    }
    closeModal();
    await updateWorkflowStatus(tx, 'DITOLAK', {
      event: 'PENGURUS_REJECT',
      note: `Ditolak oleh Pengurus: ${note}`,
      actor: currentUser
    });
  });

  root?.querySelector('#btn-pengurus-approve')?.addEventListener('click', async () => {
    const klon = root.querySelector('#input-pengurus-klon')?.value?.trim();
    const qty = parseInt(root.querySelector('#input-pengurus-qty')?.value?.trim(), 10);
    const note = root.querySelector('#input-pengurus-note')?.value?.trim() || 'Disetujui Pengurus Kebun';

    if (isNaN(qty) || qty <= 0) {
      toast('Jumlah harus lebih besar dari 0.', 'warning');
      return;
    }

    closeModal();
    await updateWorkflowStatus(tx, 'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN', {
      event: 'PENGURUS_APPROVE',
      note,
      approvedQty: qty,
      approvedClone: klon,
      actor: currentUser
    });
  });
}

/**
 * 3. ASISTEN BIBITAN REVIEW & VERIFY MODAL
 * Aksi: Verifikasi Stok Nursery / Kembalikan ke Pengurus
 */
function openAsbVerifyModal(tx, currentUser) {
  const currentQty = tx.approvedQty || tx.requestedQty || tx.qty || 0;
  const currentKlon = tx.approvedClone || tx.klon || '';

  // Cek stok nursery yang tersedia
  const availableBatches = getNurseryBatches(tx.requesterEstateId || tx.estateId, currentKlon, tx.growthStage);
  const totalStock = availableBatches.reduce((sum, b) => sum + (parseInt(b.availableQty || 0, 10)), 0);

  openModal({
    title: 'Verifikasi Ketersediaan Nursery (Asisten Pembibitan)',
    body: `
      <div style="padding: 4px 0; font-size: 0.82rem;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen:</span>
            <span style="font-weight: 700; color: #116834;">${esc(tx.docNo || tx.nir || tx.id)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">Permintaan Disetujui:</span>
            <span style="font-weight: 700; color: #1E293B;">${currentQty.toLocaleString('id-ID')} Pkk (${esc(currentKlon)})</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748B;">Stok Nursery Tersedia:</span>
            <span style="font-weight: 700; color: ${totalStock >= currentQty ? '#16A34A' : '#DC2626'};">${totalStock.toLocaleString('id-ID')} Pkk</span>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan Verifikasi Asisten Pembibitan</label>
          <textarea id="input-asb-note" rows="2" placeholder="Kondisi bibit siap dipenuhi atau catatan pengembalian..." style="width: 100%; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;"></textarea>
        </div>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 8px; width: 100%;">
        <button id="btn-asb-return" class="btn btn-ghost" style="border: 1px solid #D97706; color: #B45309; font-weight: 700; padding: 8px;">Kembalikan ke Pengurus</button>
        <button id="btn-asb-verify" class="btn btn-primary" style="background: #116834; color: #FFFFFF; font-weight: 700; padding: 8px;">Verifikasi Kebutuhan</button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  root?.querySelector('#btn-asb-return')?.addEventListener('click', async () => {
    const note = root.querySelector('#input-asb-note')?.value?.trim();
    if (!note) {
      toast('Wajib mengisi alasan pengembalian ke Pengurus pada kolom catatan.', 'warning');
      return;
    }
    closeModal();
    await updateWorkflowStatus(tx, 'PERLU_REVISI_PENGURUS', {
      event: 'ASB_RETURN',
      note: `Dikembalikan oleh Asisten Pembibitan: ${note}`,
      actor: currentUser
    });
  });

  root?.querySelector('#btn-asb-verify')?.addEventListener('click', async () => {
    const note = root.querySelector('#input-asb-note')?.value?.trim() || 'Kebutuhan bibit diverifikasi dan siap dikeluarkan';
    closeModal();
    await updateWorkflowStatus(tx, 'TERVERIFIKASI', {
      event: 'ASB_VERIFY',
      note,
      fulfillmentAssistantUserId: currentUser.userId || currentUser.id || currentUser.code,
      fulfillmentAssistantRole: ROLES.ASISTEN_BIBITAN,
      fulfillmentAssistantName: currentUser.name || 'Asisten Pembibitan',
      actor: currentUser
    });
  });
}

/**
 * 4. ASISTEN BIBITAN DISPATCH VERIFICATION MODAL
 * Aksi: Bandingkan Qty Permintaan vs Pengeluaran Mantri vs Aktual Pengeluaran
 */
function openAsbDispatchVerificationModal(tx, currentUser) {
  const approvedQty = tx.approvedQty || tx.requestedQty || tx.qty || 0;
  const dispatchData = tx.dispatchData || {};
  const issuedQty = dispatchData.issuedQty || approvedQty;

  openModal({
    title: 'Verifikasi Aktual Pengeluaran (Asisten Pembibitan)',
    body: `
      <div style="padding: 4px 0; font-size: 0.82rem;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen Request:</span>
            <span style="font-weight: 700; color: #116834;">${esc(tx.docNo || tx.nir || tx.id)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen Pengeluaran:</span>
            <span style="font-weight: 700; color: #0284C7;">${esc(dispatchData.dispatchDocNo || 'DSP-' + Date.now())}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">Jumlah Disetujui:</span>
            <span style="font-weight: 700; color: #1E293B;">${approvedQty.toLocaleString('id-ID')} Pkk</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748B;">Pengeluaran Mantri:</span>
            <span style="font-weight: 700; color: #EA580C;">${issuedQty.toLocaleString('id-ID')} Pkk</span>
          </div>
        </div>

        <form id="form-asb-dispatch-verif">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Kuantitas Aktual Diverifikasi (Pkk) <span style="color: #EF4444;">*</span></label>
            <input id="input-asb-actual-qty" type="number" min="1" value="${issuedQty}" style="width: 100%; min-height: 40px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem; font-weight: 700;" />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan Hasil Pemeriksaan Aktual</label>
            <textarea id="input-asb-verif-note" rows="2" placeholder="Fisik bibit telah dicek dan sesuai..." style="width: 100%; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;"></textarea>
          </div>
        </form>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr; width: 100%;">
        <button id="btn-confirm-asb-dispatch-verif" class="btn btn-primary" style="background: #116834; color: #FFFFFF; font-weight: 700; padding: 10px; width: 100%;">
          Verifikasi Pengeluaran & Teruskan ke Pemohon
        </button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  root?.querySelector('#btn-confirm-asb-dispatch-verif')?.addEventListener('click', async () => {
    const actualQty = parseInt(root.querySelector('#input-asb-actual-qty')?.value?.trim(), 10);
    const note = root.querySelector('#input-asb-verif-note')?.value?.trim() || 'Pengeluaran aktual diverifikasi Asisten Pembibitan';

    if (isNaN(actualQty) || actualQty <= 0) {
      toast('Kuantitas aktual harus berupa angka lebih besar dari 0.', 'warning');
      return;
    }

    closeModal();
    await updateWorkflowStatus(tx, 'MENUNGGU_PENERIMAAN', {
      event: 'ASB_VERIFY_DISPATCH',
      note,
      dispatchVerification: {
        verifiedQty: actualQty,
        verifiedBy: currentUser.userId || currentUser.id || currentUser.code,
        verifiedByName: currentUser.name || 'Asisten Pembibitan',
        verifiedAt: nowISO(),
        notes: note
      },
      actor: currentUser
    });
  });
}

/**
 * 5. REQUESTER RECEIPT MODAL (REAL CAMERA ONLY + LAYAK/RUSAK)
 * Aksi: Catat Layak & Rusak + Foto Kamera Asli Langsung (`captureSource = 'CAMERA'`)
 */
function openRequesterReceiptModal(tx, currentUser) {
  // STRICT AUTHORIZATION CHECK
  if (!canPerformRequesterReceiptAction(tx, currentUser)) {
    toast('Hanya user Asisten pembuat permohonan yang berwenang melakukan penerimaan bibit.', 'error');
    return;
  }

  const verifiedQty = tx.dispatchVerification?.verifiedQty || tx.approvedQty || tx.qty || 0;
  let capturedPhoto = null;
  let cameraStream = null;
  let isCameraActive = false;

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    const r = document.getElementById('modal-root');
    const cameraOverlay = r?.querySelector('#receipt-camera-overlay');
    const cameraVideo = r?.querySelector('#receipt-camera-video');
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraOverlay) cameraOverlay.style.display = 'none';
    isCameraActive = false;
  };

  const getPhotoPosition = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });

  openModal({
    title: 'Penerimaan Bibit Kebun Sendiri',
    onClose: stopCamera,
    body: `
      <div style="padding: 4px 0; font-size: 0.82rem;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #64748B;">No. Dokumen:</span>
            <span style="font-weight: 700; color: #116834;">${esc(tx.docNo || tx.nir || tx.id)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748B;">Dikeluarkan Nursery:</span>
            <span style="font-weight: 700; color: #116834;">${verifiedQty.toLocaleString('id-ID')} Pkk</span>
          </div>
        </div>

        <form id="form-requester-receipt">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label style="display: block; font-weight: 700; color: #166534; margin-bottom: 4px;">Diterima Layak (Pkk) <span style="color: #EF4444;">*</span></label>
              <input id="input-receipt-layak" type="number" min="0" value="${verifiedQty}" style="width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px; border: 1px solid #86EFAC; border-radius: 6px; font-size: 0.9rem; font-weight: 700; color: #166534;" />
            </div>
            <div>
              <label style="display: block; font-weight: 700; color: #991B1B; margin-bottom: 4px;">Diterima Rusak (Pkk) <span style="color: #EF4444;">*</span></label>
              <input id="input-receipt-rusak" type="number" min="0" value="0" style="width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px; border: 1px solid #FCA5A5; border-radius: 6px; font-size: 0.9rem; font-weight: 700; color: #991B1B;" />
            </div>
          </div>

          <div style="margin-bottom: 12px; background: #F1F5F9; padding: 8px 10px; border-radius: 6px; display: flex; justify-content: space-between;">
            <span style="font-weight: 700; color: #475569;">Total Diterima:</span>
            <span id="label-total-received" style="font-weight: 800; color: #0F172A;">${verifiedQty.toLocaleString('id-ID')} Pkk</span>
          </div>

          <!-- BUKTI FOTO (CAMERA REAL ONLY) -->
          <div style="margin-bottom: 12px; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; background: #FFFFFF;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px; font-size: 0.8rem;">
              Bukti Foto Fisik (Wajib Kamera) <span style="color: #EF4444;">*</span>
            </label>
            <p style="font-size: 0.72rem; color: #64748B; margin: 0 0 8px 0; line-height: 1.35;">
              Ambil foto dokumentasi fisik bibit saat penerimaan menggunakan kamera perangkat langsung.
            </p>

            <div id="photo-preview-container" style="display: none; align-items: center; gap: 10px; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 8px; border-radius: 6px; margin-bottom: 8px;">
              <div style="position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid #CBD5E1; flex-shrink: 0; cursor: pointer;">
                <img id="photo-preview-img" src="" alt="Bukti Foto" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" title="Klik untuk memperbesar" />
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.74rem; font-weight: 700; color: #166534; display: flex; align-items: center; gap: 4px;">
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="#166534"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                  Foto Kamera Tersimpan
                </div>
                <div style="font-size: 0.68rem; color: #475569; margin-top: 2px;">
                  Sumber: <strong>CAMERA</strong>
                </div>
                <div id="photo-preview-meta" style="font-size: 0.66rem; color: #64748B; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></div>
              </div>
              <button type="button" id="btn-retake-photo" style="background: #FFFFFF; border: 1px solid #CBD5E1; color: #DC2626; padding: 5px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Ulangi
              </button>
            </div>

            <div id="camera-trigger-container">
              <button id="btn-trigger-camera" type="button" class="btn btn-outline" style="width: 100%; min-height: 42px; border: 1px dashed #116834; background: #F0FDF4; color: #116834; font-weight: 700; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
                Buka Kamera & Ambil Foto
              </button>
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan Penerimaan</label>
            <textarea id="input-receipt-note" rows="2" placeholder="Catatan kondisi penerimaan di lapangan..." style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.85rem;"></textarea>
          </div>
        </form>

        <!-- LIGHTBOX PHOTO VIEWER -->
        <div id="receipt-photo-viewer-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10025; backdrop-filter: blur(4px);"></div>
        <div id="receipt-photo-viewer-modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 92vw; max-height: 85vh; z-index: 10026; flex-direction: column; align-items: center; justify-content: center;">
          <button id="btn-close-receipt-photo-viewer" type="button" aria-label="Tutup" style="position: absolute; top: -44px; right: 0; background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.5); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; cursor: pointer;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <img id="receipt-photo-viewer-img" src="" alt="Bukti Penerimaan" style="max-width: 90vw; max-height: 80vh; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.8);" />
        </div>

        <!-- FULLSCREEN LIVE CAMERA OVERLAY -->
        <div id="receipt-camera-overlay" style="display: none; position: fixed; inset: 0; background: #000; z-index: 10020; flex-direction: column;">
          <header style="display: flex; justify-content: space-between; align-items: center; padding: 16px; position: absolute; top: 0; left: 0; right: 0; z-index: 10021;">
            <div style="color: #FFFFFF; font-weight: 700; font-size: 0.85rem; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
              Kamera Penerimaan Bibit
            </div>
            <button id="btn-close-receipt-camera" type="button" aria-label="Tutup kamera" style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 40px; height: 40px; display: flex; justify-content: center; align-items: center; cursor: pointer; color: #FFF; font-size: 20px;">
              ✕
            </button>
          </header>
          <main style="flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
            <video id="receipt-camera-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
            <canvas id="receipt-camera-canvas" style="display: none;"></canvas>
            <div id="receipt-camera-error" style="display: none; color: #FFF; text-align: center; padding: 24px;">
              <svg viewBox="0 0 24 24" width="48" height="48" stroke="#EF4444" stroke-width="2" fill="none" style="margin: 0 auto 12px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <p style="font-weight: 700; margin-bottom: 6px; font-size: 0.95rem;">Kamera tidak tersedia atau akses ditolak.</p>
              <p style="font-size: 0.8rem; color: #AAA;">Pastikan Anda telah memberikan izin akses kamera pada browser perangkat Anda.</p>
            </div>
            <div style="position: absolute; width: 78%; height: 55%; border: 2px dashed rgba(255,255,255,0.45); border-radius: 12px; pointer-events: none;"></div>
          </main>
          <footer style="padding: 24px; display: flex; justify-content: center; align-items: center; position: absolute; bottom: 0; left: 0; right: 0; z-index: 10021; background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);">
            <button id="btn-receipt-shutter" type="button" aria-label="Ambil foto" style="width: 72px; height: 72px; border-radius: 50%; background: transparent; border: 4px solid #FFF; display: flex; justify-content: center; align-items: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <div style="width: 56px; height: 56px; background: #FFF; border-radius: 50%;"></div>
            </button>
          </footer>
        </div>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr; width: 100%;">
        <button id="btn-confirm-receipt" class="btn btn-primary" style="background: #116834; color: #FFFFFF; font-weight: 700; padding: 10px; width: 100%;">
          Selesaikan Penerimaan Bibit
        </button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  if (!root) return;

  const inputLayak = root.querySelector('#input-receipt-layak');
  const inputRusak = root.querySelector('#input-receipt-rusak');
  const labelTotal = root.querySelector('#label-total-received');

  const updateTotal = () => {
    const l = parseInt(inputLayak?.value || '0', 10) || 0;
    const r = parseInt(inputRusak?.value || '0', 10) || 0;
    if (labelTotal) labelTotal.textContent = `${(l + r).toLocaleString('id-ID')} Pkk`;
  };

  inputLayak?.addEventListener('input', updateTotal);
  inputRusak?.addEventListener('input', updateTotal);

  // Camera Elements
  const cameraOverlay = root.querySelector('#receipt-camera-overlay');
  const cameraVideo = root.querySelector('#receipt-camera-video');
  const cameraCanvas = root.querySelector('#receipt-camera-canvas');
  const cameraError = root.querySelector('#receipt-camera-error');
  const btnCloseCamera = root.querySelector('#btn-close-receipt-camera');
  const btnShutter = root.querySelector('#btn-receipt-shutter');
  const btnTriggerCamera = root.querySelector('#btn-trigger-camera');
  const triggerContainer = root.querySelector('#camera-trigger-container');
  const previewContainer = root.querySelector('#photo-preview-container');
  const previewImg = root.querySelector('#photo-preview-img');
  const previewMeta = root.querySelector('#photo-preview-meta');
  const btnRetake = root.querySelector('#btn-retake-photo');

  // Photo Viewer Lightbox Elements
  const photoViewerOverlay = root.querySelector('#receipt-photo-viewer-overlay');
  const photoViewerModal = root.querySelector('#receipt-photo-viewer-modal');
  const photoViewerImg = root.querySelector('#receipt-photo-viewer-img');
  const btnClosePhotoViewer = root.querySelector('#btn-close-receipt-photo-viewer');

  function openPhotoViewer(src) {
    if (!photoViewerOverlay || !photoViewerModal || !photoViewerImg) return;
    photoViewerImg.src = src;
    photoViewerOverlay.style.display = 'block';
    photoViewerModal.style.display = 'flex';
  }

  function closePhotoViewer() {
    if (!photoViewerOverlay || !photoViewerModal) return;
    photoViewerOverlay.style.display = 'none';
    photoViewerModal.style.display = 'none';
  }

  previewImg?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (capturedPhoto?.dataUrl) {
      openPhotoViewer(capturedPhoto.dataUrl);
    }
  });

  photoViewerOverlay?.addEventListener('click', closePhotoViewer);
  btnClosePhotoViewer?.addEventListener('click', closePhotoViewer);

  async function openCamera() {
    if (!cameraOverlay) return;
    cameraOverlay.style.display = 'flex';
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Kamera tidak didukung pada browser ini.');
      }
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      } catch (errRear) {
        console.warn('Gagal membuka kamera belakang, mencoba kamera default:', errRear);
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
      if (cameraVideo) {
        cameraVideo.srcObject = cameraStream;
        cameraVideo.style.display = 'block';
        await cameraVideo.play();
      }
      if (cameraError) cameraError.style.display = 'none';
      isCameraActive = true;
    } catch (err) {
      console.error('Error membuka kamera:', err);
      isCameraActive = false;
      if (cameraVideo) cameraVideo.style.display = 'none';
      if (cameraError) cameraError.style.display = 'block';
      toast(err.message || 'Gagal mengakses kamera. Pastikan izin kamera telah diberikan.', 'error');
    }
  }

  btnTriggerCamera?.addEventListener('click', openCamera);
  btnRetake?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCamera();
  });
  btnCloseCamera?.addEventListener('click', stopCamera);

  btnShutter?.addEventListener('click', async () => {
    if (!isCameraActive || !cameraVideo?.videoWidth || !cameraCanvas) {
      toast('Kamera belum siap. Mohon tunggu sebentar...', 'warning');
      return;
    }

    const captureDate = new Date();
    const ts = nowISO();
    const displayTs = captureDate.toLocaleString('id-ID');
    const position = await getPhotoPosition();

    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

    const scale = cameraCanvas.width / 640;
    const fontSize = Math.max(16, Math.round(18 * scale));
    const padding = Math.round(fontSize * 0.65);
    const lineHeight = Math.round(fontSize * 1.45);

    const userCode = currentUser.code || currentUser.loginCode || currentUser.userId || currentUser.id || '-';
    const userName = currentUser.name || 'Asisten Lapangan';
    const docNo = tx.docNo || tx.nir || tx.id || '-';

    const lines = [
      `${userCode} - ${userName} (Penerimaan Bibit)`,
      `No. Dokumen: ${docNo} | ${displayTs}`,
      position ? `GPS: ${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : 'GPS: Lokasi tidak tersedia'
    ];

    const stampHeight = padding * 2 + lineHeight * lines.length;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, cameraCanvas.height - stampHeight, cameraCanvas.width, stampHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((line, idx) => {
      ctx.fillText(line, padding, cameraCanvas.height - stampHeight + padding + idx * lineHeight, cameraCanvas.width - padding * 2);
    });

    const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.88);

    capturedPhoto = {
      dataUrl,
      captureSource: 'CAMERA',
      capturedAt: ts,
      capturedBy: currentUser.userId || currentUser.id || currentUser.code,
      capturedByName: userName,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null
    };

    stopCamera();

    if (previewImg) previewImg.src = dataUrl;
    if (previewContainer) previewContainer.style.display = 'flex';
    if (triggerContainer) triggerContainer.style.display = 'none';
    if (previewMeta) {
      previewMeta.textContent = `${displayTs} • ${position ? `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}` : 'Tanpa GPS'}`;
    }
    toast('Foto fisik berhasil diambil melalui kamera.', 'success');
  });

  root.querySelector('#btn-confirm-receipt')?.addEventListener('click', async () => {
    const layak = parseInt(inputLayak?.value?.trim(), 10) || 0;
    const rusak = parseInt(inputRusak?.value?.trim(), 10) || 0;
    const total = layak + rusak;
    const note = root.querySelector('#input-receipt-note')?.value?.trim() || 'Bibit diterima oleh Asisten Pemohon';

    if (total <= 0) {
      toast('Total penerimaan bibit harus lebih besar dari 0.', 'warning');
      return;
    }

    if (!capturedPhoto || capturedPhoto.captureSource !== 'CAMERA') {
      toast('Wajib mengambil bukti foto fisik menggunakan kamera.', 'warning');
      return;
    }

    stopCamera();
    closePhotoViewer();
    closeModal();
    await updateWorkflowStatus(tx, 'SELESAI', {
      event: 'REQUESTER_RECEIPT',
      note,
      receiptData: {
        layakQty: layak,
        rusakQty: rusak,
        totalQty: total,
        notes: note,
        photoUrl: capturedPhoto.dataUrl,
        captureSource: capturedPhoto.captureSource,
        capturedAt: capturedPhoto.capturedAt,
        capturedBy: capturedPhoto.capturedBy,
        latitude: capturedPhoto.latitude,
        longitude: capturedPhoto.longitude
      },
      actor: currentUser
    });
  });
}

/**
 * Update workflow status dan audit trail secara terpusat
 */
export async function updateWorkflowStatus(tx, nextStatus, options = {}) {
  const currentUserId = options.actor?.userId || options.actor?.id || options.actor?.code || 'SYSTEM';
  const currentUserName = options.actor?.name || currentUserId;
  const currentUserRole = normalizeRole(options.actor?.role || options.actor?.rawRole || 'USER');

  // Clone record
  const updatedTx = {
    ...tx,
    status: nextStatus,
    statusLabel: getStatusBadge(nextStatus).label,
    updatedAt: nowISO()
  };

  if (options.approvedQty !== undefined) updatedTx.approvedQty = options.approvedQty;
  if (options.approvedClone !== undefined) updatedTx.approvedClone = options.approvedClone;
  if (options.fulfillmentAssistantUserId !== undefined) {
    updatedTx.fulfillmentAssistantUserId = options.fulfillmentAssistantUserId;
    updatedTx.fulfillmentAssistantRole = options.fulfillmentAssistantRole;
    updatedTx.fulfillmentAssistantName = options.fulfillmentAssistantName;
  }
  if (options.dispatchData) updatedTx.dispatchData = options.dispatchData;
  if (options.dispatchVerification) updatedTx.dispatchVerification = options.dispatchVerification;
  if (options.receiptData) updatedTx.receiptData = options.receiptData;

  // Append audit trail
  const newAudit = {
    event: options.event || 'UPDATE_STATUS',
    actorId: currentUserId,
    actorName: currentUserName,
    actorRole: currentUserRole,
    timestamp: nowISO(),
    note: options.note || `Status diubah menjadi ${nextStatus}`
  };

  updatedTx.auditTrail = [...(tx.auditTrail || []), newAudit];

  // Simpan ke storage & IndexedDB
  const list = storage.get('requests_transactions', []);
  const idx = list.findIndex(r => r.id === tx.id || r.docNo === tx.docNo);
  if (idx !== -1) {
    list[idx] = updatedTx;
  } else {
    list.unshift(updatedTx);
  }
  storage.set('requests_transactions', list);

  try {
    await requestRepository.update(tx.id, updatedTx, options.actor);
  } catch (err) {
    console.warn('[updateWorkflowStatus] IndexedDB update fallback:', err);
  }

  toast(`Status transaksi berhasil diperbarui: ${getStatusBadge(nextStatus).label}`, 'success');
  try {
    if (typeof document !== 'undefined' && document.getElementById('app')) {
      renderRequestKebunSendiriLanding();
    }
  } catch (_) { }
  return updatedTx;
}
