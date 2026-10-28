/**
 * js/modules/request/request-kebun-sendiri-form.js
 * Form Pembuatan Permintaan Bibit Kebun Sendiri (Role Asisten Bibitan & Asisten Lapangan)
 *
 * Transaction Type: KEBUN_SENDIRI
 * Otorisasi Create: ASISTEN_BIBITAN, ASISTEN (Asisten Lapangan/Divisi), dan MANTRI_TANAMAN.
 * Larangan: PENGURUS dan ASKEP dilarang membuat request ini.
 * Karakteristik: Tanpa kebun tujuan (targetEstateId = null, targetDivisionId = null).
 * Detail Distribusi: Inline Editable Table (No | Klon | Blok | Banyaknya (Pkk) | Aksi).
 */

import { navigate } from '../../core/router.js';
import { session } from '../../core/session.js';
import { getCurrentUserContext, normalizeRole, ROLES } from '../../core/user-context.js';
import { storage } from '../../core/storage.js';
import { toast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';
import { requestRepository } from '../../db/repositories.js';
import { getActiveKlons, resolveKlon } from '../../data/klon-master.js';
import { getActiveCfnaMaster, getCfnaByCode } from '../../data/cfna-master.js';
import { getOpenPrograms, getActivePrograms, getProgramById, isProgramOpen } from '../../data/program-master.js';
import { getNurseryDivisionsByEstate } from '../../data/estate-master.js';
import {
  getBlocksByDivision,
  getBlocksByEstate,
  getBlockById,
  resolveBlock,
  BLOCK_STATUS
} from '../../data/block-master.js';
import { applyTransactionActor, AUDIT_EVENT_TYPES } from '../../core/transaction-actor.js';
import {
  formatDate,
  formatFullDateIndonesian,
  todayISO,
  nowISO,
  generateUniqueDocNo,
  esc
} from '../../core/utils.js';

/**
 * Daftar role yang diizinkan membuat Permintaan Kebun Sendiri.
 * ASISTEN_BIBITAN, ASISTEN (Asisten Lapangan/Divisi), dan Mantri Bibitan.
 */
export const ALLOWED_CREATE_ROLES = [ROLES.ASISTEN_BIBITAN, ROLES.ASISTEN, ROLES.MANTRI_TANAMAN];

/**
 * Validasi otorisasi user untuk membuat permohonan Kebun Sendiri
 */
export function canCreateRequestKebunSendiri(currentUser) {
  if (!currentUser) return false;
  const userRole = normalizeRole(currentUser.role || currentUser.rawRole);
  return ALLOWED_CREATE_ROLES.includes(userRole) || userRole === 'MANTRI';
}

/**
 * Mengambil daftar master block yang ter-scope ketat untuk user requester.
 * Strict Scoping:
 * - Jika user memiliki divisionId/divisionCode, ambil strictly dari getBlocksByDivision.
 * - Jika tidak ada division (mis. Asisten Bibitan nursery pusat), ambil getBlocksByEstate.
 * - Jangan memperluas scope atau fallback lintas divisi jika divisi tidak memiliki block.
 */
export function getScopedBlocksForRequester(user) {
  if (!user) return [];
  const divisionCode = user.divisionId || user.divisionCode;
  const estateCode = user.estateId || user.estateCode || 'EST-TBS';

  let blocks = [];
  if (divisionCode) {
    blocks = getBlocksByDivision(divisionCode);
  } else if (estateCode) {
    blocks = getBlocksByEstate(estateCode);
  }

  // Filter hanya blok aktif
  return blocks.filter(b => b.status === BLOCK_STATUS.ACTIVE || !b.status);
}

export async function renderRequestKebunSendiriForm() {
  const app = document.getElementById('app');
  if (!app) return;

  const user = getCurrentUserContext();

  // ========================================================================
  // ROUTE GUARD: Hanya ASISTEN_BIBITAN & ASISTEN yang boleh mengakses form ini.
  // PENGURUS, ASKEP, MANTRI_TANAMAN ditolak.
  // ========================================================================
  if (!canCreateRequestKebunSendiri(user)) {
    toast('Anda tidak memiliki otorisasi untuk membuat Permintaan Bibit Kebun Sendiri.', 'error');
    navigate('/request');
    return;
  }

  const today = formatFullDateIndonesian(new Date());

  // Load existing requests for unique document numbering
  let existingRequests = [];
  try {
    existingRequests = await requestRepository.list();
  } catch (err) {
    existingRequests = storage.get('requests_transactions', []);
  }
  const docNo = generateUniqueDocNo('request', existingRequests);

  // 1. Program Pembibitan
  const currentEstateId = user.estateId || (user.divisionId && user.divisionId.includes('APM') ? 'EST-APM' : 'EST-TBS');
  const activePrograms = getOpenPrograms({ estateId: currentEstateId });
  const programOptions = activePrograms.map(p => `
    <option value="${esc(p.id)}">${esc(p.code)} - ${esc(p.name)}</option>
  `).join('');

  // 2. Kode Alokasi
  const activeCfna = getActiveCfnaMaster();
  const cfnaOptions = activeCfna.map(c => `
    <option value="${esc(c.code)}">${esc(c.code)} - ${esc(c.name)}</option>
  `).join('');

  // 3. Klon Master
  const activeKlons = getActiveKlons();

  // 4. Scoped Master Blocks
  const scopedBlocks = getScopedBlocksForRequester(user);

  const displayRole = (user.position || user.role || 'Asisten Lapangan');
  const displayEstate = user.estateName || user.estateId || 'Tanah Besih';
  const displayDivision = user.divisionName || (user.divisionId ? `Divisi ${user.divisionId}` : 'Divisi I');

  // Local state for inline editable distribution items: start with 1 initial row
  let distributionItems = [
    { cloneId: '', blockId: '', blockCode: '', blockName: '', qty: '' }
  ];

  app.innerHTML = `
    <div class="page" style="display: flex; flex-direction: column; height: 100%; background: #FAFAFA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      
      <!-- HEADER -->
      <header style="display: flex; align-items: center; height: 52px; padding: 0 12px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; flex-shrink: 0;">
        <button id="btn-back" type="button" aria-label="Kembali" style="padding: 6px; margin-left: -4px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #116834;">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h1 style="font-size: 0.95rem; font-weight: 700; color: #111111; margin: 0 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">Permintaan Bibit Kebun Sendiri</h1>
      </header>

      <!-- SCROLLABLE FORM BODY -->
      <main style="flex: 1; overflow-y: auto; padding: 16px;">
        
        <!-- CARD INFO DOKUMEN & PEMOHON -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div style="font-size: 0.72rem; font-weight: 600; color: #64748B; text-transform: uppercase;">Nomor Dokumen</div>
              <div style="font-size: 0.92rem; font-weight: 800; color: #116834; margin-top: 2px;">${esc(docNo)}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.72rem; font-weight: 600; color: #64748B; text-transform: uppercase;">Tanggal</div>
              <div style="font-size: 0.82rem; font-weight: 700; color: #334155; margin-top: 2px;">${esc(today)}</div>
            </div>
          </div>
          <div style="border-top: 1px solid #F1F5F9; padding-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748B;">Pemohon:</span>
              <span style="font-weight: 700; color: #1E293B;">${esc(user.name || 'Asisten')} (${esc(displayRole)})</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748B;">Lingkup Kebun / Divisi:</span>
              <span style="font-weight: 600; color: #475569;">${esc(displayEstate)} - ${esc(displayDivision)}</span>
            </div>
          </div>
        </div>

        <!-- FORM INPUT RINCIAN KEBUTUHAN -->
        <form id="form-request-kebun-sendiri" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <h2 style="font-size: 0.9rem; font-weight: 800; color: #0F172A; margin: 0 0 14px 0;">Rincian Kebutuhan Permintaan</h2>

          <!-- FIELD 1: PROGRAM PEMBIBITAN -->
          <div class="field" style="margin-bottom: 14px;">
            <label class="field-label" style="display: block; font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
              Program Pembibitan <span style="color: #EF4444;">*</span>
            </label>
            <select id="input-program" class="field-control" required style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 0.88rem; color: #0F172A;">
              ${programOptions}
            </select>
          </div>

          <!-- FIELD 2: KODE ALOKASI -->
          <div class="field" style="margin-bottom: 14px;">
            <label class="field-label" style="display: block; font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
              Kode Alokasi <span style="color: #EF4444;">*</span>
            </label>
            <select id="input-allocation" class="field-control" required style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 0.88rem; color: #0F172A;">
              <option value="">-- Pilih Kode Alokasi --</option>
              ${cfnaOptions}
            </select>
          </div>

          <!-- FIELD 3: KATEGORI -->
          <div class="field" style="margin-bottom: 14px;">
            <label class="field-label" style="display: block; font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
              Kategori <span style="color: #EF4444;">*</span>
            </label>
            <select id="input-category" class="field-control" required style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 0.88rem; color: #0F172A;">
              <option value="">-- Pilih Kategori --</option>
              <option value="APM">APM</option>
              <option value="Seedlings">Seedlings</option>
            </select>
          </div>

          <!-- FIELD 4: TAHAPAN PERTUMBUHAN -->
          <div class="field" style="margin-bottom: 14px;">
            <label class="field-label" style="display: block; font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
              Tahapan Pertumbuhan <span style="color: #EF4444;">*</span>
            </label>
            <select id="input-growth-stage" class="field-control" required style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 0.88rem; color: #0F172A;">
              <option value="">-- Pilih Tahapan Pertumbuhan --</option>
              <option value="Rubber Main Nursery">Rubber Main Nursery</option>
              <option value="Rubber Advance Planting Material">Rubber Advance Planting Material</option>
            </select>
          </div>

          <!-- FIELD 5: TANGGAL DIBUTUHKAN -->
          <div class="field" style="margin-bottom: 6px;">
            <label class="field-label" style="display: block; font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
              Tanggal Dibutuhkan <span style="color: #EF4444;">*</span>
            </label>
            <input 
              id="input-required-date" 
              class="field-control" 
              type="date" 
              required 
              style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 0.88rem; color: #0F172A;"
            />
          </div>
        </form>

        <!-- SECTION DETAIL DISTRIBUSI PERMINTAAN (INLINE EDITABLE TABLE) -->
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h2 style="font-size: 0.9rem; font-weight: 800; color: #0F172A; margin: 0;">Detail Distribusi Bibit</h2>
            <span id="distribution-badge-count" style="font-size: 0.72rem; font-weight: 700; background: #E8F5E9; color: #116834; padding: 2px 8px; border-radius: 12px;">1 Baris</span>
          </div>

          <!-- INLINE EDITABLE TABLE -->
          <div style="overflow-x: auto; margin-bottom: 12px; border: 1px solid #E2E8F0; border-radius: 8px;">
            <table id="table-distribution" style="width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: left;">
              <thead>
                <tr style="background: #F8FAFC; border-bottom: 1px solid #E2E8F0; color: #475569;">
                  <th style="padding: 8px 4px; font-weight: 700; text-align: center; width: 28px;">No</th>
                  <th style="padding: 8px 4px; font-weight: 700;">Klon</th>
                  <th style="padding: 8px 4px; font-weight: 700;">Blok</th>
                  <th style="padding: 8px 4px; font-weight: 700; text-align: right;">Banyaknya (Pkk)</th>
                  <th style="padding: 8px 4px; font-weight: 700; text-align: center; width: 44px;">Aksi</th>
                </tr>
              </thead>
              <tbody id="distribution-tbody">
                <!-- Inline rows dynamically rendered -->
              </tbody>
            </table>
          </div>

          <!-- TOMBOL TAMBAH BARIS -->
          <button id="btn-add-row" type="button" style="width: 100%; min-height: 38px; background: #FFFFFF; color: #116834; border: 1px solid #116834; border-radius: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s ease;">
            + Tambah Baris
          </button>

          <!-- TOTAL PERMINTAAN DI BAWAH TABEL -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 14px; margin-top: 10px;">
            <span style="font-weight: 700; font-size: 0.82rem; color: #334155;">Total Permintaan:</span>
            <span id="distribution-total-qty-label" style="font-weight: 800; font-size: 0.92rem; color: #116834;">0 Pkk</span>
          </div>
        </div>

        <!-- BUTTON ACTION UTAMA -->
        <button id="btn-review" type="button" class="btn btn-primary btn-block" style="width: 100%; min-height: 46px; background: #116834; color: #FFFFFF; border: none; border-radius: 8px; font-size: 0.92rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.15s ease;">
          Review Pengajuan
        </button>
      </main>
    </div>
  `;

  // Render inline editable table function
  function renderDistributionTable() {
    const tbody = app.querySelector('#distribution-tbody');
    const badgeCount = app.querySelector('#distribution-badge-count');
    if (!tbody) return;

    if (badgeCount) {
      badgeCount.textContent = `${distributionItems.length} Baris`;
    }

    if (distributionItems.length === 0) {
      tbody.innerHTML = `
        <tr id="empty-distribution-row">
          <td colspan="5" style="padding: 16px; text-align: center; color: #94A3B8; font-size: 0.76rem;">
            Belum ada baris distribusi. Klik "+ Tambah Baris" di atas untuk menambahkan.
          </td>
        </tr>
      `;
      updateTotalDisplay();
      return;
    }

    tbody.innerHTML = distributionItems.map((item, idx) => `
      <tr style="border-bottom: 1px solid #F1F5F9; vertical-align: middle;">
        <td style="padding: 6px 4px; text-align: center; font-weight: 700; color: #64748B; font-size: 0.76rem; width: 28px;">
          ${idx + 1}
        </td>
        <td style="padding: 6px 4px; min-width: 95px;">
          <select class="inline-clone-select" data-index="${idx}" style="width: 100%; min-height: 36px; padding: 4px 6px; border: 1px solid #CBD5E1; border-radius: 6px; background: #FFFFFF; font-size: 0.78rem; color: #0F172A;">
            <option value="">-- Klon --</option>
            ${activeKlons.map(c => `<option value="${esc(c.canonicalName)}" ${item.cloneId === c.canonicalName ? 'selected' : ''}>${esc(c.canonicalName)}</option>`).join('')}
          </select>
        </td>
        <td style="padding: 6px 4px; min-width: 85px;">
          <select class="inline-block-select" data-index="${idx}" style="width: 100%; min-height: 36px; padding: 4px 6px; border: 1px solid #CBD5E1; border-radius: 6px; background: #FFFFFF; font-size: 0.78rem; color: #0F172A;">
            <option value="">-- Blok --</option>
            ${scopedBlocks.map(b => `<option value="${esc(b.id)}" data-code="${esc(b.blockCode)}" data-name="${esc(b.blockName)}" ${item.blockId === b.id ? 'selected' : ''}>${esc(b.blockCode)}</option>`).join('')}
          </select>
        </td>
        <td style="padding: 6px 4px; min-width: 75px;">
          <input 
            type="number" 
            min="1" 
            step="1" 
            placeholder="Jumlah" 
            class="inline-qty-input" 
            data-index="${idx}" 
            value="${item.qty !== undefined && item.qty !== '' ? item.qty : ''}" 
            style="width: 100%; min-height: 36px; padding: 4px 6px; border: 1px solid #CBD5E1; border-radius: 6px; background: #FFFFFF; font-size: 0.80rem; font-weight: 700; color: #0F172A; text-align: right;" 
          />
        </td>
        <td style="padding: 6px 4px; text-align: center; width: 44px;">
          <button class="btn-remove-row" data-index="${idx}" type="button" aria-label="Hapus" style="background: transparent; border: none; color: #EF4444; font-size: 0.74rem; font-weight: 700; cursor: pointer; padding: 4px;">
            Hapus
          </button>
        </td>
      </tr>
    `).join('');

    updateTotalDisplay();
    bindTableEvents();
  }

  // Update total sum display
  function updateTotalDisplay() {
    const totalQtyLabel = app.querySelector('#distribution-total-qty-label');
    if (!totalQtyLabel) return;
    const total = distributionItems.reduce((acc, item) => {
      const q = typeof item.qty === 'number' ? item.qty : (parseInt(item.qty, 10) || 0);
      return acc + q;
    }, 0);
    totalQtyLabel.textContent = `${total.toLocaleString('id-ID')} Pkk`;
  }

  // Bind inline events
  function bindTableEvents() {
    const tbody = app.querySelector('#distribution-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.inline-clone-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (!isNaN(idx) && distributionItems[idx]) {
          distributionItems[idx].cloneId = e.target.value;
        }
      });
    });

    tbody.querySelectorAll('.inline-block-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (!isNaN(idx) && distributionItems[idx]) {
          const selOpt = e.target.options[e.target.selectedIndex];
          distributionItems[idx].blockId = e.target.value;
          distributionItems[idx].blockCode = selOpt?.getAttribute('data-code') || e.target.value;
          distributionItems[idx].blockName = selOpt?.getAttribute('data-name') || `Block ${distributionItems[idx].blockCode}`;
        }
      });
    });

    tbody.querySelectorAll('.inline-qty-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (!isNaN(idx) && distributionItems[idx]) {
          const val = e.target.value.trim();
          distributionItems[idx].qty = val === '' ? '' : (parseInt(val, 10) || 0);
          updateTotalDisplay();
        }
      });
    });

    tbody.querySelectorAll('.btn-remove-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < distributionItems.length) {
          distributionItems.splice(idx, 1);
          renderDistributionTable();
        }
      });
    });
  }

  // Initial render of table
  renderDistributionTable();

  // Back button
  app.querySelector('#btn-back')?.addEventListener('click', () => {
    navigate('/request/kebun-sendiri');
  });

  // Handler: Tambah Baris Langsung ke Tabel
  app.querySelector('#btn-add-row')?.addEventListener('click', () => {
    distributionItems.push({
      cloneId: '',
      blockId: '',
      blockCode: '',
      blockName: '',
      qty: ''
    });
    renderDistributionTable();
  });

  // Review button handler
  app.querySelector('#btn-review')?.addEventListener('click', () => {
    const programId = app.querySelector('#input-program')?.value?.trim();
    const allocationCode = app.querySelector('#input-allocation')?.value?.trim();
    const category = app.querySelector('#input-category')?.value?.trim();
    const growthStage = app.querySelector('#input-growth-stage')?.value?.trim();
    const requiredDate = app.querySelector('#input-required-date')?.value?.trim();

    // Validasi form utama
    if (!programId) {
      toast('Silakan pilih Program Pembibitan.', 'warning');
      return;
    }
    if (!allocationCode) {
      toast('Silakan pilih Kode Alokasi.', 'warning');
      return;
    }
    if (!category) {
      toast('Silakan pilih Kategori.', 'warning');
      return;
    }
    if (!growthStage) {
      toast('Silakan pilih Tahapan Pertumbuhan.', 'warning');
      return;
    }
    if (!requiredDate) {
      toast('Silakan isi Tanggal Dibutuhkan.', 'warning');
      return;
    }

    // Validasi tabel distribusi minimal 1 baris
    if (!distributionItems || distributionItems.length === 0) {
      toast('Harap tambahkan minimal 1 baris detail distribusi (Klon + Blok + Banyaknya).', 'warning');
      return;
    }

    // Validasi kelengkapan setiap baris
    for (let i = 0; i < distributionItems.length; i++) {
      const item = distributionItems[i];
      const q = typeof item.qty === 'number' ? item.qty : parseInt(item.qty, 10);
      if (!item.cloneId) {
        toast(`Baris ${i + 1}: Silakan pilih Klon.`, 'warning');
        return;
      }
      if (!item.blockId) {
        toast(`Baris ${i + 1}: Silakan pilih Blok.`, 'warning');
        return;
      }
      if (!q || isNaN(q) || q <= 0) {
        toast(`Baris ${i + 1}: Banyaknya (Pkk) harus lebih besar dari 0.`, 'warning');
        return;
      }
    }

    // Validasi duplikasi Klon + Blok
    const seen = new Set();
    for (let i = 0; i < distributionItems.length; i++) {
      const item = distributionItems[i];
      const key = `${item.cloneId}__${item.blockId}`;
      if (seen.has(key)) {
        toast(`Baris ${i + 1}: Kombinasi Klon "${item.cloneId}" dan Blok "${item.blockCode}" sudah ada di baris lain.`, 'warning');
        return;
      }
      seen.add(key);
    }

    const totalQty = distributionItems.reduce((acc, item) => acc + (Number(item.qty) || 0), 0);
    const purpose = 'Penanaman Kebun Sendiri / Bibit Tanam';
    const programObj = getProgramById(programId);
    
    // Tampilkan Modal Review Pengajuan
    openReviewModal({
      docNo,
      today,
      user,
      programId: programId || 'PRG-2026-001',
      programName: programObj ? programObj.name : 'Program Nursery 2026 - Batch 1',
      purpose,
      allocationCode,
      category,
      growthStage,
      requiredDate,
      distributionItems: distributionItems.map(item => ({
        ...item,
        qty: Number(item.qty) || 0
      })),
      qty: totalQty
    });
  });
}

