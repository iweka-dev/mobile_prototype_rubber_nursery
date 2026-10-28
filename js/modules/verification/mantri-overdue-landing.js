/**
 * js/modules/verification/mantri-overdue-landing.js
 * Halaman Manajemen & Pengiriman Data Lewat Waktu (Overdue Transactions)
 * 
 * Prinsip:
 * - Konsistensi UI & UX dengan Mantri Confirmation Landing
 * - Mode Filter: "Semua Tanggal" atau "Tanggal Spesifik"
 * - Pengiriman batch transaksi lewat waktu hanya dapat dilakukan per tanggal yang dipilih
 */

import { session } from '../../core/session.js';
import { navigate } from '../../core/router.js';
import { toast } from '../../components/toast.js';
import { esc } from '../../core/utils.js';
import { getCurrentUserContext, resolveUserContext } from '../../core/user-context.js';
import {
  MANTRI_TRANSACTION_STATUS,
  MODULE_TYPES,
  MODULE_LABELS,
  getMantriTodayTransactions,
  submitOverdueTransactionsByDate,
  normalizeDateStr,
  formatSafeNumber
} from './mantri-confirmation-service.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import {
  renderUniversalCard,
  renderDetailModal
} from './mantri-confirmation-landing.js';

let activeDateFilter = 'ALL'; // 'ALL' | 'DD/MM/YYYY'
let isStatementChecked = false;
let selectedTxForModal = null;
let isSubmitting = false;
let showLoadingModal = false;
let showSuccessModal = false;
let lastSubmittedDate = '';
let lastSubmittedCount = 0;

