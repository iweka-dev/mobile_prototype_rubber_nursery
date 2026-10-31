/**
 * js/modules/physical-stock-inspection/batch-transaction-history-view.js
 * TAMPILAN RIWAYAT TRANSAKSI & MUTASI PER BATCH (BATCH TRANSACTION LEDGER)
 * 
 * Desain: Profesional, Corporate, Clean & Minimalis
 * Tanpa warna berlebih atau ikon dekoratif yang tidak perlu.
 */

import { esc, formatDateTime, formatDate } from '../../core/utils.js';
import { getAllBatchesForHistory, getBatchTransactionHistory } from './batch-transaction-history-service.js';
import { openBapsbPrintPreviewModal } from './bapsb-print-template.js';

export function renderBatchTransactionHistoryView(app, initialBatchId = null, onBack = null) {
  if (!app) return;

  const allBatches = getAllBatchesForHistory();
  let currentSelectedBatchId = initialBatchId;

  // Jika initialBatchId belum dipilih, pilih batch pertama yang ada
  if (!currentSelectedBatchId && allBatches.length > 0) {
    currentSelectedBatchId = allBatches[0].id || allBatches[0].batchId || allBatches[0].batchCode;
  }

  function renderView() {
    const historyData = getBatchTransactionHistory(currentSelectedBatchId);
    const batch = historyData.batch || {};
    const summary = historyData.summary || {
      currentSystemQty: 0,
      totalInitialQty: 0,
      totalCullQty: 0,
      totalDispatchedQty: 0,
      surplusBufferQty: 0,
      totalTransactionsCount: 0
    };
    const timeline = historyData.timeline || [];

    app.innerHTML = `
      <div class="page" style="display:flex; flex-direction:column; height:100%; background:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        
        <!-- HEADER UTAMA -->
        <header style="height:56px; display:flex; align-items:center; gap:8px; padding:0 16px; background:#FFFFFF; border-bottom:1px solid #E2E8F0; flex-shrink:0;">
          <button id="btn-batch-history-back" type="button" aria-label="Kembali" style="padding:8px; margin-left:-8px; background:transparent; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <div style="flex:1; min-width:0;">
            <h1 style="font-size:1.05rem; font-weight:700; color:#0F172A; margin:0; letter-spacing:-0.01em;">Riwayat Transaksi Batch</h1>
          </div>
          <span style="font-size:0.72rem; font-weight:600; background:#F1F5F9; color:#475569; padding:3px 9px; border-radius:4px; border:1px solid #E2E8F0;">
            ${allBatches.length} Batch
          </span>
        </header>

        <!-- MAIN SCROLLABLE CONTENT -->
        <main style="flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px;">
          
          <!-- SELECTOR DROPDOWN BATCH -->
          <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:10px 12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
              <span style="font-size:0.68rem; font-weight:700; color:#64748B; text-transform:uppercase; letter-spacing:0.04em;">Pilih Batch Bibitan</span>
              <span style="font-size:0.68rem; color:#94A3B8;">Buku Stok Batch</span>
            </div>
            <div style="position:relative;">
              <select id="select-history-batch" aria-label="Pilih Batch Bibitan" style="width:100%; height:40px; border:1px solid #CBD5E1; border-radius:6px; padding:0 34px 0 10px; font-size:0.82rem; font-weight:600; color:#0F172A; background:#FFFFFF; -webkit-appearance:none; appearance:none; outline:none; cursor:pointer;">
                ${allBatches.map(b => {
      const bVal = String(b.id || b.batchId || b.batchCode);
      const isSelected = bVal === String(currentSelectedBatchId);
      const bedLabel = b.bedengan && b.bedengan !== '-' ? ` · ${b.bedengan}` : '';
      return `<option value="${esc(bVal)}" ${isSelected ? 'selected' : ''}>
                    ${esc(b.batchCode)} (${esc(b.clone)}${esc(bedLabel)}) — ${b.currentQty.toLocaleString('id-ID')} Pkk
                  </option>`;
    }).join('')}
              </select>
              <div style="position:absolute; right:10px; top:50%; transform:translateY(-50%); pointer-events:none; color:#64748B;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
          </div>

          <!-- KARTU IDENTITAS & REKAPITULASI SALDO BATCH (CORPORATE CLEAN) -->
          <section style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:14px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
            
            <!-- IDENTITAS BATCH & PROGRAM HEADER -->
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:8px;">
              <div style="flex:1; min-width:0;">
                <div style="font-size:1.20rem; font-weight:700; color:#0F172A; line-height:1.2;">
                  ${esc(batch.batchCode || currentSelectedBatchId)}
                </div>
                <div style="font-size:0.75rem; color:#475569; margin-top:4px;">
                  <span><strong>Klon:</strong> ${esc(batch.clone || '-')}</span> &nbsp;·&nbsp; <span><strong>Bedengan:</strong> ${esc(batch.bedengan || '-')}</span>${summary.seedlingAge?.formatted && summary.seedlingAge.formatted !== '-' ? ` &nbsp;·&nbsp; <span><strong>Umur:</strong> ${summary.seedlingAge.weeks > 0 ? `${summary.seedlingAge.weeks} Minggu` : `${summary.seedlingAge.days} Hari`}</span>` : ''}
                </div>

              </div>

              <!-- PROGRAM TEXT -->
              <div style="text-align:right; max-width:150px; font-size:0.72rem; color:#475569; line-height:1.35; flex-shrink:0;">
                <div style="font-size:0.62rem; color:#94A3B8; font-weight:700; text-transform:uppercase;">Program</div>
                <div style="font-weight:600; color:#1E293B;">${esc(batch.programName || '-')}</div>
              </div>
            </div>

            <!-- HERO METRIC: STOK SISTEM SHI (CLEAN CORPORATE) -->
            <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:11px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Stok Sistem SHI</div>
                <div style="font-size:0.68rem; color:#64748B; margin-top:1px;">Jumlah Stok Batch</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.40rem; font-weight:800; color:#116834; line-height:1; letter-spacing:-0.02em;">
                  ${summary.currentSystemQty.toLocaleString('id-ID')} <span style="font-size:0.75rem; font-weight:600; color:#475569;">Pkk</span>
                </div>
              </div>
            </div>

            <!-- 3-PART BREAKDOWN: STOK AWAL | DISELEKSI | PENGELUARAN (UNIFIED CORPORATE CARDS) -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
              
              <!-- STOK AWAL -->
              <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px;">
                <div style="font-size:0.64rem; font-weight:700; color:#64748B; text-transform:uppercase;">Stok Awal</div>
                <div style="font-size:0.95rem; font-weight:700; color:#0F172A; margin-top:2px; line-height:1.2;">
                  ${summary.totalInitialQty.toLocaleString('id-ID')}
                </div>
                <div style="font-size:0.62rem; font-weight:500; color:#64748B; margin-top:1px;">
                  Pkk
                </div>
              </div>

              <!-- DISELEKSI -->
              <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px;">
                <div style="font-size:0.64rem; font-weight:700; color:#64748B; text-transform:uppercase;">DiSeleksi</div>
                <div style="font-size:0.95rem; font-weight:700; color:#0F172A; margin-top:2px; line-height:1.2;">
                  ${summary.totalCullQty > 0 ? '-' : ''}${summary.totalCullQty.toLocaleString('id-ID')}
                </div>
                <div style="font-size:0.62rem; font-weight:500; color:#64748B; margin-top:1px;">
                  Pkk
                </div>
              </div>

              <!-- PENGELUARAN -->
              <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px;">
                <div style="font-size:0.64rem; font-weight:700; color:#64748B; text-transform:uppercase;">Pengeluaran</div>
                <div style="font-size:0.95rem; font-weight:700; color:#0F172A; margin-top:2px; line-height:1.2;">
                  ${summary.totalDispatchedQty > 0 ? '-' : ''}${summary.totalDispatchedQty.toLocaleString('id-ID')}
                </div>
                <div style="font-size:0.62rem; font-weight:500; color:#64748B; margin-top:1px;">
                  Pkk
                </div>
              </div>

            </div>

            <!-- BUFFER CADANGAN LEBIH DARI BAPSB (JIKA ADA) -->
            ${summary.surplusBufferQty > 0 ? `
              <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-left:3px solid #D97706; border-radius:6px; padding:9px 12px; display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                <div>
                  <div style="font-size:0.68rem; font-weight:700; color:#92400E; text-transform:uppercase;">Stok Cadangan Lebih (BAPSB)</div>
                  <div style="font-size:0.66rem; color:#64748B; line-height:1.35; margin-top:2px;">
                    Dicatat sah di Berita Acara & tidak merubah saldo buku
                  </div>
                </div>
                <div style="font-size:1.05rem; font-weight:700; color:#B45309; text-align:right; flex-shrink:0; margin-left:8px;">
                  +${summary.surplusBufferQty.toLocaleString('id-ID')} Pkk
                </div>
              </div>
            ` : ''}
          </section>

          <!-- HEADER TIMELINE MUTASI KRONOLOGIS -->
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:2px; padding:0 2px;">
            <div>
              <div style="font-size:0.88rem; font-weight:700; color:#0F172A;">
                Kronologis Mutasi & Transaksi
              </div>
              <div style="font-size:0.69rem; color:#64748B; margin-top:2px;">
                Riwayat Transaksi
              </div>
            </div>
            <span style="font-size:0.72rem; font-weight:600; color:#475569; background:#FFFFFF; border:1px solid #E2E8F0; padding:2px 8px; border-radius:4px;">
              ${timeline.length} Transaksi
            </span>
          </div>

          <!-- LIST TIMELINE KRONOLOGIS (CORPORATE CLEAN CARDS) -->
          ${timeline.length === 0 ? `
            <div style="padding:28px 16px; text-align:center; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; color:#64748B;">
              <div style="font-weight:700; font-size:0.86rem; color:#334155; margin-bottom:4px;">Belum Ada Riwayat Transaksi</div>
              <div style="font-size:0.74rem; line-height:1.4;">Belum ada mutasi atau transaksi operasional lanjutan yang tercatat untuk batch bibitan ini.</div>
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${timeline.map((item, idx) => {
      const isVerified = item.status === 'TERVERIFIKASI' || item.status === 'DISETUJUI' || String(item.status || '').includes('FINAL');

      return `
                  <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:12px 14px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    
                    <!-- ROW ATAS: NO LANGKAH, TIPE TRANSAKSI & WAKTU -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                      <div style="font-size:0.74rem; font-weight:700; color:#0F172A;">
                        #${idx + 1} · ${esc(item.typeLabel)}
                      </div>
                      <div style="font-size:0.68rem; color:#64748B;">
                        ${item.timestamp ? formatDateTime(item.timestamp) : '-'} WIB
                      </div>
                    </div>

                    <!-- ROW TENGAH: NO DOKUMEN & PERUBAHAN KUANTITAS -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                      <div>
                        <span style="font-size:0.80rem; font-weight:700; color:#1E293B; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                          ${esc(item.docNo)}
                        </span>
                      </div>
                      <div style="text-align:right; flex-shrink:0; margin-left:10px;">
                        <span style="font-size:1.05rem; font-weight:700; color:${item.qtyChange > 0 ? '#116834' : '#0F172A'};">
                          ${item.qtyChange > 0 ? `+${item.qtyChange.toLocaleString('id-ID')}` : (item.qtyChange < 0 ? item.qtyChange.toLocaleString('id-ID') : '0')}
                        </span>
                        <span style="font-size:0.68rem; font-weight:500; color:#64748B;">
                          ${esc(item.qtyUnit)}
                        </span>
                      </div>
                    </div>

                    <!-- KOTAK NARASI INFORMATIF (CLEAN) -->
                    <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; font-size:0.73rem; color:#334155; line-height:1.45; margin-bottom:8px;">
                      ${esc(item.narrative)}
                    </div>
                     ${Array.isArray(item.bedenganDetails) && item.bedenganDetails.length ? `
                       <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;padding:7px 9px;margin-bottom:8px;display:flex;flex-direction:column;gap:4px">
                         ${item.bedenganDetails.map(row => `
                           <div style="display:flex;justify-content:space-between;gap:8px;font-size:.68rem;color:#475569">
                             <span><strong style="color:#0F172A">${esc(row.bedenganCode || row.bedenganId || 'TOTAL_BATCH')}</strong> · ${esc(row.referenceStatus || 'LEGACY')}</span>
                             <span>Fisik ${Number(row.physicalQty || 0).toLocaleString('id-ID')} Pkk${row.difference !== null && row.difference !== undefined ? ` · ${Number(row.difference) > 0 ? '+' : ''}${Number(row.difference).toLocaleString('id-ID')}` : ''}</span>
                           </div>
                           ${row.referenceQty !== null && row.referenceQty !== undefined ? `<div style="font-size:.64rem;color:#64748B">Referensi: ${Number(row.referenceQty).toLocaleString('id-ID')} Pkk</div>` : ''}
                           ${row.reason ? `<div style="font-size:.64rem;color:#64748B">Alasan: ${esc(row.reason)}</div>` : ''}
                         `).join('')}
                       </div>
                     ` : ''}

                    <!-- ROW BAWAH: PETUGAS & STATUS VERIFIKASI -->
                    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #F1F5F9; padding-top:6px; font-size:0.69rem; color:#64748B;">
                      <div>
                        Petugas: <strong style="color:#0F172A;">${esc(item.actor)}</strong>
                      </div>
                      <div style="display:flex; align-items:center; gap:6px;">
                        ${isVerified ? `
                          <span style="font-size:0.68rem; font-weight:700; color:#116834; background:#F1F5F9; border:1px solid #CBD5E1; padding:2px 7px; border-radius:4px;">
                            ${esc(item.status)}
                          </span>
                        ` : `
                          <span style="font-size:0.68rem; font-weight:600; color:#475569; background:#F8FAFC; border:1px solid #E2E8F0; padding:2px 7px; border-radius:4px;">
                            ${esc(item.status)}
                          </span>
                        `}
                        ${item.isBapsb && item.bapsbDoc ? `
                          <button type="button" class="btn-history-view-bapsb" data-bapsb="${esc(item.bapsbDoc.id)}" style="background:#116834; color:#FFFFFF; border:none; border-radius:4px; padding:2px 8px; font-size:0.66rem; font-weight:700; cursor:pointer;">
                            Lihat BA
                          </button>
                        ` : ''}
                      </div>
                    </div>

                  </div>
                `;
    }).join('')}
            </div>
          `}

        </main>
      </div>
    `;

    // Event listener: Tombol Kembali
    app.querySelector('#btn-batch-history-back')?.addEventListener('click', () => {
      if (typeof onBack === 'function') {
        onBack();
      }
    });

    // Event listener: Ubah Pilihan Batch
    app.querySelector('#select-history-batch')?.addEventListener('change', (e) => {
      currentSelectedBatchId = e.target.value;
      renderView();
    });

    // Event listener: Lihat BA jika ada item BAPSB
    app.querySelectorAll('.btn-history-view-bapsb').forEach(btn => {
      btn.addEventListener('click', () => {
        const bId = btn.dataset.bapsb;
        const bDoc = (historyData.timeline || []).find(t => t.bapsbDoc && t.bapsbDoc.id === bId)?.bapsbDoc;
        if (bDoc) {
          openBapsbPrintPreviewModal(bDoc);
        }
      });
    });
  }

  renderView();
}