/** Modal Review Pengajuan Sebelum Submit */
function openReviewModal(data) {
  const distributionRowsHtml = data.distributionItems.map((item, idx) => `
    <tr style="border-bottom: 1px solid #E2E8F0;">
      <td style="padding: 6px 8px; font-weight: 700; color: #1E293B;">${esc(item.cloneId)}</td>
      <td style="padding: 6px 8px; font-weight: 600; color: #475569;">${esc(item.blockCode)}</td>
      <td style="padding: 6px 8px; text-align: right; font-weight: 700; color: #116834;">${item.qty.toLocaleString('id-ID')} Pkk</td>
    </tr>
  `).join('');

  openModal({
    title: 'Review Pengajuan Permintaan Kebun Sendiri',
    body: `
      <div style="padding: 4px 0;">
        <p style="font-size: 0.82rem; color: #64748B; margin: 0 0 12px 0; line-height: 1.4;">
          Pastikan rincian permintaan bibit kebun sendiri di bawah ini telah sesuai sebelum diajukan ke Asisten Kepala:
        </p>

        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; font-size: 0.82rem; margin-bottom: 12px;">
          <!-- 1. NO. DOKUMEN -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #E2E8F0;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">No. Dokumen</span>
            <span style="font-weight: 800; color: #116834; font-size: 0.85rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.docNo)}</span>
          </div>

          <!-- 2. PEMOHON -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Pemohon</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.user.name || 'Asisten')} (${esc(data.user.position || data.user.role || 'Asisten')})</span>
          </div>

          <!-- 3. KEBUN ASAL -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Lingkup Kebun</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.user.estateName || data.user.estateId || '-')} - ${esc(data.user.divisionName || data.user.divisionId || '-')}</span>
          </div>

          <!-- 4. PROGRAM -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Program Pembibitan</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.programName)}</span>
          </div>

          <!-- 5. KODE ALOKASI -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Kode Alokasi</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.allocationCode)}</span>
          </div>

          <!-- 6. KATEGORI -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Kategori</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.category)}</span>
          </div>

          <!-- 7. TAHAPAN PERTUMBUHAN -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Tahapan Pertumbuhan</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(data.growthStage)}</span>
          </div>

          <!-- 8. TANGGAL DIBUTUHKAN -->
          <div style="display: grid; grid-template-columns: 42% 58%; gap: 8px; align-items: start; margin-bottom: 7px;">
            <span style="color: #64748B; font-size: 0.82rem; line-height: 1.35; text-align: left;">Tanggal Dibutuhkan</span>
            <span style="font-weight: 700; color: #1E293B; font-size: 0.82rem; line-height: 1.35; text-align: right; min-width: 0; overflow-wrap: anywhere;">${esc(formatDate(data.requiredDate))}</span>
          </div>
        </div>

        <!-- TABEL RINCIAN DISTRIBUSI -->
        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.80rem; font-weight: 700; color: #334155; margin-bottom: 6px;">Rincian Distribusi Blok (${data.distributionItems.length} Baris):</div>
          <div style="border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.76rem;">
              <thead>
                <tr style="background: #E2E8F0; color: #334155;">
                  <th style="padding: 6px 8px; text-align: left;">Klon</th>
                  <th style="padding: 6px 8px; text-align: left;">Blok</th>
                  <th style="padding: 6px 8px; text-align: right;">Banyaknya</th>
                </tr>
              </thead>
              <tbody>
                ${distributionRowsHtml}
              </tbody>
              <tfoot style="background: #F1F5F9; font-weight: 700;">
                <tr>
                  <td colspan="2" style="padding: 6px 8px; color: #1E293B;">Total Banyaknya</td>
                  <td style="padding: 6px 8px; text-align: right; color: #116834; font-size: 0.85rem;">${data.qty.toLocaleString('id-ID')} Pkk</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `,
    footer: `
      <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 10px; width: 100%;">
        <button class="btn btn-ghost" id="btn-cancel-modal" style="width: 100%; min-height: 42px; border: 1px solid #CBD5E1; color: #475569; font-weight: 600; font-size: 0.88rem; padding: 8px 12px; white-space: nowrap; cursor: pointer;">Ubah Data</button>
        <button class="btn btn-primary" id="btn-confirm-submit" style="width: 100%; min-height: 42px; background: #116834; color: #FFFFFF; font-weight: 700; font-size: 0.88rem; padding: 8px 12px; white-space: nowrap; cursor: pointer;">Kirim Permintaan</button>
      </div>
    `
  });

  const root = document.getElementById('modal-root');
  root?.querySelector('#btn-cancel-modal')?.addEventListener('click', closeModal);

  root?.querySelector('#btn-confirm-submit')?.addEventListener('click', async () => {
    closeModal();
    await submitRequestKebunSendiri(data);
  });
}

