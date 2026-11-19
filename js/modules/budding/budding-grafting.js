import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { formatStandardDocNo, todayDDMMYYYY, esc } from '../../core/utils.js';
import { normalizeKlonName } from '../../data/klon-master.js';
import { renderEmptyStateCard } from '../../components/empty-state.js';
import { renderStatusDots } from '../../core/status-dot-renderer.js';
import { isTransactionLockedForMantri } from '../verification/mantri-confirmation-service.js';
import { guardDependency } from '../../core/dependency-guard.js';
import { toast } from '../../components/toast.js';
import { getCurrentUserContext } from '../../core/user-context.js';
import { getAuthorizedTransactions, canUserAccessTransaction } from '../../core/transaction-actor.js';
import {
  normalizeDateStr,
  renderCalendarHeaderButton,
  renderDateFilterBannerHtml,
  renderDatePickerModalHtml,
  attachDatePickerModalEvents
} from '../../components/date-filter-modal.js';

let selectedGraftingDate = todayDDMMYYYY();

export function setSelectedGraftingDate(dateStr) {
  selectedGraftingDate = normalizeDateStr(dateStr) || todayDDMMYYYY();
}

export function getSelectedGraftingDate() {
  return selectedGraftingDate;
}

/**
 * Format string atau kode Bedengan agar seragam menjadi Kode Bedengan (misal: BED-001, BED-002)
 */
export function formatBedenganCode(bedengan, bedenganCode) {
  if (bedenganCode) {
    const codeStr = String(bedenganCode).trim();
    if (/^BED-\d+/i.test(codeStr)) return codeStr.toUpperCase();
    const m = codeStr.match(/(\d+)/);
    if (m) return `BED-${String(m[1]).padStart(3, '0')}`;
    return codeStr;
  }
  if (!bedengan) return '';
  const str = String(bedengan).trim();
  if (/^BED-\d+/i.test(str)) {
    return str.toUpperCase();
  }
  const match = str.match(/Bedengan[- ]*(\d+)/i);
  if (match) {
    return `BED-${String(match[1]).padStart(3, '0')}`;
  }
  return str;
}

