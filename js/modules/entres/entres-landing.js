/**
 * modules/entres/entres-landing.js — Landing Page Modul Kebun Entres
 * Menggunakan kartu menu 96px x 115px persis halaman Okulasi (budding-landing.js)
 * dan Ringkasan Data Transaksi konsisten persis Penyemaian.
 */

import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { getCurrentUserContext } from '../../core/user-context.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { getMataEntresBalances, validateToppingDeletion } from '../../core/entres-inventory-service.js';
import { isTransactionLockedForMantri, matchActor } from '../verification/mantri-confirmation-service.js';
import { toast } from '../../components/toast.js';

function formatDateDDMMYYYY(val) {
  if (!val) return '-';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const parts = val.substring(0, 10).split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return val;
}

export function renderEntresLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const currentUser = getCurrentUserContext();

  // 1. Ambil data transaksi dari storage dengan isolasi aktor
  const rawMenunasTxs = storage.get('entres_menunas_transactions', []);
  const rawToppingTxs = storage.get('entres_topping_transactions', []);
  const entresBalances = getMataEntresBalances({ userContext: currentUser, estateId: currentUser?.estateId });

  // Filter transaksi milik aktor aktif
  const visibleMenunas = rawMenunasTxs
    .map((t, originalIndex) => ({ ...t, activityType: 'Menunas', originalIndex }))
    .filter(t => matchActor(t, currentUser));

  const visibleToppings = rawToppingTxs
    .map((t, originalIndex) => ({ ...t, activityType: 'Topping', originalIndex }))
    .filter(t => matchActor(t, currentUser));

  // Hitung total agregat stok dan klon tersedia
  const totalMataEntres = entresBalances.reduce((acc, b) => acc + (b.saldoMataEntres || 0), 0);
  const availableKlonsCount = entresBalances.filter(b => (b.saldoMataEntres || 0) > 0).length;

  // Gabungkan transaksi dengan originalIndex masing-masing untuk fitur Edit & Hapus
  const allTxs = [
    ...visibleMenunas,
    ...visibleToppings
  ].reverse();

  app.innerHTML = `
    <div class="page entres-landing-page" style="display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER (Fixed 56px) -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="btn-back" type="button" aria-label="Kembali ke Beranda" style="padding: 6px; margin-left: -6px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 800; color: #0F172A; margin: 0; line-height: 1.2;">Kebun Entres</h1>
        </div>
        <button id="btn-refresh" type="button" aria-label="Segarkan" style="background: none; border: none; cursor: pointer; padding: 6px; margin-right: -6px; display: flex; align-items: center; justify-content: center; color: #116834;">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </header>

      <!-- CONTENT (Scrollable) -->
      <main style="flex: 1; min-height: 0; padding: 14px 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
        
        <!-- 1. CARD STOK MATA ENTRES (PALING ATAS) -->
        <div id="card-stok-mata-entres" style="background: #F0FDF4; border: 1px solid #DCFCE7; border-radius: 12px; padding: 16px 16px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;">
          <div style="font-size: 0.95rem; font-weight: 800; color: #15803D;">
            Stok Mata Entres
          </div>
          <div style="font-size: 0.74rem; color: #64748B; margin-top: 1px;">
            Stok tersedia berdasarkan klon
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin: 14px 0 12px; padding: 0 4px;">
            <div>
              <div style="font-size: 1.6rem; font-weight: 900; color: #0F172A; line-height: 1.1;">
                ${availableKlonsCount}
              </div>
              <div style="font-size: 0.74rem; color: #64748B; margin-top: 3px;">
                Klon tersedia
              </div>
            </div>

            <div style="width: 1px; height: 36px; background: #DCFCE7;"></div>

            <div style="text-align: right;">
              <div style="font-size: 1.6rem; font-weight: 900; color: #0F172A; line-height: 1.1;">
                ${totalMataEntres.toLocaleString('id-ID')}
              </div>
              <div style="font-size: 0.74rem; color: #64748B; margin-top: 3px;">
                Mata entres
              </div>
            </div>
          </div>

          <!-- FOOTER ACTION BANNER -->
          <div style="background: rgba(220, 252, 231, 0.6); border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span style="font-size: 0.72rem; color: #166534; line-height: 1.35;">
              Lihat detail stok per klon, mutasi, dan riwayat penggunaan.
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="#166534" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </div>

        <!-- 2. MENU TRANSAKSI: MENUNAS, TOPPING, DAN SENSUS ENTRES -->
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
          
          <!-- MENUNAS -->
          <button id="card-menunas" type="button" class="beranda-menu-card" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; width: 100%; min-width: 0; height: 115px; padding: 8px 4px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.03); cursor: pointer; text-align: center; box-sizing: border-box; transition: transform 0.15s ease, box-shadow 0.15s ease; position: relative;">
            <div style="width: 44px; height: 44px; margin-bottom: 6px; display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="#116834" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M24 42V16"></path>
                <path d="M24 30c4 0 10-3 12-8-5-1-10 3-12 8z" fill="#E8F5E9"></path>
                <path d="M24 24c-4 0-10-3-12-8 5-1 10 3 12 8z" fill="#E8F5E9"></path>
                <path d="M24 16c0-5 4-10 9-12 0 5-4 10-9 12z" fill="#E8F5E9"></path>
                <circle cx="24" cy="42" r="2.5" fill="#116834"></circle>
              </svg>
            </div>
            <span style="font-size: 0.78rem; font-weight: 700; color: #116834; line-height: 1.2; text-align: center;">
              Menunas
            </span>
          </button>

          <!-- TOPPING -->
          <button id="card-topping" type="button" class="beranda-menu-card" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; width: 100%; min-width: 0; height: 115px; padding: 8px 4px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.03); cursor: pointer; text-align: center; box-sizing: border-box; transition: transform 0.15s ease, box-shadow 0.15s ease; position: relative;">
            <div style="width: 44px; height: 44px; margin-bottom: 6px; display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="#116834" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M24 42V22"></path>
                <path d="M24 32c4 0 9-3 11-7-4-1-9 2-11 7z" fill="#E8F5E9"></path>
                <path d="M24 36c-4 0-9-3-11-7 4-1 9 2 11 7z" fill="#E8F5E9"></path>
                <line x1="15" y1="20" x2="33" y2="20" stroke="#116834" stroke-width="3"></line>
                <path d="M21 16l3-4 3 4" stroke="#116834" stroke-width="2.2"></path>
                <line x1="24" y1="12" x2="24" y2="6" stroke="#116834" stroke-width="2.2"></line>
                <circle cx="24" cy="42" r="2.5" fill="#116834"></circle>
              </svg>
            </div>
            <span style="font-size: 0.78rem; font-weight: 700; color: #116834; line-height: 1.2; text-align: center;">
              Topping
            </span>
          </button>

          <!-- SENSUS ENTRES -->
          <button id="card-sensus-entres" type="button" class="beranda-menu-card" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;width:100%;min-width:0;height:115px;padding:8px 4px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.03);cursor:pointer;text-align:center;box-sizing:border-box;transition:transform .15s ease,box-shadow .15s ease;position:relative;">
            <div style="width:44px;height:44px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="#116834" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M24 42V8"></path><path d="M24 18c-8 0-13-4-15-10 8 0 13 4 15 10z" fill="#E8F5E9"></path><path d="M24 25c8 0 13-4 15-10-8 0-13 4-15 10z" fill="#E8F5E9"></path><path d="M24 32c-7 0-11-3-13-8 7 0 11 3 13 8z" fill="#E8F5E9"></path><circle cx="24" cy="42" r="2.5" fill="#116834"></circle>
              </svg>
            </div>
            <span style="font-size:.78rem;font-weight:700;color:#116834;line-height:1.2;text-align:center;">Sensus Entres</span>
          </button>

        </div>

        <!-- RINGKASAN DATA TRANSAKSI PERSIS MODUL PENYEMAIAN -->
        <div style="padding: 24px 0 16px 0;">
          <h2 style="font-size: 1.1rem; font-weight: 700; color: #111111; margin: 0 0 16px 0;">
            Ringkasan Data Transaksi (${allTxs.length})
          </h2>

          ${allTxs.length > 0 ? allTxs.map((tx, idx) => {
            const isEntresLocked = isTransactionLockedForMantri(tx);
            return `
            <div style="border: 1px solid #D9D9D9; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #FFFFFF; position: relative;">
              
              <!-- HEADER BARIS 1: NO DOKUMEN & BADGE -->
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 700; font-size: 0.95rem; color: #111111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${tx.docNo || 'DOC-ENT-001'}
                  </div>
                  <div style="font-size: 0.8rem; color: #999999; margin-top: 4px;">
                    ${tx.activityType}, ${formatDateDDMMYYYY(tx.tanggal)}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; position: relative;">
                  <span style="background: #E8F5E9; color: #116834; font-size: 0.7rem; font-weight: 700; padding: 4px 8px; border-radius: 4px; white-space: nowrap; border: 1px solid #116834;">
                    ${tx.activityType}
                  </span>
                  ${!isEntresLocked ? `
                    <button class="btn-card-menu-entres" data-index="${idx}" style="background: none; border: none; padding: 4px; margin-right: -4px; cursor: pointer; color: #111;">
                      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                      </svg>
                    </button>
                    <div class="card-popover-entres" id="popover-entres-${idx}" style="display: none; position: absolute; top: 28px; right: 0; background: #FFFFFF; border: 1px solid #D9D9D9; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); width: 120px; z-index: 20; flex-direction: column; overflow: hidden;">
                      <button class="btn-popover-entres-edit" data-type="${tx.activityType}" data-orig-index="${tx.originalIndex}" style="padding: 12px 16px; text-align: left; background: #FFFFFF; border: none; border-bottom: 1px solid #EFEFEF; font-size: 0.88rem; font-weight: 600; color: #111111; cursor: pointer;">
                        Edit
                      </button>
                      <button class="btn-popover-entres-hapus" data-type="${tx.activityType}" data-orig-index="${tx.originalIndex}" data-doc="${tx.docNo || 'Dokumen'}" style="padding: 12px 16px; text-align: left; background: #FFFFFF; border: none; font-size: 0.88rem; font-weight: 600; color: #D32F2F; cursor: pointer;">
                        Hapus
                      </button>
                    </div>
                  ` : `
                    <span style="font-size: 0.65rem; font-weight: 700; color: #64748B; background: #F1F5F9; border: 1px solid #CBD5E1; padding: 2px 7px; border-radius: 4px;">
                      ${tx.status === 'DISETUJUI' || tx.verificationStatus === 'TERVERIFIKASI' ? 'Terverifikasi' : 'Menunggu Verifikasi'}
                    </span>
                  `}
                </div>
              </div>

              <!-- DIVIDER -->
              <hr style="border: none; border-top: 1px solid #EFEFEF; margin: 12px 0;" />

              <!-- IDENTITAS PLOT -->
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 8px;">
                <span style="font-weight: 700; font-size: 0.95rem; color: #111111; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${tx.kodePlot || 'Plot IA'} • ${tx.namaKlon || 'IRCA331'}
                </span>
              </div>

              <!-- ACCORDION CONTENT DETAIL -->
              <div class="card-details-content" style="display: none; flex-direction: column;">
                ${tx.activityType === 'Menunas' ? `
                  ${tx.jumlahPohonDitunas ? `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                      <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Jumlah Pokok Ditunas</span>
                      <span style="font-size: 0.9rem; font-weight: 700; color: #116834; text-align: right;">${parseInt(tx.jumlahPohonDitunas || 0).toLocaleString('id-ID')} Pkk</span>
                    </div>
                  ` : ''}
                  ${tx.jumlahPerisai ? `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                      <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Jumlah Perisai (Legacy)</span>
                      <span style="font-size: 0.9rem; font-weight: 700; color: #116834; text-align: right;">${parseInt(tx.jumlahPerisai || 0).toLocaleString('id-ID')} Perisai</span>
                    </div>
                  ` : ''}
                  <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                    <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Populasi Jumlah Pokok</span>
                    <span style="font-size: 0.9rem; font-weight: 700; color: #111111; text-align: right;">${parseInt(tx.jlhPokok || 0).toLocaleString('id-ID')} Pkk</span>
                  </div>
                ` : `
                  <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                    <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Jumlah Kayu</span>
                    <span style="font-size: 0.9rem; font-weight: 700; color: #116834; text-align: right;">${parseInt(tx.jumlahKayu || 0).toLocaleString('id-ID')} Btg</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                    <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Hasil Panen Mata Entres</span>
                    <span style="font-size: 0.9rem; font-weight: 700; color: #111111; text-align: right;">${parseInt(tx.jumlahPerisai || 0).toLocaleString('id-ID')} Perisai</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                    <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Rata-rata Perisai / Btg</span>
                    <span style="font-size: 0.9rem; font-weight: 700; color: #111111; text-align: right;">${(tx.jumlahPerisai && tx.jumlahKayu ? Math.round(tx.jumlahPerisai / tx.jumlahKayu) : '-')}</span>
                  </div>
                `}
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 12px;">
                  <span style="font-size: 0.85rem; color: #666666; flex-shrink: 0;">Pelaksana (Mantri)</span>
                  <span style="font-size: 0.9rem; font-weight: 700; color: #111111; text-align: right;">${tx.mantri || tx.actorName || 'Wagiman'}</span>
                </div>
              </div>

              <!-- FOOTER ACTION ROW -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                <div class="btn-expand-card" style="font-size: 0.8rem; color: #116834; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                  <span class="expand-text">Tampilkan Detail</span>
                  <svg class="expand-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s;">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: #116834; font-weight: 700; font-size: 0.85rem;">
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  Tersimpan
                </div>
              </div>

            </div>
            `;
          }).join('') : renderEmptyStateCard({
    title: 'Belum ada Dokumen Kebun Entres hari ini',
    description: 'Pilih menu Menunas atau Topping untuk memulai rekam data'
  })}

        </div>

        <!-- MODAL DIALOG KONFIRMASI HAPUS DATA -->
        <div id="modal-delete-entres-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 1000; backdrop-filter: blur(2px);"></div>
        
        <div id="dialog-delete-entres" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 88%; max-width: 320px; background: #FFFFFF; border-radius: 12px; padding: 20px 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 1001; text-align: center; box-sizing: border-box;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #FEE2E2; color: #DC2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </div>
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #111111; margin: 0 0 6px 0;">Hapus Transaksi?</h3>
          <p id="dialog-delete-entres-msg" style="font-size: 0.80rem; color: #666666; margin: 0 0 18px 0; line-height: 1.45;">
            Apakah Anda yakin ingin menghapus data transaksi ini? Data yang dihapus tidak dapat dikembalikan.
          </p>
          <div style="display: flex; gap: 8px;">
            <button id="btn-cancel-delete-entres" type="button" style="flex: 1; height: 40px; background: #F3F4F6; color: #374151; border: none; border-radius: 8px; font-size: 0.84rem; font-weight: 700; cursor: pointer;">
              Batal
            </button>
            <button id="btn-confirm-delete-entres" type="button" style="flex: 1; height: 40px; background: #DC2626; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.84rem; font-weight: 700; cursor: pointer;">
              Ya, Hapus
            </button>
          </div>
        </div>

      </main>
    </div>
  `;

  // Event Listeners: Back & Refresh
  app.querySelector('#btn-back')?.addEventListener('click', () => {
    navigate('/home');
  });

  app.querySelector('#btn-refresh')?.addEventListener('click', () => {
    renderEntresLanding();
  });

  // Card Stok Mata Entres Interaction & Navigation
  const cardStok = app.querySelector('#card-stok-mata-entres');
  if (cardStok) {
    cardStok.addEventListener('mouseenter', () => {
      cardStok.style.transform = 'translateY(-2px)';
      cardStok.style.boxShadow = '0 4px 10px rgba(21, 128, 61, 0.12)';
    });
    cardStok.addEventListener('mouseleave', () => {
      cardStok.style.transform = 'translateY(0)';
      cardStok.style.boxShadow = '0 1px 3px rgba(0,0,0,0.02)';
    });
    cardStok.addEventListener('click', () => {
      navigate('/entres/stock');
    });
  }

  // Card Menunas Interaction & Navigation
  const cardMenunas = app.querySelector('#card-menunas');
  if (cardMenunas) {
    cardMenunas.addEventListener('mouseenter', () => {
      cardMenunas.style.transform = 'translateY(-2px)';
      cardMenunas.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
    });
    cardMenunas.addEventListener('mouseleave', () => {
      cardMenunas.style.transform = 'translateY(0)';
      cardMenunas.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
    });
    cardMenunas.addEventListener('click', () => {
      storage.remove('editing_menunas_index');
      navigate('/entres/menunas');
    });
  }

  // Card Topping Interaction & Navigation
  const cardTopping = app.querySelector('#card-topping');
  if (cardTopping) {
    cardTopping.addEventListener('mouseenter', () => {
      cardTopping.style.transform = 'translateY(-2px)';
      cardTopping.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
    });
    cardTopping.addEventListener('mouseleave', () => {
      cardTopping.style.transform = 'translateY(0)';
      cardTopping.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
    });
    cardTopping.addEventListener('click', () => {
      storage.remove('editing_topping_index');
      navigate('/entres/topping');
    });
  }

  app.querySelector('#card-sensus-entres')?.addEventListener('click', () => {
    navigate('/entres/sensus');
  });

  // Modal Dialog Hapus Elements
  const deleteOverlay = app.querySelector('#modal-delete-entres-overlay');
  const deleteDialog = app.querySelector('#dialog-delete-entres');
  const deleteMsg = app.querySelector('#dialog-delete-entres-msg');
  const btnCancelDelete = app.querySelector('#btn-cancel-delete-entres');
  const btnConfirmDelete = app.querySelector('#btn-confirm-delete-entres');

  let pendingDeleteType = null;
  let pendingDeleteOrigIdx = null;

  const closeDeleteDialog = () => {
    if (deleteOverlay) deleteOverlay.style.display = 'none';
    if (deleteDialog) deleteDialog.style.display = 'none';
    pendingDeleteType = null;
    pendingDeleteOrigIdx = null;
  };

  btnCancelDelete?.addEventListener('click', closeDeleteDialog);
  deleteOverlay?.addEventListener('click', closeDeleteDialog);

  btnConfirmDelete?.addEventListener('click', () => {
    if (pendingDeleteOrigIdx !== null && !isNaN(pendingDeleteOrigIdx)) {
      if (pendingDeleteType === 'Menunas') {
        const txs = storage.get('entres_menunas_transactions', []);
        const targetTx = txs[pendingDeleteOrigIdx];
        if (isTransactionLockedForMantri(targetTx)) {
          toast.error('Transaksi Menunas tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
          closeDeleteDialog();
          return;
        }
        txs.splice(pendingDeleteOrigIdx, 1);
        storage.set('entres_menunas_transactions', txs);
        toast.success(`Transaksi Menunas berhasil dihapus.`);
      } else {
        const txs = storage.get('entres_topping_transactions', []);
        const targetTx = txs[pendingDeleteOrigIdx];
        if (isTransactionLockedForMantri(targetTx)) {
          toast.error('Transaksi Topping tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
          closeDeleteDialog();
          return;
        }
        if (targetTx) {
          const deleteCheck = validateToppingDeletion(targetTx.docNo);
          if (!deleteCheck.valid) {
            toast.error(deleteCheck.message);
            closeDeleteDialog();
            return;
          }
        }
        txs.splice(pendingDeleteOrigIdx, 1);
        storage.set('entres_topping_transactions', txs);
        toast.success(`Transaksi Topping berhasil dihapus.`);
      }
    }
    closeDeleteDialog();
    renderEntresLanding();
  });

  // Popover Actions (...) for Transaction Cards
  const btnCardMenus = app.querySelectorAll('.btn-card-menu-entres');
  const cardPopovers = app.querySelectorAll('.card-popover-entres');

  if (btnCardMenus.length > 0) {
    btnCardMenus.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = e.currentTarget.dataset.index;
        const popover = app.querySelector(`#popover-entres-${idx}`);
        cardPopovers.forEach(p => {
          if (p !== popover) p.style.display = 'none';
        });
        if (popover) {
          popover.style.display = popover.style.display === 'flex' ? 'none' : 'flex';
        }
      });
    });

    document.addEventListener('click', () => {
      cardPopovers.forEach(p => p.style.display = 'none');
    });

    // Handle Edit Action
    app.querySelectorAll('.btn-popover-entres-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cardPopovers.forEach(p => p.style.display = 'none');

        const type = e.currentTarget.dataset.type;
        const origIdx = parseInt(e.currentTarget.dataset.origIndex, 10);

        if (type === 'Menunas') {
          const txs = storage.get('entres_menunas_transactions', []);
          const editTx = txs[origIdx];
          if (!editTx || !matchActor(editTx, currentUser)) {
            toast.error('Akses ditolak: Anda tidak memiliki wewenang untuk mengubah transaksi ini.');
            return;
          }
          if (isTransactionLockedForMantri(editTx)) {
            toast.error('Transaksi Menunas tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
            return;
          }
          if (editTx) {
            storage.set('editing_menunas_index', origIdx);
            storage.set('selected_menunas_plot', {
              kodePlot: editTx.kodePlot,
              namaKlon: editTx.namaKlon,
              jlhPokok: editTx.jlhPokok,
              verifiedMethod: editTx.verifiedMethod || 'MANUAL'
            });
            navigate('/entres/menunas/form');
          } else {
            console.error('Transaksi tidak ditemukan pada index:', origIdx);
          }
        } else {
          const txs = storage.get('entres_topping_transactions', []);
          const editTx = txs[origIdx];
          if (!editTx || !matchActor(editTx, currentUser)) {
            toast.error('Akses ditolak: Anda tidak memiliki wewenang untuk mengubah transaksi ini.');
            return;
          }
          if (isTransactionLockedForMantri(editTx)) {
            toast.error('Transaksi Topping tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.');
            return;
          }
          if (editTx) {
            storage.set('editing_topping_index', origIdx);
            storage.set('selected_topping_plot', {
              kodePlot: editTx.kodePlot,
              namaKlon: editTx.namaKlon,
              jlhPokok: editTx.jlhPokok,
              verifiedMethod: editTx.verifiedMethod || 'MANUAL'
            });
            navigate('/entres/topping/form');
          } else {
            navigate('/entres/topping');
          }
        }
      });
    });

    // Handle Hapus Action (Trigger Modal Dialog)
    app.querySelectorAll('.btn-popover-entres-hapus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cardPopovers.forEach(p => p.style.display = 'none');

        pendingDeleteType = e.currentTarget.dataset.type;
        pendingDeleteOrigIdx = parseInt(e.currentTarget.dataset.origIndex, 10);
        const docNo = e.currentTarget.dataset.doc;

        const txs = pendingDeleteType === 'Menunas'
          ? storage.get('entres_menunas_transactions', [])
          : storage.get('entres_topping_transactions', []);
        const targetTx = txs[pendingDeleteOrigIdx];

        if (!targetTx || !matchActor(targetTx, currentUser)) {
          toast.error('Akses ditolak: Anda tidak memiliki wewenang untuk menghapus transaksi ini.');
          return;
        }

        if (isTransactionLockedForMantri(targetTx)) {
          toast.error(`Transaksi ${pendingDeleteType} tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.`);
          return;
        }

        if (deleteMsg) {
          deleteMsg.textContent = `Apakah Anda yakin ingin menghapus data transaksi ${pendingDeleteType} "${docNo}"? Data yang telah dihapus tidak dapat dipulihkan kembali.`;
        }
        if (deleteOverlay) deleteOverlay.style.display = 'block';
        if (deleteDialog) deleteDialog.style.display = 'block';
      });
    });
  }

  // Toggle Accordion Detail (Sama persis dengan Penyemaian)
  app.querySelectorAll('.btn-expand-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.currentTarget.closest('div[style*="border: 1px solid #D9D9D9"]');
      if (!card) return;
      const content = card.querySelector('.card-details-content');
      const text = btn.querySelector('.expand-text');
      const icon = btn.querySelector('.expand-icon');

      if (content) {
        if (content.style.display === 'none' || !content.style.display) {
          content.style.display = 'flex';
          if (icon) icon.style.transform = 'rotate(180deg)';
          if (text) text.textContent = 'Sembunyikan Detail';
        } else {
          content.style.display = 'none';
          if (icon) icon.style.transform = 'rotate(0deg)';
          if (text) text.textContent = 'Tampilkan Detail';
        }
      }
    });
  });
}
