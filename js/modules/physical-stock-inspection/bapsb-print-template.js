/**
 * js/modules/physical-stock-inspection/bapsb-print-template.js
 * Template Cetak & Preview Berita Acara Pemeriksaan Stok Fisik (BAPSB) Karet Digital
 * 
 * Standar:
 * - Format resmi A4 & Responsive Preview Layar HP
 * - Kop Resmi PT Socfin Indonesia
 * - Tiga Tanda Tangan Berjenjang: ASB (Pelaksana), Askep (Verifikator), Pengurus (Mengesahkan)
 * - Retensi Penuh Audit Trail (Seluruh putaran hitung ditampilkan di dokumen)
 * - Rekonsiliasi: Menampilkan selisih lebih dan kurang per Bedengan
 */

import { formatDate, formatDateTime, esc } from '../../core/utils.js';
import { openModal, closeModal } from '../../components/modal.js';
import { SOCFINDO_LOGO_DATA_URL } from '../../../assets/icons/socfindo-logo.js';
import { BAPSB_STATUS } from './physical-stock-bapsb-service.js';

export function renderBapsbPrintHtml(doc, options = {}) {
  if (!doc) return '';

  const isScreenPreview = options?.isScreenPreview === true;
  const isFinalDoc = Boolean(doc.isFinal || doc.status === BAPSB_STATUS.FINAL);
  const statusDisplay = doc.status === BAPSB_STATUS.APPLIED
    ? 'STATUS: Rekonsiliasi Diterapkan'
    : doc.status === BAPSB_STATUS.FINAL_PENDING_APPLICATION
      ? 'STATUS: Final — Menunggu Penerapan'
      : isFinalDoc ? 'STATUS: Telah Disetujui' : 'STATUS: DRAF PERSETUJUAN';

  const cleanEstateName = (doc.estateName || 'Tanah Besih').replace(/^Kebun\s+/i, '');
  const cleanDivisionName = doc.divisionName || 'Divisi I';
  const estateDivisionLine = `KEBUN: ${cleanEstateName} - ${cleanDivisionName}`;
  const cleanEstateCode = String(doc.estateCode || 'TB').replace(/^EST-/, '').replace(/S$/, '');
  const cleanDivisionCode = String(doc.divisionCode || 'DIV-I').replace(/^DIV-0*/, 'DIV-').replace(/DIV-1$/, 'DIV-I');
  const cleanDocNo = (doc.officialDocNo || doc.docNo || '-').replace('/TBS/', '/TB/').replace('/DIV-1/', '/DIV-I/');

  const asbSig = doc.signatures?.asb || null;
  const askepSig = doc.signatures?.askep || null;
  const pengurusSig = doc.signatures?.pengurus || null;

  const auditTrail = Array.isArray(doc.auditTrail) && doc.auditTrail.length > 0 ? doc.auditTrail : [];

  const photos = [];
  if (Array.isArray(doc.photos) && doc.photos.length > 0) {
    photos.push(...doc.photos);
  } else if (doc.photoEvidence) {
    photos.push(doc.photoEvidence);
  }
  if (photos.length === 0 && Array.isArray(auditTrail)) {
    auditTrail.forEach(item => {
      if (item.photoEvidence) {
        photos.push(typeof item.photoEvidence === 'object' ? { ...item.photoEvidence, round: item.round } : item.photoEvidence);
      } else if (Array.isArray(item.photos)) {
        photos.push(...item.photos);
      }
    });
  }

  return `
    <div class="bapb-a4-sheet ${isScreenPreview ? 'bapb-sheet-preview' : ''}" style="background:#FFFFFF;color:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:${isScreenPreview ? '14px 12px' : '20mm 15mm'};box-sizing:border-box;max-width:100%">
      
      <!-- KOP SURAT PERUSAHAAN -->
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0F172A;padding-bottom:10px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${SOCFINDO_LOGO_DATA_URL}" alt="PT Socfin Indonesia" style="height:32px;max-width:145px;object-fit:contain;display:block" />
        </div>
        <div style="text-align:right">
          <div style="font-size:7pt;font-weight:700;color:#475569;text-transform:uppercase">DOKUMEN RESMI</div>
          <div style="font-size:7.2pt;color:${isFinalDoc ? '#059669' : '#059669'};font-weight:700;margin-top:1px">${statusDisplay}</div>
        </div>
      </div>

      <!-- JUDUL UTAMA DOKUMEN (FORMAT SESUAI BAPB) -->
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#334155;margin-bottom:2px">
          BERITA ACARA
        </div>
        <h1 style="font-size:11.5pt;font-weight:800;text-transform:uppercase;margin:0;color:#0F172A;letter-spacing:0.02em">
          REKONSILIASI STOK FISIK BIBIT
        </h1>
        <div style="font-size:8pt;font-weight:700;color:#334155;margin-top:5px">
          ${esc(estateDivisionLine)}
        </div>
        <div style="font-size:9.5pt;font-weight:800;color:#0F172A;font-family:monospace;margin-top:3px;letter-spacing:0.02em">
          ${esc(cleanDocNo)}
        </div>
      </div>

      <!-- PARAGRAF PEMBUKA -->
      <div style="font-size:7.2pt;color:#334155;margin-bottom:10px;text-align:justify;line-height:1.45">
        Pada hari ini telah dilaksanakan pemeriksaan stok fisik bibit di lokasi pembibitan kebun. Dokumen ini mencatat selisih fisik per Bedengan dan menjadi dasar penerapan rekonsiliasi setelah memperoleh persetujuan Asisten Kepala serta pengesahan Pengurus.
      </div>

      <!-- METADATA DOKUMEN -->
      <div style="margin-bottom:10px;overflow-x:auto;-webkit-overflow-scrolling:touch">
        <table style="width:100%;border-collapse:collapse;font-size:7.2pt;line-height:1.5">
          <tbody>
            <tr>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Kebun / Estate</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 12px 2px 0"><strong>${esc(cleanEstateName)} (${esc(cleanEstateCode)})</strong></td>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Batch Bibitan</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 0"><strong>${esc(doc.batchCode || doc.batchId || '-')}</strong></td>
            </tr>
            <tr>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Divisi Pembibitan</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 12px 2px 0"><strong>${esc(cleanDivisionName)} (${esc(cleanDivisionCode)})</strong></td>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Program Bibitan</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 0"><strong>${esc(doc.programCode || doc.programName || 'Program Bibitan')}</strong></td>
            </tr>
            <tr>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Tgl Pelaksanaan Sensus</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 12px 2px 0"><strong>${doc.createdAt ? formatDate(doc.createdAt) : '-'}</strong></td>
              <td style="width:1%;white-space:nowrap;padding:2px 0;color:#475569">Lokasi Bedengan</td>
              <td style="width:10px;text-align:center;padding:2px 4px">:</td>
              <td style="padding:2px 0"><strong>${doc.bedenganIds && doc.bedenganIds.length ? doc.bedenganIds.join(', ') : 'Bedengan Terkait'}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- I. RINGKASAN STATUS PERSEDIAAN & REKONSILIASI STOK -->
      <div style="margin-bottom:12px">
        <div style="font-size:7.8pt;font-weight:700;color:#0F172A;margin-bottom:5px;text-transform:uppercase">
          I. Hasil Rekonsiliasi Stok Fisik vs Sistem
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:7.2pt;text-align:center;border:1px solid #CBD5E1">
          <thead>
            <tr style="background:#F1F5F9;font-weight:800;color:#1E293B">
              <th style="border:1px solid #CBD5E1;padding:5px 6px">Stok Buku Sistem</th>
              <th style="border:1px solid #CBD5E1;padding:5px 6px">Hasil Sensus Fisik</th>
              <th style="border:1px solid #CBD5E1;padding:5px 6px;color:#047857">Total Lebih</th>
              <th style="border:1px solid #CBD5E1;padding:5px 6px;color:#B91C1C">Total Kurang</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid #CBD5E1;padding:6px;font-weight:700">${Number(doc.systemQtySnapshot || doc.systemQty || 0).toLocaleString('id-ID')} Pkk<div style="font-size:6pt;color:#64748B;font-weight:400">Stok Sistem</div></td>
              <td style="border:1px solid #CBD5E1;padding:6px;font-weight:700">${Number(doc.physicalQty || 0).toLocaleString('id-ID')} Pkk</td>
              <td style="border:1px solid #CBD5E1;padding:6px;font-weight:800;color:#047857">+${Number(doc.totalSurplusQty || doc.surplusQty || 0).toLocaleString('id-ID')} Pkk</td>
              <td style="border:1px solid #CBD5E1;padding:6px;font-weight:800;color:#B91C1C">-${Number(doc.totalShortageQty || doc.shortageQty || 0).toLocaleString('id-ID')} Pkk</td>
            </tr>
          </tbody>
        </table>
        <div style="font-size:6.5pt;color:#64748B;margin-top:4px;font-style:italic">
          * Catatan: Pengesahan dokumen tidak langsung mengubah saldo. Saldo berubah hanya setelah rekonsiliasi diterapkan melalui Central Hub.
        </div>
      </div>

      ${Array.isArray(doc.bedenganDetails) && doc.bedenganDetails.length ? `
      <div style="margin-bottom:12px">
        <div style="font-size:7.8pt;font-weight:700;color:#0F172A;margin-bottom:5px;text-transform:uppercase">Rincian Rekonsiliasi per Bedengan</div>
        <table style="width:100%;border-collapse:collapse;font-size:7pt;border:1px solid #CBD5E1">
          <thead><tr style="background:#F8FAFC;font-weight:800;color:#334155;text-align:left">
            <th style="border:1px solid #CBD5E1;padding:4px 6px">Bedengan</th>
            <th style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">Referensi</th>
            <th style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">Fisik</th>
            <th style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">Selisih</th>
            <th style="border:1px solid #CBD5E1;padding:4px 6px">Alasan</th>
          </tr></thead>
          <tbody>${doc.bedenganDetails.map(row => `
            <tr>
              <td style="border:1px solid #CBD5E1;padding:4px 6px;font-weight:700">${esc(row.bedenganCode || row.bedenganId || 'UNSPECIFIED')}</td>
              <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">${Number(row.referenceQty || 0).toLocaleString('id-ID')} Pkk</td>
              <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">${Number(row.physicalQty || 0).toLocaleString('id-ID')} Pkk</td>
              <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right;font-weight:800;color:${Number(row.difference || 0) >= 0 ? '#047857' : '#B91C1C'}">${Number(row.difference || 0) > 0 ? '+' : ''}${Number(row.difference || 0).toLocaleString('id-ID')} Pkk</td>
              <td style="border:1px solid #CBD5E1;padding:4px 6px">${esc(row.reason || '-')}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : ''}

      <!-- II. REKAM JEJAK PEMERIKSAAN BERULANG (AUDIT TRAIL LENGKAP) -->
      <div style="margin-bottom:12px">
        <div style="font-size:7.8pt;font-weight:700;color:#0F172A;margin-bottom:5px;text-transform:uppercase">
          II. Ringkasan Pemeriksaan Lapangan (${auditTrail.length}x Pemeriksaan)
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:7pt;border:1px solid #CBD5E1">
          <thead>
            <tr style="background:#F8FAFC;font-weight:800;color:#334155;text-align:left">
              <th style="border:1px solid #CBD5E1;padding:4px 6px;width:30px;text-align:center">Put.</th>
              <th style="border:1px solid #CBD5E1;padding:4px 6px">No. Pemeriksaan / Waktu</th>
              <th style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">Hasil Fisik</th>
              <th style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right">Selisih</th>
              <th style="border:1px solid #CBD5E1;padding:4px 6px">Petugas Pemeriksa</th>
            </tr>
          </thead>
          <tbody>
            ${auditTrail.map(item => `
              <tr>
                <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:center;font-weight:700">#${item.round}</td>
                <td style="border:1px solid #CBD5E1;padding:4px 6px">
                  <strong>${esc(item.docNo)}</strong>
                  <div style="font-size:6.2pt;color:#64748B">${item.completedAt ? formatDateTime(item.completedAt) : '-'}</div>
                </td>
                <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right;font-weight:700">${Number(item.physicalQty).toLocaleString('id-ID')} Pkk</td>
                <td style="border:1px solid #CBD5E1;padding:4px 6px;text-align:right;font-weight:800;color:#059669">${item.difference > 0 ? '+' : ''}${Number(item.difference).toLocaleString('id-ID')} Pkk</td>
                <td style="border:1px solid #CBD5E1;padding:4px 6px">
                  <strong>${esc(item.completedByName || 'Asisten Bibitan')}</strong>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- JUSTIFIKASI LAPANGAN -->
      <div style="margin-bottom:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:7px 9px">
        <div style="font-size:7pt;font-weight:800;color:#334155;text-transform:uppercase;margin-bottom:2px">Catatan & Justifikasi Asisten Bibitan:</div>
        <div style="font-size:7.2pt;color:#1E293B;line-height:1.4">${esc(doc.justifikasi || 'Hasil pemeriksaan stok fisik telah dikonfirmasi dan diajukan untuk rekonsiliasi berjenjang.')}</div>
      </div>

      <!-- III. BUKTI FOTO FISIK PEMERIKSAAN DI LAPANGAN (MAKSIMAL 2 FOTO) -->
      <div style="margin-bottom: ${isScreenPreview ? '10px' : '14px'};">
        <div style="font-size: ${isScreenPreview ? '7.8pt' : '9pt'}; font-weight: 700; color: #0F172A; margin-bottom: ${isScreenPreview ? '5px' : '6px'}; text-transform: uppercase;">
          III. Bukti Foto Fisik Pemeriksaan di Lapangan (Maksimal 2 Foto)
        </div>
        ${photos.length > 0 ? `
          <div class="bapb-preview-photos" style="display: flex; gap: ${isScreenPreview ? '8px' : '14px'}; justify-content: flex-start; align-items: flex-start;">
            ${photos.slice(0, 2).map((photoItem, pIdx) => {
    const photoSrc = typeof photoItem === 'string' ? photoItem : (photoItem.image || photoItem.dataUrl || photoItem.url || '');
    const photoLabel = typeof photoItem === 'object' && photoItem.round
      ? `Dokumentasi Putaran #${photoItem.round}`
      : `Dokumentasi Lapangan #${pIdx + 1}`;
    const photoMeta = typeof photoItem === 'object' && photoItem.capturedAt
      ? `${formatDateTime(photoItem.capturedAt)}${photoItem.latitude != null ? ` · ${Number(photoItem.latitude).toFixed(4)}, ${Number(photoItem.longitude).toFixed(4)}` : ''}`
      : '';

    return `
                <div class="bapb-preview-photo-item" style="flex: 1; max-width: ${isScreenPreview ? '160px' : '250px'}; border: 1px solid #CBD5E1; border-radius: 6px; padding: ${isScreenPreview ? '4px' : '6px'}; background: #F8FAFC; text-align: center; box-sizing: border-box;">
                  ${photoSrc ? `
                    <img src="${photoSrc}" alt="${esc(photoLabel)}" style="width: 100%; height: ${isScreenPreview ? '90px' : '130px'}; object-fit: cover; border-radius: 4px; display: block;" />
                  ` : `
                    <div style="height: ${isScreenPreview ? '90px' : '130px'}; display: flex; align-items: center; justify-content: center; background: #E2E8F0; border-radius: 4px; color: #64748B; font-size: ${isScreenPreview ? '6.5pt' : '8pt'}; font-style: italic;">
                      [Foto Bukti Sensus Tersimpan]
                    </div>
                  `}
                  <div style="font-size: ${isScreenPreview ? '6.5pt' : '7.5pt'}; color: #0F172A; margin-top: ${isScreenPreview ? '3px' : '4px'}; font-weight: 700;">
                    ${esc(photoLabel)}
                  </div>
                  ${photoMeta ? `<div style="font-size: ${isScreenPreview ? '5.8pt' : '6.5pt'}; color: #64748B; margin-top: 1px;">${esc(photoMeta)}</div>` : ''}
                </div>
              `;
  }).join('')}
          </div>
        ` : `
          <div style="border: 1px dashed #CBD5E1; border-radius: 6px; padding: ${isScreenPreview ? '8px' : '10px'}; font-size: ${isScreenPreview ? '7.2pt' : '8.5pt'}; color: #94A3B8; text-align: center;">
            Tidak ada foto bukti terlampir.
          </div>
        `}
      </div>

      <!-- IV. PENGESAHAN PEJABAT BERWENANG -->
      <div style="margin-top: ${isScreenPreview ? '10px' : '16px'};">
        <div style="font-size: ${isScreenPreview ? '7.8pt' : '9.5pt'}; font-weight: 700; color: #0F172A; margin-bottom: 6px; text-transform: uppercase;">
          IV. Pengesahan Pejabat Berwenang
        </div>
        
        <div class="bapb-preview-signatures" style="display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: ${isScreenPreview ? '6px' : '14px'} !important; text-align: center !important; margin-top: 10px !important;">
          
          <!-- 1. ASISTEN DIVISI BIBITAN -->
          <div class="bapb-preview-sig-box" style="border: 1px solid #CBD5E1 !important; border-radius: 6px !important; padding: ${isScreenPreview ? '6px 4px' : '8px'} !important; background: #FFFFFF !important; text-align: center !important;">
            <div style="font-size: ${isScreenPreview ? '6.5pt' : '7.5pt'}; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
            <div style="font-size: ${isScreenPreview ? '7.2pt' : '8.5pt'}; font-weight: 800; color: #0F172A; min-height: 22px;">Asisten Divisi Bibitan</div>
            <div style="height: ${isScreenPreview ? '44px' : '60px'}; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
              ${asbSig?.signatureDataUrl ? `
                <img src="${asbSig.signatureDataUrl}" alt="TTD ASB" style="max-height: ${isScreenPreview ? '40px' : '55px'}; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
              `}
            </div>
            <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
              <div style="font-size: ${isScreenPreview ? '7pt' : '8.5pt'}; font-weight: 800; color: #0F172A;">${esc(asbSig?.name || (doc.estateCode === 'APM' ? 'Abdul Gofur' : 'Annisa'))}</div>
              <div style="font-size: ${isScreenPreview ? '6pt' : '7pt'}; color: #64748B;">${asbSig?.signedAt ? esc(formatDate(asbSig.signedAt)) : '-'}</div>
            </div>
          </div>

          <!-- 2. ASISTEN KEPALA (ASKEP) -->
          <div class="bapb-preview-sig-box" style="border: 1px solid #CBD5E1 !important; border-radius: 6px !important; padding: ${isScreenPreview ? '6px 4px' : '8px'} !important; background: #FFFFFF !important; text-align: center !important;">
            <div style="font-size: ${isScreenPreview ? '6.5pt' : '7.5pt'}; font-weight: 700; color: #64748B; text-transform: uppercase;">Pelaksana</div>
            <div style="font-size: ${isScreenPreview ? '7.2pt' : '8.5pt'}; font-weight: 800; color: #0F172A; min-height: 22px;">Asisten Kepala</div>
            <div style="height: ${isScreenPreview ? '44px' : '60px'}; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
              ${askepSig?.signatureDataUrl ? `
                <img src="${askepSig.signatureDataUrl}" alt="TTD Askep" style="max-height: ${isScreenPreview ? '40px' : '55px'}; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
              `}
            </div>
            <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
              <div style="font-size: ${isScreenPreview ? '7pt' : '8.5pt'}; font-weight: 800; color: #0F172A;">${esc(askepSig?.name || (doc.estateCode === 'APM' ? 'Dadin' : 'Beny Sihotang'))}</div>
              <div style="font-size: ${isScreenPreview ? '6pt' : '7pt'}; color: #64748B;">${askepSig?.signedAt ? esc(formatDate(askepSig.signedAt)) : '-'}</div>
            </div>
          </div>

          <!-- 3. PENGURUS -->
          <div class="bapb-preview-sig-box" style="border: 1px solid #CBD5E1 !important; border-radius: 6px !important; padding: ${isScreenPreview ? '6px 4px' : '8px'} !important; background: #FFFFFF !important; text-align: center !important;">
            <div style="font-size: ${isScreenPreview ? '6.5pt' : '7.5pt'}; font-weight: 700; color: #64748B; text-transform: uppercase;">Diketahui</div>
            <div style="font-size: ${isScreenPreview ? '7.2pt' : '8.5pt'}; font-weight: 800; color: #0F172A; min-height: 22px;">Pengurus</div>
            <div style="height: ${isScreenPreview ? '44px' : '60px'}; display: flex; align-items: center; justify-content: center; margin: 3px 0;">
              ${pengurusSig?.signatureDataUrl ? `
                <img src="${pengurusSig.signatureDataUrl}" alt="TTD Pengurus" style="max-height: ${isScreenPreview ? '40px' : '55px'}; max-width: 90%; object-fit: contain;" />
              ` : `
                <span style="font-size: 6.5pt; color: #94A3B8; font-style: italic;">[Belum TTD]</span>
              `}
            </div>
            <div style="border-top: 1px solid #CBD5E1; padding-top: 3px;">
              <div style="font-size: ${isScreenPreview ? '7pt' : '8.5pt'}; font-weight: 800; color: #0F172A;">${esc(pengurusSig?.name || 'Junaidi')}</div>
              <div style="font-size: ${isScreenPreview ? '6pt' : '7pt'}; color: #64748B;">${pengurusSig?.signedAt ? esc(formatDate(pengurusSig.signedAt)) : '-'}</div>
            </div>
          </div>

        </div>
      </div>

      <!-- FOOTER INFORMASI PERUSAHAAN & LEGAL -->
      <div class="bapb-document-footer" style="margin-top: ${isScreenPreview ? '14px' : '20px'}; border-top: 1.5px solid #0f172a; padding-top: ${isScreenPreview ? '6px' : '8px'}; font-size: ${isScreenPreview ? '6.5pt' : '7.8pt'}; color: #475569; line-height: 1.4; text-align: left; box-sizing: border-box;">
        <div style="font-weight: 800; font-size: ${isScreenPreview ? '7.5pt' : '8.5pt'}; color: #0F172A; letter-spacing: 0.02em; margin-bottom: 2px;">
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
        <div style="margin-top: 4px; font-size: ${isScreenPreview ? '5.8pt' : '6.8pt'}; color: #94A3B8; text-align: right;">
          Dicetak: ${formatDateTime(new Date().toISOString())} WIB
        </div>
      </div>

    </div>
  `;
}

