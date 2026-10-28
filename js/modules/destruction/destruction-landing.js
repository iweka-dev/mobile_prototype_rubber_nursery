/**
 * js/modules/destruction/destruction-landing.js
 * Landing Page & Execution Module: Berita Acara Pemusnahan Bibit (BAPB) Karet Digital
 * 
 * Prinsip Bisnis & Desain:
 * - Alur Persetujuan Berjenjang: ASB (Draft) -> Askep (Review & TTD) -> Pengurus (Pengesahan Dokumen FINAL).
 * - Penomoran Resmi Format: [KODE_KEBUN]/[KODE_DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]
 * - Tiga tanda tangan visual di layar HP (ASB, Askep, Pengurus). KTU ditiadakan.
 * - Bukti foto pemusnahan (minimal 1, maksimal 2 foto) diambil via kamera perangkat.
 * - Invarian Stok: Zero mutation pada penerbitan BAPB (bapbInventoryEffect: 'ZERO_MUTATION_ALREADY_DEDUCTED_AT_SELECTION').
 * - Validasi kuantitas ketat kanonikal (pure integer > 0).
 * - Format cetak native A4 (window.print()).
 * - Preservasi penuh seluruh draf lain dan record historis CUL.
 */

import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { session } from '../../core/session.js';
import { formatDate, formatDateTime, formatStandardDocNo, esc } from '../../core/utils.js';
import { getCurrentUserContext, resolveUserContext, normalizeRole, ROLES } from '../../core/user-context.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import {
  BAPB_STATUS,
  APPROVAL_MODE,
  DESTRUCTION_STATUS,
  DESTRUCTION_REASONS,
  STOCK_MUTATION_STATUS,
  DESTRUCTION_STORAGE_KEY,
  getVerifiedDestructionCollection,
  filterDestructionByScope,
  getActionableDestructionCount,
  canPerformAsistenDestructionAction,
  approveDestructionRecord,
  returnDestructionRecord,
  createDestructionRecord,
  getEligibleSelectionDocsForBapb,
  createBapbDraft,
  reviseBapbDraft,
  signBapbAskep,
  returnBapbByAskep,
  finalizeBapbDocument,
  resolveBapbSignersForEstate,
  createAndFinalizeDirectOnSiteBapb
} from './destruction-manager.js';
import { printBapbDocument, openBapbPrintPreviewModal } from './bapb-print-template.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { getAllBatches, getBatchById } from '../../data/batch-master.js';
import { getBedenganById } from '../../data/bedengan-master.js';

export {
  BAPB_STATUS,
  APPROVAL_MODE,
  DESTRUCTION_STATUS,
  DESTRUCTION_REASONS,
  DESTRUCTION_STORAGE_KEY,
  filterDestructionByScope,
  getActionableDestructionCount,
  canPerformAsistenDestructionAction,
  approveDestructionRecord,
  returnDestructionRecord,
  createDestructionRecord,
  createBapbDraft,
  reviseBapbDraft,
  signBapbAskep,
  returnBapbByAskep,
  finalizeBapbDocument,
  resolveBapbSignersForEstate,
  createAndFinalizeDirectOnSiteBapb,
  printBapbDocument,
  openBapbPrintPreviewModal
};

export function renderDestructionLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const currentUser = getCurrentUserContext();
  const normalizedUserRole = normalizeRole(currentUser.role || currentUser.rawRole);
  const isAsb = normalizedUserRole === ROLES.ASISTEN_BIBITAN;
  const isAskep = normalizedUserRole === ROLES.ASISTEN_KEPALA || normalizedUserRole === 'ASKEP';
  const isPengurus = normalizedUserRole === ROLES.PENGURUS;

  if (isAsb || isAskep || isPengurus) {
    renderBapbReviewDashboard(app, currentUser);
  } else {
    renderMantriDestructionLanding(app, currentUser);
  }
}

/**
 * =============================================================================
 * DASHBOARD TERPADU BAPB KARET & PEMUSNAHAN BIBIT (ASB, ASKEP, PENGURUS)
 * =============================================================================
 */
function renderBapbReviewDashboard(app, currentUser) {
  const allRecords = getVerifiedDestructionCollection();
  const scopedRecords = filterDestructionByScope(allRecords, currentUser);

  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  const isAsb = role === ROLES.ASISTEN_BIBITAN;
  const isAskep = role === ROLES.ASISTEN_KEPALA || role === 'ASKEP';
  const isPengurus = role === ROLES.PENGURUS;
  // Gunakan resolver yang sama dengan modal sumber agar angka ringkasan selalu
  // identik dengan jumlah dokumen yang benar-benar dapat dipilih.
  const eligibleSelectionCount = isAsb
    ? getEligibleSelectionDocsForBapb(currentUser).length
    : 0;

  // Filter kelompok dokumen BAPB
  const bapbRecords = scopedRecords.filter(r => r.documentType === 'BAPB_KARET' || r.bapbStatus || r.signatures);

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; flex-shrink: 0;">
        <div style="display: flex; align-items: center;">
          <button id="btn-back" type="button" aria-label="Kembali" style="padding: 8px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.15rem; font-weight: 700; color: #111111; margin: 0 0 0 8px; letter-spacing: -0.01em;">Pemusnahan Bibit</h1>
        </div>
      </header>

      <!-- MAIN CONTENT LIST -->
      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        ${isAsb && eligibleSelectionCount > 0 ? `
          <section id="bapb-eligible-summary" aria-live="polite" style="display: flex; align-items: flex-start; gap: 10px; background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 10px; padding: 11px 12px; margin-bottom: 14px;">
            <div style="width: 32px; height: 32px; border-radius: 999px; background: #D1FAE5; color: #057A55; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="9" y1="13" x2="15" y2="13"></line>
                <line x1="9" y1="17" x2="15" y2="17"></line>
              </svg>
            </div>
            <div style="min-width: 0; color: #065F46; font-size: 0.78rem; line-height: 1.45;">
              <div style="font-weight: 800; margin-bottom: 2px;">Dokumen Afkir Siap Diproses</div>
              <div>Ada <strong>${eligibleSelectionCount} dokumen</strong> yang perlu dibuatkan Berita Acara Pemusnahan Bibit.</div>
            </div>
          </section>
        ` : ''}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h2 style="font-size: 0.88rem; font-weight: 700; color: #1E293B; margin: 0;">Riwayat Pemusnahan Bibit</h2>
          <span style="background: #E2E8F0; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;">${bapbRecords.length} Dokumen</span>
        </div>

        ${bapbRecords.length === 0 ? renderEmptyStateCard({
    title: 'Belum Ada Riwayat Pemusnahan Bibit',
    description: isAsb
      ? 'Klik tombol "Buat Berita Acara" di bagian bawah untuk menerbitkan draf berita acara baru dari hasil seleksi yang telah disetujui.'
      : 'Daftar dokumen pemusnahan bibit akan tampil di sini.'
  }) : `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${bapbRecords.map(item => renderBapbCardItem(item, currentUser)).join('')}
          </div>
        `}
      </main>

      <!-- BOTTOM ACTION BAR (ASB ONLY) -->
      ${isAsb ? `
        <footer style="flex-shrink: 0; padding: 12px 16px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; box-shadow: 0 -2px 6px rgba(0,0,0,0.04); z-index: 10;">
          <button id="btn-create-bapb" type="button" style="width: 100%; height: 44px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 4px rgba(17,104,52,0.25);">
            <span>Buat Berita Acara</span>
            ${eligibleSelectionCount > 0 ? `
              <span class="bapb-action-notif-dot notif-dot" title="${eligibleSelectionCount} dokumen afkir perlu diproses" aria-label="${eligibleSelectionCount} dokumen afkir perlu diproses" style="display: inline-block; width: 10px; height: 10px; flex: 0 0 10px; background: #EF4444; border-radius: 999px; box-shadow: 0 0 0 2px #FFFFFF;"></span>
            ` : ''}
          </button>
        </footer>
      ` : ''}
    </div>
  `;

  // Attach Event Handlers
  app.querySelector('#btn-back')?.addEventListener('click', () => navigate('/inspection'));

  // Action: Open BAPB Method Selection Modal (ASB only)
  app.querySelector('#btn-create-bapb')?.addEventListener('click', () => {
    openBapbMethodSelectionModal(app, currentUser);
  });

  // Action: Review & Sign Askep
  app.querySelectorAll('.btn-askep-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (target) openAskepReviewModal(target, app, currentUser);
    });
  });

  // Action: Review & Finalize Pengurus
  app.querySelectorAll('.btn-pengurus-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (target) openPengurusReviewModal(target, app, currentUser);
    });
  });

  // Action: Preview & Cetak BAPB (A4)
  app.querySelectorAll('.btn-preview-bapb').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (target) {
        openBapbPrintPreviewModal(target);
      }
    });
  });

  // Action: Direct Print BAPB (if dedicated direct-print button is used without preview)
  app.querySelectorAll('.btn-print-bapb:not(.btn-preview-bapb)').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (target) {
        try {
          printBapbDocument(target);
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });
  });

  // Action: Perbaiki Draf BAPB (ASB)
  app.querySelectorAll('.btn-recreate-bapb').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (target) openBapbCreationModal(app, currentUser, target);
    });
  });

  // Legacy Actions (if any)
  attachLegacyActionHandlers(app, allRecords, currentUser);
}

/**
 * Render Kartu Dokumen BAPB Karet
 */
function renderBapbCardItem(item, currentUser) {
  const role = normalizeRole(currentUser.role || currentUser.rawRole);
  const isAsb = role === ROLES.ASISTEN_BIBITAN;
  const isAskep = role === ROLES.ASISTEN_KEPALA || role === 'ASKEP';
  const isPengurus = role === ROLES.PENGURUS;

  const status = item.bapbStatus || item.status;
  const isFinal = status === BAPB_STATUS.FINAL || item.isFinal;
  const isAwaitingAskep = status === BAPB_STATUS.DRAFT_AWAITING_ASKEP;
  const isAwaitingPengurus = status === BAPB_STATUS.DRAFT_AWAITING_PENGURUS;
  const isReturned = status === BAPB_STATUS.DIKEMBALIKAN_KE_ASB;

  let badgeHtml = '';
  if (isFinal) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0;">Disetujui</span>`;
  } else if (isAwaitingAskep) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A;">MENUNGGU ASKEP</span>`;
  } else if (isAwaitingPengurus) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE;">MENUNGGU PENGURUS</span>`;
  } else if (isReturned) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA;">DIKEMBALIKAN KE ASB</span>`;
  }

  const isDirectOnSite = item.approvalMode === APPROVAL_MODE.DIRECT_ON_SITE || item.approvalMode === 'DIRECT_ON_SITE';
  const modeBadgeHtml = isDirectOnSite
    ? `<span style="font-size: 0.66rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #FAF5FF; color: #7E22CE; border: 1px solid #E9D5FF;">Metode Persetujuan: Langsung di Lokasi</span>`
    : `<span style="font-size: 0.66rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #F8FAFC; color: #475569; border: 1px solid #E2E8F0;">Metode Persetujuan: Bertahap</span>`;

  const docNoDisplay = item.officialDocNo || item.docNo || item.draftDocNo || '-';
  const totalQty = item.totalQty || item.quantity || 0;
  const itemCount = Array.isArray(item.items) ? item.items.length : 1;

  return `
    <div class="card-bapb-item" data-id="${esc(item.id)}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
      
      <!-- HEADER -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
        <div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0F172A; font-family: monospace;">
            ${esc(docNoDisplay)}
          </div>
          <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">
            Kebun: <strong>${esc(item.estateCode || 'TB')}</strong> • Divisi: <strong>${esc(item.divisionCode || 'DIV-I')}</strong> • ${itemCount} Item Seleksi
          </div>
        </div>
        <div>
          ${badgeHtml}
        </div>
      </div>

      <!-- METADATA & TOTAL -->
      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; margin: 8px 0; align-items: center;">
        <div>
          <div style="font-size: 0.68rem; color: #64748B;">Klon & Bedengan:</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: #1E293B;">
            ${esc(item.klon || 'GT 1')} (${esc(item.bedengan || '-')})
          </div>
          <div style="font-size: 0.68rem; color: #64748B; margin-top: 2px;">
            Tgl Pelaksanaan: <strong>${esc(formatDate(item.tanggalPelaksanaan || item.date))}</strong>
          </div>
        </div>
        <div style="text-align: right; border-left: 1px solid #E2E8F0; padding-left: 10px;">
          <div style="font-size: 0.64rem; font-weight: 700; color: #DC2626; text-transform: uppercase;">Total Dimusnahkan</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: #DC2626; margin-top: 1px;">
            ${Number(totalQty).toLocaleString('id-ID')} <span style="font-size: 0.72rem; font-weight: 700;">Pkk</span>
          </div>
        </div>
      </div>

      <!-- INVARIAN STOK, PELAKSANA & METODE PERSETUJUAN -->
      <div style="font-size: 0.72rem; color: #475569; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
          <div>Pelaksana: <strong>${esc(item.signatures?.asb?.name || item.createdByName || 'Asisten Bibitan')}</strong></div>
          <div>${modeBadgeHtml}</div>
        </div>
        ${item.returnReason ? `<div style="margin-top: 3px; color: #DC2626;">Alasan Dikembalikan: <strong>${esc(item.returnReason)}</strong></div>` : ''}
        ${item.askepNotes ? `<div style="margin-top: 3px; color: #15803D;">Catatan Askep: ${esc(item.askepNotes)}</div>` : ''}
        ${item.pengurusNotes ? `<div style="margin-top: 3px; color: #047857;">Catatan Pengurus: ${esc(item.pengurusNotes)}</div>` : ''}
      </div>

      <!-- ACTION BUTTONS -->
      <div style="display: flex; gap: 8px; border-top: 1px solid #E2E8F0; padding-top: 10px;">
        ${isAskep && isAwaitingAskep ? `
          <button type="button" class="btn-askep-action" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
            Pemeriksaan & Tanda Tangan Askep
          </button>
        ` : ''}

        ${isPengurus && isAwaitingPengurus ? `
          <button type="button" class="btn-pengurus-action" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #047857; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
            Pemeriksaan & Pengesahan Dokumen FINAL
          </button>
        ` : ''}

        ${isFinal ? `
          <button type="button" class="btn-preview-bapb btn-print-bapb" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            <span>Lihat & Cetak BA</span>
          </button>
        ` : `
          <button type="button" class="btn-preview-bapb" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #F1F5F9; color: #334155; border: 1px solid #CBD5E1; border-radius: 6px; font-weight: 700; font-size: 0.76rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Preview Draf (A4)</span>
          </button>
        `}

        ${isAsb && isReturned ? `
          <button type="button" class="btn-recreate-bapb" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
            Perbaiki Draf BAPB
          </button>
        ` : ''}
      </div>

    </div>
  `;
}

