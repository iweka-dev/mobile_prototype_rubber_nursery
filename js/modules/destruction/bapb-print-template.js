/**
 * js/modules/destruction/bapb-print-template.js
 * Template Cetak & Export A4 Berita Acara Pemusnahan Bibit (BAPB) Karet Digital
 * 
 * Ketentuan Desain & Lifecycle Cetak:
 * - Format resmi A4 portrait.
 * - Tiga tanda tangan visual: ASB (Pelaksana), Askep (Pelaksana), Pengurus (Diketahui).
 * - KTU DITIADAKAN dan tidak boleh muncul pada dokumen cetak.
 * - Bukti foto pemusnahan (minimal 1, maksimal 2).
 * - Menampilkan nomor resmi: [KODE_KEBUN]/[KODE_DIVISI]/[BULAN]/[TAHUN]/[NOMOR_URUT]
 * - Terpisah antara Tanggal Pelaksanaan Fisik dan Tanggal Pengesahan Resmi (WIB).
 * - Mode Preview Responsif untuk Layar HP (tidak terpotong / overflow).
 * - Lifecycle cetak aman tanpa freeze, tanpa white screen, dan pulih mulus setelah cetak/batal.
 */

import { formatDate, formatDateTime, esc } from '../../core/utils.js';
import { openModal, closeModal } from '../../components/modal.js';
import { SOCFINDO_LOGO_DATA_URL } from '../../../assets/icons/socfindo-logo.js';