export function renderMantriOverdueLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const currentUser = getCurrentUserContext();

  // Ambil seluruh transaksi mantri
  const allTxs = getMantriTodayTransactions(currentUser);

  // Filter hanya transaksi yang berstatus LEWAT WAKTU dan belum terverifikasi
  const overdueTxs = allTxs.filter(tx =>
    (tx.status === MANTRI_TRANSACTION_STATUS.READY_TO_CONFIRM || tx.status === MANTRI_TRANSACTION_STATUS.REVISION) &&
    tx.isSubmissionExpired
  );

  // Ekstrak daftar tanggal unik transaksi lewat waktu
  const uniqueDatesSet = new Set();
  overdueTxs.forEach(tx => {
    const d = normalizeDateStr(tx.date);
    if (d) uniqueDatesSet.add(d);
  });
  const availableDates = Array.from(uniqueDatesSet).sort((a, b) => {
    const [d1, m1, y1] = a.split('/').map(Number);
    const [d2, m2, y2] = b.split('/').map(Number);
    return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
  });

  // Jika activeDateFilter tidak valid lagi, reset ke 'ALL'
  if (activeDateFilter !== 'ALL' && !availableDates.includes(activeDateFilter)) {
    activeDateFilter = 'ALL';
    isStatementChecked = false;
  }

  // Filter transaksi berdasarkan tanggal yang dipilih
  const visibleTxs = activeDateFilter === 'ALL'
    ? overdueTxs
    : overdueTxs.filter(tx => normalizeDateStr(tx.date) === activeDateFilter);

  // Evaluasi tombol submit: Hanya aktif bila tanggal spesifik dipilih & checkbox tercentang
  const isSpecificDateSelected = activeDateFilter !== 'ALL';
  const hasItemsToSubmit = isSpecificDateSelected && visibleTxs.length > 0;
  const canSubmit = hasItemsToSubmit && isStatementChecked && !isSubmitting;

  const statementText = 'Saya dengan ini menyatakan bahwa informasi di atas adalah benar dan sesuai dengan kondisi lapangan.';

  app.innerHTML = `
    <div class="page mantri-overdue-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; position: relative;">
      
      <!-- 1. HEADER (Fixed 56px, Flex-shrink 0) -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <button id="btn-back-confirmation" type="button" aria-label="Kembali ke Konfirmasi" style="background: transparent; border: none; padding: 6px; margin-left: -6px; color: #057A55; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <div style="min-width: 0; flex: 1;">
            <h1 style="font-size: 0.96rem; font-weight: 800; color: #0F172A; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              Data Lewat Waktu
            </h1>
            <span style="font-size: 0.70rem; color: #64748B; font-weight: 600;">
              ${esc(currentUser.estateName || 'Tanah Besih')} - ${esc(currentUser.divisionName || 'Divisi I')}
            </span>
          </div>
        </div>
      </header>

      <!-- 2. TAB BAR (Flex-shrink 0, Horizontal Scroll) -->
      <nav style="display: flex; overflow-x: auto; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 12px; gap: 12px; flex-shrink: 0; width: 100%; min-width: 0; scrollbar-width: none; -webkit-overflow-scrolling: touch;">
        <button class="dynamic-tab-btn" data-date="ALL" style="flex-shrink: 0; padding: 10px 6px; font-size: 0.80rem; font-weight: ${activeDateFilter === 'ALL' ? '800' : '600'}; color: ${activeDateFilter === 'ALL' ? '#057A55' : '#64748B'}; background: transparent; border: none; border-bottom: 2.5px solid ${activeDateFilter === 'ALL' ? '#057A55' : 'transparent'}; cursor: pointer; white-space: nowrap; transition: all 0.15s ease;">
          Semua Tanggal (${overdueTxs.length})
        </button>

        ${availableDates.map(dStr => {
    const isActive = activeDateFilter === dStr;
    const countOnDate = overdueTxs.filter(t => normalizeDateStr(t.date) === dStr).length;
    return `
            <button class="dynamic-tab-btn" data-date="${esc(dStr)}" style="flex-shrink: 0; padding: 10px 6px; font-size: 0.80rem; font-weight: ${isActive ? '800' : '600'}; color: ${isActive ? '#057A55' : '#64748B'}; background: transparent; border: none; border-bottom: 2.5px solid ${isActive ? '#057A55' : 'transparent'}; cursor: pointer; white-space: nowrap; transition: all 0.15s ease;">
              ${esc(dStr)} (${countOnDate})
            </button>
          `;
  }).join('')}
      </nav>

      <!-- 3. MAIN CONTENT AREA (Scrollable) -->
      <main style="flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
        
        <!-- Info Banner Kebijakan Lewat Waktu -->
        <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px; display: flex; align-items: flex-start; gap: 8px;">
          <span style="font-size: 0.95rem; line-height: 1;">⚠️</span>
          <div style="font-size: 0.74rem; color: #991B1B; line-height: 1.4;">
            <strong>Arsip Transaksi Lewat Waktu:</strong> Transaksi di bawah ini melewati batas pengiriman harian (D+1 jam 12:00). Pilih tanggal tertentu untuk mengirimkan batch transaksi per hari.
          </div>
        </div>

        ${visibleTxs.length === 0 ? renderEmptyStateCard({
    title: 'Tidak Ada Data Lewat Waktu',
    description: activeDateFilter === 'ALL'
      ? 'Seluruh transaksi operasional telah dikonfirmasi tepat waktu.'
      : `Tidak ada data transaksi lewat waktu pada tanggal ${activeDateFilter}.`
  }) : `
          <!-- Section Title & Count -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 0;">
            <h2 style="font-size: 0.88rem; font-weight: 800; color: #0F172A; margin: 0;">
              ${activeDateFilter === 'ALL' ? 'Daftar Seluruh Transaksi Lewat Waktu' : `Transaksi Tanggal ${activeDateFilter}`}
            </h2>
            <span style="font-size: 0.74rem; font-weight: 700; color: #DC2626; background: #FEE2E2; padding: 2px 8px; border-radius: 12px;">
              ${visibleTxs.length} Transaksi
            </span>
          </div>

          <!-- Cards List -->
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${visibleTxs.map(tx => renderUniversalCard(tx)).join('')}
          </div>
        `}

      </main>

      <!-- 4. BOTTOM ACTION AREA (Sticky Footer) -->
      ${overdueTxs.length > 0 ? `
        <div class="overdue-submit-area" style="flex-shrink: 0; width: 100%; padding: 12px 14px 16px; background: #FFFFFF; border-top: 1px solid #E2E8F0; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 -2px 6px rgba(0,0,0,0.03); z-index: 10;">
          
          ${!isSpecificDateSelected ? `
            <!-- Mode Semua Tanggal: Hint Selector -->
            <div style="background: #F1F5F9; border: 1px dashed #CBD5E1; border-radius: 8px; padding: 10px 12px; text-align: center; color: #64748B; font-size: 0.75rem; font-weight: 600;">
              Pilih salah satu tanggal di atas untuk mengaktifkan pengiriman data lewat waktu.
            </div>
            <button type="button" disabled style="width: 100%; height: 42px; background: #E2E8F0; color: #94A3B8; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Kirim Data ke Asisten (Pilih Tanggal)</span>
            </button>
          ` : `
            <!-- Mode Tanggal Spesifik: Checkbox & Submit Button -->
            <div style="font-size: 0.82rem; font-weight: 800; color: #0F172A;">
              Pernyataan Pengiriman (${esc(activeDateFilter)})
            </div>

            <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 0.72rem; color: #334155; line-height: 1.45;">
              <input type="checkbox" id="chk-overdue-statement" style="margin-top: 2px; width: 16px; height: 16px; accent-color: #057A55; cursor: pointer; flex-shrink: 0;" ${isStatementChecked ? 'checked' : ''} />
              <span>${statementText}</span>
            </label>

            <button type="button" id="btn-submit-overdue" ${canSubmit ? '' : 'disabled'} style="width: 100%; height: 42px; background: ${canSubmit ? '#057A55' : '#D1D5DB'}; color: ${canSubmit ? '#FFFFFF' : '#9CA3AF'}; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: ${canSubmit ? 'pointer' : 'not-allowed'}; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: ${canSubmit ? '0 2px 5px rgba(5,122,85,0.25)' : 'none'}; transition: all 0.2s ease;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Kirim Data ke Asisten (${visibleTxs.length} Transaksi)</span>
            </button>
          `}
        </div>
      ` : ''}

      <!-- 5. DETAIL TRANSACTION MODAL -->
      ${selectedTxForModal ? renderDetailModal(selectedTxForModal, currentUser) : ''}

      <!-- 6. LOADING MODAL -->
      ${showLoadingModal ? renderOverdueLoadingModal() : ''}

      <!-- 7. SUCCESS MODAL -->
      ${showSuccessModal ? renderOverdueSuccessModal() : ''}

    </div>
  `;

  attachOverdueEvents(overdueTxs, currentUser);
}