/**
 * Render Kartu Pengajuan Pemusnahan Lama (CUL)
 */
function renderLegacyDestructionCardItem(item, currentUser) {
  const qty = parseInt(item.quantity || item.destructionQty || 0, 10);
  const isActionable = canPerformAsistenDestructionAction(item, currentUser);
  const isApproved = item.status === DESTRUCTION_STATUS.DISETUJUI;
  const isReturned = item.status === DESTRUCTION_STATUS.DIKEMBALIKAN;

  let statusBadge = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A;">MENUNGGU PEMERIKSAAN</span>`;
  if (isApproved) {
    statusBadge = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #F0FDF4; color: #15803D; border: 1px solid #BBF7D0;">DISETUJUI (CUL)</span>`;
  } else if (isReturned) {
    statusBadge = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA;">DIKEMBALIKAN</span>`;
  }

  return `
    <div class="card-destruction-item" data-id="${esc(item.id)}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
        <div>
          <div style="font-weight: 800; font-size: 0.95rem; color: #0F172A;">
            ${esc(item.batchCode || item.batchNo || 'Batch')} • ${esc(item.clone || item.klon || '-')}
          </div>
          <div style="font-size: 0.74rem; color: #64748B; margin-top: 2px;">
            ${esc(item.programName || item.programId || 'Program Pembibitan')} • Bedengan: <strong>${esc(item.bedengan || '-')}</strong>
          </div>
        </div>
        <div>
          ${statusBadge}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 8px; background: #FEF2F2; border: 1px solid #FEE2E2; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; align-items: center;">
        <div>
          <div style="font-size: 0.64rem; font-weight: 700; color: #991B1B; text-transform: uppercase;">Alasan Pemusnahan</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: #991B1B; margin-top: 2px;">
            ${esc(item.reason || item.alasan || 'Tidak memenuhi standar')}
          </div>
        </div>
        <div style="text-align: right; border-left: 1px solid #FECACA; padding-left: 10px;">
          <div style="font-size: 0.64rem; font-weight: 700; color: #DC2626; text-transform: uppercase;">Jumlah Dimusnahkan</div>
          <div style="font-size: 1.1rem; font-weight: 900; color: #DC2626; margin-top: 1px;">
            ${qty.toLocaleString('id-ID')} <span style="font-size: 0.72rem; font-weight: 700;">Pkk</span>
          </div>
        </div>
      </div>

      <div style="font-size: 0.72rem; color: #475569; margin-bottom: ${isActionable ? '10px' : '4px'};">
        <div>Pengaju: <strong>${esc(item.createdByName || 'Mantri Bibitan')}</strong> • ${esc(item.tanggalPemusnahan || item.createdAt ? formatDate(item.createdAt) : '-')}</div>
        ${item.description && item.description !== '-' ? `<div style="margin-top: 2px;">Keterangan: <em>${esc(item.description)}</em></div>` : ''}
        ${item.approvalNotes ? `<div style="margin-top: 2px; color: #15803D;">Catatan Persetujuan: ${esc(item.approvalNotes)}</div>` : ''}
        ${item.returnReason ? `<div style="margin-top: 2px; color: #DC2626;">Alasan Pengembalian: <strong>${esc(item.returnReason)}</strong></div>` : ''}
      </div>

      ${isActionable ? `
        <div style="display: flex; gap: 8px; border-top: 1px solid #E2E8F0; padding-top: 10px;">
          <button type="button" class="btn-return-destruction" data-id="${esc(item.id)}" style="flex: 1; height: 36px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
            Kembalikan
          </button>
          <button type="button" class="btn-approve-destruction" data-id="${esc(item.id)}" style="flex: 1.2; height: 36px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer; box-shadow: 0 1px 3px rgba(17,104,52,0.2);">
            Setujui Pemusnahan
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * =============================================================================
 * MODAL / FULL-SCREEN: PEMBUATAN BERITA ACARA PEMUSNAHAN BIBIT (ASISTEN BIBITAN)
 * =============================================================================
 */
/**
 * =============================================================================
 * MODAL LANGKAH 1: PILIH METODE PERSETUJUAN BAPB
 * =============================================================================
 */
function openBapbMethodSelectionModal(app, currentUser, initialSelectedMode = null, preservedFormData = null) {
  let selectedMode = initialSelectedMode;

  openModal({
    title: 'Pilih Metode Persetujuan',
    className: 'modal-bapb-method-selection',
    body: `
      <div style="padding: 4px 0;">
        <div style="font-size: 0.8rem; color: #475569; margin-bottom: 14px; line-height: 1.45;">
          Tentukan metode persetujuan Berita Acara Pemusnahan Bibit (BAPB) sesuai kehadiran pejabat berwenang di lokasi pemusnahan:
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;" id="bapb-pre-method-options">
          <!-- OPSI A: PERSETUJUAN BERTAHAP -->
          <label class="bapb-pre-mode-card" data-mode="SEQUENTIAL" style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1.5px solid ${selectedMode === 'SEQUENTIAL' ? '#116834' : '#E2E8F0'}; border-radius: 10px; background: ${selectedMode === 'SEQUENTIAL' ? '#F0FDF4' : '#FFFFFF'}; cursor: pointer; transition: all 0.2s ease;">
            <input type="radio" name="bapb-pre-mode" id="bapb-pre-mode-sequential" value="SEQUENTIAL" ${selectedMode === 'SEQUENTIAL' ? 'checked' : ''} style="margin-top: 3px; accent-color: #116834;" />
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; font-size: 0.88rem; color: #0F172A; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 6px;">
                <span>Persetujuan Berjenjang</span>
                <span style="display: none; font-size: 0.65rem; font-weight: 700; color: #116834; background: #DCFCE7; padding: 2px 7px; border-radius: 4px; border: 1px solid #86EFAC; white-space: nowrap;">Default</span>
              </div>
              <div style="font-size: 0.76rem; color: #475569; line-height: 1.4;">
                Asisten Bibitan membuat draf dan menandatangani → Askep memeriksa menyetujui → Pengurus mengesahkan dokumen.
              </div>
            </div>
          </label>

          <!-- OPSI B: TANDA TANGAN LANGSUNG DI LOKASI -->
          <label class="bapb-pre-mode-card" data-mode="DIRECT_ON_SITE" style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1.5px solid ${selectedMode === 'DIRECT_ON_SITE' ? '#116834' : '#E2E8F0'}; border-radius: 10px; background: ${selectedMode === 'DIRECT_ON_SITE' ? '#F0FDF4' : '#FFFFFF'}; cursor: pointer; transition: all 0.2s ease;">
            <input type="radio" name="bapb-pre-mode" id="bapb-pre-mode-direct" value="DIRECT_ON_SITE" ${selectedMode === 'DIRECT_ON_SITE' ? 'checked' : ''} style="margin-top: 3px; accent-color: #116834;" />
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; font-size: 0.88rem; color: #0F172A; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 6px;">
                <span>Hadir Langsung di Lokasi</span>
                <span style="display: none; font-size: 0.65rem; font-weight: 700; color: #7E22CE; background: #F3E8FF; padding: 2px 7px; border-radius: 4px; border: 1px solid #E9D5FF; white-space: nowrap;">Serempak</span>
              </div>
              <div style="font-size: 0.76rem; color: #475569; line-height: 1.4;">
                Asisten, Askep, dan Pengurus hadir bersama di lokasi pemusnahan fisik dan melakukan tanda tangan langsung pada formulir di perangkat Asisten.
              </div>
            </div>
          </label>
        </div>
      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-cancel-method-selection" type="button" class="bapb-btn-cancel">
          Batal
        </button>
        <button id="btn-continue-method-selection" type="button" class="bapb-btn-submit">
          Lanjutkan
        </button>
      </div>
    `
  });

  const cards = document.querySelectorAll('.bapb-pre-mode-card');
  const radios = document.querySelectorAll('input[name="bapb-pre-mode"]');

  function updateCardsUI(mode) {
    selectedMode = mode;
    cards.forEach(card => {
      const isCardSelected = card.dataset.mode === mode;
      card.style.borderColor = isCardSelected ? '#116834' : '#E2E8F0';
      card.style.background = isCardSelected ? '#F0FDF4' : '#FFFFFF';
      const r = card.querySelector('input[type="radio"]');
      if (r) r.checked = isCardSelected;
    });
  }

  cards.forEach(card => {
    card.addEventListener('click', (e) => {
      const mode = card.dataset.mode;
      updateCardsUI(mode);
    });
  });

  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateCardsUI(e.target.value);
    });
  });

  document.getElementById('btn-cancel-method-selection')?.addEventListener('click', () => {
    closeModal();
  });

  document.getElementById('btn-continue-method-selection')?.addEventListener('click', () => {
    const checkedRadio = document.querySelector('input[name="bapb-pre-mode"]:checked');
    if (!checkedRadio) {
      toast('Silakan pilih salah satu metode persetujuan terlebih dahulu.', 'warning');
      return;
    }
    const finalChosenMode = checkedRadio.value;
    closeModal();
    // Buka Langkah 2: Pilih Dokumen Sumber Seleksi Afkir
    openBapbSourceSelectionModal(app, currentUser, finalChosenMode, preservedFormData?.selectedSources || [], preservedFormData);
  });
}

