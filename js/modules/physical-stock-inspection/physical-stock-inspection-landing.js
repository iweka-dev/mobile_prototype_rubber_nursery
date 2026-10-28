import { navigate } from '../../core/router.js';
import { session } from '../../core/session.js';
import { esc, formatDateTime, formatDate } from '../../core/utils.js';
import { toast } from '../../components/toast.js';
import { renderAsbBottomNav, attachAsbBottomNavEvents } from '../../components/bottom-nav-asb.js';
import { normalizeRole, ROLES } from '../../core/user-context.js';
import { openModal, closeModal } from '../../components/modal.js';
import {
  PHYSICAL_STOCK_STATUS,
  getEligiblePhysicalStockBatches,
  getPhysicalStockInspections,
  startPhysicalStockInspection,
  finalizePhysicalStockInspectionWithEvidence,
  restartPhysicalStockInspection,
  startPhysicalStockCorrection,
  cancelPhysicalStockDraft,
  submitPhysicalStockShortageForVerification,
  isPhysicalStockInspectionStale,
  getSeedlingAgeFromGermination
} from './physical-stock-inspection-manager.js';

import {
  BAPSB_STATUS,
  BAPSB_STATUS_LABELS,
  createBapsbDraft,
  signBapsbAskep,
  finalizeBapsbPengurus,
  getBapsbById,
  getBapsbByInspectionId,
  collectAuditTrailForInspection,
  getBapsbCollection
} from './physical-stock-bapsb-service.js';
import {
  openBapsbPreviewModal,
  openBapsbPrintPreviewModal,
  printBapsbDocument,
  setupSignatureCanvas
} from './bapsb-print-template.js';
import { renderBatchTransactionHistoryView } from './batch-transaction-history-view.js';

const STATUS_LABEL = Object.freeze({
  BELUM_DIPERIKSA: 'Belum diperiksa',
  COUNTING: 'Sedang dihitung',
  RECOUNT_REQUIRED: 'Perlu hitung ulang',
  MATCHED: 'Sesuai',
  SURPLUS: 'Selisih lebih',
  SHORTAGE_OPEN: 'Selisih kurang',
  SHORTAGE_PENDING_VERIFICATION: 'Menunggu verifikasi afkir',
  SHORTAGE_VERIFIED: 'Afkir terverifikasi',
  CORRECTED: 'Dikoreksi',
  KOREKSI_BERLANGSUNG: 'Koreksi berlangsung',
  STOCK_CHANGED: 'Stok berubah'
});

let lastStockSyncAt = null;