function attachOverdueEvents(overdueTxs, user) {
  // Kembali ke Halaman Konfirmasi
  document.getElementById('btn-back-confirmation')?.addEventListener('click', () => {
    navigate('/mantri-confirmation');
  });

  // Filter Tanggal Tabs
  document.querySelectorAll('.dynamic-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-date');
      if (d) {
        activeDateFilter = d;
        isStatementChecked = false;
        renderMantriOverdueLanding();
      }
    });
  });

  // Checkbox Pernyataan
  const chk = document.getElementById('chk-overdue-statement');
  if (chk) {
    chk.addEventListener('change', (e) => {
      isStatementChecked = e.target.checked;
      const btnSubmit = document.getElementById('btn-submit-overdue');
      if (btnSubmit) {
        btnSubmit.disabled = !isStatementChecked || isSubmitting;
        btnSubmit.style.background = isStatementChecked ? '#057A55' : '#D1D5DB';
        btnSubmit.style.color = isStatementChecked ? '#FFFFFF' : '#9CA3AF';
        btnSubmit.style.cursor = isStatementChecked ? 'pointer' : 'not-allowed';
      }
    });
  }

  // Submit Button
  document.getElementById('btn-submit-overdue')?.addEventListener('click', async () => {
    if (!isStatementChecked || activeDateFilter === 'ALL' || isSubmitting) return;

    isSubmitting = true;
    showLoadingModal = true;
    renderMantriOverdueLanding();

    try {
      await new Promise(r => setTimeout(r, 600)); // Simulasi brief async animation
      const result = submitOverdueTransactionsByDate(activeDateFilter, user);

      showLoadingModal = false;
      if (result.success && result.submittedCount > 0) {
        lastSubmittedDate = activeDateFilter;
        lastSubmittedCount = result.submittedCount;
        showSuccessModal = true;
        isStatementChecked = false;
      } else {
        toast(result.message || 'Gagal mengirim data lewat waktu.', 'warning');
      }
    } catch (err) {
      showLoadingModal = false;
      console.error('[submitOverdueTransactionsByDate Error]', err);
      toast(err.message || 'Terjadi kesalahan saat mengirim data.', 'error');
    } finally {
      isSubmitting = false;
      renderMantriOverdueLanding();
    }
  });

  // Card Click: Detail Modal
  document.querySelectorAll('.card-universal-item').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-expired-info')) return;
      const txId = card.getAttribute('data-tx-id');
      const tx = overdueTxs.find(t => String(t.id) === String(txId));
      if (tx) {
        selectedTxForModal = tx;
        renderMantriOverdueLanding();
      }
    });
  });

  // Close Detail Modal. Modal ini memakai renderer yang sama dengan halaman
  // Central Hub, sehingga ID tombolnya adalah btn-close-modal-x/footer.
  const closeDetailModal = () => {
    selectedTxForModal = null;
    renderMantriOverdueLanding();
  };

  document.getElementById('btn-close-modal-x')?.addEventListener('click', closeDetailModal);
  document.getElementById('btn-close-modal-footer')?.addEventListener('click', closeDetailModal);
  // Tetap dukung ID lama bila ada kartu historis yang masih menggunakannya.
  document.getElementById('btn-close-detail-modal')?.addEventListener('click', closeDetailModal);
  document.getElementById('modal-tx-detail-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeDetailModal();
  });

  // Lewat Waktu Info Icon Click
  document.querySelectorAll('.btn-expired-info').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast('Lewat Waktu, Silahkan hubungi KTU untuk dapat di proses selanjutnya', 'warning');
    });
  });

  // Close Success Modal
  document.getElementById('btn-close-overdue-success')?.addEventListener('click', () => {
    showSuccessModal = false;
    renderMantriOverdueLanding();
  });
}