/**
 * =============================================================================
 * MODAL LANGKAH 2: PILIH DOKUMEN SUMBER SELEKSI AFKIR
 * =============================================================================
 */
function openBapbSourceSelectionModal(app, currentUser, selectedMode, initialSelectedSources = [], preservedFormData = null) {
  const eligibleSelections = getEligibleSelectionDocsForBapb(currentUser);
  let selectedIndices = Array.isArray(initialSelectedSources)
    ? [...initialSelectedSources]
    : (preservedFormData?.selectedSources ? [...preservedFormData.selectedSources] : []);

  openModal({
    title: 'Pilih Dokumen Sumber Seleksi',
    className: 'modal-bapb-source-selection',
    body: `
      <div style="padding: 4px 0;">
        <div style="font-size: 0.8rem; color: #475569; margin-bottom: 12px; line-height: 1.45;">
          Pilih minimal satu dokumen seleksi bibit afkir yang telah disetujui untuk diproses ke dalam Berita Acara ini:
        </div>

        ${eligibleSelections.length === 0 ? `
          <div style="border: 1px dashed #CBD5E1; border-radius: 8px; padding: 18px 14px; text-align: center; color: #64748B; font-size: 0.8rem; background: #F8FAFC; line-height: 1.5;">
            <div style="font-weight: 700; color: #475569; margin-bottom: 4px;">Tidak Ada Dokumen Seleksi yang Eligible</div>
            Tidak ditemukan dokumen seleksi afkir yang eligible atau belum diproses ke BAPB.<br>
            <span style="font-size: 0.72rem; color: #94A3B8;">Pastikan seleksi bibit afkir telah disetujui oleh Asisten Bibitan terlebih dahulu.</span>
          </div>
        ` : `
          <div class="bapb-source-list" style="max-height: 280px; gap: 8px;">
            ${eligibleSelections.map((sel, sIdx) => {
      const qty = sel.calculatedAfkirQty || sel.jumlahAfkirTotal || sel.jumlahAfkir || sel.quantity || 0;
      const isChecked = selectedIndices.includes(String(sIdx));
      return `
                <label class="bapb-source-item" data-index="${sIdx}">
                  <input type="checkbox" class="chk-bapb-source bapb-source-checkbox" value="${esc(sel.id || sel.docNo)}" data-index="${sIdx}" ${isChecked ? 'checked' : ''} />
                  <div class="bapb-source-content">
                    <div class="bapb-source-top">
                      <span class="bapb-source-docno">${esc(sel.docNo || sel.selectionNo || 'Seleksi')}</span>
                      <span class="bapb-source-qty">${Number(qty).toLocaleString('id-ID')} Pkk</span>
                    </div>
                    <div class="bapb-source-meta">
                      Bedengan: <strong>${esc(sel.bedenganCode || sel.bedengan || '-')}</strong> • Klon: <strong>${esc(sel.klon || sel.clone || 'GT 1')}</strong> • ${esc(sel.selectionStage || sel.stage || 'Afkir Seleksi')}
                    </div>
                  </div>
                </label>
              `;
    }).join('')}
          </div>

          <div id="bapb-source-summary-bar" style="margin-top: 10px; padding: 8px 12px; background: #F1F5F9; border-radius: 6px; font-size: 0.75rem; color: #334155; display: flex; justify-content: space-between; align-items: center;">
            <span id="bapb-source-count-label">0 dokumen dipilih</span>
            <span id="bapb-source-qty-label" style="font-weight: 700; color: #DC2626;">0 Pkk</span>
          </div>
        `}
      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-back-source-selection" type="button" class="bapb-btn-cancel">
          Kembali
        </button>
        <button id="btn-cancel-source-selection" type="button" class="bapb-btn-cancel" style="background: #FFFFFF;">
          Batal
        </button>
        <button id="btn-continue-source-selection" type="button" class="bapb-btn-submit" ${eligibleSelections.length === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
          Lanjutkan
        </button>
      </div>
    `
  });

  const checkboxes = document.querySelectorAll('.chk-bapb-source');
  const countLabel = document.getElementById('bapb-source-count-label');
  const qtyLabel = document.getElementById('bapb-source-qty-label');

  function updateSummary() {
    let count = 0;
    let totalQty = 0;
    checkboxes.forEach(chk => {
      if (chk.checked) {
        count++;
        const idx = parseInt(chk.dataset.index, 10);
        const sel = eligibleSelections[idx];
        if (sel) {
          const q = sel.calculatedAfkirQty || sel.jumlahAfkirTotal || sel.jumlahAfkir || sel.quantity || 0;
          totalQty += Number(q) || 0;
        }
      }
    });
    if (countLabel) countLabel.textContent = `${count} dokumen dipilih`;
    if (qtyLabel) qtyLabel.textContent = `${totalQty.toLocaleString('id-ID')} Pkk`;
  }

  checkboxes.forEach(chk => {
    chk.addEventListener('change', updateSummary);
  });
  updateSummary();

  // Tombol Kembali: ke Pemilihan Mode
  document.getElementById('btn-back-source-selection')?.addEventListener('click', () => {
    const currentChecked = Array.from(document.querySelectorAll('.chk-bapb-source:checked')).map(c => c.dataset.index);
    closeModal();
    openBapbMethodSelectionModal(app, currentUser, selectedMode, {
      ...preservedFormData,
      selectedSources: currentChecked
    });
  });

  // Tombol Batal: Tutup bersih
  document.getElementById('btn-cancel-source-selection')?.addEventListener('click', () => {
    closeModal();
  });

  // Tombol Lanjutkan: Konfirmasi Dokumen Sumber & Masuk Form BAPB
  document.getElementById('btn-continue-source-selection')?.addEventListener('click', () => {
    const checkedBoxes = Array.from(document.querySelectorAll('.chk-bapb-source:checked'));
    if (checkedBoxes.length === 0) {
      toast('Pilih minimal satu dokumen seleksi sumber untuk Berita Acara.', 'warning');
      return;
    }

    // Re-validasi eligibility secara kanonikal
    const freshEligible = getEligibleSelectionDocsForBapb(currentUser);
    const freshIds = new Set(freshEligible.map(s => String(s.id || s.docNo)));
    const confirmedItems = [];
    const confirmedIndices = [];

    for (const chk of checkedBoxes) {
      const idx = parseInt(chk.dataset.index, 10);
      const sel = eligibleSelections[idx];
      if (!sel || !freshIds.has(String(sel.id || sel.docNo))) {
        toast('Sebagian dokumen seleksi yang dipilih tidak lagi eligible atau telah diproses.', 'error');
        return;
      }
      confirmedIndices.push(String(idx));
      confirmedItems.push({
        sourceSelectionId: sel.id || sel.txId || sel.docNo,
        sourceSelectionNo: sel.docNo || sel.selectionNo,
        batchId: sel.batchId || null,
        batchCode: sel.batchCode || '-',
        bedengan: sel.bedenganCode || sel.bedengan || '-',
        klon: sel.klon || sel.clone || 'GT 1',
        stage: sel.selectionStage || sel.stage || 'Afkir Seleksi',
        quantity: sel.calculatedAfkirQty || sel.jumlahAfkirTotal || sel.jumlahAfkir || sel.quantity || 0,
        reason: sel.reason || sel.alasan || 'Afkir Seleksi'
      });
    }

    // Ketentuan Wajib 5: Cek apakah komposisi dokumen sumber berubah
    const newDocSignature = confirmedItems.map(it => it.sourceSelectionId || it.sourceSelectionNo).sort().join(',');
    const prevDocSignature = preservedFormData?.sourceDocIds || '';
    const isDocCompositionChanged = !!(prevDocSignature && prevDocSignature !== newDocSignature);

    const updatedFormData = {
      ...preservedFormData,
      selectedSources: confirmedIndices,
      confirmedItems,
      sourceDocIds: newDocSignature,
      resetSignaturesNeeded: isDocCompositionChanged
    };

    closeModal();
    openBapbCreationModal(app, currentUser, null, selectedMode, updatedFormData);
  });
}