function latestMap(inspections) {
  const result = new Map();
  const byBatch = new Map();
  inspections.forEach(item => {
    const list = byBatch.get(item.batchId) || [];
    list.push(item);
    byBatch.set(item.batchId, list);
  });

  byBatch.forEach((items, batchId) => {
    // A correction draft remains the visible state until it is locked or cancelled.
    const activeCorrection = items
      .filter(item => item.correctionOf && [PHYSICAL_STOCK_STATUS.COUNTING, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(item.status))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    if (activeCorrection) {
      result.set(batchId, activeCorrection);
      return;
    }

    // Once a correction is locked, its completed result replaces the superseded
    // record on the Batch card while the original remains in the audit history.
    const effectiveItems = items.filter(item => item.status !== PHYSICAL_STOCK_STATUS.CORRECTED);
    effectiveItems.sort((a, b) => {
      const aDate = a.completedAt || a.createdAt || '';
      const bDate = b.completedAt || b.createdAt || '';
      return String(bDate).localeCompare(String(aDate));
    });
    if (effectiveItems[0]) result.set(batchId, effectiveItems[0]);
  });
  return result;
}

function badge(status) {
  const colors = {
    MATCHED: ['#ECFDF5', '#047857', '#A7F3D0'], // Sesuai
    SURPLUS: ['#FEF3C7', '#B45309', '#FDE68A'], // Selisih lebih
    SHORTAGE_OPEN: ['#FEF2F2', '#DC2626', '#FECACA'],
    SHORTAGE_PENDING_VERIFICATION: ['#FEF3C7', '#B45309', '#FDE68A'],
    SHORTAGE_VERIFIED: ['#EFF6FF', '#1D4ED8', '#BFDBFE'],
    COUNTING: ['#EFF6FF', '#1D4ED8', '#BFDBFE'],
    RECOUNT_REQUIRED: ['#FEF2F2', '#DC2626', '#FECACA'],
    KOREKSI_BERLANGSUNG: ['#FEF3C7', '#B45309', '#FDE68A'],
    CORRECTED: ['#F1F5F9', '#64748B', '#CBD5E1'],
    STOCK_CHANGED: ['#FEF2F2', '#DC2626', '#FECACA']
  };
  const pair = colors[status] || ['#F1F5F9', '#475569', '#E2E8F0'];
  return `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: ${pair[0]}; color: ${pair[1]}; border: 1px solid ${pair[2]}; white-space: nowrap;">${STATUS_LABEL[status] || status}</span>`;
}

function resultHtml(item, bapsb = null, auditTrail = []) {
  if (!item || [PHYSICAL_STOCK_STATUS.COUNTING, PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED].includes(item.status)) return '';
  const diff = Number(item.difference || 0);

  const surplusPill = bapsb ? `
    <div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:#FFFBEB;border:1px solid #FCD34D;display:flex;justify-content:space-between;align-items:center;font-size:.72rem">
      <span style="color:#92400E;font-weight:700">Stok Lebih Tersendiri:</span>
      <strong style="color:#B45309;font-size:.8rem">+${Number(bapsb.surplusQty).toLocaleString('id-ID')} Pkk</strong>
    </div>
  ` : '';

  const historyExpand = auditTrail.length > 1 ? `
    <div style="margin-top:8px;border-top:1px dashed #CBD5E1;padding-top:6px">
      <button class="psi-toggle-history" data-target="history-${esc(item.id)}" type="button" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:6px 8px;border:1px solid #E2E8F0;background:#FFFFFF;border-radius:6px;color:#047857;font-size:.72rem;font-weight:700;cursor:pointer">
        <span style="display:flex;align-items:center;gap:5px">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          Riwayat Pemeriksaan (${auditTrail.length}x)
        </span>
        <svg class="psi-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s ease"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div id="history-${esc(item.id)}" class="psi-history-collapse" style="display:none;margin-top:6px;padding-top:2px">
        <div style="display:flex;flex-direction:column;gap:5px">
          ${auditTrail.map(h => `
            <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;padding:6px 8px;font-size:.7rem">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong style="color:#0F172A">#${h.round} (${esc(h.docNo)})</strong>
                <span style="color:#64748B;font-size:.64rem">${h.completedAt ? formatDateTime(h.completedAt) : '-'}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:3px">
                <span style="color:#475569">Hasil Fisik: <strong style="color:#0F172A">${Number(h.physicalQty).toLocaleString('id-ID')} Pkk</strong></span>
                <span style="color:#475569">Selisih: <strong style="color:${h.difference > 0 ? '#059669' : (h.difference < 0 ? '#BE123C' : '#475569')}">${h.difference > 0 ? '+' : ''}${Number(h.difference).toLocaleString('id-ID')} Pkk</strong></span>
              </div>
              <div style="color:#64748B;font-size:.64rem;margin-top:2px;border-top:1px dashed #F1F5F9;padding-top:2px">
                Petugas: <strong>${esc(h.completedByName || 'Asisten Bibitan')}</strong>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  ` : '';

  return `<div style="margin-top:7px;padding:8px;background:#F8FAFC;border-radius:8px;font-size:.76rem;color:#334155">
    <div style="display:flex;justify-content:space-between"><span>Stok sistem saat dikunci</span><strong>${Number(item.systemQtySnapshot).toLocaleString('id-ID')} Pkk</strong></div>
    <div style="display:flex;justify-content:space-between;margin-top:5px"><span>Hasil fisik</span><strong>${Number(item.physicalQty).toLocaleString('id-ID')} Pkk</strong></div>
    <div style="display:flex;justify-content:space-between;margin-top:5px"><span>Selisih</span><strong>${diff > 0 ? '+' : ''}${diff.toLocaleString('id-ID')} Pkk</strong></div>
    ${surplusPill}
    ${historyExpand}
  </div>`;
}

function cardHtml(batch, current, currentUser) {
  const key = batch.id || batch.batchId || batch.batchCode;
  const hasLockedCount = Array.isArray(current?.counts) && current.counts.length > 0;
  const status = isPhysicalStockInspectionStale(current)
    ? PHYSICAL_STOCK_STATUS.STOCK_CHANGED
    : current?.status === PHYSICAL_STOCK_STATUS.COUNTING && !hasLockedCount
      ? (current.correctionOf ? 'KOREKSI_BERLANGSUNG' : 'BELUM_DIPERIKSA')
      : (current?.status || 'BELUM_DIPERIKSA');

  const role = normalizeRole(currentUser?.role || currentUser?.rawRole);
  const isAsb = role === ROLES.ASISTEN_BIBITAN;
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  const isPengurus = role === ROLES.PENGURUS;

  const bapsb = (current?.id && status === PHYSICAL_STOCK_STATUS.SURPLUS) ? getBapsbByInspectionId(current.id) : null;
  const auditTrail = current?.id ? collectAuditTrailForInspection(current.id) : [];

  let badgeHtml = badge(status);
  if (bapsb) {
    if (bapsb.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP) {
      badgeHtml = '<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A; white-space: nowrap;">MENUNGGU ASKEP</span>';
    } else if (bapsb.status === BAPSB_STATUS.MENUNGGU_PENGURUS) {
      badgeHtml = '<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; white-space: nowrap;">MENUNGGU PENGURUS</span>';
    } else if (bapsb.status === BAPSB_STATUS.FINAL) {
      badgeHtml = '<span style="font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; white-space: nowrap;">Disetujui</span>';
    } else if (bapsb.status === BAPSB_STATUS.RETURNED_TO_ASB) {
      badgeHtml = '<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; white-space: nowrap;">DIKEMBALIKAN KE ASB</span>';
    }
  }

  const buttonStyle = 'flex:1;border:0;border-radius:8px;color:white;padding:9px 8px;font-size:.78rem;line-height:1.2;font-weight:800;min-height:38px;display:inline-flex;align-items:center;justify-content:center;text-align:center;box-sizing:border-box;text-decoration:none;cursor:pointer';
  let action = `<button class="psi-start" data-batch="${esc(key)}" style="${buttonStyle};background:#116834">${status === 'BELUM_DIPERIKSA' ? 'Mulai Pemeriksaan' : 'Periksa Kembali'}</button>`;
  
  if (status === PHYSICAL_STOCK_STATUS.COUNTING) action = `<button class="psi-open" data-id="${esc(current.id)}" style="${buttonStyle};background:#116834">Lanjutkan Hitung</button>`;
  if (status === 'KOREKSI_BERLANGSUNG') action = `<button class="psi-open" data-id="${esc(current.id)}" style="${buttonStyle};background:#B45309">Lanjutkan Hitung</button>`;
  if (status === PHYSICAL_STOCK_STATUS.RECOUNT_REQUIRED) action = `<button class="psi-recount" data-id="${esc(current.id)}" style="${buttonStyle};background:#BE123C">Hitung Ulang</button>`;
  
  if (status === PHYSICAL_STOCK_STATUS.MATCHED) {
    action = `<button class="psi-correct" data-id="${esc(current.id)}" style="${buttonStyle};background:#FFFFFF;color:#116834;border:1.5px solid #116834">Periksa Kembali</button>`;
  }

  if (status === PHYSICAL_STOCK_STATUS.SURPLUS) {
    if (!bapsb) {
      if (isAsb) {
        action = `<button class="psi-correct" data-id="${esc(current.id)}" style="${buttonStyle};background:#FFFFFF;color:#116834;border:1.5px solid #116834">Periksa Kembali</button><button class="psi-create-bapsb" data-id="${esc(current.id)}" style="${buttonStyle};background:#116834">Buat BA</button>`;
      } else {
        action = `<span style="font-size:0.72rem;color:#64748B;font-weight:600;padding:6px 0;width:100%;text-align:center">Menunggu penerbitan BA oleh Asisten</span>`;
      }
    } else {
      if (isAskep && bapsb.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP) {
        action = `<button class="psi-review-bapsb" data-bapsb="${esc(bapsb.id)}" style="${buttonStyle};background:#116834">Tinjau & Setujui BA</button>`;
      } else if (isPengurus && bapsb.status === BAPSB_STATUS.MENUNGGU_PENGURUS) {
        action = `<button class="psi-review-bapsb" data-bapsb="${esc(bapsb.id)}" style="${buttonStyle};background:#116834">Tinjau & Sahkan BA</button>`;
      } else if (bapsb.status === BAPSB_STATUS.FINAL) {
        action = `<button type="button" class="psi-view-bapsb btn-print-bapb" data-bapsb="${esc(bapsb.id)}" style="${buttonStyle};background:#116834;display:inline-flex;align-items:center;justify-content:center;gap:6px">
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
          </svg>
          <span>Lihat & Cetak BA</span>
        </button>`;
      } else if (bapsb.status === BAPSB_STATUS.RETURNED_TO_ASB && isAsb) {
        action = `<button class="psi-correct" data-id="${esc(current.id)}" style="${buttonStyle};background:#FFFFFF;color:#116834;border:1.5px solid #116834">Periksa Kembali</button><button class="psi-view-bapsb" data-bapsb="${esc(bapsb.id)}" style="${buttonStyle};background:#B45309">Lihat BA Dikembalikan</button>`;
      } else {
        action = `<button type="button" class="psi-view-bapsb" data-bapsb="${esc(bapsb.id)}" style="${buttonStyle};background:#116834;display:inline-flex;align-items:center;justify-content:center;gap:6px">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span>Lihat Draf BA</span>
        </button>`;
      }
    }
  }

  if (status === PHYSICAL_STOCK_STATUS.SHORTAGE_OPEN) action = `<button class="psi-correct" data-id="${esc(current.id)}" style="${buttonStyle};background:#FFFFFF;color:#B45309;border:1.5px solid #B45309">Periksa Kembali</button><button class="psi-verify" data-id="${esc(current.id)}" style="${buttonStyle};background:#B45309">Ajukan sebagai Afkir</button>`;
  if (status === PHYSICAL_STOCK_STATUS.SHORTAGE_PENDING_VERIFICATION) action = `<button class="psi-open-verification" type="button" style="${buttonStyle};background:#116834">Buka Verifikasi</button>`;

  const cullNotice = status === PHYSICAL_STOCK_STATUS.SHORTAGE_PENDING_VERIFICATION
    ? `<div style="margin-top:7px;padding:7px 8px;border-radius:8px;background:#FFFBEB;color:#92400E;font-size:.7rem;line-height:1.4">Dokumen <strong>${esc(current.selectionDocNo || '-')}</strong> menunggu persetujuan di Verifikasi Penyeleksian. Stok sistem belum dikurangi.</div>`
    : current?.cullSubmissionStatus === 'RETURNED'
      ? `<div style="margin-top:7px;padding:7px 8px;border-radius:8px;background:#FFF1F2;color:#9F1239;font-size:.7rem;line-height:1.4">Pengajuan afkir dikembalikan${current.cullReturnReason ? `: ${esc(current.cullReturnReason)}` : '.'}</div>`
      : '';

  const ageInfo = getSeedlingAgeFromGermination(batch);
  const ageHtml = ageInfo && ageInfo.formatted && ageInfo.formatted !== '-'
    ? `<div style="font-size:.72rem;color:#475569;margin-top:4px">Umur Bibit: <strong style="color:#0F172A">${ageInfo.weeks > 0 ? `${ageInfo.weeks} Minggu` : `${ageInfo.days} Hari`}</strong>${ageInfo.weeks > 0 ? ` <span style="font-size:.68rem;color:#64748B">(${ageInfo.days} Hari)</span>` : ''}</div>`
    : '';

  return `<section style="background:white;border:1px solid #E2E8F0;border-radius:11px;padding:10px 12px;box-shadow:0 1px 4px rgba(15,23,42,.05)">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div>
        <strong style="color:#0F172A;font-size:.9rem">${esc(batch.batchCode || batch.batchNo || batch.kode || key)}</strong>
        <div style="font-size:.7rem;color:#64748B;margin-top:2px">${esc(batch.programCode || batch.programName || 'Program Bibitan')}</div>
        ${ageHtml}
      </div>${badgeHtml}
    </div>${resultHtml(current, bapsb, auditTrail)}${cullNotice}${status === PHYSICAL_STOCK_STATUS.STOCK_CHANGED ? '<div style="margin-top:7px;padding:7px 8px;border-radius:8px;background:#FFF1F2;color:#9F1239;font-size:.7rem;line-height:1.4">Saldo sistem berubah setelah pemeriksaan ini. Lakukan pemeriksaan ulang untuk memperbarui hasil.</div>' : ''}<div style="display:flex;gap:8px;width:100%;margin-top:10px">${action}</div>
  </section>`;
}


function openAuditHistoryModal(inspectionId) {
  const auditTrail = collectAuditTrailForInspection(inspectionId);
  if (!auditTrail || auditTrail.length === 0) return;

  openModal({
    title: 'Riwayat Pemeriksaan Fisik',
    body: `
      <div style="font-size:0.75rem;color:#64748B;margin-bottom:12px">Seluruh putaran penghitungan tersimpan permanen di rekam jejak audit tanpa ada data yang hilang.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${auditTrail.map(item => `
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px;padding:9px 11px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:800;color:#0F172A;font-size:.8rem">Pemeriksaan #${item.round} (${esc(item.docNo)})</span>
              <span style="font-size:.68rem;color:#64748B">${item.completedAt ? formatDateTime(item.completedAt) : '-'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-top:2px">
              <span>Hasil Fisik: <strong style="color:#0F172A">${Number(item.physicalQty).toLocaleString('id-ID')} Pkk</strong></span>
              <span>Selisih: <strong style="color:${item.difference > 0 ? '#059669' : (item.difference < 0 ? '#BE123C' : '#475569')}">${item.difference > 0 ? '+' : ''}${Number(item.difference).toLocaleString('id-ID')} Pkk</strong></span>
            </div>
            <div style="font-size:.7rem;color:#64748B;margin-top:4px;border-top:1px dashed #E2E8F0;padding-top:4px">
              Petugas: <strong>${esc(item.completedByName || 'Asisten Bibitan')}</strong>
            </div>
          </div>
        `).join('')}
      </div>
    `,
    footer: `
      <button id="btn-close-audit-history" type="button" style="width:100%;padding:10px;border:1px solid #CBD5E1;background:#FFFFFF;border-radius:8px;font-weight:800;color:#334155">
        Tutup
      </button>
    `
  });
  document.getElementById('btn-close-audit-history')?.addEventListener('click', closeModal);
}

function openCreateBapsbModal(inspection, currentUser, onCreated) {
  const diff = Number(inspection.difference || 0);
  const auditTrail = collectAuditTrailForInspection(inspection.id);
  const totalRounds = auditTrail.length || 1;

  openModal({
    title: 'Buat Berita Acara Selisih Lebih',
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapsb-fullscreen',
    body: `
      <div style="max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:12px">
        <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;font-size:.74rem;line-height:1.5;color:#92400E">
          Berita Acara ini mengesahkan temuan selisih lebih fisik (+${diff.toLocaleString('id-ID')} Pkk) sebagai <strong>stok cadangan terpisah</strong>. Saldo buku sistem tetap murni dan tidak berubah.
        </div>
        <section style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;font-size:.78rem">
          <div style="display:flex;justify-content:space-between"><span>Batch:</span><strong>${esc(inspection.batchCode || inspection.batchId)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:5px"><span>Stok Buku Sistem:</span><strong>${Number(inspection.systemQtySnapshot || 0).toLocaleString('id-ID')} Pkk</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:5px"><span>Hasil Fisik Lapangan:</span><strong>${Number(inspection.physicalQty || 0).toLocaleString('id-ID')} Pkk</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;border-top:1px solid #E2E8F0;padding-top:6px">
            <span style="color:#92400E;font-weight:700">Stok Lebih Tersendiri:</span>
            <strong style="color:#059669;font-size:.88rem">+${diff.toLocaleString('id-ID')} Pkk</strong>
          </div>
          <div style="font-size:.68rem;color:#64748B;margin-top:4px;font-style:italic">Telah melalui ${totalRounds}x putaran sensus fisik terkonfirmasi.</div>
        </section>
        <div>
          <label style="display:block;font-size:.74rem;font-weight:700;color:#334155;margin-bottom:4px">Catatan & Justifikasi Lapangan:</label>
          <textarea id="create-bapsb-notes" rows="3" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:.76rem;box-sizing:border-box;line-height:1.4">Hasil sensus fisik ulang bedengan terkonfirmasi selisih lebih. Nilai kelebihan dicatat sebagai stok cadangan fisik terpisah batch dan tidak merubah saldo buku sistem.</textarea>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <label style="font-size:.74rem;font-weight:700;color:#334155">Tanda Tangan Asisten Bibitan <span style="color:#DC2626">*</span></label>
            <button id="create-bapsb-clear-sig" type="button" title="Hapus Goresan" aria-label="Hapus Goresan" style="border:0;background:transparent;color:#64748B;padding:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:4px">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
            </button>
          </div>
          <div style="border:1.5px dashed #94A3B8;border-radius:8px;background:#FAFAFA;overflow:hidden">
            <canvas id="create-bapsb-canvas" style="display:block;width:100%;height:140px;touch-action:none"></canvas>
          </div>
          <div style="font-size:.68rem;color:#64748B;margin-top:4px">Bubuhkan tanda tangan di dalam kotak sebagai pembuat dokumen resmi.</div>
        </div>
      </div>
    `,
    footer: `
      <div style="display:flex;gap:8px;width:100%;max-width:640px;margin:0 auto">
        <button id="create-bapsb-cancel" type="button" style="flex:1;padding:11px;border:1px solid #CBD5E1;background:#FFFFFF;border-radius:8px;font-weight:800;color:#334155">Batal</button>
        <button id="create-bapsb-submit" type="button" style="flex:1.4;padding:11px;border:0;background:#116834;color:#FFFFFF;border-radius:8px;font-weight:800">Kirim ke Askep</button>
      </div>
    `
  });

  const canvas = document.getElementById('create-bapsb-canvas');
  const clearBtn = document.getElementById('create-bapsb-clear-sig');
  const sigHandler = setupSignatureCanvas(canvas, clearBtn);

  document.getElementById('create-bapsb-cancel')?.addEventListener('click', closeModal);
  document.getElementById('create-bapsb-submit')?.addEventListener('click', () => {
    const sigData = sigHandler.getSignatureDataUrl();
    if (!sigData) {
      alert('Tanda tangan digital Asisten Bibitan wajib dibubuhkan.');
      return;
    }
    const justifikasi = document.getElementById('create-bapsb-notes')?.value || '';
    try {
      const doc = createBapsbDraft(inspection.id, currentUser, { justifikasi, signatureDataUrl: sigData });
      toast.success(`Draf Berita Acara (${doc.docNo}) berhasil dikirim ke Asisten Kepala.`);
      closeModal();
      if (onCreated) onCreated(doc);
    } catch (e) {
      toast.error(e.message || 'Gagal membuat Berita Acara.');
    }
  });
}

function renderLockConfirmation(inspection, counts, photoEvidence) {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;
  const batchCode = inspection.batchCode || inspection.batchId || '-';
  const batchProgram = inspection.programCode || inspection.programName || inspection.programId || 'Program Bibitan';
  const total = counts.reduce((sum, item) => sum + Number(item.physicalQty || 0), 0);
  const rows = counts.map(item => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #E2E8F0"><span style="color:#64748B">${item.bedenganId ? `Bedengan ${esc(item.bedenganId)}` : 'Jumlah fisik Batch'}</span><strong>${Number(item.physicalQty).toLocaleString('id-ID')} Pkk</strong></div>`).join('');
  app.innerHTML = `<div class="page" style="height:100%;display:flex;flex-direction:column;background:#F8FAFC">
    <header style="display:flex;align-items:center;height:56px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;flex-shrink:0">
      <div style="display:flex;align-items:center">
        <button id="psi-confirm-back" type="button" aria-label="Kembali" style="padding:8px;margin-left:-8px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#116834">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h1 style="font-size:1.05rem;font-weight:700;color:#0F172A;margin:0 0 0 6px;letter-spacing:-0.01em">Konfirmasi Nilai Fisik</h1>
      </div>
    </header>
    <main style="flex:1;overflow:auto;padding:14px 12px"><div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:10px;font-size:.74rem;line-height:1.5;color:#92400E;margin-bottom:12px">Pastikan nilai fisik dan foto bukti sudah benar. Setelah dikunci, perubahan hanya dapat dilakukan melalui proses koreksi yang tercatat.</div><section style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px;font-size:.8rem"><div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #F1F5F9"><div><span style="font-size:0.68rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.02em">Batch Bibitan</span><div style="font-size:0.95rem;font-weight:800;color:#0F172A;margin-top:1px">${esc(batchCode)}</div></div>${batchProgram ? `<span style="font-size:0.72rem;font-weight:700;padding:4px 8px;border-radius:6px;background:#F1F5F9;color:#475569">${esc(batchProgram)}</span>` : ''}</div>${rows}<div style="display:flex;justify-content:space-between;padding:12px 0 2px;font-size:.9rem;border-top:1px solid #F1F5F9"><strong>Total fisik</strong><strong style="color:#116834">${total.toLocaleString('id-ID')} Pkk</strong></div></section><section style="margin-top:10px;background:white;border:1px solid #E2E8F0;border-radius:12px;padding:10px"><div style="font-size:.76rem;font-weight:800;margin-bottom:7px">Foto Bukti Bertimestamp</div><img src="${photoEvidence.image}" alt="Foto bukti pemeriksaan" style="display:block;width:100%;max-height:180px;object-fit:cover;border-radius:8px"><div style="font-size:.68rem;color:#64748B;margin-top:6px">${new Date(photoEvidence.capturedAt).toLocaleString('id-ID')} · ${photoEvidence.latitude ?? '-'}, ${photoEvidence.longitude ?? '-'}</div></section></main>
    <footer style="display:flex;gap:8px;padding:10px 12px 12px;background:white;border-top:1px solid #E2E8F0"><button id="psi-confirm-edit" type="button" style="flex:1;padding:11px;border:1px solid #CBD5E1;background:white;border-radius:9px;font-weight:800">Kembali</button><button id="psi-confirm-lock" type="button" style="flex:1.25;padding:11px;border:0;background:#116834;color:white;border-radius:9px;font-weight:800">Simpan Pemeriksaan</button></footer>
  </div>`;
  app.querySelector('#psi-confirm-back').onclick = () => renderCountForm(inspection);
  app.querySelector('#psi-confirm-edit').onclick = () => renderCountForm(inspection);
  app.querySelector('#psi-confirm-lock').onclick = async () => {
    const user = session.get();
    try {
      const result = await finalizePhysicalStockInspectionWithEvidence(inspection.id, counts, user, photoEvidence);
      toast.success(result.status === PHYSICAL_STOCK_STATUS.MATCHED ? 'Pemeriksaan selesai, fisik sesuai stok sistem.' : (result.difference > 0 ? 'Pemeriksaan selesai: Terdeteksi selisih lebih.' : 'Pemeriksaan selesai: Terdeteksi selisih kurang.'));
      renderPhysicalStockInspectionLanding();
    } catch (error) { toast.error(error.message); }
  };
}

function renderCountForm(inspection) {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;
  const user = session.get();
  const batchCode = inspection.batchCode || inspection.batchId || '-';
  const batchProgram = inspection.programCode || inspection.programName || inspection.programId || 'Program Bibitan';
  const bedenganList = Array.isArray(inspection.bedenganIds) && inspection.bedenganIds.length ? inspection.bedenganIds : null;
  const labels = bedenganList
    ? bedenganList.map(id => `<div style="margin-bottom:12px"><label style="display:block;font-size:.76rem;color:#334155;font-weight:700;margin-bottom:4px">Bedengan ${esc(id)}</label><input type="number" min="0" step="1" required class="psi-count-input" data-bedengan="${esc(id)}" placeholder="Masukkan jumlah fisik" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:1rem;box-sizing:border-box"></div>`).join('')
    : `<div style="margin-bottom:12px"><label style="display:block;font-size:.76rem;color:#334155;font-weight:700;margin-bottom:4px">Jumlah fisik Batch</label><input type="number" min="0" step="1" required class="psi-count-input" data-bedengan="TOTAL_BATCH" placeholder="Masukkan total fisik" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:1rem;box-sizing:border-box"></div>`;

  let photoEvidence = null;
  let mediaStream = null;

  app.innerHTML = `<div class="page" style="height:100%;display:flex;flex-direction:column;background:#F8FAFC">
    <header style="display:flex;align-items:center;height:56px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;flex-shrink:0">
      <div style="display:flex;align-items:center">
        <button id="psi-form-back" type="button" aria-label="Kembali" style="padding:8px;margin-left:-8px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#116834">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h1 style="font-size:1.05rem;font-weight:700;color:#0F172A;margin:0 0 0 6px;letter-spacing:-0.01em">Input Stok Fisik</h1>
      </div>
    </header>
    <form id="psi-count-form" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <main style="flex:1;overflow:auto;padding:14px 12px">
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:10px;font-size:.74rem;line-height:1.5;color:#065F46;margin-bottom:14px">Masukkan nilai fisik hasil penghitungan lapangan. Stok sistem akan ditampilkan jika pemeriksaan telah selesai.</div>
        <section style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid #F1F5F9">
            <div>
              <span style="font-size:0.68rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.02em">Batch Bibitan</span>
              <div style="font-size:0.95rem;font-weight:800;color:#0F172A;margin-top:1px">${esc(batchCode)}</div>
            </div>
            ${batchProgram ? `<span style="font-size:0.72rem;font-weight:700;padding:4px 8px;border-radius:6px;background:#F1F5F9;color:#475569">${esc(batchProgram)}</span>` : ''}
          </div>
          ${labels}
        </section>
        <section style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:14px;margin-top:10px">
          <div style="font-size:.8rem;font-weight:800;color:#0F172A;margin-bottom:10px">Foto Bukti Pemeriksaan <span style="color:#DC2626">*</span></div>
          <button id="psi-open-camera" type="button" style="width:100%;padding:10px;border:1.5px dashed #116834;border-radius:9px;background:#F0FDF4;color:#116834;font-weight:800">Ambil Foto Lapangan</button>
          <div id="psi-photo-preview" style="display:${photoEvidence ? 'block' : 'none'};margin-top:10px"><img src="${photoEvidence?.image || ''}" alt="Foto bukti" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px"><div id="psi-photo-meta" style="font-size:.68rem;color:#64748B;margin-top:5px">${photoEvidence ? new Date(photoEvidence.capturedAt).toLocaleString('id-ID') : ''}</div></div>
        </section>
      </main>
      <footer style="display:flex;gap:8px;padding:10px 12px 12px;background:#FFFFFF;border-top:1px solid #E2E8F0;flex-shrink:0">
        <button id="psi-form-cancel" type="button" style="flex:1;padding:11px;border:1px solid #CBD5E1;background:white;border-radius:9px;font-weight:800">Batal</button>
        <button type="submit" style="flex:1.35;padding:11px;border:0;background:#116834;color:white;border-radius:9px;font-weight:800">Lanjutkan</button>
      </footer>
    </form>
    <div id="psi-camera" style="display:none;position:absolute;inset:0;background:#000;z-index:30;flex-direction:column">
      <header style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;color:white;z-index:2"><button id="psi-close-camera" type="button" style="border:0;background:rgba(0,0,0,.45);color:white;border-radius:50%;width:38px;height:38px;font-size:1.2rem">×</button><strong style="font-size:.85rem">Foto Stok Fisik</strong><span style="width:38px"></span></header>
      <div style="position:absolute;inset:0"><video id="psi-camera-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video><canvas id="psi-camera-canvas" style="display:none"></canvas><div id="psi-camera-error" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;color:white;padding:24px">Kamera tidak tersedia. Periksa izin kamera perangkat.</div></div>
      <div id="psi-camera-location" style="position:absolute;top:66px;left:12px;right:12px;padding:7px 9px;background:rgba(0,0,0,.6);border-radius:7px;color:white;font-size:.68rem">Mendeteksi lokasi...</div>
      <footer style="position:absolute;left:0;right:0;bottom:0;padding:22px;display:flex;justify-content:center;background:linear-gradient(transparent,rgba(0,0,0,.8))"><button id="psi-camera-shutter" type="button" aria-label="Ambil foto" style="width:68px;height:68px;border-radius:50%;border:4px solid white;background:rgba(255,255,255,.2)"><span style="display:block;width:52px;height:52px;border-radius:50%;background:white"></span></button></footer>
    </div>
  </div>`;
  const returnToList = () => renderPhysicalStockInspectionLanding();
  const cancelDraft = () => {
    try { cancelPhysicalStockDraft(inspection.id, user); } catch (_) {}
    returnToList();
  };
  app.querySelector('#psi-form-back').onclick = cancelDraft;
  app.querySelector('#psi-form-cancel').onclick = cancelDraft;

  const cameraEl = app.querySelector('#psi-camera');
  const videoEl = app.querySelector('#psi-camera-video');
  const canvasEl = app.querySelector('#psi-camera-canvas');
  const locationEl = app.querySelector('#psi-camera-location');
  const errorEl = app.querySelector('#psi-camera-error');
  let currentPosition = null;

  const stopCamera = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    cameraEl.style.display = 'none';
  };

  app.querySelector('#psi-close-camera').onclick = stopCamera;
  app.querySelector('#psi-open-camera').onclick = async () => {
    errorEl.style.display = 'none';
    cameraEl.style.display = 'flex';
    locationEl.textContent = 'Mendeteksi lokasi...';
    currentPosition = null;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          currentPosition = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          locationEl.textContent = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        },
        () => { locationEl.textContent = 'GPS tidak tersedia (menggunakan timestamp perangkat)'; },
        { enableHighAccuracy: true, timeout: 7000 }
      );
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      videoEl.srcObject = mediaStream;
    } catch (_) {
      errorEl.style.display = 'flex';
    }
  };
  app.querySelector('#psi-camera-shutter').onclick = () => {
    const width = videoEl.videoWidth || 1280;
    const height = videoEl.videoHeight || 720;
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, width, height);

    const actor = session.get();
    const position = currentPosition;
    const capturedAt = new Date();
    const padding = 20;
    const fontSize = Math.max(14, Math.floor(canvasEl.width * 0.024));
    const lineHeight = Math.floor(fontSize * 1.35);
    const lines = [
      `SIGMA NURSERY · ${inspection.batchCode || inspection.batchId}`,
      `${actor?.name || 'Asisten Bibitan'} (${actor?.code || actor?.userId || 'ASB'})`,
      capturedAt.toLocaleString('id-ID'),
      position ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : 'Lokasi tidak tersedia'
    ];
    const stampHeight = padding * 2 + lineHeight * lines.length;
    ctx.fillStyle = 'rgba(0,0,0,.68)';
    ctx.fillRect(0, canvasEl.height - stampHeight, canvasEl.width, stampHeight);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => ctx.fillText(line, padding, canvasEl.height - stampHeight + padding + index * lineHeight, canvasEl.width - padding * 2));
    photoEvidence = {
      image: canvasEl.toDataURL('image/jpeg', .72),
      capturedAt: capturedAt.toISOString(),
      capturedBy: actor?.code || actor?.userId || actor?.id,
      capturedByName: actor?.name || null,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null
    };
    const preview = app.querySelector('#psi-photo-preview');
    preview.querySelector('img').src = photoEvidence.image;
    app.querySelector('#psi-photo-meta').textContent = `${capturedAt.toLocaleString('id-ID')} · ${position ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : 'Lokasi tidak tersedia'}`;
    preview.style.display = 'block';
    stopCamera();
  };
  app.querySelector('#psi-count-form').onsubmit = event => {
    event.preventDefault();
    try {
      const counts = [...app.querySelectorAll('.psi-count-input')].map(input => ({ bedenganId: input.dataset.bedengan === 'TOTAL_BATCH' ? null : input.dataset.bedengan, physicalQty: Number(input.value) }));
      if (!photoEvidence) throw new Error('Foto bukti pemeriksaan bertimestamp wajib diambil.');
      renderLockConfirmation(inspection, counts, photoEvidence);
    } catch (error) { toast.error(error.message); }
  };
}

