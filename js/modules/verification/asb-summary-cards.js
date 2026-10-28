/**
 * js/modules/verification/asb-summary-cards.js
 * Shared Presentation & Read-Only Selector for Asisten Bibitan Summary Cards:
 * 1. VERIFIKASI DIPERLUKAN (Halaman /#/verification)
 * 2. PEMERIKSAAN DIPERLUKAN (Halaman /#/inspection)
 * 
 * Sesuai Desain Acuan Visual Reference:
 * - Header title kiri, "Pembaruan Terakhir HH:MM:SS" di bawahnya
 * - 2-Kolom Hero Metrics: Angka Besar + Label 2-baris di sampingnya (Hijau #116834)
 * - Progress bar warna gradasi berdasarkan persentase (getProgressColor)
 * - Footer: "Pencapaian hari ini" kiri & Persentase merah di kanan
 */

import { storage } from '../../core/storage.js';
import {
  getActionableRecordsForAsb,
  getVerifiedTransactionsByScope
} from './verification-manager.js';
import {
  getActionableSelectionCount,
  getPreGraftingSelectionDocuments,
  filterSelectionByScope,
  SELECTION_STORAGE_KEY,
  SELECTION_TYPES,
  SELECTION_STAGES
} from '../selection/selection-manager.js';
import {
  getActionableDestructionCount,
  filterDestructionByScope,
  DESTRUCTION_STORAGE_KEY
} from '../destruction/destruction-manager.js';
import {
  getPhysicalStockActionableCount
} from '../physical-stock-inspection/physical-stock-inspection-manager.js';

/**
 * Format timestamp terbaru menjadi HH:mm:ss atau null jika tidak ada
 */