/**
 * Helper: Canvas Signature Handler Touch & Desktop
 */
export function setupSignatureCanvas(canvasEl, clearBtnEl) {
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

  return {
    getSignatureDataUrl: () => (strokeCount > 5 ? canvasEl.toDataURL('image/png') : null),
    getStrokeCount: () => strokeCount
  };
}

/**
 * Membuka Modal Preview & Persetujuan Dokumen BAPSB
 */
export function openBapsbPreviewModal(bapsbDoc, currentUser, onActionCallback = null) {
  if (!bapsbDoc) return;
  const docNo = esc((bapsbDoc.officialDocNo || bapsbDoc.docNo || '-').replace('/TBS/', '/TB/').replace('/DIV-1/', '/DIV-I/'));

  const role = String(currentUser?.role || currentUser?.rawRole || '').toUpperCase();
  const isAskep = role === 'ASKEP' || role === 'ASISTEN_KEPALA';
  const isPengurus = role === 'PENGURUS';

  // Tentukan apakah user saat ini perlu menandatangani
  const canAskepSign = isAskep && bapsbDoc.status === BAPSB_STATUS.MENUNGGU_PERSETUJUAN_ASKEP;
  const canPengurusSign = isPengurus && bapsbDoc.status === BAPSB_STATUS.MENUNGGU_PENGURUS;
  const needsSignature = canAskepSign || canPengurusSign;

  const roleTitle = canAskepSign ? 'Asisten Kepala' : (canPengurusSign ? 'Pengurus Kebun' : '');

  const signatureSection = needsSignature ? `
    <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong style="font-size:.8rem;color:#0F172A">Tanda Tangan Persetujuan (${roleTitle}) <span style="color:#DC2626">*</span></strong>
        <button id="bapsb-clear-sig" type="button" title="Hapus Goresan" aria-label="Hapus Goresan" style="border:0;background:transparent;color:#64748B;padding:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:4px">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>
      </div>
      <div style="border:1.5px dashed #94A3B8;border-radius:8px;background:#FAFAFA;position:relative;overflow:hidden">
        <canvas id="bapsb-sig-canvas" style="display:block;width:100%;height:130px;touch-action:none"></canvas>
      </div>
      <div style="font-size:.68rem;color:#64748B;margin-top:4px">Bubuhkan tanda tangan di dalam kotak sebagai bukti pengesahan digital.</div>
      <div style="margin-top:8px">
        <label style="display:block;font-size:.72rem;font-weight:700;color:#334155;margin-bottom:3px">Catatan Tambahan (Opsional):</label>
        <input id="bapsb-notes-input" type="text" placeholder="Masukkan catatan jika ada..." style="width:100%;padding:7px 9px;border:1px solid #CBD5E1;border-radius:6px;font-size:.75rem;box-sizing:border-box" />
      </div>
    </div>
  ` : '';

  let actionButtons = `
    <button id="bapsb-btn-close" type="button" class="bapb-btn-cancel">
      Kembali
    </button>
    <button id="bapsb-btn-print" type="button" class="bapb-btn-submit" style="background: #059669; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      <span>Cetak / Simpan PDF (A4)</span>
    </button>
  `;

  if (canAskepSign) {
    actionButtons = `
      <button id="bapsb-btn-return" type="button" class="bapb-btn-cancel" style="color:#B91C1C;border-color:#FCA5A5">
        Kembalikan
      </button>
      <button id="bapsb-btn-askep-submit" type="button" class="bapb-btn-submit" style="background:#116834;font-size:.72rem;line-height:1.15;padding:0 7px;letter-spacing:-.01em;">
        Setujui & Teruskan ke Pengurus
      </button>
    `;
  } else if (canPengurusSign) {
    actionButtons = `
      <button id="bapsb-btn-return" type="button" class="bapb-btn-cancel" style="color:#B91C1C;border-color:#FCA5A5">
        Kembalikan
      </button>
      <button id="bapsb-btn-pengurus-submit" type="button" class="bapb-btn-submit" style="background: #116834;">
        Sahkan Berita Acara (FINAL)
      </button>
    `;
  }

  // Bersihkan state cetak sebelumnya
  cleanupActivePrint(false);

  openModal({
    title: `Preview Berita Acara: ${docNo}`,
    isFullScreen: true,
    className: 'modal-fullscreen modal-bapb-fullscreen modal-bapb-preview-modal',
    body: `
      <div class="bapb-preview-container" style="display:flex;flex-direction:column;align-items:center;padding:12px 10px 24px">
        <div class="bapb-preview-paper" style="max-width:680px;width:100%;margin:0 auto">
          ${renderBapsbPrintHtml(bapsbDoc, { isScreenPreview: true })}
        </div>
        ${signatureSection ? `<div style="max-width:680px;width:100%;margin:0 auto">${signatureSection}</div>` : ''}
      </div>
    `,
    footer: `
      <div class="bapb-footer-actions" style="max-width:680px;margin:0 auto;width:100%">
        ${actionButtons}
      </div>
    `,
    onClose: () => {
      cleanupActivePrint(false);
    }
  });

  document.getElementById('bapsb-btn-close')?.addEventListener('click', () => {
    cleanupActivePrint(false);
    closeModal();
  });

  document.getElementById('bapsb-btn-print')?.addEventListener('click', () => {
    printBapsbDocument(bapsbDoc);
  });

  document.getElementById('bapsb-btn-return')?.addEventListener('click', () => {
    const reason = window.prompt('Masukkan alasan pengembalian BA ke Asisten Bibitan:');
    if (!reason || !reason.trim()) return;
    if (onActionCallback) {
      onActionCallback(canAskepSign ? 'RETURN_ASKEP' : 'RETURN_PENGURUS', { reason: reason.trim() });
    }
    closeModal();
  });

  let sigHandler = null;
  if (needsSignature) {
    const canvas = document.getElementById('bapsb-sig-canvas');
    const clearBtn = document.getElementById('bapsb-clear-sig');
    sigHandler = setupSignatureCanvas(canvas, clearBtn);

    if (canAskepSign) {
      document.getElementById('bapsb-btn-askep-submit')?.addEventListener('click', () => {
        const sigData = sigHandler.getSignatureDataUrl();
        if (!sigData) {
          alert('Tanda tangan digital Asisten Kepala wajib dibubuhkan.');
          return;
        }
        const notes = document.getElementById('bapsb-notes-input')?.value || '';
        if (onActionCallback) {
          onActionCallback('SIGN_ASKEP', { signatureDataUrl: sigData, notes });
        }
        closeModal();
      });
    }

    if (canPengurusSign) {
      document.getElementById('bapsb-btn-pengurus-submit')?.addEventListener('click', () => {
        const sigData = sigHandler.getSignatureDataUrl();
        if (!sigData) {
          alert('Tanda tangan digital Pengurus Kebun wajib dibubuhkan.');
          return;
        }
        const notes = document.getElementById('bapsb-notes-input')?.value || '';
        if (onActionCallback) {
          onActionCallback('FINALIZE_PENGURUS', { signatureDataUrl: sigData, notes });
        }
        closeModal();
      });
    }
  }
}