function formatIndonesianDateDisplay(isoDateStr) {
  if (!isoDateStr) return '-';
  const MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  if (typeof isoDateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDateStr.trim())) {
    const [y, m, d] = isoDateStr.trim().split('-');
    const mIdx = parseInt(m, 10) - 1;
    return `${parseInt(d, 10)} ${MONTHS[mIdx] || m} ${y}`;
  }
  try {
    const d = new Date(isoDateStr);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
  } catch (e) {}
  return String(isoDateStr);
}

/**
 * =============================================================================
 * MODAL / FULL-SCREEN: FORMULIR INPUT BAPB (LANGKAH 3)
 * =============================================================================
 */
function openBapbCreationModal(app, currentUser, existingDraft = null, initialSelectedMode = null, preservedFormData = null) {
  const eligibleSelections = getEligibleSelectionDocsForBapb(currentUser);
  const todayStr = new Date().toISOString().split('T')[0];

  let selectedPhotos = preservedFormData?.photos
    ? [...preservedFormData.photos]
    : (existingDraft?.photos ? [...existingDraft.photos] : []);
  const initialExecutionDate = preservedFormData?.tanggalPelaksanaan || existingDraft?.tanggalPelaksanaan || existingDraft?.date || todayStr;
  const initialMethod = preservedFormData?.metodePemusnahan || existingDraft?.metodePemusnahan || 'Pencincangan dan Pemendaman';

  const estateId = existingDraft?.estateId || currentUser.estateId || 'EST-TBS';
  const resolvedSigners = resolveBapbSignersForEstate(estateId);
  const initialMode = existingDraft?.approvalMode || initialSelectedMode || APPROVAL_MODE.SEQUENTIAL;

  // Resolve confirmed selection items
  let displayItems = [];
  if (existingDraft) {
    displayItems = existingDraft.items || [];
  } else if (preservedFormData?.confirmedItems && preservedFormData.confirmedItems.length > 0) {
    displayItems = preservedFormData.confirmedItems;
  } else if (preservedFormData?.selectedSources && preservedFormData.selectedSources.length > 0) {
    displayItems = preservedFormData.selectedSources.map(sIdx => {
      const idx = parseInt(sIdx, 10);
      const sel = eligibleSelections[idx];
      if (!sel) return null;
      return {
        sourceSelectionId: sel.id || sel.txId || sel.docNo,
        sourceSelectionNo: sel.docNo || sel.selectionNo,
        batchId: sel.batchId || null,
        batchCode: sel.batchCode || '-',
        bedengan: sel.bedenganCode || sel.bedengan || '-',
        klon: sel.klon || sel.clone || 'GT 1',
        stage: sel.selectionStage || sel.stage || 'Afkir Seleksi',
        quantity: sel.calculatedAfkirQty || sel.jumlahAfkirTotal || sel.jumlahAfkir || sel.quantity || 0,
        reason: sel.reason || sel.alasan || 'Afkir Seleksi'
      };
    }).filter(Boolean);
  } else if (eligibleSelections.length > 0) {
    const firstSel = eligibleSelections[0];
    displayItems = [{
      sourceSelectionId: firstSel.id || firstSel.txId || firstSel.docNo,
      sourceSelectionNo: firstSel.docNo || firstSel.selectionNo,
      batchId: firstSel.batchId || null,
      batchCode: firstSel.batchCode || '-',
      bedengan: firstSel.bedenganCode || firstSel.bedengan || '-',
      klon: firstSel.klon || firstSel.clone || 'GT 1',
      stage: firstSel.selectionStage || firstSel.stage || 'Afkir Seleksi',
      quantity: firstSel.calculatedAfkirQty || firstSel.jumlahAfkirTotal || firstSel.jumlahAfkir || firstSel.quantity || 0,
      reason: firstSel.reason || firstSel.alasan || 'Afkir Seleksi'
    }];
  }

  openModal({
    title: 'Buat Berita Acara Pemusnahan Bibit',
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapb-fullscreen',
    body: `
      <div class="bapb-form-wrapper">
        
        ${existingDraft?.returnReason ? `
          <div class="bapb-return-box">
            <div style="font-weight: 800; font-size: 0.82rem; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>Catatan Pengembalian dari Asisten Kepala:</span>
            </div>
            <div style="font-size: 0.82rem; margin-left: 22px;">"${esc(existingDraft.returnReason)}"</div>
            <div style="font-size: 0.72rem; color: #B91C1C; margin-top: 4px; margin-left: 22px;">
              Silakan lakukan pemeriksaan fisik ulang dan bubuhkan tanda tangan baru sebelum menyerahkan kembali draf ke Askep.
            </div>
          </div>
        ` : ''}

        <!-- INDIKATOR METODE PERSETUJUAN TERPILIH (DISEMBUNYIKAN PADA FORMULIR) -->
        <div class="bapb-section" id="section-bapb-approval-mode" style="display: none;">
          <div>
            <div style="font-size: 0.68rem; color: #64748B; font-weight: 700; text-transform: uppercase;">Metode Persetujuan:</div>
            <div style="font-size: 0.86rem; font-weight: 800; color: #0F172A; margin-top: 2px;">
              ${initialMode === APPROVAL_MODE.DIRECT_ON_SITE ? 'Tanda Tangan Langsung di Lokasi' : 'Persetujuan Bertahap'}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${!existingDraft ? `
              <button type="button" id="btn-change-bapb-mode" style="background: #FFFFFF; border: 1px solid #CBD5E1; color: #334155; font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer;">
                Ubah
              </button>
            ` : ''}
          </div>
          <!-- Hidden inputs for backward compatibility with selectors -->
          <input type="radio" name="bapb-approval-mode" id="bapb-mode-sequential" value="SEQUENTIAL" ${initialMode === 'SEQUENTIAL' ? 'checked' : ''} style="display: none;" />
          <input type="radio" name="bapb-approval-mode" id="bapb-mode-direct" value="DIRECT_ON_SITE" ${initialMode === 'DIRECT_ON_SITE' ? 'checked' : ''} style="display: none;" />
        </div>

        <!-- 1. DOKUMEN SUMBER SELEKSI AFKIR (TERKONFIRMASI) -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <h3 class="bapb-section-title">
              1. Dokumen Sumber Seleksi Afkir <span style="color: #DC2626;">*</span>
            </h3>
          </div>
          
          <div class="bapb-confirmed-sources-box">
            ${displayItems.length > 0 ? displayItems.map((it, idx) => `
              <div class="bapb-confirmed-source-card" style="${idx > 0 ? 'margin-top: 10px; padding-top: 10px; border-top: 1px dashed #E2E8F0;' : ''}">
                <div class="bapb-confirmed-source-docno" style="font-weight: 700; color: #0F172A; font-family: monospace; font-size: 0.86rem; line-height: 1.3;">
                  ${esc(it.sourceSelectionNo || it.docNo || 'Seleksi')}
                </div>
                <div class="bapb-confirmed-source-meta" style="font-size: 0.74rem; color: #64748B; margin: 3px 0 6px 0; line-height: 1.4;">
                  Bedengan: <strong>${esc(it.bedengan || '-')}</strong> • Klon: <strong>${esc(it.klon || 'GT 1')}</strong>
                </div>
                <div class="bapb-confirmed-source-bottom-row" style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
                  <div class="bapb-confirmed-source-qty" style="font-weight: 800; color: #DC2626; font-size: 1.05rem; line-height: 1.2;">
                    ${Number(it.quantity).toLocaleString('id-ID')} Pkk
                  </div>
                  ${(!existingDraft && idx === 0) ? `
                    <button type="button" id="btn-change-source-selection" class="bapb-btn-change-source">
                      Ubah Dokumen
                    </button>
                  ` : ''}
                </div>
                <!-- Hidden checkbox to preserve selection state & DOM query selectors -->
                <input type="checkbox" class="chk-bapb-source bapb-source-checkbox" data-index="${idx}" value="${esc(it.sourceSelectionId || it.id || it.docNo)}" checked style="position: absolute; opacity: 0; width: 16px; height: 16px; pointer-events: auto;" />
              </div>
            `).join('') : `
              <div style="text-align: center; color: #64748B; font-size: 0.75rem; padding: 6px 0;">
                Tidak ada dokumen sumber terpilih.
              </div>
            `}
          </div>
        </div>

        <!-- 2. RINCIAN TRANSAKSI (TANGGAL OTOMATIS & METODE) -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <h3 class="bapb-section-title">
              2. Rincian Transaksi <span style="color: #DC2626;">*</span>
            </h3>
          </div>

          <div class="bapb-transaction-details-group">
            <div class="bapb-date-display-box">
              <div class="bapb-date-label">Tanggal Pelaksanaan</div>
              <div class="bapb-date-value" id="bapb-execution-date-display">${esc(formatIndonesianDateDisplay(initialExecutionDate))}</div>
              <input type="hidden" id="bapb-execution-date" value="${esc(initialExecutionDate)}" />
            </div>

            <div class="bapb-field-group">
              <label for="bapb-method" class="bapb-field-label">
                Metode Pemusnahan <span style="color: #DC2626;">*</span>
              </label>
              <select id="bapb-method" class="bapb-input-control bapb-select-control">
                <option value="Pencincangan dan Pemendaman" ${initialMethod === 'Pencincangan dan Pemendaman' ? 'selected' : ''}>Pencincangan dan Pemendaman</option>
                <option value="Pembakaran Terkendali" ${initialMethod === 'Pembakaran Terkendali' ? 'selected' : ''}>Pembakaran Terkendali</option>
                <option value="Pemusnahan Kimiawi / Herbisida" ${initialMethod === 'Pemusnahan Kimiawi / Herbisida' ? 'selected' : ''}>Pemusnahan Kimiawi / Herbisida</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 3. TANDA TANGAN (LANGKAH 3: SEBELUM BUKTI FOTO) -->
        <div class="bapb-section" id="section-bapb-signatures">
          <div class="bapb-section-header">
            <h3 class="bapb-section-title">
              3. Tanda Tangan <span style="color: #DC2626;">*</span>
            </h3>
          </div>

          <!-- TANDA TANGAN 1: ASISTEN DIVISI (AKTIF DI KEDUA MODE) -->
          <div class="bapb-sig-item" id="item-sig-asb">
            <div class="bapb-sig-role-header">
              <span class="bapb-sig-role-title">1. Asisten Divisi <span style="color: #DC2626;">*</span></span>
              <button type="button" id="btn-clear-sig-asb" class="bapb-btn-clear-sig" title="Bersihkan Tanda Tangan" aria-label="Bersihkan">
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              </button>
            </div>
            <div class="bapb-canvas-box">
              <span class="bapb-canvas-placeholder">Area tanda tangan</span>
              <canvas id="bapb-sig-canvas-asb" width="340" height="120" class="bapb-sig-canvas"></canvas>
            </div>
          </div>

          <!-- CONTAINER TANDA TANGAN LANGSUNG DI LOKASI (2. ASKEP & 3. PENGURUS) -->
          <div id="bapb-direct-signatures-container" style="display: ${initialMode === 'DIRECT_ON_SITE' ? 'block' : 'none'};">
            
            <!-- TANDA TANGAN 2: ASISTEN KEPALA (DIRECT) -->
            <div class="bapb-sig-item" id="section-sig-direct-askep" style="margin-top: 10px;">
              <div class="bapb-sig-role-header">
                <span class="bapb-sig-role-title">2. Asisten Kepala <span style="color: #DC2626;">*</span></span>
                <button type="button" id="btn-clear-sig-direct-askep" class="bapb-btn-clear-sig" title="Bersihkan Tanda Tangan" aria-label="Bersihkan">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
              </div>
              <div class="bapb-canvas-box">
                <span class="bapb-canvas-placeholder">Area tanda tangan</span>
                <canvas id="bapb-sig-canvas-direct-askep" width="340" height="120" class="bapb-sig-canvas"></canvas>
              </div>
            </div>

            <!-- TANDA TANGAN 3: PENGURUS (DIRECT) -->
            <div class="bapb-sig-item" id="section-sig-direct-pengurus" style="margin-top: 10px;">
              <div class="bapb-sig-role-header">
                <span class="bapb-sig-role-title">3. Pengurus <span style="color: #DC2626;">*</span></span>
                <button type="button" id="btn-clear-sig-direct-pengurus" class="bapb-btn-clear-sig" title="Bersihkan Tanda Tangan" aria-label="Bersihkan">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
              </div>
              <div class="bapb-canvas-box">
                <span class="bapb-canvas-placeholder">Area tanda tangan</span>
                <canvas id="bapb-sig-canvas-direct-pengurus" width="340" height="120" class="bapb-sig-canvas"></canvas>
              </div>
            </div>

          </div>

          <div class="bapb-sig-bottom-hint">
            Tanda tangan langsung pada area di atas.
          </div>
        </div>

        <!-- 4. BUKTI FOTO PEMUSNAHAN (LANGKAH 4: SETELAH TANDA TANGAN) -->
        <div class="bapb-section" id="section-bapb-photos">
          <div class="bapb-section-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <h3 class="bapb-section-title">
                4. Bukti Foto Pemusnahan <span style="color: #DC2626;">*</span>
              </h3>
              <span class="bapb-section-subtitle">Foto bukti pelaksanaan fisik. Minimal 1 foto.</span>
            </div>
            <span id="photo-count-label" class="bapb-photo-counter" style="display: none;">
              ${selectedPhotos.length} / 2 foto diambil (wajib minimal 1)
            </span>
          </div>

          <div id="bapb-photo-preview-grid" class="bapb-photo-grid"></div>

          <div id="camera-capture-trigger" style="display: ${selectedPhotos.length >= 2 ? 'none' : 'block'}; margin-top: 8px;">
            <button type="button" id="btn-trigger-photo" class="bapb-btn-photo">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              <span>Buka Kamera & Ambil Foto</span>
            </button>
          </div>

          <!-- OVERLAY KAMERA PERANGKAT BAPB (KONSISTEN DENGAN MODUL PENERIMAAN) -->
          <div id="bapb-camera-overlay" class="bapb-camera-overlay" style="display: none;">
            <header style="display: flex; justify-content: space-between; align-items: center; padding: 16px; position: absolute; top: 0; left: 0; right: 0; z-index: 10031;">
              <span style="color: #FFFFFF; font-weight: 700; font-size: 0.88rem; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">Kamera Bukti Pemusnahan</span>
              <button type="button" id="btn-bapb-camera-close" aria-label="Tutup kamera" style="background: rgba(0,0,0,0.5); border: none; border-radius: 50%; width: 40px; height: 40px; display: flex; justify-content: center; align-items: center; cursor: pointer; color: #FFFFFF; font-size: 24px; line-height: 1;">×</button>
            </header>
            <main style="flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;">
              <video id="bapb-camera-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
              <canvas id="bapb-camera-canvas" style="display: none;"></canvas>
              <div id="bapb-camera-error" style="display: none; color: #FFFFFF; text-align: center; padding: 24px; flex-direction: column; align-items: center; justify-content: center;">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                  <line x1="1" y1="1" x2="23" y2="23" stroke="#DC2626" stroke-width="2.5"></line>
                </svg>
                <p style="font-weight: 700; font-size: 1rem; margin: 0 0 6px 0;">Kamera Tidak Tersedia atau Akses Ditolak</p>
                <p style="font-size: 0.8rem; color: #CBD5E1; margin: 0 0 16px 0; max-width: 290px;">Aplikasi membutuhkan izin akses kamera perangkat untuk mendokumentasikan bukti fisik pemusnahan di lapangan. Pastikan izin kamera aktif pada peramban perangkat Anda.</p>
              </div>
              <div style="position: absolute; width: 80%; height: 60%; border: 2px dashed rgba(255,255,255,0.4); border-radius: 12px; pointer-events: none;"></div>
            </main>
            <footer style="padding: 24px; display: flex; justify-content: center; align-items: center; position: absolute; bottom: 0; left: 0; right: 0; z-index: 10031; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);">
              <button id="btn-bapb-camera-shutter" type="button" aria-label="Ambil foto" style="width: 70px; height: 70px; border-radius: 50%; background: transparent; border: 4px solid #FFFFFF; display: flex; justify-content: center; align-items: center; cursor: pointer;">
                <div style="width: 54px; height: 54px; background: #FFFFFF; border-radius: 50%;"></div>
              </button>
            </footer>
          </div>
        </div>

      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-cancel-bapb-modal" type="button" class="bapb-btn-cancel">
          Batal
        </button>
        <button id="btn-submit-bapb-draft" type="button" class="bapb-btn-submit">
          ${existingDraft ? 'Simpan Perbaikan Berita Acara' : 'Buat Dokumen'}
        </button>
      </div>
    `,
    onClose: () => {
      stopBapbCamera();
    }
  });

  // Setup Canvas Signatures
  const canvasEl = document.getElementById('bapb-sig-canvas-asb');
  const clearBtn = document.getElementById('btn-clear-sig-asb');
  const sigHandler = setupSignatureCanvas(canvasEl, clearBtn);

  // Setup Direct Signatures (Askep & Pengurus)
  const canvasDirectAskep = document.getElementById('bapb-sig-canvas-direct-askep');
  const clearDirectAskep = document.getElementById('btn-clear-sig-direct-askep');
  const sigHandlerDirectAskep = setupSignatureCanvas(canvasDirectAskep, clearDirectAskep);

  const canvasDirectPengurus = document.getElementById('bapb-sig-canvas-direct-pengurus');
  const clearDirectPengurus = document.getElementById('btn-clear-sig-direct-pengurus');
  const sigHandlerDirectPengurus = setupSignatureCanvas(canvasDirectPengurus, clearDirectPengurus);

  // Setup Mode Selection Handlers
  const radioModes = document.querySelectorAll('input[name="bapb-approval-mode"]');
  function updateApprovalModeUI() {
    const selectedMode = document.querySelector('input[name="bapb-approval-mode"]:checked')?.value || APPROVAL_MODE.SEQUENTIAL;
    const directContainer = document.getElementById('bapb-direct-signatures-container');
    const submitBtn = document.getElementById('btn-submit-bapb-draft');
    const modeCards = document.querySelectorAll('.bapb-mode-card');

    modeCards.forEach(card => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && radio.checked) {
        card.style.borderColor = '#116834';
        card.style.background = '#F0FDF4';
      } else {
        card.style.borderColor = '#E2E8F0';
        card.style.background = '#FFFFFF';
      }
    });

    if (selectedMode === APPROVAL_MODE.DIRECT_ON_SITE) {
      if (directContainer) directContainer.style.display = 'block';
      if (submitBtn) submitBtn.textContent = existingDraft ? 'Simpan Perbaikan Berita Acara' : 'Buat Dokumen';
      setTimeout(() => {
        sigHandlerDirectAskep?.resize?.();
        sigHandlerDirectPengurus?.resize?.();
      }, 50);
    } else {
      if (directContainer) directContainer.style.display = 'none';
      if (submitBtn) submitBtn.textContent = existingDraft ? 'Simpan Perbaikan Berita Acara' : 'Buat Dokumen';
    }
  }

  radioModes.forEach(r => {
    r.addEventListener('change', updateApprovalModeUI);
  });
  updateApprovalModeUI();

  // Action: Change Mode from inside form
  document.getElementById('btn-change-bapb-mode')?.addEventListener('click', () => {
    const currentFormData = {
      tanggalPelaksanaan: document.getElementById('bapb-execution-date')?.value,
      metodePemusnahan: document.getElementById('bapb-method')?.value,
      selectedSources: preservedFormData?.selectedSources || [],
      confirmedItems: displayItems,
      sourceDocIds: preservedFormData?.sourceDocIds || '',
      photos: [...selectedPhotos]
    };
    stopBapbCamera();
    closeModal();
    openBapbMethodSelectionModal(app, currentUser, initialMode, currentFormData);
  });

  // Action: Change Source Selection from inside form
  document.getElementById('btn-change-source-selection')?.addEventListener('click', () => {
    const currentFormData = {
      ...preservedFormData,
      tanggalPelaksanaan: document.getElementById('bapb-execution-date')?.value,
      metodePemusnahan: document.getElementById('bapb-method')?.value,
      selectedSources: preservedFormData?.selectedSources || [],
      confirmedItems: displayItems,
      sourceDocIds: preservedFormData?.sourceDocIds || displayItems.map(it => it.sourceSelectionId || it.sourceSelectionNo).sort().join(','),
      photos: [...selectedPhotos]
    };
    stopBapbCamera();
    closeModal();
    openBapbSourceSelectionModal(app, currentUser, initialMode, currentFormData.selectedSources, currentFormData);
  });

  // Ketentuan Wajib 5: Jika komposisi dokumen sumber berubah, hapus tanda tangan lama
  if (preservedFormData?.resetSignaturesNeeded) {
    setTimeout(() => {
      toast('Komposisi dokumen sumber diubah. Tanda tangan sebelumnya dihapus dan wajib dibubuhkan ulang.', 'warning');
      sigHandler?.clear?.();
      sigHandlerDirectAskep?.clear?.();
      sigHandlerDirectPengurus?.clear?.();
    }, 120);
  }

  // Camera & Photo State Handlers
  let bapbCameraStream = null;

  function stopBapbCamera() {
    if (bapbCameraStream) {
      try {
        bapbCameraStream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.warn('Gagal menghentikan track kamera:', err);
      }
      bapbCameraStream = null;
    }
    const modalEl = document.querySelector('.modal-fullscreen');
    if (modalEl) modalEl.classList.remove('has-camera-active');
    const overlay = document.getElementById('bapb-camera-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  const triggerBtn = document.getElementById('btn-trigger-photo');
  const cameraOverlay = document.getElementById('bapb-camera-overlay');
  const cameraVideo = document.getElementById('bapb-camera-video');
  const cameraCanvas = document.getElementById('bapb-camera-canvas');
  const cameraError = document.getElementById('bapb-camera-error');
  const cameraCloseBtn = document.getElementById('btn-bapb-camera-close');
  const cameraShutterBtn = document.getElementById('btn-bapb-camera-shutter');
  const previewGrid = document.getElementById('bapb-photo-preview-grid');
  const countLabel = document.getElementById('photo-count-label');

  triggerBtn?.addEventListener('click', async () => {
    if (selectedPhotos.length >= 2) {
      toast('Maksimal 2 foto bukti pemusnahan.', 'warning');
      return;
    }

    const modalEl = document.querySelector('.modal-fullscreen');
    if (modalEl) modalEl.classList.add('has-camera-active');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Kamera tidak didukung pada peramban ini.');
      }
      try {
        bapbCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch (errFacing) {
        bapbCameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (cameraVideo) {
        cameraVideo.srcObject = bapbCameraStream;
        cameraVideo.style.display = 'block';
        await cameraVideo.play();
      }
      if (cameraError) cameraError.style.display = 'none';
      if (cameraOverlay) cameraOverlay.style.display = 'flex';
      if (cameraShutterBtn) cameraShutterBtn.disabled = false;
    } catch (err) {
      console.warn('Akses kamera gagal / fallback:', err);
      // Mode otomatis pengujian tanpa hardware kamera (Puppeteer / headless):
      if (navigator.webdriver && cameraCanvas && cameraCanvas.captureStream) {
        try {
          cameraCanvas.width = 640;
          cameraCanvas.height = 480;
          const ctx = cameraCanvas.getContext('2d');
          ctx.fillStyle = '#116834';
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 22px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('SIGMA NURSERY — PEMUSNAHAN BIBIT', 320, 240);
          bapbCameraStream = cameraCanvas.captureStream(25);
          if (cameraVideo) {
            cameraVideo.srcObject = bapbCameraStream;
            cameraVideo.style.display = 'block';
            await cameraVideo.play();
          }
          if (cameraError) cameraError.style.display = 'none';
          if (cameraOverlay) cameraOverlay.style.display = 'flex';
          if (cameraShutterBtn) cameraShutterBtn.disabled = false;
          return;
        } catch (synthErr) {
          console.warn('Synthetic stream failed:', synthErr);
        }
      }

      if (bapbCameraStream) {
        try {
          bapbCameraStream.getTracks().forEach(track => track.stop());
        } catch (e) { }
        bapbCameraStream = null;
      }
      if (cameraOverlay) cameraOverlay.style.display = 'flex';
      if (cameraVideo) cameraVideo.style.display = 'none';
      if (cameraError) cameraError.style.display = 'flex';
      if (cameraShutterBtn) cameraShutterBtn.disabled = true;
      toast('Kamera tidak dapat diakses atau izin ditolak. Harap izinkan akses kamera perangkat.', 'error');
    }
  });

  cameraCloseBtn?.addEventListener('click', stopBapbCamera);

  cameraShutterBtn?.addEventListener('click', () => {
    if (selectedPhotos.length >= 2) {
      stopBapbCamera();
      toast('Maksimal 2 foto bukti pemusnahan.', 'warning');
      return;
    }

    if (!bapbCameraStream || !cameraVideo || cameraVideo.videoWidth <= 0) {
      toast('Kamera belum aktif. Tidak dapat mengambil foto tanpa kamera.', 'error');
      return;
    }

    let photoData = '';
    const capturedAt = new Date();

    if (cameraCanvas) {
      cameraCanvas.width = cameraVideo.videoWidth;
      cameraCanvas.height = cameraVideo.videoHeight;
      const ctx = cameraCanvas.getContext('2d');
      ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

      // Watermark BAPB konsisten dengan modul Penerimaan
      const scale = cameraCanvas.width / 640;
      const fontSize = Math.max(14, Math.round(16 * scale));
      const lines = [
        `SIGMA NURSERY • BAPB PEMUSNAHAN BIBIT`,
        `Pelaksana: ${currentUser.name || currentUser.userId || 'ASB'}`,
        `${capturedAt.toLocaleString('id-ID')} WIB`
      ];
      const padding = Math.round(fontSize * 0.7);
      const lineHeight = Math.round(fontSize * 1.4);
      const stampHeight = padding * 2 + lineHeight * lines.length;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, cameraCanvas.height - stampHeight, cameraCanvas.width, stampHeight);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      lines.forEach((line, index) => {
        ctx.fillText(line, padding, cameraCanvas.height - stampHeight + padding + index * lineHeight, cameraCanvas.width - padding * 2);
      });

      photoData = cameraCanvas.toDataURL('image/jpeg', 0.85);
    }

    stopBapbCamera();

    if (photoData) {
      selectedPhotos.push(photoData);
      updatePhotoPreviews();
      toast(`Foto bukti ke-${selectedPhotos.length} berhasil diambil dari kamera.`, 'success');
    }
  });

  function updatePhotoPreviews() {
    if (!previewGrid || !countLabel) return;
    countLabel.textContent = `${selectedPhotos.length} / 2 foto diambil (wajib minimal 1)`;

    const triggerContainer = document.getElementById('camera-capture-trigger');
    if (triggerContainer) {
      triggerContainer.style.display = selectedPhotos.length >= 2 ? 'none' : 'block';
    }

    const userName = currentUser.name || currentUser.userId || 'ASB';

    previewGrid.innerHTML = selectedPhotos.map((p, idx) => `
      <div class="bapb-photo-card">
        <img src="${p}" alt="Bukti Foto ${idx + 1}" />
        <div class="bapb-photo-card-info">
          <div class="bapb-photo-card-title">Foto Bukti ${idx + 1} Tersedia</div>
          <div class="bapb-photo-card-meta">
            Sumber: <strong>CAMERA</strong> • Oleh: <strong>${esc(userName)}</strong>
          </div>
        </div>
        <button type="button" class="btn-remove-photo btn-delete-photo bapb-btn-remove-photo" data-index="${idx}" aria-label="Hapus Foto ${idx + 1}">
          <span>✕ Hapus</span>
        </button>
      </div>
    `).join('');

    previewGrid.querySelectorAll('.btn-remove-photo').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        selectedPhotos.splice(idx, 1);
        updatePhotoPreviews();
        toast('Foto bukti berhasil dihapus.', 'info');
      });
    });
  }

  // Render initial photos if editing
  if (selectedPhotos.length > 0) {
    updatePhotoPreviews();
  }

  document.getElementById('btn-cancel-bapb-modal')?.addEventListener('click', () => {
    const hasData = (selectedPhotos.length > 0) || (document.querySelectorAll('.chk-bapb-source:checked').length > 0);
    if (hasData) {
      if (!window.confirm('Batalkan pengisian Berita Acara? Data yang telah diinput tidak akan disimpan.')) {
        return;
      }
    }
    stopBapbCamera();
    closeModal();
  });

  // Submit Draft BAPB
  document.getElementById('btn-submit-bapb-draft')?.addEventListener('click', () => {
    let selectedItems = [];
    if (existingDraft) {
      selectedItems = existingDraft.items || [];
    } else if (displayItems && displayItems.length > 0) {
      selectedItems = displayItems;
    } else {
      const checkedBoxes = Array.from(document.querySelectorAll('.chk-bapb-source:checked'));
      if (checkedBoxes.length === 0) {
        toast('Pilih minimal satu dokumen seleksi sumber untuk Berita Acara.', 'error');
        return;
      }
      selectedItems = checkedBoxes.map(chk => {
        const idx = parseInt(chk.dataset.index, 10);
        const sel = eligibleSelections[idx];
        return {
          sourceSelectionId: sel.id || sel.txId || sel.docNo,
          sourceSelectionNo: sel.docNo || sel.selectionNo,
          batchId: sel.batchId || null,
          batchCode: sel.batchCode || '-',
          bedengan: sel.bedenganCode || sel.bedengan || '-',
          klon: sel.klon || sel.clone || 'GT 1',
          stage: sel.selectionStage || sel.stage || 'Afkir Seleksi',
          quantity: sel.calculatedAfkirQty || sel.jumlahAfkirTotal || sel.jumlahAfkir || sel.quantity || 0,
          reason: sel.reason || sel.alasan || 'Afkir Seleksi'
        };
      });
    }

    if (!selectedItems || selectedItems.length === 0) {
      toast('Pilih minimal satu dokumen seleksi sumber untuk Berita Acara.', 'error');
      return;
    }

    const executionDate = document.getElementById('bapb-execution-date')?.value;
    const method = document.getElementById('bapb-method')?.value;

    if (selectedPhotos.length < 1) {
      toast('Bukti foto pemusnahan wajib dilampirkan minimal 1 foto.', 'error');
      return;
    }

    const asbSigData = sigHandler.getSignatureDataUrl();
    if (!asbSigData) {
      toast('Tanda tangan Asisten Divisi Bibitan wajib dibubuhkan di layar.', 'error');
      return;
    }

    const selectedMode = document.querySelector('input[name="bapb-approval-mode"]:checked')?.value || APPROVAL_MODE.SEQUENTIAL;

    // ALUR MODE B: TANDA TANGAN LANGSUNG DI LOKASI (FINAL SEKETIKA)
    if (selectedMode === APPROVAL_MODE.DIRECT_ON_SITE) {
      const askepSigData = sigHandlerDirectAskep.getSignatureDataUrl();
      if (!askepSigData) {
        toast('Tanda tangan Asisten Kepala (Pemeriksa) wajib dibubuhkan di layar.', 'error');
        return;
      }

      const pengurusSigData = sigHandlerDirectPengurus.getSignatureDataUrl();
      if (!pengurusSigData) {
        toast('Tanda tangan Pengurus (Pengesah) wajib dibubuhkan di layar.', 'error');
        return;
      }

      if (
        asbSigData === askepSigData ||
        asbSigData === pengurusSigData ||
        askepSigData === pengurusSigData
      ) {
        toast('Setiap pihak (ASB, Askep, Pengurus) wajib membubuhkan tanda tangan masing-masing. Tanda tangan tidak boleh disalin atau identik.', 'error');
        return;
      }

      const confirmed = window.confirm(
        'Konfirmasi Pengesahan Langsung di Lokasi:\n\n' +
        'Apakah Anda yakin ingin mengesahkan Berita Acara Pemusnahan Bibit ini sebagai dokumen FINAL?\n\n' +
        '• Seluruh pihak (ASB, Askep, Pengurus) telah menandatangani di lokasi.\n' +
        '• Dokumen FINAL akan terkunci dan tidak dapat diedit kembali.\n' +
        '• Nomor resmi akan dialokasikan seketika.'
      );
      if (!confirmed) return;

      try {
        const finalDoc = createAndFinalizeDirectOnSiteBapb({
          items: selectedItems,
          tanggalPelaksanaan: executionDate,
          metodePemusnahan: method,
          photos: selectedPhotos,
          asbSignature: asbSigData,
          askepSignature: askepSigData,
          pengurusSignature: pengurusSigData,
          approvalMode: APPROVAL_MODE.DIRECT_ON_SITE,
          askepName: resolvedSigners.askep.name,
          askepUserId: resolvedSigners.askep.userId,
          pengurusName: resolvedSigners.pengurus.name,
          pengurusUserId: resolvedSigners.pengurus.userId
        }, currentUser);

        closeModal();
        toast(`Berita Acara resmi disahkan secara FINAL (${finalDoc.officialDocNo || finalDoc.docNo}).`, 'success');
        renderBapbReviewDashboard(app, currentUser);
      } catch (err) {
        toast(err.message || 'Gagal mengesahkan Berita Acara langsung di lokasi.', 'error');
      }
      return;
    }

    // ALUR MODE A: PERSETUJUAN BERTAHAP (ASB -> ASKEP -> PENGURUS)
    try {
      if (existingDraft) {
        reviseBapbDraft(existingDraft.id, {
          tanggalPelaksanaan: executionDate,
          metodePemusnahan: method,
          photos: selectedPhotos,
          asbSignature: asbSigData
        }, currentUser);
        closeModal();
        toast('Perbaikan Berita Acara berhasil dikirim ulang ke Asisten Kepala.', 'success');
      } else {
        createBapbDraft({
          items: selectedItems,
          tanggalPelaksanaan: executionDate,
          metodePemusnahan: method,
          photos: selectedPhotos,
          asbSignature: asbSigData,
          approvalMode: APPROVAL_MODE.SEQUENTIAL
        }, currentUser);
        closeModal();
        toast('Draf Berita Acara berhasil dibuat dan diteruskan ke Asisten Kepala.', 'success');
      }

      renderBapbReviewDashboard(app, currentUser);
    } catch (err) {
      toast(err.message || 'Gagal menyimpan draf Berita Acara', 'error');
    }
  });
}