function extractLatestTimestamp(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let latestTime = 0;
  for (const r of records) {
    if (!r) continue;
    const raw = r.submittedAt || r.updatedAt || r.verifiedAt || r.approvedAt || r.createdAt || r.date || r.tanggal;
    if (raw) {
      const t = new Date(raw).getTime();
      if (!isNaN(t) && t > latestTime) {
        latestTime = t;
      }
    }
  }
  if (latestTime === 0) return null;
  const d = new Date(latestTime);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Continuous HSL interpolation untuk warna progress bar berdasarkan percentage.
 * 0% → Merah, 25% → Orange, 50% → Kuning, 75% → Hijau, 100% → Hijau penuh (#116834).
 * Percentage di-clamp ke range 0-100 sebelum kalkulasi warna.
 * @param {number} percentage - Nilai persentase (akan di-clamp ke 0-100)
 * @returns {string} CSS color string
 */
export function getProgressColor(percentage) {
  const p = Math.max(0, Math.min(100, percentage));

  // 100% = hijau penuh, konsisten dengan design system existing (#116834)
  if (p === 100) return '#116834';

  // Linear HSL interpolation: hue 0° (merah) → 120° (hijau)
  const hue = Math.round((p / 100) * 120);
  return `hsl(${hue}, 80%, 45%)`;
}

/**
 * Mengambil ringkasan metrik untuk CARD 1: VERIFIKASI DIPERLUKAN
 * @param {Object} userCtx 
 * @returns {Object} { pendingCount, verifiedCount, totalCount, percentage, lastUpdatedStr, timeStr }
 */
export function getVerifikasiSummary(userCtx) {
  if (!userCtx) {
    return { pendingCount: 0, verifiedCount: 0, totalCount: 0, percentage: 0, lastUpdatedStr: 'Belum ada pembaruan', timeStr: null };
  }

  const pendingList = getActionableRecordsForAsb(userCtx);
  const verifiedList = getVerifiedTransactionsByScope(userCtx);

  const pendingCount = pendingList.length;
  const verifiedCount = verifiedList.length;
  const totalCount = pendingCount + verifiedCount;

  // Persentase verifikasi selesai vs total transaksi masuk
  let percentage = 0;
  if (totalCount > 0) {
    percentage = Math.round((verifiedCount / totalCount) * 100);
  }

  // Cari timestamp terbaru dari pending atau verified
  const allVerifTxs = [...pendingList, ...verifiedList];
  const timeStr = extractLatestTimestamp(allVerifTxs);
  const lastUpdatedStr = timeStr ? `Pembaruan Terakhir ${timeStr}` : 'Belum ada pembaruan';

  return {
    pendingCount,
    verifiedCount,
    totalCount,
    percentage,
    lastUpdatedStr,
    timeStr
  };
}

/**
 * Mengambil ringkasan metrik untuk CARD 2: PEMERIKSAAN DIPERLUKAN
 * @param {Object} userCtx 
 * @returns {Object} { pendingCount, completedCount, totalCount, percentage, lastUpdatedStr, timeStr, pendingSelection, pendingDestruction }
 */
export function getPemeriksaanSummary(userCtx) {
  if (!userCtx) {
    return { pendingCount: 0, completedCount: 0, totalCount: 0, percentage: 0, lastUpdatedStr: 'Belum ada pembaruan', timeStr: null, pendingPhysicalStock: 0, pendingDestruction: 0 };
  }

  const pendingPhysicalStock = getPhysicalStockActionableCount(userCtx);
  const pendingDestruction = getActionableDestructionCount(null, userCtx);
  const pendingCount = pendingPhysicalStock + pendingDestruction;

  // 1. Hitung Pemeriksaan Stok Fisik Selesai
  const allPhysicalStock = storage.get('physical_stock_inspections', []);
  const completedPhysicalStockCount = allPhysicalStock.filter(d => (d.status || '').toUpperCase() === 'COMPLETED').length;

  // 2. Hitung Pemusnahan Selesai (DISETUJUI)
  const allDestructionRecords = storage.get(DESTRUCTION_STORAGE_KEY, []);
  const scopedDestruction = filterDestructionByScope(allDestructionRecords, userCtx);
  const approvedDestructionCount = scopedDestruction.filter(d => (d.status || '').toUpperCase() === 'DISETUJUI').length;

  const completedCount = completedPhysicalStockCount + approvedDestructionCount;
  const totalCount = pendingCount + completedCount;

  let percentage = 0;
  if (totalCount > 0) {
    percentage = Math.round((completedCount / totalCount) * 100);
  }

  // Timestamp terbaru
  const allInspRecords = [...allPhysicalStock, ...scopedDestruction];
  const timeStr = extractLatestTimestamp(allInspRecords);
  const lastUpdatedStr = timeStr ? `Pembaruan Terakhir ${timeStr}` : 'Belum ada pembaruan';

  return {
    pendingCount,
    completedCount,
    totalCount,
    percentage,
    lastUpdatedStr,
    timeStr,
    pendingPhysicalStock,
    pendingDestruction
  };
}

/**
 * Render HANYA Card "Verifikasi Diperlukan" untuk halaman /#/verification
 * @param {Object} userCtx 
 * @returns {string} HTML string
 */
export function renderVerifikasiSummaryCardHtml(userCtx) {
  const stats = getVerifikasiSummary(userCtx);
  const progressColor = getProgressColor(stats.percentage);

  return `
    <div class="asb-summary-card" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); box-sizing: border-box; margin-bottom: 12px;">
      
      <!-- HEADER: TITLE & TIMESTAMP -->
      <div style="margin-bottom: 12px;">
        <h3 style="font-size: 0.96rem; font-weight: 800; color: #111827; margin: 0; letter-spacing: -0.01em; line-height: 1.25;">
          Verifikasi Diperlukan
        </h3>
        <div style="font-size: 0.70rem; color: #94A3B8; margin-top: 3px; font-weight: 500;">
          ${stats.lastUpdatedStr}
        </div>
      </div>

      <!-- BODY: 2-COLUMN HERO METRICS -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; align-items: center;">
        <!-- KOLOM KIRI: TOTAL MASUK -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 2.1rem; font-weight: 800; color: #116834; line-height: 1; letter-spacing: -0.02em;">
            ${stats.totalCount}
          </span>
          <div style="font-size: 0.74rem; font-weight: 700; color: #116834; line-height: 1.2;">
            Verifikasi<br>Masuk
          </div>
        </div>

        <!-- KOLOM KANAN: TOTAL DIPROSES -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 2.1rem; font-weight: 800; color: #116834; line-height: 1; letter-spacing: -0.02em;">
            ${stats.verifiedCount}
          </span>
          <div style="font-size: 0.74rem; font-weight: 700; color: #116834; line-height: 1.2;">
            Verifikasi<br>Diproses
          </div>
        </div>
      </div>

      <!-- GRADIENT PROGRESS BAR -->
      <div style="height: 6px; background: #F1F5F9; border-radius: 999px; overflow: hidden; margin-bottom: 8px;">
        <div style="height: 100%; width: ${stats.percentage}%; background: ${progressColor}; border-radius: 999px; transition: width 0.3s ease;"></div>
      </div>

      <!-- FOOTER: PENCAPAIAN HARI INI & PERSENTASE -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.74rem; font-weight: 500; color: #64748B;">
          Pencapaian hari ini
        </span>
        <span style="font-size: 0.80rem; font-weight: 800; color: ${progressColor};">
          ${stats.percentage}%
        </span>
      </div>

    </div>
  `;
}

/**
 * Render HANYA Card "Pemeriksaan Diperlukan" untuk halaman /#/inspection
 * @param {Object} userCtx 
 * @returns {string} HTML string
 */
export function renderPemeriksaanSummaryCardHtml(userCtx) {
  const stats = getPemeriksaanSummary(userCtx);
  const progressColor = getProgressColor(stats.percentage);

  return `
    <div class="asb-summary-card" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); box-sizing: border-box; margin-bottom: 12px;">
      
      <!-- HEADER: TITLE & TIMESTAMP -->
      <div style="margin-bottom: 12px;">
        <h3 style="font-size: 0.96rem; font-weight: 800; color: #111827; margin: 0; letter-spacing: -0.01em; line-height: 1.25;">
          Pemeriksaan Diperlukan
        </h3>
        <div style="font-size: 0.70rem; color: #94A3B8; margin-top: 3px; font-weight: 500;">
          ${stats.lastUpdatedStr}
        </div>
      </div>

      <!-- BODY: 2-COLUMN HERO METRICS -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; align-items: center;">
        <!-- KOLOM KIRI: TOTAL MASUK -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 2.1rem; font-weight: 800; color: #116834; line-height: 1; letter-spacing: -0.02em;">
            ${stats.totalCount}
          </span>
          <div style="font-size: 0.74rem; font-weight: 700; color: #116834; line-height: 1.2;">
            Pemeriksaan<br>Masuk
          </div>
        </div>

        <!-- KOLOM KANAN: TOTAL DIPROSES -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 2.1rem; font-weight: 800; color: #116834; line-height: 1; letter-spacing: -0.02em;">
            ${stats.completedCount}
          </span>
          <div style="font-size: 0.74rem; font-weight: 700; color: #116834; line-height: 1.2;">
            Pemeriksaan<br>Diproses
          </div>
        </div>
      </div>

      <!-- GRADIENT PROGRESS BAR -->
      <div style="height: 6px; background: #F1F5F9; border-radius: 999px; overflow: hidden; margin-bottom: 8px;">
        <div style="height: 100%; width: ${stats.percentage}%; background: ${progressColor}; border-radius: 999px; transition: width 0.3s ease;"></div>
      </div>

      <!-- FOOTER: PENCAPAIAN HARI INI & PERSENTASE -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.74rem; font-weight: 500; color: #64748B;">
          Pencapaian hari ini
        </span>
        <span style="font-size: 0.80rem; font-weight: 800; color: ${progressColor};">
          ${stats.percentage}%
        </span>
      </div>

    </div>
  `;
}