function renderBapsbApprovalCardItem(item, currentUser) {
  const role = normalizeRole(currentUser?.role || currentUser?.rawRole);
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  const isPengurus = role === ROLES.PENGURUS;

  const status = item.bapbStatus || item.status;
  const isFinal = status === BAPSB_STATUS.FINAL || item.isFinal;
  const isAwaitingAskep = status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP;
  const isAwaitingPengurus = status === BAPSB_STATUS.MENUNGGU_PENGURUS;
  const isReturned = status === BAPSB_STATUS.RETURNED_TO_ASB;

  let badgeHtml = '';
  if (isFinal) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; white-space: nowrap;">Disetujui</span>`;
  } else if (isAwaitingAskep) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A; white-space: nowrap;">MENUNGGU ASKEP</span>`;
  } else if (isAwaitingPengurus) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; white-space: nowrap;">MENUNGGU PENGURUS</span>`;
  } else if (isReturned) {
    badgeHtml = `<span style="font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; white-space: nowrap;">DIKEMBALIKAN KE ASB</span>`;
  }

  const cleanEstate = String(item.estateCode || 'TB').replace(/^EST-/, '').replace(/S$/, '');
  const cleanDiv = String(item.divisionCode || 'DIV-I').replace(/^DIV-0*/, 'DIV-').replace(/DIV-1$/, 'DIV-I');
  let docNoDisplay = item.docNo || item.officialDocNo || '-';
  docNoDisplay = docNoDisplay.replace('/TBS/', '/TB/').replace('/DIV-1/', '/DIV-I/');

  const bedenganDisplay = Array.isArray(item.bedenganIds) && item.bedenganIds.length 
    ? item.bedenganIds.join(', ') 
    : (item.bedengan || 'BED-003');
  const klonDisplay = item.klon || 'GT 1';

  return `
    <div class="card-bapb-item" data-id="${esc(item.id)}" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
      
      <!-- HEADER -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-size: 0.88rem; font-weight: 800; color: #0F172A; font-family: monospace; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${esc(docNoDisplay)}
          </div>
          <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">
            Kebun: <strong>${esc(cleanEstate)}</strong> • Divisi: <strong>${esc(cleanDiv)}</strong> • Batch: <strong>${esc(item.batchCode || item.batchId)}</strong>
          </div>
        </div>
        <div style="flex-shrink: 0;">
          ${badgeHtml}
        </div>
      </div>

      <!-- METADATA & TOTAL -->
      <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; margin: 8px 0; align-items: center;">
        <div>
          <div style="font-size: 0.68rem; color: #64748B;">Klon & Bedengan:</div>
          <div style="font-size: 0.82rem; font-weight: 700; color: #1E293B;">
            ${esc(klonDisplay)} (${esc(bedenganDisplay)})
          </div>
          <div style="font-size: 0.68rem; color: #64748B; margin-top: 2px;">
            Tgl Pelaksanaan: <strong>${esc(formatDate(item.createdAt || item.date))}</strong>
          </div>
        </div>
        <div style="text-align: right; border-left: 1px solid #E2E8F0; padding-left: 10px;">
          <div style="font-size: 0.64rem; font-weight: 700; color: #047857; text-transform: uppercase; line-height: 1.25;">TOTAL<br>SELISIH LEBIH</div>
          <div style="font-size: 1.15rem; font-weight: 900; color: #047857; margin-top: 2px;">
            +${Number(item.surplusQty || 0).toLocaleString('id-ID')} <span style="font-size: 0.72rem; font-weight: 700;">Pkk</span>
          </div>
        </div>
      </div>

      <!-- INVARIAN STOK, PELAKSANA & METODE PERSETUJUAN -->
      <div style="font-size: 0.72rem; color: #475569; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
          <div>Pelaksana: <strong>${esc(item.signatures?.asb?.name || item.createdByName || 'Annisa')}</strong></div>
          <div>
            <span style="font-size: 0.66rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #F8FAFC; color: #475569; border: 1px solid #E2E8F0;">Metode Persetujuan: Bertahap</span>
          </div>
        </div>
        ${item.signatures?.askep?.notes ? `<div style="margin-top: 4px; color: #15803D;">Catatan Askep: ${esc(item.signatures.askep.notes)}</div>` : ''}
        ${item.signatures?.pengurus?.notes ? `<div style="margin-top: 4px; color: #047857;">Catatan Pengurus: ${esc(item.signatures.pengurus.notes)}</div>` : ''}
        ${item.returnReason ? `<div style="margin-top: 4px; color: #DC2626;">Alasan Dikembalikan: <strong>${esc(item.returnReason)}</strong></div>` : ''}
      </div>

      <!-- ACTION BUTTONS -->
      <div style="border-top: 1px solid #E2E8F0; padding-top: 10px;">
        ${isFinal ? `
          <button type="button" class="btn-preview-bapb btn-print-bapb psi-view-bapsb" data-bapsb="${esc(item.id)}" style="width: 100%; height: 36px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            <span>Lihat & Cetak BA</span>
          </button>
        ` : ((isAskep && isAwaitingAskep) || (isPengurus && isAwaitingPengurus)) ? `
          <button type="button" class="btn-askep-action psi-review-bapsb" data-bapsb="${esc(item.id)}" style="width: 100%; height: 36px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.84rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>Tinjau dan Proses</span>
          </button>
        ` : `
          <button type="button" class="btn-preview-bapb psi-view-bapsb" data-bapsb="${esc(item.id)}" style="width: 100%; height: 36px; background: #F1F5F9; color: #334155; border: 1px solid #CBD5E1; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Pratinjau Draf (A4)</span>
          </button>
        `}
      </div>

    </div>
  `;
}