/**
 * Service-level submit request Kebun Sendiri.
 * SERVICE-LEVEL GUARD: Hanya ASISTEN_BIBITAN dan ASISTEN (Lapangan) yang diizinkan.
 */
export async function submitRequestKebunSendiri(data) {
  // Service-level authorization guard
  const creatorRole = normalizeRole(data.user?.role || data.user?.rawRole || '');
  if (!ALLOWED_CREATE_ROLES.includes(creatorRole) && creatorRole !== 'MANTRI') {
    toast('Otorisasi ditolak: Hanya Asisten Bibitan atau Asisten Lapangan yang dapat membuat Permintaan Bibit Kebun Sendiri.', 'error');
    console.error(`[submitRequestKebunSendiri] ACCESS DENIED: role '${creatorRole}' tidak berwenang.`);
    throw new Error(`ACCESS_DENIED: Role '${creatorRole}' tidak diizinkan membuat request KEBUN_SENDIRI.`);
  }

  // Validasi minimal 1 distribution item (dengan fallback backward compatibility jika hanya ada klon + qty)
  let rawItems = data.distributionItems || [];
  if (rawItems.length === 0 && (data.klon || data.cloneId) && data.qty) {
    const scopedBlocks = getScopedBlocksForRequester(data.user);
    const defaultBlock = scopedBlocks[0] || getBlockById('BLK-001') || { id: 'BLK-001', blockCode: '001/91', blockName: 'Block 001/91' };
    rawItems = [{
      cloneId: data.klon || data.cloneId,
      blockId: defaultBlock.id,
      blockCode: defaultBlock.blockCode,
      blockName: defaultBlock.blockName,
      qty: data.qty
    }];
  }

  if (rawItems.length === 0) {
    toast('Detail distribusi bibit tidak boleh kosong.', 'warning');
    throw new Error('VALIDATION_ERROR: Detail distribusi kosong.');
  }

  // Normalize distributionItems
  const distributionItems = rawItems.map(item => {
    const resolvedK = resolveKlon(item.cloneId);
    return {
      cloneId: resolvedK ? resolvedK.canonicalName : item.cloneId,
      blockId: item.blockId,
      blockCode: item.blockCode,
      blockName: item.blockName,
      qty: Number(item.qty) || 0
    };
  });

  const totalQty = distributionItems.reduce((acc, item) => acc + item.qty, 0);
  const primaryClone = distributionItems[0]?.cloneId || '';

  const resolvedCfna = getCfnaByCode(data.allocationCode);
  const canonicalAllocation = resolvedCfna ? resolvedCfna.code : (data.allocationCode || '');

  // Menentukan fulfillment nursery division default di kebun pemohon
  const estateId = data.user.estateId || 'EST-TBS';
  const nurseryDivs = getNurseryDivisionsByEstate(estateId);
  const defaultNurseryDiv = (nurseryDivs && nurseryDivs.length > 0) ? nurseryDivs[0] : null;

  const currentUserId = data.user.userId || data.user.id || data.user.code || 'AST001';

  const newRecord = {
    id: 'REQ-' + Date.now(),
    requestId: 'REQ-' + Date.now(),
    docNo: data.docNo,
    nomorDokumen: data.docNo,
    nir: data.docNo,
    type: 'KEBUN_SENDIRI',
    transactionType: 'KEBUN_SENDIRI',
    category: data.category,
    status: 'MENUNGGU_VERIFIKASI_ASISTEN_KEPALA',
    statusLabel: 'Menunggu Verifikasi Askep',

    // Transaction Date Context
    createdAt: nowISO(),
    date: todayISO(),
    tanggal: todayISO(),

    // Requester Identity (Eksplisit terpisah)
    requesterUserId: currentUserId,
    requesterRole: creatorRole,
    requesterEstateId: estateId,
    requesterDivisionId: data.user.divisionId || null,
    userId: currentUserId,
    role: creatorRole,
    requestedBy: data.user.name || currentUserId,
    position: data.user.position || 'Asisten Lapangan',
    estateId: estateId,
    divisionId: data.user.divisionId || null,
    divisionName: data.user.divisionName || (data.user.divisionId ? `Divisi ${data.user.divisionId}` : null),

    // Destination: STRICTLY NULL / TIDAK DIGUNAKAN (No dummy target)
    targetEstateId: null,
    targetDivisionId: null,
    targetEstateName: null,

    // Fulfillment Assistant Context (Terpisah dari requester)
    fulfillmentAssistantUserId: null, // Diisi saat workflow verifikasi ASB
    fulfillmentAssistantRole: ROLES.ASISTEN_BIBITAN,
    fulfillmentDivisionId: defaultNurseryDiv ? defaultNurseryDiv.division_id : null,
    fulfillmentDivisionName: defaultNurseryDiv ? defaultNurseryDiv.division_name : null,

    // Program Master
    programId: data.programId || 'PRG-2026-001',
    programName: data.programName || 'Program Nursery 2026 - Batch 1',

    // Business Payload & Detail Distribusi Master Block
    purpose: data.purpose || 'Penanaman Kebun Sendiri / Bibit Tanam',
    allocationCode: canonicalAllocation,
    klon: primaryClone,
    cloneId: primaryClone,
    growthStage: data.growthStage,
    qty: totalQty,
    requestedQty: totalQty,
    approvedQty: totalQty,
    approvedClone: primaryClone,
    unit: 'Pkk',
    requiredDate: data.requiredDate,

    // Canonical Multi-Row Distribution Items
    distributionItems: distributionItems,

    // Workflow Review / Audit History
    askepReview: null,
    pengurusApproval: null,
    asbVerification: null,
    dispatchData: null,
    dispatchVerification: null,
    receiptData: null,
    auditTrail: []
  };

  try {
    // 1. Simpan ke IndexedDB requests store jika ada
    let savedRecord = null;
    try {
      savedRecord = await requestRepository.create(newRecord, data.user);
    } catch (dbErr) {
      savedRecord = applyTransactionActor(
        newRecord,
        AUDIT_EVENT_TYPES.CREATE,
        data.user,
        'Permintaan Bibit Kebun Sendiri diajukan.'
      );
    }

    // 2. Simpan ke LocalStorage fallback agar kompatibel dengan storage registry
    const localList = storage.get('requests_transactions', []);
    localList.unshift(savedRecord);
    storage.set('requests_transactions', localList);

    toast('Dokumen Permintaan Bibit Kebun Sendiri berhasil diajukan.', 'success');
    try {
      navigate('/request/kebun-sendiri');
    } catch (_) {}
    return savedRecord;
  } catch (err) {
    if (err.message && err.message.startsWith('ACCESS_DENIED')) throw err;
    console.error('[submitRequestKebunSendiri] Gagal menyimpan permintaan:', err);
    toast('Gagal mengajukan permohonan. Silakan coba kembali.', 'danger');
    return null;
  }
}