export function renderBuddingGrafting() {
  const app = document.getElementById('app');
  const userCtx = getCurrentUserContext();

  // Load Seleksi III FINAL documents (Rootstock population source)
  const allSelectionDocs = storage.get('pre_grafting_selection_documents', []);
  const seleksi3FinalDocs = allSelectionDocs.filter(d => 
    (d.selectionStage === 'SELEKSI_III' || d.selectionStage === 'SELEKSI_3') &&
    (d.selectionType === 'PRA_OKULASI' || !d.selectionType) &&
    d.status === 'DISETUJUI' &&
    Boolean(d.isFinal)
  );
  const rawBuddingTxs = storage.get('budding_transactions', []).filter(b => b.type === 'GRAFTING' || !b.type);
  const allBuddingTxs = getAuthorizedTransactions(rawBuddingTxs, userCtx);
  const returnedGraftingTxs = allBuddingTxs.filter(b =>
    b.status === 'DIKEMBALIKAN' || b.verificationStatus === 'DIKEMBALIKAN'
  );
  const buddingTxs = allBuddingTxs.filter(b => {
    const isReturned = b.status === 'DIKEMBALIKAN' || b.verificationStatus === 'DIKEMBALIKAN';
    if (isReturned) return false;
    const d = normalizeDateStr(b.tanggal || b.date || b.createdAt);
    return d === selectedGraftingDate;
  });

  // Process and sort batches: yang belum selesai (Perlu Diokulasi) di ATAS, yang sudah selesai (Selesai Diokulasi) di BAWAH
  const processedBatchList = seleksi3FinalDocs.map((s3Doc, idx) => {
    const batchNo = s3Doc.batchCode || s3Doc.batchNo || `Batch-0${idx + 1}`;
    const docNo = s3Doc.docNo || formatStandardDocNo(2026, 'SEL-III', idx + 1);
    const populasiBibit = parseInt(
      s3Doc.totalLayak !== undefined
        ? s3Doc.totalLayak
        : (s3Doc.finalBibitQty !== undefined ? s3Doc.finalBibitQty : (s3Doc.currentBibitQty || 0)),
      10
    );

    // Calculate accumulated budding for this Seleksi III FINAL document
    let ttlDiokulasi = 0;
    let ttlDitolak = 0;
    let ttlKayu = 0;
    const relatedBuddings = allBuddingTxs.filter(b => 
      (b.sourceSelection3DocNo && b.sourceSelection3DocNo === docNo) ||
      (b.sourceSelection3DocumentId && s3Doc.id && b.sourceSelection3DocumentId === s3Doc.id) ||
      (b.sourceDocNo && b.sourceDocNo === docNo) ||
      (b.batchNo === batchNo && !b.sourceSelection3DocNo && !b.sourceDocNo)
    );
    relatedBuddings.forEach(b => {
      ttlDiokulasi += parseInt(b.jumlah || 0);
      ttlDitolak += parseInt(b.jumlahDitolak || 0);
      ttlKayu += parseInt(b.jumlahKayu || 0);
    });

    const totalRealisasi = ttlDiokulasi + ttlDitolak;
    const sisaBelumOkulasi = Math.max(0, populasiBibit - totalRealisasi);
    const persenSelesai = populasiBibit > 0 ? Math.min(100, Math.round((totalRealisasi / populasiBibit) * 100)) : 0;
    const isCompleted = sisaBelumOkulasi <= 0 && populasiBibit > 0;

    // Status badge
    let statusBadgeText = 'Perlu Diokulasi';
    let statusFlagKey = 'OKULASI_PERLU';

    if (totalRealisasi === 0) {
      statusBadgeText = 'Perlu Diokulasi';
      statusFlagKey = 'OKULASI_PERLU';
    } else if (sisaBelumOkulasi <= 0) {
      statusBadgeText = 'Selesai Diokulasi';
      statusFlagKey = 'OKULASI_SELESAI';
    } else {
      statusBadgeText = 'Okulasi Belum Selesai';
      statusFlagKey = 'OKULASI_BELUM_SELESAI';
    }

    // Extract bedengan rows (Tampilkan Kode Bedengan: BED-001, BED-002, dst)
    const rows = s3Doc.rows || [];
    const bedenganCodes = rows.map(r => formatBedenganCode(r.bedengan, r.bedenganCode)).filter(Boolean);
    const bedenganDisplay = bedenganCodes.length > 0 ? Array.from(new Set(bedenganCodes)).join(', ') : (formatBedenganCode(s3Doc.bedengan, s3Doc.bedenganCode) || 'BED-001');

    return {
      s3Doc,
      originalIdx: idx,
      batchNo,
      docNo,
      populasiBibit,
      ttlDiokulasi,
      ttlDitolak,
      ttlKayu,
      relatedBuddings,
      totalRealisasi,
      sisaBelumOkulasi,
      persenSelesai,
      isCompleted,
      statusFlagKey,
      statusBadgeText,
      bedenganDisplay
    };
  });

  // Urutkan: Dokumen/Batch yang belum selesai paling ATAS, yang sudah selesai paling BAWAH
  processedBatchList.sort((a, b) => {
    if (a.isCompleted === b.isCompleted) return 0;
    return a.isCompleted ? 1 : -1;
  });

  // Satu kartu per batch; dokumen sumber per bedengan tetap disimpan untuk pemilihan transaksi.
  const groupedBatchMap = new Map();
  processedBatchList.forEach(item => {
    const programKey = item.s3Doc.programCode || item.s3Doc.programName || item.s3Doc.program || '';
    const key = `${programKey}::${item.batchNo}`;
    if (!groupedBatchMap.has(key)) groupedBatchMap.set(key, { ...item, sources: [] });
    groupedBatchMap.get(key).sources.push(item);
  });
  const groupedBatchList = Array.from(groupedBatchMap.values()).map(group => {
    if (group.sources.length === 1) return group;
    const sum = field => group.sources.reduce((total, source) => total + (Number(source[field]) || 0), 0);
    const rows = group.sources.flatMap(source => {
      const sourceRows = source.s3Doc.rows || [];
      return sourceRows.length ? sourceRows : [{
        bedengan: source.s3Doc.bedengan,
        bedenganCode: source.s3Doc.bedenganCode,
        disemai: source.populasiBibit,
        klon: source.s3Doc.klon || source.s3Doc.clone
      }];
    });
    group.s3Doc = { ...group.s3Doc, rows };
    group.populasiBibit = sum('populasiBibit');
    group.ttlDiokulasi = sum('ttlDiokulasi');
    group.ttlDitolak = sum('ttlDitolak');
    group.ttlKayu = sum('ttlKayu');
    group.totalRealisasi = sum('totalRealisasi');
    group.sisaBelumOkulasi = sum('sisaBelumOkulasi');
    group.persenSelesai = group.populasiBibit > 0
      ? Math.min(100, Math.round((group.totalRealisasi / group.populasiBibit) * 100)) : 0;
    group.isCompleted = group.sources.every(source => source.isCompleted);
    group.statusFlagKey = group.isCompleted ? 'OKULASI_SELESAI'
      : group.totalRealisasi > 0 ? 'OKULASI_BELUM_SELESAI' : 'OKULASI_PERLU';
    group.statusBadgeText = group.isCompleted ? 'Selesai Diokulasi'
      : group.totalRealisasi > 0 ? 'Okulasi Belum Selesai' : 'Perlu Diokulasi';
    group.bedenganDisplay = Array.from(new Set(group.sources.map(source => source.bedenganDisplay))).join(', ');
    group.docNo = `${group.sources.length} dokumen Seleksi III FINAL`;
    group.relatedBuddings = group.sources.flatMap(source => source.relatedBuddings);
    return group;
  });
  groupedBatchList.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: #FFFFFF; border-bottom: 1px solid #D9D9D9; flex-shrink: 0;">
        <div style="display: flex; align-items: center;">
          <button id="btn-back" type="button" aria-label="Kembali" style="padding: 8px; margin-left: -8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h1 style="font-size: 1.05rem; font-weight: 700; color: #111111; margin: 0 0 0 6px; letter-spacing: -0.01em;">Okulasi (Grafting)</h1>
        </div>
        <div>
          ${renderCalendarHeaderButton('btn-open-date-filter', selectedGraftingDate)}
        </div>
      </header>

      <!-- MAIN CONTENT -->
      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        
        <div style="margin-bottom: 12px;">
          <h2 style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0 0 10px 0;">Daftar Batch Siap Okulasi</h2>
        </div>

        ${groupedBatchList.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
            ${groupedBatchList.map((item, groupIndex) => {
              const {
                s3Doc,
                originalIdx,
                batchNo,
                docNo,
                populasiBibit,
                ttlDiokulasi,
                ttlDitolak,
                ttlKayu,
                relatedBuddings,
                totalRealisasi,
                sisaBelumOkulasi,
                persenSelesai,
                statusFlagKey,
                statusBadgeText,
                bedenganDisplay
              } = item;
              const rows = s3Doc.rows || [];

              return `
                <div class="card-batch-wrapper" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  
                  <!-- HEADER BARIS 1: NOMOR BATCH & BADGE STATUS -->
                  <div style="display: flex; align-items: center; margin-bottom: 4px; gap: 6px;">
                    <div style="display:flex;align-items:center;gap:6px;min-width:0;">
                      ${renderStatusDots([{ key: statusFlagKey, label: statusBadgeText }])}
                      <div style="font-size: 0.95rem; font-weight: 800; color: #116834; white-space: nowrap; letter-spacing: -0.01em;">
                        ${batchNo}
                      </div>
                    </div>
                    <div style="margin-left:auto;flex-shrink:0;padding:3px 8px;border-radius:999px;background:#EAF6EE;color:#116834;font-size:.78rem;font-weight:800;line-height:1.2;">
                      ${persenSelesai}% diokulasi
                    </div>
                  </div>

                  <!-- HEADER BARIS 2: DOKUMEN ASAL & TANGGAL -->
                  <div style="font-size: 0.82rem; font-weight: 700; color: #111111; margin-bottom: 2px;">
                    ${docNo}
                  </div>
                  <div style="font-size: 0.72rem; color: #6B7280; margin-bottom: 10px;">
                    Dokumen Seleksi III FINAL • Disetujui Asisten Bibitan
                  </div>

                  <!-- TOMBOL TOGGLE EXPAND DETAIL -->
                  <div style="margin:8px 0;">
                    <button type="button" class="btn-toggle-expand-batch" style="background: #F0FDF4; border: 1px solid #DCFCE7; border-radius: 6px; width: 100%; padding: 6px 10px; font-size: 0.74rem; font-weight: 700; color: #116834; cursor: pointer; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box;">
                      <span class="text-expand-batch">Tampilkan Detail</span>
                      <svg class="icon-expand-batch" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease;">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                  </div>

                  <!-- EXPANDABLE ACCORDION DETAIL (LOCATED DIRECTLY BELOW BUTTON) -->
                  <div class="batch-expand-content" style="display: none; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.74rem; line-height: 1.45;">
                    <hr style="border:none;border-top:1px solid #E2E8F0;margin:0 0 10px;" />
                    <!-- RINGKASAN BATCH, DITAMPILKAN SAAT DETAIL DIBUKA -->
                    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 12px;margin-bottom:12px;">
                      <div>
                        <div style="font-size:.70rem;color:#6B7280;margin-bottom:2px;">Klon Batang Bawah</div>
                        <div style="font-size:.82rem;font-weight:700;color:#111827;line-height:1.3;">${s3Doc.klon ? normalizeKlonName(s3Doc.klon) : (s3Doc.clone ? normalizeKlonName(s3Doc.clone) : 'GT 1')}</div>
                      </div>
                      <div>
                        <div style="font-size:.70rem;color:#6B7280;margin-bottom:2px;">Lokasi Bedengan</div>
                        <div style="font-size:.82rem;font-weight:700;color:#111827;line-height:1.35;word-break:break-word;">${bedenganDisplay}</div>
                      </div>
                      <div>
                        <div style="font-size:.70rem;color:#6B7280;margin-bottom:2px;">Populasi Siap Okulasi (Layak)</div>
                        <div style="font-size:.82rem;font-weight:700;color:#116834;line-height:1.3;">${populasiBibit.toLocaleString('id-ID')} Pkk</div>
                      </div>
                      <div>
                        <div style="font-size:.70rem;color:#6B7280;margin-bottom:2px;">Belum Diokulasi</div>
                        <div style="font-size:.82rem;font-weight:700;color:${sisaBelumOkulasi > 0 ? '#D32F2F' : '#116834'};line-height:1.3;">${sisaBelumOkulasi.toLocaleString('id-ID')} Pkk</div>
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Program Nursery:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right; word-break: break-word;">${s3Doc.programCode || s3Doc.programName || s3Doc.program || 'PRG/NUR/01/2026'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Tahapan Pertumbuhan:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right; word-break: break-word;">${(s3Doc.tahapan || s3Doc.growthStage || 'Rubber Main Nursery').replace(/\s*\(Seleksi\s*III\s*-\s*Stadia\s*15-16\s*Minggu\)/gi, '').replace(/\s*\(Seleksi\s*III\s*FINAL\)/gi, '').trim() || 'Rubber Main Nursery'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Total Diokulasi SDHI:</span>
                      <span style="font-weight: 700; color: #116834; text-align: right; word-break: break-word;">${ttlDiokulasi.toLocaleString('id-ID')} Pkk (${persenSelesai}%)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Total Bibit Ditolak:</span>
                      <span style="font-weight: 700; color: #D32F2F; text-align: right; word-break: break-word;">${ttlDitolak.toLocaleString('id-ID')} Pkk</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Total Kayu Entres Dipakai:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right; word-break: break-word;">${ttlKayu.toLocaleString('id-ID')} Batang</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Ref. Dokumen Seleksi II:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right; word-break: break-word;">${s3Doc.sourceSelectionDocNo || s3Doc.sourceDocNo || '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px;">
                      <span style="color: #6B7280; flex-shrink: 0;">Ref. Dokumen Penyemaian:</span>
                      <span style="font-weight: 700; color: #111827; text-align: right; word-break: break-word;">${s3Doc.sourceSeedingDocNo || '-'}</span>
                    </div>

                    ${rows.length > 0 ? `
                      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #D1D5DB;">
                        <div style="font-weight: 700; color: #374151; margin-bottom: 4px;">Rincian Bedengan Asal:</div>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                          ${rows.map(r => `
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #4B5563;">
                              <span style="word-break: break-word;">• ${formatBedenganCode(r.bedengan, r.bedenganCode) || 'BED-001'} (${r.klon ? normalizeKlonName(r.klon) : (s3Doc.klon ? normalizeKlonName(s3Doc.klon) : 'GT 1')})</span>
                              <span style="font-weight: 700; color: #116834; white-space: nowrap; flex-shrink: 0;">${parseInt(r.disemai || r.sourceBibitQty || 0).toLocaleString('id-ID')} Pkk</span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    ` : ''}
                  </div>

                  <!-- FOOTER ACTION ROW -->
                  ${sisaBelumOkulasi <= 0 ? `
                    <div class="card-action-rekam" data-index="${originalIdx}" data-doc="${docNo}" data-id="${s3Doc.id || ''}" data-completed="true" style="display: flex; justify-content: flex-end; align-items: center; padding-top: 8px; border-top: 1px dashed #E5E7EB; cursor: default;">
                      <div style="display: flex; align-items: center; gap: 4px; color: #116834; font-weight: 700; font-size: 0.74rem;">
                        <span>Batch Selesai</span>
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    </div>
                  ` : `
                    <button type="button" class="card-action-rekam" data-group-index="${groupIndex}" data-completed="false" style="width: 100%; min-height: 44px; margin-top: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; box-sizing: border-box; border: 0; border-radius: 7px; background: #116834; color: #fff; font: inherit; font-size: 0.9rem; font-weight: 700; text-align: left; cursor: pointer;">
                      <span>Rekam Okulasi</span>
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" style="flex: 0 0 auto;">
                          <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                  `}

                </div>
              `;
            }).join('')}
          </div>
        ` : renderEmptyStateCard({
          title: 'Belum Ada Bibit Siap Diokulasi',
          description: 'Belum ada bibit yang siap diokulasi. Seleksi III belum final.',
          customStyle: 'margin-top: 24px;'
        })}

        <!-- SECTION: OKULASI PERLU PERBAIKAN (RETURNED FROM ASISTEN) -->
        ${returnedGraftingTxs.length > 0 ? `
          <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; width: 3px; height: 14px; border-radius: 2px; background: #DC2626;"></span>
                <h2 style="font-size: 0.92rem; font-weight: 700; color: #0F172A; margin: 0;">
                  Transaksi Okulasi Perlu Perbaikan
                </h2>
              </div>
              <span style="font-size: 0.68rem; font-weight: 600; background: #FEF2F2; color: #DC2626; padding: 2px 8px; border-radius: 9999px; border: 1px solid #FECACA;">
                ${returnedGraftingTxs.length} dokumen menunggu koreksi
              </span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${returnedGraftingTxs.map((tx, idx) => {
                const docNo = tx.docNo ? tx.docNo.replace('/OKL/', '/GRF/') : formatStandardDocNo(2026, 'GRF', idx + 1);
                const returnNote = tx.returnReason || tx.lastReturnReason || 'Perlu perbaikan data.';
                const jmlDiokulasi = parseInt(tx.jumlah || 0);
                const jmlKayu = parseInt(tx.jumlahKayu || 0);
                const bedenganStr = tx.bedengan ? formatBedenganCode(tx.bedengan, tx.bedenganCode) : 'BED-001';

                return `
                  <div class="card-summary-wrapper card-returned-okulasi-wrapper" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 0.78rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); position: relative;">
                    
                    <!-- BARIS 1: IDENTITAS DOKUMEN & BADGE DIKEMBALIKAN -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                      <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                          <span style="font-weight: 800; font-size: 0.95rem; color: #0F172A; letter-spacing: -0.01em;">${esc(docNo)}</span>
                          <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; display: inline-flex; align-items: center; gap: 4px;">
                            <span style="width: 5px; height: 5px; border-radius: 50%; background: #DC2626;"></span>
                            Dikembalikan
                          </span>
                        </div>
                        
                        <!-- BARIS 2 & 3: METADATA -->
                        <div style="font-size: 0.74rem; color: #64748B; margin-top: 4px; line-height: 1.35;">
                          Batch: <strong style="color: #334155; font-weight: 600;">${esc(tx.batchNo || 'Batch-01')}</strong> • Klon: <strong style="color: #116834; font-weight: 600;">${esc(tx.klonEntres || tx.klon || 'PB 260')}</strong>
                        </div>
                        <div style="font-size: 0.74rem; color: #64748B; margin-top: 2px; line-height: 1.35;">
                          Bedengan: <strong style="color: #0F172A; font-weight: 600;">${esc(bedenganStr)}</strong> • Tgl: <span style="color: #475569; font-weight: 500;">${esc(tx.tanggal || tx.date || '-')}</span>
                        </div>
                      </div>

                      <!-- 3-DOTS ACTION TRIGGER -->
                      <div style="position: relative; flex-shrink: 0; margin-left: 8px;">
                        <button type="button" class="btn-tx-action-trigger" data-index="ret-grf-${idx}" aria-label="Menu Aksi" style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #4B5563; padding: 0;">
                          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="1.2" fill="currentColor"></circle>
                            <circle cx="19" cy="12" r="1.2" fill="currentColor"></circle>
                            <circle cx="5" cy="12" r="1.2" fill="currentColor"></circle>
                          </svg>
                        </button>

                        <!-- POPUP MENU -->
                        <div class="tx-action-menu" style="display: none; position: absolute; right: 0; top: 32px; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); z-index: 100; min-width: 140px; overflow: hidden;">
                          <button type="button" class="menu-action-edit" data-doc="${esc(tx.docNo || '')}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #116834; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <svg viewBox="0 0 24 24" width="13" height="13" stroke="#116834" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span>Edit / Koreksi</span>
                          </button>
                        </div>
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

                    <!-- BARIS 5: METRICS CONTAINER -->
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                      <div>
                        <span style="font-size: 0.68rem; color: #64748B;">Total Diokulasi</span>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #116834; margin-top: 1px;">
                          ${jmlDiokulasi.toLocaleString('id-ID')} Pkk
                        </div>
                      </div>
                      <div style="text-align: right;">
                        <span style="font-size: 0.68rem; color: #64748B;">Kayu Okulasi</span>
                        <div style="font-size: 0.85rem; font-weight: 800; color: #0F172A; margin-top: 1px;">
                          ${jmlKayu.toLocaleString('id-ID')} Batang
                        </div>
                      </div>
                    </div>

                    <!-- BARIS 6: DIRECT ACTION BUTTON -->
                    <button type="button" class="btn-koreksi-okulasi" data-doc="${esc(tx.docNo || '')}" style="width: 100%; height: 38px; margin-top: 10px; background: #116834; color: #FFFFFF; border: none; border-radius: 6px; font-weight: 700; font-size: 0.80rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 2px rgba(17,104,52,0.15); transition: all 0.15s ease;">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="#FFFFFF" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      <span>Edit / Koreksi Okulasi</span>
                    </button>

                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- STATUS BANNER FILTER TANGGAL (JIKA MEMILIH TANGGAL LAMPAU) -->
        ${renderDateFilterBannerHtml(selectedGraftingDate, 'btn-reset-date-filter')}

        <!-- HISTORI / RINGKASAN DATA OKULASI DENGAN MENU AKSI 3-DOTS (...) -->
        ${buddingTxs.length > 0 ? `
          <div style="margin: 20px 0 10px 0;">
            <h2 style="font-size: 0.92rem; font-weight: 700; color: #111111; margin: 0;">Ringkasan Data Okulasi (${buddingTxs.length})</h2>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${buddingTxs.map((tx, idx) => {
              const workersList = tx.workers || [];
              const docNo = tx.docNo ? tx.docNo.replace('/OKL/', '/GRF/') : formatStandardDocNo(2026, 'GRF', idx + 1);
              const jmlDiokulasi = parseInt(tx.jumlah || 0);
              const jmlKayu = parseInt(tx.jumlahKayu || 0);
              const jmlMataEntres = (tx.jumlahMataEntres !== undefined && tx.jumlahMataEntres !== null && tx.jumlahMataEntres !== '') 
                ? parseInt(tx.jumlahMataEntres).toLocaleString('id-ID') 
                : (jmlDiokulasi > 0 ? jmlDiokulasi.toLocaleString('id-ID') : '-');

              return `
                <div class="card-summary-wrapper" style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 10px; padding: 14px 16px; font-size: 0.78rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); position: relative; margin-bottom: 8px;">
                  
                  <!-- BAGIAN A: IDENTITAS DOKUMEN -->
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                    <div style="min-width: 0; flex: 1;">
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-weight: 800; font-size: 0.98rem; color: #111827; letter-spacing: -0.01em;">${docNo}</span>
                        <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #E8F5E9; color: #116834; border: 1px solid #C8E6C9;">
                          Okulasi
                        </span>
                      </div>
                      <div style="font-weight: 700; font-size: 0.86rem; color: #111827; margin-top: 4px;">
                        ${tx.batchNo || 'Batch-01'} <span style="color: #9CA3AF; margin: 0 2px;">•</span> ${tx.klonEntres || tx.klon || 'PB 260'}
                      </div>
                      <div style="font-size: 0.74rem; color: #6B7280; margin-top: 2px;">
                        ${tx.bedengan ? formatBedenganCode(tx.bedengan, tx.bedenganCode) : 'BED-001'} <span style="color: #9CA3AF; margin: 0 2px;">•</span> ${tx.tanggal || 'Hari ini'}
                      </div>
                      <div style="font-size: 0.74rem; color: #6B7280; margin-top: 2px;">
                        Dok. Penyemaian: <span style="color: #374151; font-weight: 600;">${tx.sourceDocNo || '-'}</span>
                      </div>
                    </div>

                    <!-- TOMBOL AKSI 3-DOTS / STATUS BADGE -->
                    ${(() => {
                      const isGraftingLocked = isTransactionLockedForMantri(tx);
                      if (!isGraftingLocked) {
                        return `
                          <div style="position: relative; flex-shrink: 0; margin-top: 2px;">
                            <button type="button" class="btn-tx-action-trigger" data-index="${idx}" aria-label="Menu Aksi" style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #4B5563; padding: 0;">
                              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="1.2" fill="currentColor"></circle>
                                <circle cx="19" cy="12" r="1.2" fill="currentColor"></circle>
                                <circle cx="5" cy="12" r="1.2" fill="currentColor"></circle>
                              </svg>
                            </button>

                            <!-- DROPDOWN POPUP MENU -->
                            <div class="tx-action-menu" style="display: none; position: absolute; right: 0; top: 34px; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); z-index: 100; min-width: 130px; overflow: hidden;">
                              <button type="button" class="menu-action-edit" data-index="${idx}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #116834; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid #F3F4F6;">
                                <svg viewBox="0 0 24 24" width="13" height="13" stroke="#116834" stroke-width="2.2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Edit</span>
                              </button>
                              <button type="button" class="menu-action-delete" data-index="${idx}" data-doc="${tx.docNo || ''}" style="width: 100%; padding: 8px 12px; text-align: left; background: transparent; border: none; font-size: 0.75rem; font-weight: 600; color: #DC2626; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <svg viewBox="0 0 24 24" width="13" height="13" stroke="#DC2626" stroke-width="2.2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                <span>Hapus</span>
                              </button>
                            </div>
                          </div>
                        `;
                      } else {
                        const isVerified = tx.status === 'DISETUJUI' || tx.verificationStatus === 'TERVERIFIKASI';
                        return `
                          <span style="display: inline-flex; align-items: center; flex: 0 0 auto; white-space: nowrap; font-size: 0.62rem; line-height: 1.15; font-weight: 700; color: ${isVerified ? '#047857' : '#1D4ED8'}; background: ${isVerified ? '#ECFDF5' : '#EFF6FF'}; border: 1px solid ${isVerified ? '#A7F3D0' : '#BFDBFE'}; padding: 3px 8px; border-radius: 9999px; margin-top: 2px;">
                            ${isVerified ? 'Terverifikasi' : 'Menunggu Verifikasi'}
                          </span>
                        `;
                      }
                    })()}
                  </div>

                  <!-- BAGIAN B: TOMBOL LIHAT DETAIL -->
                  <div>
                    <button type="button" class="btn-toggle-expand-summary" style="background: #F0FDF4; border: 1px solid #DCFCE7; border-radius: 6px; width: 100%; padding: 6px 10px; font-size: 0.74rem; font-weight: 700; color: #116834; cursor: pointer; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box;">
                      <span class="text-expand-summary">Lihat Detail</span>
                      <svg class="icon-expand-summary" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease;">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                  </div>

                  <!-- EXPANDABLE CONTENT (TERSEMBUNYI SAAT COLLAPSED, TERBUKA SAAT EXPANDED) -->
                  <div class="summary-expand-content" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #E5E7EB;">
                    
                    <!-- RINGKASAN PRODUKSI (2x2 GRID HARMONIS) -->
                    <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; font-size: 0.74rem;">
                      <div>
                        <div style="font-size: 0.68rem; color: #6B7280; margin-bottom: 2px;">Total Diokulasi</div>
                        <div style="font-size: 0.82rem; font-weight: 700; color: #116834; line-height: 1.3;">${jmlDiokulasi.toLocaleString('id-ID')} Pkk</div>
                      </div>
                      <div>
                        <div style="font-size: 0.68rem; color: #6B7280; margin-bottom: 2px;">Kayu Okulasi</div>
                        <div style="font-size: 0.82rem; font-weight: 700; color: #116834; line-height: 1.3;">${jmlKayu.toLocaleString('id-ID')} Batang</div>
                      </div>
                      <div>
                        <div style="font-size: 0.68rem; color: #6B7280; margin-bottom: 2px;">Jumlah Mata Entres</div>
                        <div style="font-size: 0.82rem; font-weight: 700; color: #116834; line-height: 1.3;">${jmlMataEntres}</div>
                      </div>
                      <div>
                        <div style="font-size: 0.68rem; color: #6B7280; margin-bottom: 2px;">Batang Bawah</div>
                        <div style="font-size: 0.82rem; font-weight: 700; color: #111827; line-height: 1.3;">${tx.klonRootstock ? normalizeKlonName(tx.klonRootstock) : 'GT 1'}</div>
                      </div>
                      ${parseInt(tx.jumlahDitolak || 0) > 0 ? `
                        <div style="grid-column: span 2; display: flex; justify-content: space-between; align-items: center; padding-top: 6px; border-top: 1px dashed #E5E7EB; margin-top: 2px;">
                          <span style="font-size: 0.68rem; color: #6B7280;">Bibit Ditolak:</span>
                          <span style="font-size: 0.80rem; font-weight: 700; color: #D32F2F;">${parseInt(tx.jumlahDitolak).toLocaleString('id-ID')} Pkk</span>
                        </div>
                      ` : ''}
                    </div>

                    <!-- DETAIL PEKERJA LENGKAP -->
                    ${workersList.length > 0 ? `
                      <div>
                        <div style="font-weight: 700; color: #111827; margin-bottom: 6px; font-size: 0.76rem;">Pekerja Okulasi:</div>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                          ${workersList.map(w => `
                            <div style="display: flex; justify-content: space-between; align-items: center; color: #4B5563; font-size: 0.74rem;">
                              <span>• ${w.name} <span style="color: #9CA3AF;">(${w.code})</span></span>
                              <span style="font-weight: 700; color: #116834; text-align: right;">${parseInt(w.qty || 0).toLocaleString('id-ID')} Pkk</span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    ` : `
                      <div style="color: #9CA3AF; font-size: 0.74rem; font-style: italic;">Tidak ada data pekerja</div>
                    `}

                  </div>

                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

      </main>

      <!-- MODAL FILTER TANGGAL (HARI INI, KEMARIN, PILIH TANGGAL) -->
      ${renderDatePickerModalHtml(selectedGraftingDate)}
    </div>
  `;

  // Event Listener: Back button
  app.querySelector('#btn-back').addEventListener('click', () => {
    navigate('/budding');
  });

  // Event Listener: Expand / Collapse on Batch Cards
  app.querySelectorAll('.card-batch-wrapper').forEach(wrapper => {
    const btnToggle = wrapper.querySelector('.btn-toggle-expand-batch');
    const content = wrapper.querySelector('.batch-expand-content');
    const textSpan = wrapper.querySelector('.text-expand-batch');
    const icon = wrapper.querySelector('.icon-expand-batch');

    if (btnToggle && content) {
      btnToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = content.style.display === 'block';
        content.style.display = isOpen ? 'none' : 'block';
        textSpan.textContent = isOpen ? 'Tampilkan Detail' : 'Sembunyikan Detail';
        icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
    }
  });

  // Event Listener: Expand / Collapse on Summary Cards (Single-expand with Auto-scroll)
  app.querySelectorAll('.card-summary-wrapper').forEach(wrapper => {
    const btnToggle = wrapper.querySelector('.btn-toggle-expand-summary');
    const content = wrapper.querySelector('.summary-expand-content');
    const textSpan = wrapper.querySelector('.text-expand-summary');
    const icon = wrapper.querySelector('.icon-expand-summary');

    if (btnToggle && content) {
      btnToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = content.style.display !== 'block';

        // Close all other summary cards (single-expand behavior)
        app.querySelectorAll('.card-summary-wrapper').forEach(otherWrapper => {
          if (otherWrapper !== wrapper) {
            const otherContent = otherWrapper.querySelector('.summary-expand-content');
            const otherTextSpan = otherWrapper.querySelector('.text-expand-summary');
            const otherIcon = otherWrapper.querySelector('.icon-expand-summary');
            if (otherContent) otherContent.style.display = 'none';
            if (otherTextSpan) otherTextSpan.textContent = 'Lihat Detail';
            if (otherIcon) otherIcon.style.transform = 'rotate(0deg)';
          }
        });

        // Toggle current card
        content.style.display = willOpen ? 'block' : 'none';
        if (textSpan) textSpan.textContent = willOpen ? 'Sembunyikan Detail' : 'Lihat Detail';
        if (icon) icon.style.transform = willOpen ? 'rotate(180deg)' : 'rotate(0deg)';

        // Auto-scroll / focus to the opened card
        if (willOpen) {
          setTimeout(() => {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
        }
      });
    }
  });

  // Event Listener: Action Rekam Okulasi
  app.querySelectorAll('.card-action-rekam').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.currentTarget.dataset.completed === 'true') return;
      const group = groupedBatchList[Number(e.currentTarget.dataset.groupIndex)];
      if (!group) return;
      const choices = group.sources.filter(source => source.sisaBelumOkulasi > 0);
      const modal = document.createElement('div');
      modal.className = 'grafting-bedengan-picker';
      modal.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:auto;background:rgba(15,23,42,.48);display:flex;align-items:flex-end;justify-content:center;padding:0;box-sizing:border-box;';
      modal.innerHTML = `
        <section style="width:100%;max-height:80%;overflow:auto;background:#fff;border-radius:16px 16px 0 0;padding:18px 16px 20px;box-sizing:border-box;box-shadow:0 -8px 28px rgba(0,0,0,.16);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <div style="font-size:1rem;font-weight:800;color:#111827;">Pilih Bedengan</div>
              <div style="font-size:.78rem;color:#64748B;margin-top:3px;">${esc(group.batchNo)} • ${choices.length} bedengan tersedia</div>
            </div>
            <button type="button" class="btn-close-bedengan-picker" aria-label="Tutup" style="border:0;background:transparent;color:#64748B;font-size:1.4rem;cursor:pointer;padding:4px 8px;">×</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${choices.map(source => `
              <button type="button" class="btn-select-grafting-source" data-index="${source.originalIdx}" data-doc="${esc(source.docNo)}" data-id="${esc(source.s3Doc.id || '')}" style="width:100%;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;background:#fff;border:1px solid #DCE5EF;border-radius:9px;color:#111827;cursor:pointer;">
                <span>
                  <strong style="display:block;font-size:.9rem;">${esc(source.bedenganDisplay)}</strong>
                  <span style="display:block;margin-top:4px;font-size:.74rem;color:#64748B;">Dokumen: ${esc(source.docNo)}</span>
                </span>
                <span style="flex-shrink:0;text-align:right;">
                  <strong style="display:block;color:#116834;font-size:.82rem;">${source.sisaBelumOkulasi.toLocaleString('id-ID')} Pkk</strong>
                  <span style="font-size:.7rem;color:#64748B;">tersedia</span>
                </span>
              </button>
            `).join('')}
          </div>
        </section>`;
      const modalRoot = document.getElementById('modal-root') || document.getElementById('device-screen') || app;
      modalRoot.appendChild(modal);
      const closePicker = () => modal.remove();
      modal.querySelector('.btn-close-bedengan-picker').addEventListener('click', closePicker);
      modal.addEventListener('click', event => { if (event.target === modal) closePicker(); });
      modal.querySelectorAll('.btn-select-grafting-source').forEach(option => {
        option.addEventListener('click', () => {
          storage.remove('editing_budding_index');
          storage.set('selected_grafting_batch_index', option.dataset.index);
          storage.set('selected_grafting_batch_doc_no', option.dataset.doc);
          if (option.dataset.id) storage.set('selected_grafting_batch_id', option.dataset.id);
          else storage.remove('selected_grafting_batch_id');
          storage.remove('budding_qr_verified');
          navigate('/budding/grafting/scan');
        });
      });
    });
  });

  // Event Listener: 3-Dots Action Menu Trigger
  app.querySelectorAll('.btn-tx-action-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = e.currentTarget.closest('.card-summary-wrapper');
      const menu = wrapper?.querySelector('.tx-action-menu');
      
      // Close other open menus
      app.querySelectorAll('.tx-action-menu').forEach(m => {
        if (m !== menu) m.style.display = 'none';
      });

      if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      }
    });
  });

  // Close menus when clicking outside
  document.addEventListener('click', () => {
    app.querySelectorAll('.tx-action-menu').forEach(m => {
      m.style.display = 'none';
    });
  });

  // Event Listener: Action Rincian (Toggle Expand)
  app.querySelectorAll('.menu-action-rincian').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = e.currentTarget.closest('.card-summary-wrapper');
      const menu = wrapper?.querySelector('.tx-action-menu');
      if (menu) menu.style.display = 'none';

      const content = wrapper?.querySelector('.summary-expand-content');
      if (content) {
        content.style.display = content.style.display === 'block' ? 'none' : 'block';
      }
    });
  });

  // Event Listener: Action Edit / Koreksi Okulasi
  const handleEditGrafting = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const doc = e.currentTarget.dataset.doc;
    const rawIdx = e.currentTarget.dataset.index;
    const allTxs = storage.get('budding_transactions', []);
    let origIdx = -1;
    if (doc) {
      origIdx = allTxs.findIndex(b => b.docNo === doc || (b.type === 'GRAFTING' && b.docNo?.replace('/OKL/', '/GRF/') === doc));
    }
    if (origIdx < 0 && rawIdx !== undefined && rawIdx !== null && !isNaN(parseInt(rawIdx, 10))) {
      origIdx = parseInt(rawIdx, 10);
    }

    const targetTx = allTxs[origIdx];
    if (!targetTx) {
      toast('Data transaksi Okulasi tidak ditemukan', 'error');
      return;
    }

    if (!canUserAccessTransaction(targetTx, userCtx, 'UPDATE')) {
      toast('Anda tidak memiliki otoritas untuk mengedit transaksi ini.', 'error');
      return;
    }

    if (isTransactionLockedForMantri(targetTx)) {
      toast('Transaksi Okulasi tidak dapat diubah karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.', 'error');
      return;
    }

    storage.set('editing_budding_index', origIdx);
    storage.set('selected_grafting_batch_index', targetTx?.seedingIndex !== undefined ? targetTx.seedingIndex : 0);
    storage.set('budding_type', 'GRAFTING');
    navigate('/budding/grafting/form');
  };

  app.querySelectorAll('.btn-koreksi-okulasi, .menu-action-edit').forEach(btn => {
    btn.addEventListener('click', handleEditGrafting);
  });

  // Event Listener: Action Delete Okulasi
  app.querySelectorAll('.menu-action-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = e.currentTarget.closest('.card-summary-wrapper');
      const menu = wrapper?.querySelector('.tx-action-menu');
      if (menu) menu.style.display = 'none';

      const doc = e.currentTarget.dataset.doc;
      const rawIdx = e.currentTarget.dataset.index;
      let allTxs = storage.get('budding_transactions', []);
      let actualIdx = -1;
      if (doc) {
        actualIdx = allTxs.findIndex(b => b.docNo === doc || (b.type === 'GRAFTING' && b.docNo?.replace('/OKL/', '/GRF/') === doc));
      }
      if (actualIdx < 0 && rawIdx !== undefined && rawIdx !== null && !isNaN(parseInt(rawIdx, 10))) {
        actualIdx = parseInt(rawIdx, 10);
      }

      const targetTx = allTxs[actualIdx];

      if (!targetTx || !canUserAccessTransaction(targetTx, userCtx, 'DELETE')) {
        toast('Anda tidak memiliki otoritas untuk menghapus transaksi ini.', 'error');
        return;
      }

      if (isTransactionLockedForMantri(targetTx)) {
        toast('Transaksi Okulasi tidak dapat dihapus karena sedang dalam proses verifikasi Asisten Bibitan atau sudah disetujui.', 'error');
        return;
      }

      if (guardDependency(targetTx || doc, 'Okulasi (Grafting)', 'Dihapus')) {
        return;
      }

      if (confirm(`Apakah Anda yakin ingin menghapus transaksi okulasi "${doc || targetTx.docNo || ''}"?`)) {
        if (actualIdx !== -1) {
          allTxs.splice(actualIdx, 1);
          storage.set('budding_transactions', allTxs);
          toast(`Transaksi okulasi "${doc || targetTx.docNo || ''}" berhasil dihapus.`, 'success');
          renderBuddingGrafting();
        }
      }
    });
  });

  // Modal Events for Date Filter
  attachDatePickerModalEvents({
    container: app,
    currentDateStr: selectedGraftingDate,
    onDateSelect: (newDateStr) => {
      setSelectedGraftingDate(newDateStr);
      renderBuddingGrafting();
    },
    onDateReset: () => {
      setSelectedGraftingDate(todayDDMMYYYY());
      renderBuddingGrafting();
    }
  });
}