function renderBapsbApprovalDashboard(app, currentUser) {
  const role = normalizeRole(currentUser?.role || currentUser?.rawRole);
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  const isPengurus = role === ROLES.PENGURUS;

  const allBapsb = getBapsbCollection(currentUser);

  // Sort: Dokumen yang menunggu tindakan ditampilkan paling atas
  const pendingDocs = allBapsb.filter(b => {
    if (isAskep) return b.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP;
    if (isPengurus) return b.status === BAPSB_STATUS.MENUNGGU_PENGURUS;
    return false;
  });
  const otherDocs = allBapsb.filter(b => !pendingDocs.some(p => p.id === b.id));
  const sortedDocs = [...pendingDocs, ...otherDocs];

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; flex-shrink: 0;">
        <div style="display: flex; align-items: center;">
          <button id="psi-approval-back" type="button" aria-label="Kembali" style="padding: 8px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.15rem; font-weight: 700; color: #111111; margin: 0 0 0 8px; letter-spacing: -0.01em;">Pemeriksaan Stok Fisik</h1>
        </div>
        <button id="psi-approval-batch-history" type="button" aria-label="Riwayat Transaksi Batch" title="Lihat Riwayat Transaksi Batch" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid #CBD5E1;border-radius:9px;background:#FFFFFF;color:#334155;cursor:pointer">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
      </header>

      <!-- MAIN CONTENT LIST (BAPB HARMONIZED) -->
      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h2 style="font-size: 0.88rem; font-weight: 700; color: #1E293B; margin: 0;">Riwayat Berita Acara Selisih Lebih</h2>
          <span style="background: #E2E8F0; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;">${sortedDocs.length} Dokumen</span>
        </div>

        ${sortedDocs.length === 0 ? `
          <div style="padding: 32px 16px; text-align: center; background: white; border: 1px dashed #CBD5E1; border-radius: 10px; color: #64748B;">
            <div style="font-weight: 700; font-size: 0.86rem; color: #334155; margin-bottom: 4px;">Belum Ada Berita Acara</div>
            <div style="font-size: 0.74rem; line-height: 1.4;">Belum ada dokumen Berita Acara Pemeriksaan Stok Fisik yang diterbitkan oleh Asisten Bibitan untuk kebun ini.</div>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${sortedDocs.map(item => renderBapsbApprovalCardItem(item, currentUser)).join('')}
          </div>
        `}
      </main>
    </div>
  `;

  app.querySelector('#psi-approval-back')?.addEventListener('click', () => navigate('/inspection'));
  app.querySelector('#psi-approval-batch-history')?.addEventListener('click', () => {
    renderBatchTransactionHistoryView(app, null, () => renderBapsbApprovalDashboard(app, currentUser));
  });
  app.querySelector('#psi-approval-refresh')?.addEventListener('click', () => renderPhysicalStockInspectionLanding());

  app.querySelectorAll('.psi-review-bapsb').forEach(button => button.onclick = () => {
    const bapsbId = button.dataset.bapsb;
    const bapsb = getBapsbById(bapsbId);
    if (!bapsb) {
      toast.error('Dokumen Berita Acara tidak ditemukan.');
      return;
    }
    openBapsbPreviewModal(bapsb, currentUser, (action, payload) => {
      try {
        if (action === 'SIGN_ASKEP') {
          signBapsbAskep(bapsb.id, currentUser, payload);
          toast.success('Berita Acara berhasil disetujui Askep dan diteruskan ke Pengurus.');
          renderPhysicalStockInspectionLanding();
        } else if (action === 'FINALIZE_PENGURUS') {
          finalizeBapsbPengurus(bapsb.id, currentUser, payload);
          toast.success(`Berita Acara resmi disahkan secara FINAL (${bapsb.docNo}).`);
          renderPhysicalStockInspectionLanding();
        }
      } catch (err) {
        toast.error(err.message || 'Gagal memproses persetujuan Berita Acara.');
      }
    });
  });

  app.querySelectorAll('.psi-view-bapsb, .btn-preview-bapb').forEach(button => button.onclick = () => {
    const bapsbId = button.dataset.bapsb;
    const bapsb = getBapsbById(bapsbId);
    if (!bapsb) {
      toast.error('Dokumen Berita Acara tidak ditemukan.');
      return;
    }
    openBapsbPrintPreviewModal(bapsb);
  });
}

export function renderPhysicalStockInspectionLanding() {
  const app = document.getElementById('main-content') || document.getElementById('app');
  if (!app) return;
  const user = session.get();
  const role = normalizeRole(user?.role || user?.rawRole);
  const isAsb = role === ROLES.ASISTEN_BIBITAN;
  const isAskep = role === ROLES.ASKEP || role === 'ASISTEN_KEPALA';
  const isPengurus = role === ROLES.PENGURUS;

  // Askep dan Pengurus hanya melihat Dashboard Persetujuan Berita Acara (seperti pola BAPB)
  if (isAskep || isPengurus) {
    renderBapsbApprovalDashboard(app, user);
    return;
  }

  let batches = [], inspections = [];
  try {
    batches = getEligiblePhysicalStockBatches(user);
    inspections = getPhysicalStockInspections(user);
  } catch (error) {
    toast.error(error.message);
    navigate('/inspection');
    return;
  }
  const latest = latestMap(inspections);

  app.innerHTML = `<div class="page" style="height:100%;display:flex;flex-direction:column;background:#F8FAFC">
    <header style="height:56px;display:flex;align-items:center;gap:12px;padding:0 12px 0 16px;background:white;border-bottom:1px solid #E2E8F0;flex-shrink:0">
      <button id="psi-back" type="button" aria-label="Kembali" style="padding:8px;margin-left:-8px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#116834">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>
      <div style="flex:1;min-width:0">
        <h1 style="font-size:1.05rem;font-weight:700;margin:0;color:#0F172A;letter-spacing:-0.01em">Pemeriksaan Stok Fisik</h1>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button id="psi-batch-history" type="button" aria-label="Riwayat Transaksi Batch" title="Lihat Riwayat Transaksi Batch" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid #CBD5E1;border-radius:9px;background:#FFFFFF;color:#334155;cursor:pointer">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
        <button id="psi-sync" type="button" aria-label="Sinkronkan stok sistem" title="Sinkronkan stok sistem" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:#ECFDF3;color:#116834;cursor:pointer">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/>
          </svg>
        </button>
      </div>
    </header>
    <main style="flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:7px">
      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 10px;font-size:.72rem;line-height:1.45;color:#065F46">
        Stok sistem ditampilkan setelah hasil pemeriksaan fisik selesai. Selisih lebih tidak otomatis menambah stok dan akan ditindaklanjuti melalui Berita Acara (BA). Selisih kurang hanya mengurangi stok setelah diverifikasi dan disetujui sebagai Afkir/Diseleksi.
        ${lastStockSyncAt ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid #A7F3D0;font-size:.66rem;color:#047857">Saldo sistem diperbarui ${lastStockSyncAt}</div>` : ''}
      </div>
      ${batches.length ? batches.map(batch => cardHtml(batch, latest.get(batch.id || batch.batchId || batch.batchCode), user)).join('') : '<div style="padding:28px;text-align:center;color:#64748B;background:white;border-radius:14px">Belum ada Batch dengan Pindah Semai terverifikasi dan saldo aktif.</div>'}
    </main>
    ${isAsb ? renderAsbBottomNav('pemeriksaan') : ''}
  </div>`;

  const psiBackBtn = app.querySelector('#psi-back') || app.querySelector('#btn-back');
  if (psiBackBtn) {
    psiBackBtn.onclick = () => navigate('/inspection');
  }
  if (isAsb) {
    attachAsbBottomNavEvents(app);
  }
  app.querySelector('#psi-batch-history')?.addEventListener('click', () => {
    renderBatchTransactionHistoryView(app, null, () => renderPhysicalStockInspectionLanding());
  });
  app.querySelector('#psi-sync').onclick = () => {
    try {
      getEligiblePhysicalStockBatches(user);
      lastStockSyncAt = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      renderPhysicalStockInspectionLanding();
      toast.success('Saldo sistem dan status pemeriksaan diperbarui.');
    } catch (error) {
      toast.error(error.message || 'Saldo sistem gagal diperbarui.');
    }
  };

  app.querySelectorAll('.psi-start').forEach(button => button.onclick = () => {
    if (!isAsb) {
      toast.info('Hanya Asisten Bibitan yang berwenang melakukan pemeriksaan stok fisik.');
      return;
    }
    try { renderCountForm(startPhysicalStockInspection(button.dataset.batch, user)); } catch (e) { toast.error(e.message); }
  });
  app.querySelectorAll('.psi-open').forEach(button => button.onclick = () => renderCountForm(inspections.find(item => item.id === button.dataset.id)));
  app.querySelectorAll('.psi-recount').forEach(button => button.onclick = () => {
    if (!isAsb) {
      toast.info('Hanya Asisten Bibitan yang berwenang melakukan hitung ulang.');
      return;
    }
    try { renderCountForm(restartPhysicalStockInspection(button.dataset.id, user)); } catch (e) { toast.error(e.message); }
  });
  app.querySelectorAll('.psi-correct').forEach(button => button.onclick = () => {
    if (!isAsb) {
      toast.info('Hanya Asisten Bibitan yang berwenang melakukan pemeriksaan kembali.');
      return;
    }
    try { renderCountForm(startPhysicalStockCorrection(button.dataset.id, user)); } catch (e) { toast.error(e.message); }
  });

  app.querySelectorAll('.psi-create-bapsb').forEach(button => button.onclick = () => {
    const inspection = inspections.find(item => item.id === button.dataset.id);
    if (!inspection) return;
    openCreateBapsbModal(inspection, user, () => renderPhysicalStockInspectionLanding());
  });

  app.querySelectorAll('.psi-review-bapsb').forEach(button => button.onclick = () => {
    const bapsbId = button.dataset.bapsb;
    const bapsb = getBapsbById(bapsbId);
    if (!bapsb) {
      toast.error('Dokumen Berita Acara tidak ditemukan.');
      return;
    }
    openBapsbPreviewModal(bapsb, user, (action, payload) => {
      try {
        if (action === 'SIGN_ASKEP') {
          signBapsbAskep(bapsb.id, user, payload);
          toast.success('Berita Acara berhasil disetujui Askep dan diteruskan ke Pengurus.');
          renderPhysicalStockInspectionLanding();
        } else if (action === 'FINALIZE_PENGURUS') {
          finalizeBapsbPengurus(bapsb.id, user, payload);
          toast.success(`Berita Acara resmi disahkan secara FINAL (${bapsb.docNo}).`);
          renderPhysicalStockInspectionLanding();
        }
      } catch (err) {
        toast.error(err.message || 'Gagal memproses persetujuan Berita Acara.');
      }
    });
  });

  app.querySelectorAll('.psi-view-bapsb, .btn-preview-bapb').forEach(button => button.onclick = () => {
    const bapsbId = button.dataset.bapsb;
    const bapsb = getBapsbById(bapsbId);
    if (!bapsb) {
      toast.error('Dokumen Berita Acara tidak ditemukan.');
      return;
    }
    openBapsbPrintPreviewModal(bapsb);
  });

  app.querySelectorAll('.psi-toggle-history').forEach(button => button.onclick = () => {
    const targetId = button.dataset.target;
    const content = app.querySelector(`#${targetId}`);
    const chevron = button.querySelector('.psi-chevron');
    if (!content) return;
    const isExpanded = content.style.display !== 'none';
    content.style.display = isExpanded ? 'none' : 'block';
    if (chevron) {
      chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });

  app.querySelectorAll('.psi-open-verification').forEach(button => button.onclick = () => navigate('/verification'));
  app.querySelectorAll('.psi-verify').forEach(button => button.onclick = async () => {
    if (!confirm('Ajukan selisih kurang sebagai dokumen afkir ke halaman Verifikasi Penyeleksian? Stok belum akan berkurang sampai dokumen disetujui.')) return;
    button.disabled = true;
    try {
      await submitPhysicalStockShortageForVerification(button.dataset.id, user);
      toast.success('Dokumen afkir masuk ke halaman Verifikasi Penyeleksian.');
      renderPhysicalStockInspectionLanding();
    } catch (error) {
      button.disabled = false;
      toast.error(error.message);
    }
  });

  if (isAsb) {
    attachAsbBottomNavEvents(app);
  }
}