/**
 * Membuka modal preview A4 Berita Acara Pemeriksaan Stok Fisik (BAPSB) sebelum cetak
 */
export function openBapsbPrintPreviewModal(bapsbDoc) {
  openBapsbPreviewModal(bapsbDoc, null, null);
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
    const printBtn = document.getElementById('bapsb-btn-print');
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
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('pointer-events');
  const appEl = document.getElementById('app') || document.getElementById('main-content');
  if (appEl) {
    appEl.style.removeProperty('pointer-events');
  }
}

/**
 * Memicu dialog cetak native browser window.print() dengan isolasi total via iframe tersembunyi.
 * Memungkinkan user untuk mencetak langsung atau memilih 'Simpan sebagai PDF' (Save as PDF).
 */
export function printBapsbDocument(bapsbDoc) {
  if (!bapsbDoc) {
    throw new Error('Dokumen Berita Acara tidak valid untuk dicetak.');
  }

  if (isPrintBusy) {
    console.warn('[BAPSB Print] Proses cetak sedang dipersiapkan, abaikan klik berulang.');
    return;
  }
  isPrintBusy = true;

  cleanupActivePrint(false);
  isPrintBusy = true;

  const printBtn = document.getElementById('bapsb-btn-print');
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border: 2px solid #FFFFFF; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></div>
      <span>Menyiapkan Cetak...</span>
    `;
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'bapsb-print-iframe';
  iframe.setAttribute('title', 'BAPSB Print Frame');
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

  const cleanDocNo = (bapsbDoc.officialDocNo || bapsbDoc.docNo || 'BAPSB').replace('/TBS/', '/TB/').replace('/DIV-1/', '/DIV-I/');
  const printContentHtml = renderBapsbPrintHtml(bapsbDoc, { isScreenPreview: false });

  const fullPrintHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>BAPSB - ${cleanDocNo}</title>
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
      table tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    .bapb-preview-signatures {
      display: grid !important;
      grid-template-columns: 1fr 1fr 1fr !important;
      gap: 14px !important;
      text-align: center !important;
      margin-top: 12px !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .bapb-preview-sig-box {
      border: 1px solid #CBD5E1 !important;
      border-radius: 6px !important;
      padding: 8px !important;
      background: #FFFFFF !important;
      text-align: center !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .bapb-preview-photos {
      display: flex !important;
      gap: 14px !important;
      justify-content: flex-start !important;
      align-items: flex-start !important;
      margin-bottom: 12px !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .bapb-preview-photo-item {
      flex: 1 !important;
      max-width: 250px !important;
      border: 1px solid #CBD5E1 !important;
      border-radius: 6px !important;
      padding: 6px !important;
      background: #F8FAFC !important;
      text-align: center !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
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

  let hasHandledPrintEnd = false;
  const onPrintEnd = () => {
    if (hasHandledPrintEnd) return;
    hasHandledPrintEnd = true;
    cleanupActivePrint(true);
  };

  try {
    iframe.contentWindow?.addEventListener('afterprint', onPrintEnd);
  } catch (_) { }
  window.addEventListener('afterprint', onPrintEnd, { once: true });

  const onWindowFocusReturn = () => {
    setTimeout(() => {
      onPrintEnd();
      window.removeEventListener('focus', onWindowFocusReturn);
    }, 600);
  };
  window.addEventListener('focus', onWindowFocusReturn, { once: true });

  printSafetyTimer = setTimeout(() => {
    onPrintEnd();
  }, 10000);

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (printErr) {
      console.error('[BAPSB Print Error]', printErr);
      cleanupActivePrint(true);
      window.print();
    }
  }, 350);
}