export function renderBapbPrintHtml(doc, options = {}) {
  if (!doc) return '';

  const isScreenPreview = options?.isScreenPreview === true;

  const items = Array.isArray(doc.items) && doc.items.length > 0
    ? doc.items
    : [{
      sourceSelectionNo: doc.sourceSelectionNo || '-',
      bedengan: doc.bedengan || '-',
      klon: doc.klon || 'GT 1',
      stage: doc.stage || 'Afkir Seleksi',
      quantity: doc.quantity || doc.totalQty || 0,
      reason: doc.reason || doc.alasan || 'Afkir Seleksi'
    }];

  const totalQty = doc.totalQty || doc.quantity || items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

  const asbSig = doc.signatures?.asb;
  const askepSig = doc.signatures?.askep;
  const pengurusSig = doc.signatures?.pengurus;

  const photos = Array.isArray(doc.photos) && doc.photos.length > 0
    ? doc.photos
    : (doc.photoEvidence ? [doc.photoEvidence] : []);

  const cleanEstateName = (doc.estateName || 'Tanah Besih').replace(/^Kebun\s+/i, '');
  const cleanDivisionName = doc.divisionName || 'Divisi I';
  const estateDivisionLine = `KEBUN: ${cleanEstateName} - ${cleanDivisionName}`;
  const docNo = doc.officialDocNo || doc.docNo || doc.draftDocNo || '-';
  const isFinalDoc = Boolean(doc.isFinal || doc.bapbStatus === 'FINAL' || doc.status === 'FINAL');
  const statusDisplay = isFinalDoc ? 'STATUS: Telah Disetujui' : 'STATUS: DRAF PERSETUJUAN';

  if (isScreenPreview) {
    // =========================================================================
    // RESPONSIVE PREVIEW VIEW (MOBILE FRAME HP OPTIMIZED)
    // =========================================================================
    return `
      <div class="bapb-a4-sheet bapb-sheet-preview">
        
        <!-- KOP SURAT PERUSAHAAN -->
        <div class="bapb-preview-kop">
          <div style="display: flex; align-items: center; position: relative;">
            <img src="${SOCFINDO_LOGO_DATA_URL}" alt="PT Socfin Indonesia (Socfindo)" style="height: 32px; max-width: 145px; object-fit: contain; display: block;" />
            <span style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden;">PT SOCFIN INDONESIA</span>
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <div style="font-size: 7pt; font-weight: 700; color: #475569; text-transform: uppercase;">DOKUMEN RESMI</div>
            <div style="font-size: 7.2pt; color: #059669; font-weight: 700; margin-top: 1px;">
              ${statusDisplay}
            </div>
          </div>
        </div>

        <!-- JUDUL UTAMA DOKUMEN -->
        <div style="text-align: center; margin-bottom: 12px;">
          <div style="font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #334155; margin-bottom: 2px;">
            BERITA ACARA
          </div>
          <h1 style="font-size: 11.5pt; font-weight: 800; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.02em;">
            PEMUSNAHAN BIBIT KARET
          </h1>
          <div style="font-size: 8pt; font-weight: 700; color: #334155; margin-top: 5px;">
            ${esc(estateDivisionLine)}
          </div>
          <div style="font-size: 9.5pt; font-weight: 800; color: #0F172A; font-family: monospace; margin-top: 3px; letter-spacing: 0.02em;">
            ${esc(docNo)}
          </div>
        </div>

        <!-- KETERANGAN & PARAGRAF PEMBUKA -->
        <div style="font-size: 7.2pt; color: #334155; margin-bottom: 10px; text-align: justify; line-height: 1.45;">
          Pada hari ini Sabtu telah dilaksanakan kegiatan pemusnahan fisik bibit untuk pembibitan karet yang telah melalui proses seleksi resmi dan dinyatakan tidak layak untuk dipelihara maupun ditanam di lapangan. Berita acara ini dibuat dan disahkan oleh pejabat berwenang sebagai dokumen pertanggungjawaban resmi.
        </div>

        <!-- METADATA DOKUMEN (2-KOLOM RAPI SESUAI HIERARKI SCREENSHOT) -->
        <div class="bapb-preview-meta-container" style="margin-bottom: 12px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table class="bapb-meta-table" style="width: 100%; min-width: 440px; border-collapse: collapse; border: none; font-size: 7.2pt; line-height: 1.5;">
            <tbody>
              <!-- BARIS 1 -->
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Kebun / Estate</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 14px 2px 0;"><strong>${esc(doc.estateName || 'Tanah Besih')} (${esc(doc.estateCode || 'TB')})</strong></td>
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Metode Pemusnahan</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 0;"><strong>${esc(doc.metodePemusnahan || 'Pencincangan dan Pemendaman')}</strong></td>
              </tr>
              <!-- BARIS 2 -->
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Divisi Pembibitan</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 14px 2px 0;"><strong>${esc(doc.divisionName || 'Divisi I')} (${esc(doc.divisionCode || 'DIV-I')})</strong></td>
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Mode Persetujuan</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 0;"><strong>${doc.approvalMode === 'DIRECT_ON_SITE' ? 'Tanda Tangan Langsung di Lokasi' : 'Persetujuan Bertahap'}</strong></td>
              </tr>
              <!-- BARIS 3 -->
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Tgl Pelaksanaan Fisik</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 14px 2px 0;"><strong>${esc(formatDate(doc.tanggalPelaksanaan || doc.date))}</strong></td>
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Invarian Mutasi Stok</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 0;"><strong>Nol Mutasi (Dipotong saat Seleksi)</strong></td>
              </tr>
              <!-- BARIS 4 -->
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 2px 0;">Tgl Pengesahan Resmi (WIB)</td>
                <td class="bapb-meta-colon" style="width: 10px; text-align: center; vertical-align: top; color: #1E293B; padding: 2px 4px;">:</td>
                <td class="bapb-meta-val" style="white-space: nowrap; vertical-align: top; color: #000000; padding: 2px 14px 2px 0;"><strong>${doc.publishedAt ? esc(formatDateTime(doc.publishedAt)) : 'Menunggu Pengesahan Pengurus'}</strong></td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- TABEL RINCIAN BIBIT DIMUSNAHKAN -->
        <div style="margin-bottom: 10px;">
          <div style="font-size: 7.8pt; font-weight: 700; color: #0F172A; margin-bottom: 5px; text-transform: uppercase;">
            I. Rincian Bibit Karet Yang Dimusnahkan
          </div>
          <div class="bapb-preview-table-wrap">
            <table class="bapb-preview-table">
              <thead>
                <tr style="background: #FFFFFF; color: #000000;">
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; width: 24px; text-align: center; color: #000000; font-weight: 700; background: #FFFFFF;">No</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; color: #000000; font-weight: 700; background: #FFFFFF;">No. Dokumen Seleksi Sumber</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; color: #000000; font-weight: 700; background: #FFFFFF;">Bedengan / Batch</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; color: #000000; font-weight: 700; background: #FFFFFF;">Klon Bibit</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; color: #000000; font-weight: 700; background: #FFFFFF;">Tahapan Seleksi</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; text-align: right; color: #000000; font-weight: 700; background: #FFFFFF;">Jumlah (Pkk)</th>
                  <th style="border: 1px solid #CBD5E1; padding: 4px 6px; color: #000000; font-weight: 700; background: #FFFFFF;">Alasan Pemusnahan</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((it, idx) => `
                  <tr style="background: ${idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};">
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px; text-align: center;">${idx + 1}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px; font-family: monospace; font-weight: 600;">${esc(it.sourceSelectionNo || it.docNo || '-')}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px;">${esc(it.bedengan || '-')}${it.batchCode ? ` (${esc(it.batchCode)})` : ''}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px; font-weight: 700;">${esc(it.klon || it.clone || 'GT 1')}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px;">${esc(it.stage || 'Afkir Seleksi')}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px; text-align: right; font-weight: 700; color: #991B1B;">${Number(it.quantity).toLocaleString('id-ID')}</td>
                    <td style="border: 1px solid #CBD5E1; padding: 4px 6px;">${esc(it.reason || it.alasan || 'Afkir Seleksi')}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background: #F1F5F9; font-weight: 800;">
                  <td colspan="5" style="border: 1px solid #CBD5E1; padding: 6px; text-align: right; text-transform: uppercase;">Total Bibit Dimusnahkan:</td>
                  <td style="border: 1px solid #CBD5E1; padding: 6px; text-align: right; color: #DC2626; font-size: 8pt;">${Number(totalQty).toLocaleString('id-ID')}</td>
                  <td style="border: 1px solid #CBD5E1; padding: 6px; font-size: 7pt; color: #64748B;">Pkk</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- BUKTI FOTO PEMUSNAHAN -->
        <div style="margin-bottom: 10px;">
          <div style="font-size: 7.8pt; font-weight: 700; color: #0F172A; margin-bottom: 5px; text-transform: uppercase;">
            II. Bukti Foto Fisik Pemusnahan di Lapangan (Maksimal 2 Foto)
          </div>
          ${photos.length > 0 ? `
            <div class="bapb-preview-photos">
              ${photos.slice(0, 2).map((photoUrl, pIdx) => `
                <div class="bapb-preview-photo-item">
                  <img src="${photoUrl}" alt="Bukti Pemusnahan ${pIdx + 1}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 4px; display: block;" />
                  <div style="font-size: 6.5pt; color: #475569; margin-top: 3px; font-weight: 600;">
                    Dokumentasi #${pIdx + 1}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="border: 1px dashed #CBD5E1; border-radius: 6px; padding: 8px; font-size: 7.2pt; color: #94A3B8; text-align: center;">
              Tidak ada foto bukti terlampir.
            </div>
          `}
        </div>

        <!-- TANDA TANGAN PEJABAT BERWENANG -->
        <div style="margin-top: 10px;">
          <div style="font-size: 7.8pt; font-weight: 700; color: #0F172A; margin-bottom: 6px; text-transform: uppercase;">
            III. Pengesahan Pejabat Berwenang ${doc.approvalMode === 'DIRECT_ON_SITE' ? '(Ditandatangani Langsung di Lokasi)' : ''}
          </div>
          
          <div class="bapb-preview-signatures">
            
            <!-- 1. ASISTEN DIVISI BIBITAN -->
            <div class="bapb-preview-sig-box">
              <div style="font-size: 6.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
              <div style="font-size: 7.2pt; font-weight: 800; color: #0F172A; min-height: 22px;">
                Asisten Divisi Bibitan
              </div>
              <div style="height: 44px; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
                ${asbSig?.signatureDataUrl ? `
                  <img src="${asbSig.signatureDataUrl}" alt="TTD ASB" style="max-height: 40px; max-width: 90%; object-fit: contain;" />
                ` : `
                  <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
                `}
              </div>
              <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
                <div style="font-size: 7pt; font-weight: 800; color: #0F172A;">${esc(asbSig?.name || doc.createdByName || 'Asisten Bibitan')}</div>
                <div style="font-size: 6pt; color: #64748B;">${asbSig?.signedAt ? esc(formatDate(asbSig.signedAt)) : '-'}</div>
              </div>
            </div>

            <!-- 2. ASISTEN KEPALA -->
            <div class="bapb-preview-sig-box">
              <div style="font-size: 6.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
              <div style="font-size: 7.2pt; font-weight: 800; color: #0F172A; min-height: 22px;">
                Asisten Kepala
              </div>
              <div style="height: 44px; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
                ${askepSig?.signatureDataUrl ? `
                  <img src="${askepSig.signatureDataUrl}" alt="TTD Askep" style="max-height: 40px; max-width: 90%; object-fit: contain;" />
                ` : `
                  <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
                `}
              </div>
              <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
                <div style="font-size: 7pt; font-weight: 800; color: #0F172A;">${esc(askepSig?.name || 'Asisten Kepala')}</div>
                <div style="font-size: 6pt; color: #64748B;">${askepSig?.signedAt ? esc(formatDate(askepSig.signedAt)) : '-'}</div>
              </div>
            </div>

            <!-- 3. PENGURUS -->
            <div class="bapb-preview-sig-box">
              <div style="font-size: 6.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Diketahui</div>
              <div style="font-size: 7.2pt; font-weight: 800; color: #0F172A; min-height: 22px;">
                Pengurus
              </div>
              <div style="height: 44px; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
                ${pengurusSig?.signatureDataUrl ? `
                  <img src="${pengurusSig.signatureDataUrl}" alt="TTD Pengurus" style="max-height: 40px; max-width: 90%; object-fit: contain;" />
                ` : `
                  <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
                `}
              </div>
              <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
                <div style="font-size: 7pt; font-weight: 800; color: #0F172A;">${esc(pengurusSig?.name || 'Pengurus')}</div>
                <div style="font-size: 6pt; color: #64748B;">${pengurusSig?.signedAt ? esc(formatDate(pengurusSig.signedAt)) : '-'}</div>
              </div>
            </div>

          </div>
        </div>

        <!-- FOOTER INFORMASI PERUSAHAAN & LEGAL -->
        <div class="bapb-document-footer" style="margin-top: 14px; border-top: 1.5px solid #0f172a; padding-top: 6px; font-size: 6.5pt; color: #475569; line-height: 1.4; text-align: left; box-sizing: border-box;">
          <div style="font-weight: 800; font-size: 7.5pt; color: #0F172A; letter-spacing: 0.02em; margin-bottom: 2px;">
            PT Socfin Indonesia
          </div>
          <div style="margin-bottom: 2px;">
            Jl. K.L. Yos Sudarso No. 106, Glugur Kota, Kec. Medan Barat, Kota Medan, Sumatera Utara 20115
          </div>
          <div style="margin-bottom: 2px;">
            Telp: +62-61-6610088 | Fax: +62-61-6610099
          </div>
          <div style="margin-bottom: 2px;">
            Email: <a href="mailto:tanahbesih@socfindo.co.id" style="color: #116834; text-decoration: none; font-weight: 600;">tanahbesih@socfindo.co.id</a> | Website: <a href="https://www.socfindo.co.id" target="_blank" rel="noopener noreferrer" style="color: #116834; text-decoration: none; font-weight: 600;">https://www.socfindo.co.id</a>
          </div>
          <div style="margin-top: 4px; font-size: 5.8pt; color: #94A3B8; text-align: right;">
            Dicetak: ${formatDateTime(new Date().toISOString())} WIB
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // STANDARD A4 SHEET FOR PRINT / PDF EXPORT
  // =========================================================================
  return `
    <div class="bapb-a4-sheet" style="width: 210mm; min-height: 297mm; padding: 18mm 20mm 15mm 20mm; margin: 0 auto; box-sizing: border-box; background: #ffffff; color: #111827; font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.4;">
      
      <!-- KOP SURAT PERUSAHAAN -->
      <div style="border-bottom: 2.5px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: center; position: relative;">
          <img src="${SOCFINDO_LOGO_DATA_URL}" alt="PT Socfin Indonesia (Socfindo)" style="height: 42px; max-width: 180px; object-fit: contain; display: block;" />
          <span style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden;">PT SOCFIN INDONESIA</span>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 8pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">DOKUMEN RESMI</div>
          <div style="font-size: 8.5pt; color: #059669; font-weight: 700; margin-top: 3px;">
            ${statusDisplay}
          </div>
        </div>
      </div>

      <!-- JUDUL UTAMA DOKUMEN -->
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #334155; margin-bottom: 2px;">
          BERITA ACARA
        </div>
        <h1 style="font-size: 14pt; font-weight: 800; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.02em;">
          PEMUSNAHAN BIBIT KARET
        </h1>
        <div style="font-size: 10pt; font-weight: 700; color: #334155; margin-top: 6px; letter-spacing: 0.02em;">
          ${esc(estateDivisionLine)}
        </div>
        <div style="font-size: 11.5pt; font-weight: 800; color: #0F172A; font-family: monospace; margin-top: 4px; letter-spacing: 0.03em;">
          ${esc(docNo)}
        </div>
      </div>

      <!-- KETERANGAN & PARAGRAF PEMBUKA -->
      <div style="font-size: 9pt; color: #334155; margin-bottom: 12px; text-align: justify; line-height: 1.5;">
        Pada hari ini Sabtu telah dilaksanakan kegiatan pemusnahan fisik bibit untuk pembibitan karet yang telah melalui proses seleksi resmi dan dinyatakan tidak layak untuk dipelihara maupun ditanam di lapangan. Berita acara ini dibuat dan disahkan oleh pejabat berwenang sebagai dokumen pertanggungjawaban resmi.
      </div>

      <!-- METADATA DOKUMEN (2-KOLOM RAPI SESUAI HIERARKI SCREENSHOT UNTUK CETAK A4) -->
      <div class="bapb-print-meta-container" style="margin-bottom: 14px; page-break-inside: avoid; break-inside: avoid;">
        <table class="bapb-meta-table" style="width: 100%; border-collapse: collapse; border: none; font-size: 8.5pt; line-height: 1.5;">
          <tbody>
            <!-- BARIS 1 -->
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Kebun / Estate</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 18px 3px 0; word-break: break-word;"><strong>${esc(doc.estateName || 'Tanah Besih')} (${esc(doc.estateCode || 'TB')})</strong></td>
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Metode Pemusnahan</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 0; word-break: break-word;"><strong>${esc(doc.metodePemusnahan || 'Pencincangan dan Pemendaman')}</strong></td>
            </tr>
            <!-- BARIS 2 -->
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Divisi Pembibitan</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 18px 3px 0; word-break: break-word;"><strong>${esc(doc.divisionName || 'Divisi I')} (${esc(doc.divisionCode || 'DIV-I')})</strong></td>
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Mode Persetujuan</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 0; word-break: break-word;"><strong>${doc.approvalMode === 'DIRECT_ON_SITE' ? 'Tanda Tangan Langsung di Lokasi' : 'Persetujuan Bertahap'}</strong></td>
            </tr>
            <!-- BARIS 3 -->
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Tgl Pelaksanaan Fisik</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 18px 3px 0; word-break: break-word;"><strong>${esc(formatDate(doc.tanggalPelaksanaan || doc.date))}</strong></td>
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Invarian Mutasi Stok</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 0; word-break: break-word;"><strong>Nol Mutasi (Dipotong saat Seleksi)</strong></td>
            </tr>
            <!-- BARIS 4 -->
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td class="bapb-meta-label" style="width: 1%; white-space: nowrap; vertical-align: top; color: #1E293B; padding: 3px 0;">Tgl Pengesahan Resmi (WIB)</td>
              <td class="bapb-meta-colon" style="width: 12px; text-align: center; vertical-align: top; color: #1E293B; padding: 3px 4px;">:</td>
              <td class="bapb-meta-val" style="width: 42%; vertical-align: top; color: #000000; padding: 3px 18px 3px 0; word-break: break-word;"><strong>${doc.publishedAt ? esc(formatDateTime(doc.publishedAt)) : 'Menunggu Pengesahan Pengurus'}</strong></td>
              <td colspan="3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- TABEL RINCIAN BIBIT DIMUSNAHKAN -->
      <div style="margin-bottom: 14px;">
        <div style="font-size: 9pt; font-weight: 700; color: #0F172A; margin-bottom: 6px; text-transform: uppercase;">
          I. Rincian Bibit Karet Yang Dimusnahkan
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; text-align: left;">
          <thead>
            <tr style="background: #FFFFFF; color: #000000;">
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; width: 28px; text-align: center; color: #000000; font-weight: 700; background: #FFFFFF;">No</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; color: #000000; font-weight: 700; background: #FFFFFF;">No. Dokumen Seleksi Sumber</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; color: #000000; font-weight: 700; background: #FFFFFF;">Bedengan / Batch</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; color: #000000; font-weight: 700; background: #FFFFFF;">Klon Bibit</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; color: #000000; font-weight: 700; background: #FFFFFF;">Tahapan Seleksi</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; text-align: right; color: #000000; font-weight: 700; background: #FFFFFF;">Jumlah (Pkk)</th>
              <th style="border: 1px solid #CBD5E1; padding: 6px 8px; color: #000000; font-weight: 700; background: #FFFFFF;">Alasan Pemusnahan</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};">
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px; text-align: center;">${idx + 1}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px; font-family: monospace; font-weight: 600;">${esc(it.sourceSelectionNo || it.docNo || '-')}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px;">${esc(it.bedengan || '-')}${it.batchCode ? ` (${esc(it.batchCode)})` : ''}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px; font-weight: 700;">${esc(it.klon || it.clone || 'GT 1')}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px;">${esc(it.stage || 'Afkir Seleksi')}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px; text-align: right; font-weight: 700; color: #991B1B;">${Number(it.quantity).toLocaleString('id-ID')}</td>
                <td style="border: 1px solid #CBD5E1; padding: 6px 8px;">${esc(it.reason || it.alasan || 'Afkir Seleksi')}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #F1F5F9; font-weight: 800;">
              <td colspan="5" style="border: 1px solid #CBD5E1; padding: 8px; text-align: right; text-transform: uppercase;">Total Bibit Dimusnahkan:</td>
              <td style="border: 1px solid #CBD5E1; padding: 8px; text-align: right; color: #DC2626; font-size: 9.5pt;">${Number(totalQty).toLocaleString('id-ID')}</td>
              <td style="border: 1px solid #CBD5E1; padding: 8px; font-size: 8pt; color: #64748B;">Pkk (Pokok)</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- BUKTI FOTO PEMUSNAHAN (MIN 1, MAX 2) -->
      <div style="margin-bottom: 14px;">
        <div style="font-size: 9pt; font-weight: 700; color: #0F172A; margin-bottom: 6px; text-transform: uppercase;">
          II. Bukti Foto Fisik Pemusnahan di Lapangan (Maksimal 2 Foto)
        </div>
        ${photos.length > 0 ? `
          <div style="display: flex; gap: 14px; justify-content: flex-start; align-items: flex-start;">
            ${photos.slice(0, 2).map((photoUrl, pIdx) => `
              <div style="flex: 1; max-width: 250px; border: 1px solid #CBD5E1; border-radius: 6px; padding: 6px; background: #F8FAFC; text-align: center;">
                <img src="${photoUrl}" alt="Bukti Pemusnahan ${pIdx + 1}" style="width: 100%; height: 130px; object-fit: cover; border-radius: 4px; display: block;" />
                <div style="font-size: 7.5pt; color: #475569; margin-top: 4px; font-weight: 600;">
                  Dokumentasi Lapangan #${pIdx + 1}
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="border: 1px dashed #CBD5E1; border-radius: 6px; padding: 12px; font-size: 8pt; color: #94A3B8; text-align: center;">
            Tidak ada foto bukti terlampir.
          </div>
        `}
      </div>

      <!-- TANDA TANGAN PEJABAT BERWENANG (3 PEJABAT: ASB, ASKEP, PENGURUS) -->
      <div style="margin-top: 18px; page-break-inside: avoid;">
        <div style="font-size: 9pt; font-weight: 700; color: #0F172A; margin-bottom: 10px; text-transform: uppercase;">
          III. Pengesahan Pejabat Berwenang ${doc.approvalMode === 'DIRECT_ON_SITE' ? '(Ditandatangani Langsung di Lokasi)' : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; text-align: center;">
          
          <!-- 1. ASISTEN DIVISI BIBITAN -->
          <div style="border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px; background: #FFFFFF;">
            <div style="font-size: 7.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
            <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A; margin-top: 2px; min-height: 28px;">
              Asisten Divisi Bibitan
            </div>
            <div style="height: 60px; display: flex; align-items: center; justify-content: center; margin: 6px 0;">
              ${asbSig?.signatureDataUrl ? `
                <img src="${asbSig.signatureDataUrl}" alt="TTD ASB" style="max-height: 55px; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 7.5pt; color: #94A3B8; font-style: italic;">[Belum Ditandatangani]</span>
              `}
            </div>
            <div style="border-top: 1px solid #94A3B8; padding-top: 4px;">
              <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A;">${esc(asbSig?.name || doc.createdByName || 'Asisten Bibitan')}</div>
              <div style="font-size: 7pt; color: #64748B;">${asbSig?.signedAt ? esc(formatDate(asbSig.signedAt)) : '-'}</div>
            </div>
          </div>

          <!-- 2. ASISTEN KEPALA -->
          <div style="border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px; background: #FFFFFF;">
            <div style="font-size: 7.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
            <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A; margin-top: 2px; min-height: 28px;">
              Asisten Kepala
            </div>
            <div style="height: 60px; display: flex; align-items: center; justify-content: center; margin: 6px 0;">
              ${askepSig?.signatureDataUrl ? `
                <img src="${askepSig.signatureDataUrl}" alt="TTD Askep" style="max-height: 55px; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 7.5pt; color: #94A3B8; font-style: italic;">[Belum Ditandatangani]</span>
              `}
            </div>
            <div style="border-top: 1px solid #94A3B8; padding-top: 4px;">
              <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A;">${esc(askepSig?.name || 'Asisten Kepala')}</div>
              <div style="font-size: 7pt; color: #64748B;">${askepSig?.signedAt ? esc(formatDate(askepSig.signedAt)) : '-'}</div>
            </div>
          </div>

          <!-- 3. PENGURUS -->
          <div style="border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px; background: #FFFFFF;">
            <div style="font-size: 7.5pt; font-weight: 700; color: #64748B; text-transform: uppercase;">Diketahui</div>
            <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A; margin-top: 2px; min-height: 28px;">
              Pengurus
            </div>
            <div style="height: 60px; display: flex; align-items: center; justify-content: center; margin: 6px 0;">
              ${pengurusSig?.signatureDataUrl ? `
                <img src="${pengurusSig.signatureDataUrl}" alt="TTD Pengurus" style="max-height: 55px; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 7.5pt; color: #94A3B8; font-style: italic;">[Belum Ditandatangani]</span>
              `}
            </div>
            <div style="border-top: 1px solid #94A3B8; padding-top: 4px;">
              <div style="font-size: 8.5pt; font-weight: 800; color: #0F172A;">${esc(pengurusSig?.name || 'Pengurus')}</div>
              <div style="font-size: 7pt; color: #64748B;">${pengurusSig?.signedAt ? esc(formatDate(pengurusSig.signedAt)) : '-'}</div>
            </div>
          </div>

        </div>

      </div>

      <!-- FOOTER INFORMASI PERUSAHAAN & LEGAL -->
      <div class="bapb-document-footer" style="margin-top: 20px; border-top: 1.5px solid #0f172a; padding-top: 8px; font-size: 7.8pt; color: #475569; line-height: 1.45; text-align: left; box-sizing: border-box;">
        <div style="font-weight: 800; font-size: 8.5pt; color: #116834; letter-spacing: 0.03em; margin-bottom: 2px;">
          PT Socfin Indonesia
        </div>
        <div style="margin-bottom: 2px;">
          Jl. K.L. Yos Sudarso No. 106, Glugur Kota, Kec. Medan Barat, Kota Medan, Sumatera Utara 20115
        </div>
        <div style="margin-bottom: 2px;">
          Telp: +62-61-6610088 | Fax: +62-61-6610099
        </div>
        <div style="margin-bottom: 2px;">
          Email: <a href="mailto:tanahbesih@socfindo.co.id" style="color: #116834; text-decoration: none; font-weight: 600;">tanahbesih@socfindo.co.id</a> | Website: <a href="https://www.socfindo.co.id" target="_blank" rel="noopener noreferrer" style="color: #116834; text-decoration: none; font-weight: 600;">https://www.socfindo.co.id</a>
        </div>
        <div style="margin-top: 4px; font-size: 6.8pt; color: #94A3B8; text-align: right;">
          Dicetak: ${formatDateTime(new Date().toISOString())} WIB
        </div>
      </div>

    </div>
  `;
}

let activePrintIframe = null;
let isPrintBusy = false;
let printSafetyTimer = null;

/**
 * Membersihkan seluruh state, iframe, listener, dan style lock pasca-cetak
 */
export function cleanupActivePrint(restoreButton = true) {
  isPrintBusy = false;
  if (printSafetyTimer) {
    clearTimeout(printSafetyTimer);
    printSafetyTimer = null;
  }
  if (activePrintIframe && activePrintIframe.parentNode) {
    activePrintIframe.remove();
    activePrintIframe = null;
  }
  if (restoreButton) {
    const printBtn = document.getElementById('btn-execute-print');
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
          <polyline points="6 9 6 2 18 2 18 9"></polyline>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
          <rect x="6" y="14" width="12" height="8"></rect>
        </svg>
        <span>Cetak / Simpan PDF (A4)</span>
      `;
    }
  }
  // Pulihkan overflow dan pointer-events halaman
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('pointer-events');
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.removeProperty('pointer-events');
  }
}

/**
 * Membuka modal preview A4 Berita Acara Pemusnahan Bibit (BAPB) sebelum cetak
 */
export function openBapbPrintPreviewModal(bapbDoc) {
  if (!bapbDoc) return;
  const docNo = esc(bapbDoc.officialDocNo || bapbDoc.docNo || bapbDoc.draftDocNo || '-');

  // Bersihkan state cetak sebelumnya
  cleanupActivePrint(false);

  openModal({
    title: `Preview Berita Acara: ${docNo}`,
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapb-fullscreen modal-bapb-preview-modal',
    body: `
      <div class="bapb-preview-container">
        <div class="bapb-preview-paper">
          ${renderBapbPrintHtml(bapbDoc, { isScreenPreview: true })}
        </div>
      </div>
    `,
    footer: `
      <div class="bapb-footer-actions">
        <button id="btn-close-print-preview" type="button" class="bapb-btn-cancel">
          Kembali
        </button>
        <button id="btn-execute-print" type="button" class="bapb-btn-submit" style="background: #059669; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
          </svg>
          <span>Cetak / Simpan PDF (A4)</span>
        </button>
      </div>
    `,
    onClose: () => {
      cleanupActivePrint(false);
    }
  });

  document.getElementById('btn-close-print-preview')?.addEventListener('click', () => {
    cleanupActivePrint(false);
    closeModal();
  });

  document.getElementById('btn-execute-print')?.addEventListener('click', () => {
    printBapbDocument(bapbDoc);
  });
}

/**
 * Memicu dialog cetak native browser window.print() dengan isolasi total via iframe tersembunyi.
 * Dilengkapi proteksi anti-freeze, multi-tier lifecycle recovery, dan pembersihan DOM yang handal.
 */
export function printBapbDocument(bapbDoc) {
  if (!bapbDoc) {
    throw new Error('Dokumen BAPB tidak valid untuk dicetak.');
  }

  // Cegah pemanggilan ganda jika proses sebelumnya belum selesai
  if (isPrintBusy) {
    console.warn('[BAPB Print] Proses cetak sedang dipersiapkan, abaikan klik berulang.');
    return;
  }
  isPrintBusy = true;

  // Bersihkan iframe lama jika ada
  cleanupActivePrint(false);
  isPrintBusy = true;

  // Tampilkan visual feedback pada tombol
  const printBtn = document.getElementById('btn-execute-print');
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border: 2px solid #FFFFFF; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></div>
      <span>Menyiapkan Cetak...</span>
    `;
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'bapb-print-iframe';
  iframe.setAttribute('title', 'BAPB Print Frame');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '-9999';
  document.body.appendChild(iframe);
  activePrintIframe = iframe;

  const docNo = esc(bapbDoc.officialDocNo || bapbDoc.docNo || bapbDoc.draftDocNo || 'BAPB');
  const printContentHtml = renderBapbPrintHtml(bapbDoc, { isScreenPreview: false });

  const fullPrintHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>BAPB - ${docNo}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #FFFFFF !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .bapb-a4-sheet {
      width: 210mm !important;
      min-height: 297mm !important;
      padding: 16mm 18mm 14mm 18mm !important;
      margin: 0 auto !important;
      background: #FFFFFF !important;
      box-sizing: border-box !important;
      font-size: 10pt !important;
      line-height: 1.35 !important;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
        background: #FFFFFF !important;
      }
      .bapb-a4-sheet {
        box-shadow: none !important;
        margin: 0 auto !important;
      }
      .bapb-meta-table tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
    .bapb-print-meta-container {
      background: transparent !important;
      padding: 2px 0 !important;
      margin-bottom: 14px !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .bapb-meta-table {
      width: 100% !important;
      border-collapse: collapse !important;
      border: none !important;
    }
    .bapb-meta-table tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .bapb-meta-table .bapb-meta-label {
      vertical-align: top !important;
      color: #1E293B !important;
      font-weight: 400 !important;
      white-space: nowrap !important;
      padding: 3px 0 !important;
    }
    .bapb-meta-table .bapb-meta-colon {
      vertical-align: top !important;
      color: #1E293B !important;
      text-align: center !important;
      white-space: nowrap !important;
      padding: 3px 4px !important;
      width: 12px !important;
    }
    .bapb-meta-table .bapb-meta-val {
      vertical-align: top !important;
      color: #000000 !important;
      font-weight: 700 !important;
      padding: 3px 18px 3px 0 !important;
      word-break: break-word !important;
    }
    table thead tr,
    table thead tr th {
      background: #FFFFFF !important;
      color: #000000 !important;
      font-weight: 700 !important;
      border: 1px solid #CBD5E1 !important;
    }
  </style>
</head>
<body>
  ${printContentHtml}
</body>
</html>`;

  const frameDoc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!frameDoc) {
    cleanupActivePrint(true);
    throw new Error('Gagal menginisialisasi lingkungan cetak.');
  }

  frameDoc.open();
  frameDoc.write(fullPrintHtml);
  frameDoc.close();

  // Multi-tier recovery handlers:
  let hasHandledPrintEnd = false;
  const onPrintEnd = () => {
    if (hasHandledPrintEnd) return;
    hasHandledPrintEnd = true;
    cleanupActivePrint(true);
  };

  try {
    iframe.contentWindow?.addEventListener('afterprint', onPrintEnd);
  } catch (e) {
    // Cross-origin restriction fallback
  }
  window.addEventListener('afterprint', onPrintEnd, { once: true });

  const onWindowFocusReturn = () => {
    // Fallback when afterprint doesn't fire: focus returns to window
    setTimeout(() => {
      onPrintEnd();
      window.removeEventListener('focus', onWindowFocusReturn);
    }, 800);
  };
  window.addEventListener('focus', onWindowFocusReturn, { once: true });

  // Safety fallback timeout (60 seconds)
  printSafetyTimer = setTimeout(() => {
    onPrintEnd();
  }, 60000);

  // Tunggu gambar & canvas data-url di dalam iframe termuat sempurna sebelum trigger print
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn('[BAPB Print] Iframe print gagal, mencoba fallback window.print():', err);
      try {
        window.print();
      } catch (windowPrintErr) {
        console.error('[BAPB Print] Cetak tidak didukung:', windowPrintErr);
      }
      onPrintEnd();
    }
  }, 250);
}