function renderOverdueLoadingModal() {
  return `
    <div class="modal-overlay" style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px);">
      <div style="background: #FFFFFF; border-radius: 12px; padding: 24px; width: 85%; max-width: 320px; display: flex; flex-direction: column; align-items: center; gap: 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.15);">
        <div style="width: 38px; height: 38px; border: 3px solid #E2E8F0; border-top-color: #057A55; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="text-align: center;">
          <div style="font-size: 0.90rem; font-weight: 800; color: #0F172A; margin-bottom: 2px;">Mengirim Data Lewat Waktu</div>
          <div style="font-size: 0.74rem; color: #64748B;">Menghubungkan ke Asisten Bibitan...</div>
        </div>
      </div>
    </div>
    <style>
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
}

function renderOverdueSuccessModal() {
  return `
    <div class="modal-overlay" style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px);">
      <div style="background: #FFFFFF; border-radius: 12px; padding: 24px 20px; width: 85%; max-width: 320px; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); text-align: center;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #DEF7EC; display: flex; align-items: center; justify-content: center; color: #057A55;">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0F172A; margin-bottom: 4px;">Pengiriman Berhasil</div>
          <div style="font-size: 0.76rem; color: #475569; line-height: 1.45;">
            Sebanyak <strong>${lastSubmittedCount} transaksi</strong> pada tanggal <strong>${esc(lastSubmittedDate)}</strong> berhasil diajukan ke Asisten Bibitan.
          </div>
        </div>
        <button id="btn-close-overdue-success" type="button" style="margin-top: 6px; width: 100%; height: 38px; background: #057A55; color: #FFFFFF; font-size: 0.82rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 4px rgba(5,122,85,0.2);">
          Mengerti
        </button>
      </div>
    </div>
  `;
}