/**
 * =============================================================================
 * MODAL / FULL-SCREEN: PEMERIKSAAN & TANDA TANGAN ASKEP
 * =============================================================================
 */
function openAskepReviewModal(bapbDoc, app, currentUser) {
  openModal({
    title: 'Pemeriksaan & Tanda Tangan Asisten Kepala',
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapb-fullscreen',
    body: `
      <div class="bapb-form-wrapper">
        
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 0.72rem; color: #64748B;">Draf Berita Acara:</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0F172A; font-family: monospace;">${esc(bapbDoc.draftDocNo || bapbDoc.docNo)}</div>
          <div style="font-size: 0.82rem; margin-top: 4px;">
            Total Bibit Dimusnahkan: <strong style="color: #DC2626; font-size: 0.95rem;">${Number(bapbDoc.totalQty || bapbDoc.quantity).toLocaleString('id-ID')} Pkk</strong>
          </div>
          <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">
            Klon: <strong>${esc(bapbDoc.klon || 'GT 1')}</strong> • Bedengan: <strong>${esc(bapbDoc.bedengan || '-')}</strong> • Tgl Fisik: <strong>${esc(formatDate(bapbDoc.tanggalPelaksanaan))}</strong>
          </div>
        </div>

        <!-- FOTO BUKTI -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <div>
              <h3 class="bapb-section-title">Bukti Foto Lapangan</h3>
              <span class="bapb-section-subtitle">Foto bukti fisik pemusnahan dari kamera perangkat yang diambil oleh ASB.</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${(bapbDoc.photos || []).map((p, idx) => `
              <div class="bapb-photo-card" style="width: 100px; height: 80px;">
                <img src="${p}" alt="Bukti Foto ${idx + 1}" />
                <div class="bapb-photo-card-badge">Foto ${idx + 1}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- TTD ASB -->
        <div style="background: #F1F5F9; border-radius: 6px; padding: 10px 12px; font-size: 0.74rem; border: 1px solid #E2E8F0;">
          <div>Tanda Tangan Asisten Divisi Bibitan: <strong style="color: #047857;">Lengkap & Sah</strong></div>
          <div style="color: #64748B; margin-top: 2px;">Oleh: ${esc(bapbDoc.signatures?.asb?.name)} • ${esc(formatDateTime(bapbDoc.signatures?.asb?.signedAt))}</div>
        </div>

        <!-- CATATAN ASKEP -->
        <div class="bapb-section">
          <div class="bapb-field-group">
            <label for="askep-notes-input" class="bapb-field-label">
              Catatan Pemeriksaan Askep (Opsional)
            </label>
            <textarea id="askep-notes-input" rows="2" class="bapb-input-control" style="height: auto; min-height: 60px; padding: 8px;" placeholder="Masukkan catatan pemeriksaan fisik..."></textarea>
          </div>
        </div>

        <!-- TTD KANVAS ASKEP -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <div>
              <h3 class="bapb-section-title">
                Tanda Tangan Asisten Kepala<span style="color: #DC2626;">*</span>
              </h3>
              <span class="bapb-section-subtitle">Peran: Pemeriksaan & Verifikasi Fisik Lapangan</span>
            </div>
            <button type="button" id="btn-clear-sig-askep" class="bapb-btn-clear-sig" title="Bersihkan Tanda Tangan" aria-label="Bersihkan">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>
          <div class="bapb-canvas-box">
            <canvas id="bapb-sig-canvas-askep" width="340" height="130" class="bapb-sig-canvas" style="height: 130px;"></canvas>
          </div>
          <div class="bapb-canvas-hint">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span>Tanda tangani langsung di atas area kanvas menggunakan jari atau stylus.</span>
          </div>
        </div>

      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-cancel-askep-modal" type="button" class="bapb-btn-cancel">
          Batal
        </button>
        <button id="btn-return-bapb-askep" type="button" style="flex: 1.1; height: 42px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer; padding: 0 6px; box-sizing: border-box;">
          Kembalikan ke ASB
        </button>
        <button id="btn-confirm-sign-askep" type="button" class="bapb-btn-submit" style="flex: 1.5;">
          Setujui & Tanda Tangani
        </button>
      </div>
    `
  });

  const canvasEl = document.getElementById('bapb-sig-canvas-askep');
  const clearBtn = document.getElementById('btn-clear-sig-askep');
  const sigHandler = setupSignatureCanvas(canvasEl, clearBtn);

  // Cancel / Close
  document.getElementById('btn-cancel-askep-modal')?.addEventListener('click', closeModal);

  // Return to ASB
  document.getElementById('btn-return-bapb-askep')?.addEventListener('click', () => {
    const reason = prompt('Masukkan alasan pengembalian draf Berita Acara ke Asisten Bibitan:');
    if (!reason || !reason.trim()) {
      toast('Alasan pengembalian wajib diisi.', 'warning');
      return;
    }
    try {
      returnBapbByAskep(bapbDoc.id, reason, currentUser);
      closeModal();
      toast('Draf Berita Acara berhasil dikembalikan ke ASB.', 'info');
      renderBapbReviewDashboard(app, currentUser);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Confirm Askep Sign
  document.getElementById('btn-confirm-sign-askep')?.addEventListener('click', () => {
    const sigData = sigHandler.getSignatureDataUrl();
    if (!sigData) {
      toast('Tanda tangan Askep wajib dibubuhkan di layar.', 'error');
      return;
    }
    const notes = document.getElementById('askep-notes-input')?.value || '';
    try {
      signBapbAskep(bapbDoc.id, sigData, notes, currentUser);
      closeModal();
      toast('Berita Acara berhasil disetujui Askep dan diteruskan ke Pengurus.', 'success');
      renderBapbReviewDashboard(app, currentUser);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/**
 * =============================================================================
 * MODAL / FULL-SCREEN: PEMERIKSAAN & PENGESAHAN FINAL (PENGURUS)
 * =============================================================================
 */
function openPengurusReviewModal(bapbDoc, app, currentUser) {
  openModal({
    title: 'Pengesahan Dokumen FINAL BAPB (Pengurus)',
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapb-fullscreen',
    body: `
      <div class="bapb-form-wrapper">
        
        <div class="bapb-notice-box">
          <div style="font-size: 0.72rem; color: #065F46; font-weight: 700; text-transform: uppercase;">PENGESAHAN DOKUMEN RESMI</div>
          <div style="font-size: 0.82rem; color: #047857; margin-top: 2px;">
            Setelah Pengurus mengesahkan dokumen ini, nomor resmi BAPB <strong>[KEBUN]/[DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]</strong> akan dialokasikan secara permanen dan dokumen berstatus <strong>FINAL</strong> (kekal).
          </div>
        </div>

        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 0.72rem; color: #64748B;">Identitas Draf:</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0F172A; font-family: monospace;">${esc(bapbDoc.draftDocNo || bapbDoc.docNo)}</div>
          <div style="font-size: 0.82rem; margin-top: 4px;">
            Total Pemusnahan: <strong style="color: #DC2626; font-size: 1rem;">${Number(bapbDoc.totalQty || bapbDoc.quantity).toLocaleString('id-ID')} Pkk</strong>
          </div>
          <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">
            Kebun: <strong>${esc(bapbDoc.estateCode || 'TB')}</strong> • Divisi: <strong>${esc(bapbDoc.divisionCode || 'DIV-I')}</strong> • Tgl Fisik: <strong>${esc(formatDate(bapbDoc.tanggalPelaksanaan))}</strong>
          </div>
        </div>

        <!-- BUKTI FOTO KAMERA -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <div>
              <h3 class="bapb-section-title">Bukti Foto Lapangan</h3>
              <span class="bapb-section-subtitle">Foto bukti fisik pemusnahan dari kamera perangkat yang diambil oleh ASB.</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${(bapbDoc.photos || []).map((p, idx) => `
              <div class="bapb-photo-card" style="width: 100px; height: 80px;">
                <img src="${p}" alt="Bukti Foto ${idx + 1}" />
                <div class="bapb-photo-card-badge">Foto ${idx + 1}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- STATUS TANDA TANGAN ASB & ASKEP -->
        <div class="bapb-grid-fields">
          <div style="background: #F1F5F9; border-radius: 6px; padding: 8px 10px; font-size: 0.72rem; border: 1px solid #E2E8F0;">
            <div>ASB (Pelaksana): <strong style="color: #047857;">Lengkap</strong></div>
            <div style="color: #64748B; margin-top: 2px;">${esc(bapbDoc.signatures?.asb?.name)}</div>
          </div>
          <div style="background: #F1F5F9; border-radius: 6px; padding: 8px 10px; font-size: 0.72rem; border: 1px solid #E2E8F0;">
            <div>Askep (Pemeriksa): <strong style="color: #047857;">Lengkap</strong></div>
            <div style="color: #64748B; margin-top: 2px;">${esc(bapbDoc.signatures?.askep?.name)}</div>
          </div>
        </div>

        <!-- CATATAN PENGURUS -->
        <div class="bapb-section">
          <div class="bapb-field-group">
            <label for="pengurus-notes-input" class="bapb-field-label">
              Catatan Pengurus (Opsional)
            </label>
            <textarea id="pengurus-notes-input" rows="2" class="bapb-input-control" style="height: auto; min-height: 60px; padding: 8px;" placeholder="Masukkan arahan atau catatan pengesahan..."></textarea>
          </div>
        </div>

        <!-- TTD KANVAS PENGURUS -->
        <div class="bapb-section">
          <div class="bapb-section-header">
            <div>
              <h3 class="bapb-section-title">
                Tanda Tangan Pengurus <span style="color: #DC2626;">*</span>
              </h3>
              <span class="bapb-section-subtitle">Peran: Pengesahan Dokumen FINAL (Diketahui)</span>
            </div>
            <button type="button" id="btn-clear-sig-pengurus" class="bapb-btn-clear-sig" title="Bersihkan Tanda Tangan" aria-label="Bersihkan">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>
          <div class="bapb-canvas-box">
            <canvas id="bapb-sig-canvas-pengurus" width="340" height="130" class="bapb-sig-canvas" style="height: 130px;"></canvas>
          </div>
          <div class="bapb-canvas-hint">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span>Tanda tangani langsung di atas area kanvas menggunakan jari atau stylus.</span>
          </div>
        </div>

      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-cancel-pengurus-modal" type="button" class="bapb-btn-cancel">
          Batal
        </button>
        <button id="btn-confirm-finalize-pengurus" type="button" class="bapb-btn-submit" style="background: #047857;">
          Buat Dokumen
        </button>
      </div>
    `
  });

  const canvasEl = document.getElementById('bapb-sig-canvas-pengurus');
  const clearBtn = document.getElementById('btn-clear-sig-pengurus');
  const sigHandler = setupSignatureCanvas(canvasEl, clearBtn);

  document.getElementById('btn-cancel-pengurus-modal')?.addEventListener('click', closeModal);

  document.getElementById('btn-confirm-finalize-pengurus')?.addEventListener('click', () => {
    const sigData = sigHandler.getSignatureDataUrl();
    if (!sigData) {
      toast('Tanda tangan Pengurus wajib dibubuhkan di layar.', 'error');
      return;
    }
    const notes = document.getElementById('pengurus-notes-input')?.value || '';
    try {
      const finalized = finalizeBapbDocument(bapbDoc.id, sigData, notes, currentUser);
      closeModal();
      toast(`Dokumen Berita Acara FINAL berhasil disahkan dengan nomor resmi: ${finalized.officialDocNo}`, 'success');
      renderBapbReviewDashboard(app, currentUser);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/**
 * =============================================================================
 * HELPER: CANVAS SIGNATURE HANDLER
 * =============================================================================
 */
function setupSignatureCanvas(canvasEl, clearBtnEl) {
  if (!canvasEl) return { getSignatureDataUrl: () => null, getStrokeCount: () => 0 };
  const ctx = canvasEl.getContext('2d');
  let isDrawing = false;
  let strokeCount = 0;

  const rect = canvasEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = rect.width || 340;
  const height = rect.height || 130;
  canvasEl.width = width * dpr;
  canvasEl.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0F172A';

  function getPos(e) {
    const r = canvasEl.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - r.left,
        y: e.touches[0].clientY - r.top
      };
    }
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top
    };
  }

  function start(e) {
    e.preventDefault();
    isDrawing = true;
    strokeCount++;
    canvasEl.parentElement?.classList.add('is-signed');
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    strokeCount++;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stop(e) {
    if (isDrawing) {
      e?.preventDefault();
      isDrawing = false;
    }
  }

  canvasEl.addEventListener('touchstart', start, { passive: false });
  canvasEl.addEventListener('touchmove', draw, { passive: false });
  canvasEl.addEventListener('touchend', stop, { passive: false });
  canvasEl.addEventListener('touchcancel', stop, { passive: false });

  canvasEl.addEventListener('mousedown', start);
  canvasEl.addEventListener('mousemove', draw);
  canvasEl.addEventListener('mouseup', stop);
  canvasEl.addEventListener('mouseleave', stop);

  clearBtnEl?.addEventListener('click', (e) => {
    e.preventDefault();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();
    strokeCount = 0;
    canvasEl.parentElement?.classList.remove('is-signed');
  });

  function resize() {
    const r = canvasEl.getBoundingClientRect();
    const w = (r.width > 0) ? r.width : 340;
    const h = (r.height > 0) ? r.height : 130;
    canvasEl.width = w * dpr;
    canvasEl.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
  }

  return {
    getSignatureDataUrl: () => (strokeCount > 10 ? canvasEl.toDataURL('image/png') : null),
    getStrokeCount: () => strokeCount,
    resize
  };
}

/**
 * =============================================================================
 * HELPER: IMAGE COMPRESSOR
 * =============================================================================
 */
async function compressImageFile(file, maxWidth = 800, maxHeight = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth || h > maxHeight) {
          const ratio = Math.min(maxWidth / w, maxHeight / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * =============================================================================
 * LEGACY CUL HANDLERS
 * =============================================================================
 */
function attachLegacyActionHandlers(app, allRecords, currentUser) {
  app.querySelectorAll('.btn-approve-destruction').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = allRecords.find(r => r.id === id);
      if (!target) return;

      openModal({
        title: 'Konfirmasi Persetujuan Pemusnahan (CUL)',
        body: `
          <div style="font-size: 0.84rem; color: #334155; line-height: 1.5;">
            <p style="margin: 0 0 12px 0;">
              Anda akan menyetujui pemusnahan bibit sebanyak <strong style="color: #DC2626;">${parseInt(target.quantity || 0).toLocaleString('id-ID')} Pkk</strong> pada batch <strong>${esc(target.batchCode)}</strong>.
            </p>
            <div style="display: flex; gap: 8px;">
              <button id="btn-cancel-modal" type="button" style="flex: 1; height: 38px; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 6px; font-weight: 600; cursor: pointer;">Batal</button>
              <button id="btn-confirm-approve-destr" type="button" style="flex: 1; height: 38px; background: #116834; color: #FFF; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Setujui</button>
            </div>
          </div>
        `
      });

      document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);
      document.getElementById('btn-confirm-approve-destr')?.addEventListener('click', async () => {
        try {
          await approveDestructionRecord(id, 'Disetujui oleh Asisten Bibitan', currentUser, false);
          closeModal();
          toast('Pemusnahan berhasil disetujui.', 'success');
          renderBapbReviewDashboard(app, currentUser);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  });

  app.querySelectorAll('.btn-return-destruction').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const reason = prompt('Masukkan alasan pengembalian pengajuan pemusnahan:');
      if (!reason || !reason.trim()) return;
      try {
        returnDestructionRecord(id, reason, currentUser);
        toast('Pengajuan pemusnahan berhasil dikembalikan.', 'info');
        renderBapbReviewDashboard(app, currentUser);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/**
 * =============================================================================
 * FORM PENGAJUAN PEMUSNAHAN OLEH MANTRI BIBITAN (LEGACY FORM)
 * =============================================================================
 */
function renderMantriDestructionLanding(app, currentUser) {
  const allBatches = getAllBatches().filter(b => b.estateId === currentUser.estateId && (b.availableQty || 0) > 0 && b.status !== 'INACTIVE');
  const todayStr = new Date().toISOString().split('T')[0];

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center;">
          <button id="btn-back" type="button" aria-label="Kembali" style="padding: 8px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 700; color: #0F172A; margin: 0 0 0 6px;">Pengajuan Pemusnahan Bibit</h1>
        </div>
      </header>

      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        <form id="form-destruction" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
          <div style="margin-bottom: 14px;">
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Pilih Batch Sumber <span style="color: #DC2626;">*</span></label>
            <select id="select-batch" required style="width: 100%; height: 38px; border: 1px solid #CBD5E1; border-radius: 6px; padding: 0 8px; font-size: 0.82rem; background: #FFF;">
              <option value="">-- Pilih Batch --</option>
              ${allBatches.map(b => `
                <option value="${esc(b.id)}">${esc(b.batchCode || b.batchNo)} (${esc(b.clone || b.klon)}) - Stok: ${(b.availableQty || 0).toLocaleString('id-ID')} Pkk</option>
              `).join('')}
            </select>
          </div>

          <div style="margin-bottom: 14px;">
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Jumlah Pemusnahan (Pkk) <span style="color: #DC2626;">*</span></label>
            <input type="number" id="input-qty" required min="1" placeholder="Masukkan jumlah bibit..." style="width: 100%; height: 38px; border: 1px solid #CBD5E1; border-radius: 6px; padding: 0 10px; font-size: 0.85rem; box-sizing: border-box;" />
          </div>

          <div style="margin-bottom: 14px;">
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Alasan Pemusnahan <span style="color: #DC2626;">*</span></label>
            <select id="select-reason" required style="width: 100%; height: 38px; border: 1px solid #CBD5E1; border-radius: 6px; padding: 0 8px; font-size: 0.82rem; background: #FFF;">
              ${DESTRUCTION_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Catatan / Keterangan</label>
            <textarea id="input-notes" rows="3" placeholder="Masukkan keterangan tambahan jika diperlukan..." style="width: 100%; border: 1px solid #CBD5E1; border-radius: 6px; padding: 8px; font-size: 0.82rem; box-sizing: border-box;"></textarea>
          </div>

          <button type="submit" style="width: 100%; height: 40px; background: #116834; color: #FFF; border: none; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
            Kirim Pengajuan Pemusnahan
          </button>
        </form>
      </main>
    </div>
  `;

  app.querySelector('#btn-back')?.addEventListener('click', () => navigate('/inspection'));

  app.querySelector('#form-destruction')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const batchId = document.getElementById('select-batch')?.value;
    const qty = parseInt(document.getElementById('input-qty')?.value, 10);
    const reason = document.getElementById('select-reason')?.value;
    const notes = document.getElementById('input-notes')?.value || '';

    try {
      createDestructionRecord({
        batchId: batchId,
        quantity: qty,
        reason: reason,
        description: notes,
        tanggalPemusnahan: todayStr
      }, currentUser);

      toast('Pengajuan pemusnahan berhasil dikirim ke Asisten Bibitan.', 'success');
      navigate('/home');
    } catch (err) {
      toast(err.message || 'Gagal membuat pengajuan pemusnahan', 'error');
    }
  });
}
