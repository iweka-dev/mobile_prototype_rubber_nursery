/**
 * js/modules/review/flow-process-ui.js
 * User Interface & Interactive Mermaid Flowchart Renderer untuk Tab "Flow Proses Aplikasi"
 * Prototype Review Workspace — SIGMA Nursery
 */

import { MAIN_FLOW, ROLE_FLOWS, MODULE_FLOWS } from './flow-process-data.js';
import { navigate } from '../../core/router.js';
import { toast } from '../../components/toast.js';

// State Internal Tab Flow
let activeCategory = 'MAIN'; // 'MAIN' | 'ROLE' | 'MODULE'
let selectedRoleId = 'MANTRI_TANAMAN';
let selectedModuleId = 'attendance';
let activeViewMode = 'DIAGRAM'; // 'DIAGRAM' | 'STEPS'
let selectedNodeData = null;
let moduleSearchQuery = '';
let zoomLevel = 1.0;

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render Konten Utama Tab Flow Proses
 */
export function renderFlowProcessTab() {
  const currentFlowData = getCurrentFlowData();

  return `
    <div class="flow-app-workspace" id="flow-app-workspace">
      <!-- 1. Top Bar: Kategori Flow & Mode Tampilan -->
      <div class="flow-app-top-header">
        <div class="flow-app-brand-area">
          <div class="flow-app-title-line">
            <h2>Flow Proses Aplikasi</h2>
            <span class="flow-audit-badge runtime">Hasil Audit Source Code & Runtime Aktual</span>
          </div>
          <p class="flow-app-subtitle">
            Diagram Mermaid Flowchart TD interaktif yang menggambarkan alur penggunaan aplikasi berdasarkan implementasi source code yang berjalan di repository.
          </p>
        </div>

        <!-- 3-Tier Category Selector -->
        <div class="flow-category-switch-bar">
          <button class="flow-cat-btn ${activeCategory === 'MAIN' ? 'is-active' : ''}" data-cat="MAIN" type="button">
            <span>Siklus Utama</span>
          </button>
          <button class="flow-cat-btn ${activeCategory === 'ROLE' ? 'is-active' : ''}" data-cat="ROLE" type="button">
            <span>Berdasarkan Role (7)</span>
          </button>
          <button class="flow-cat-btn ${activeCategory === 'MODULE' ? 'is-active' : ''}" data-cat="MODULE" type="button">
            <span>Berdasarkan Modul (14)</span>
          </button>
        </div>
      </div>

      <!-- 2. Sub-Navigation / Filter Bar -->
      ${renderSubNavigationBar()}

      <!-- 3. Active Flow Content View -->
      <div class="flow-content-layout">
        ${renderFlowHeaderCard(currentFlowData)}
        ${renderFlowMainBody(currentFlowData)}
        ${renderFlowTraceabilitySection(currentFlowData)}
        ${renderFlowMetadataGrid(currentFlowData)}
      </div>
    </div>
  `;
}

/** Ambil dataset yang sedang aktif berdasarkan state */
function getCurrentFlowData() {
  if (activeCategory === 'MAIN') {
    return MAIN_FLOW;
  }
  if (activeCategory === 'ROLE') {
    return ROLE_FLOWS[selectedRoleId] || ROLE_FLOWS['MANTRI_TANAMAN'];
  }
  return MODULE_FLOWS[selectedModuleId] || MODULE_FLOWS['attendance'];
}

/** Render Sub-Navigation Bar (Role Pills / Module Pills) */
function renderSubNavigationBar() {
  if (activeCategory === 'MAIN') {
    return `
      <div class="flow-sub-nav-bar main-phases-bar">
        <span class="sub-nav-label">Cakupan Siklus:</span>
        <div class="flow-phase-chips-wrap">
          <span class="flow-phase-chip"><strong class="phase-num">01</strong> Pengadaan SIR</span>
          <span class="flow-phase-chip"><strong class="phase-num">02</strong> Dederan Pasir</span>
          <span class="flow-phase-chip"><strong class="phase-num">03</strong> Pindah Semai</span>
          <span class="flow-phase-chip"><strong class="phase-num">04</strong> Seleksi Pra-Okulasi</span>
          <span class="flow-phase-chip"><strong class="phase-num">05</strong> Okulasi & Entres</span>
          <span class="flow-phase-chip"><strong class="phase-num">06</strong> Buka Ikatan & Regrafting</span>
          <span class="flow-phase-chip"><strong class="phase-num">07</strong> Pengeluaran SPB</span>
          <span class="flow-phase-chip"><strong class="phase-num">08</strong> BAPB Afkir</span>
          <span class="flow-phase-chip"><strong class="phase-num">09</strong> EOD & Verifikasi ERP</span>
        </div>
      </div>
    `;
  }

  if (activeCategory === 'ROLE') {
    const rolesList = Object.values(ROLE_FLOWS);
    return `
      <div class="flow-sub-nav-bar role-selector-bar">
        <span class="sub-nav-label">Pilih Role / Persona:</span>
        <div class="flow-role-chips-wrap">
          ${rolesList.map(r => `
            <button class="flow-role-select-chip ${selectedRoleId === r.roleId ? 'is-active' : ''}" data-role-id="${r.roleId}" type="button">
              <span class="role-name">${esc(r.roleName)}</span>
              ${r.verificationStatus === 'DALAM PENGEMBANGAN'
                ? '<span class="chip-status-tag dev">Dev</span>'
                : '<span class="chip-status-tag ok">Aktif</span>'}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Active Category: MODULE
  const modulesList = Object.values(MODULE_FLOWS).filter(m => {
    if (!moduleSearchQuery) return true;
    const q = moduleSearchQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
  });

  return `
    <div class="flow-sub-nav-bar module-selector-bar">
      <div class="module-search-row">
        <span class="sub-nav-label">Pilih Modul Operasional:</span>
        <div class="module-search-input-wrap">
          <input type="text" id="flow-module-search" class="flow-module-search-input" placeholder="Cari nama atau kode modul..." value="${esc(moduleSearchQuery)}" />
          ${moduleSearchQuery ? '<button id="flow-module-search-clear" class="btn-clear-search" type="button">&times;</button>' : ''}
        </div>
      </div>
      <div class="flow-module-chips-wrap">
        ${modulesList.map(m => {
          const rawKey = m.id.replace('mod-', '').replace(/-/g, '_');
          const isSelected = selectedModuleId === rawKey || selectedModuleId === m.id;
          return `
            <button class="flow-module-select-chip ${isSelected ? 'is-active' : ''}" data-mod-id="${m.id}" type="button">
              <span class="mod-code">${m.code}</span>
              <span class="mod-name">${esc(m.name)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/** Render Header Card Info */
function renderFlowHeaderCard(flow) {
  const isDev = flow.verificationStatus === 'DALAM PENGEMBANGAN';
  const rolesList = flow.rolesInvolved || flow.roles || (flow.roleName ? [flow.roleName] : []);

  return `
    <div class="flow-header-card ${isDev ? 'is-dev-card' : ''}">
      <div class="flow-header-main-col">
        <div class="flow-header-badge-row">
          <span class="flow-verif-pill ${isDev ? 'dev' : 'verified'}">
            ${isDev ? '⚪ DALAM PENGEMBANGAN' : '🟢 TERVERIFIKASI RUNTIME'}
          </span>
          ${flow.route ? `<span class="flow-route-pill">Rute Terkait: <code>${flow.route}</code></span>` : ''}
          ${flow.category ? `<span class="flow-category-pill">${esc(flow.category)}</span>` : ''}
        </div>
        <h3 class="flow-card-title">${esc(flow.title || flow.name || flow.roleName)}</h3>
        <p class="flow-card-objective">${esc(flow.objective || flow.summary || flow.subtitle || '')}</p>
        <div class="flow-card-roles-row">
          <strong>Aktor Terlibat:</strong>
          ${rolesList.map(r => `<span class="role-actor-chip">${esc(r)}</span>`).join('')}
        </div>
      </div>

      <div class="flow-header-actions-col">
        ${flow.route ? `
          <button class="btn-open-in-phone" data-route="${flow.route}" type="button" title="Buka modul langsung pada simulator HP">
            <span>Buka Layar di HP</span>
          </button>
        ` : ''}
        <div class="view-mode-toggle-group">
          <button class="view-mode-btn ${activeViewMode === 'DIAGRAM' ? 'is-active' : ''}" data-view="DIAGRAM" type="button">
            <span>Diagram Mermaid</span>
          </button>
          <button class="view-mode-btn ${activeViewMode === 'STEPS' ? 'is-active' : ''}" data-view="STEPS" type="button">
            <span>Rincian Langkah</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

/** Render Body: Flowchart Mermaid Rendered atau Step-by-Step Breakdown */
function renderFlowMainBody(flow) {
  if (flow.verificationStatus === 'DALAM PENGEMBANGAN') {
    return `
      <div class="flow-dev-placeholder-box">
        <div class="dev-placeholder-content">
          <div class="dev-placeholder-icon">🛠️</div>
          <h4>Role Tekniker I & KTU Sedang Dalam Pengembangan</h4>
          <p>
            Berdasarkan hasil audit source code aktual, role ini belum memiliki alur transaksi aktif pada versi saat ini.
            Aplikasi menampilkan layar placeholder resmi <em>"DALAM PENGEMBANGAN"</em>.
          </p>
          <div class="dev-placeholder-note">
            Sesuai prinsip bukti audit: Tidak ada alur transaksi atau percabangan fiktif yang dimunculkan untuk fitur yang belum terimplementasi.
          </div>
        </div>
      </div>
    `;
  }

  if (activeViewMode === 'STEPS') {
    return renderStepsBreakdownView(flow);
  }

  return renderMermaidDiagramView(flow);
}

/** Render Mermaid Diagram Canvas with Zoom & Node Inspector */
function renderMermaidDiagramView(flow) {
  const mermaidSyntax = flow.mermaidSyntax || 'flowchart TD\n  A([Mulai]) --> B([Selesai])';

  return `
    <div class="flow-diagram-wrapper">
      <div class="flow-diagram-controls-bar">
        <span class="diagram-instruction-text">
          💡 <strong>Petunjuk:</strong> Diagram Mermaid Flowchart TD di-render langsung dari source code aktual. Gunakan tombol zoom untuk memperbesar/memperkecil, atau geser horizontal bila layar sempit.
        </span>
        <div class="diagram-zoom-controls">
          <button class="btn-diagram-zoom" id="btn-zoom-out" type="button" title="Perkecil">−</button>
          <span class="zoom-display" id="flow-zoom-display">${Math.round(zoomLevel * 100)}%</span>
          <button class="btn-diagram-zoom" id="btn-zoom-in" type="button" title="Perbesar">+</button>
          <button class="btn-diagram-zoom reset" id="btn-zoom-reset" type="button">Reset</button>
        </div>
      </div>

      <!-- Diagram Canvas Area -->
      <div class="flow-diagram-canvas-scroll" id="diagram-canvas-scroll">
        <div class="mermaid-diagram-stage" id="mermaid-diagram-stage" style="transform: scale(${zoomLevel}); transform-origin: top center; transition: transform 0.15s ease;">
          <div class="mermaid-flow-renderer" id="mermaid-flow-renderer" data-mermaid="${esc(mermaidSyntax)}">
            <div class="mermaid-loading-state">
              <span class="loading-spinner-inline"></span>
              <span>Memuat Diagram Mermaid...</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Interactive Node Inspector Drawer / Card -->
      ${selectedNodeData ? renderNodeInspectorCard(selectedNodeData) : ''}
    </div>
  `;
}

/** Render Detail Inspector when a node is selected */
function renderNodeInspectorCard(node) {
  return `
    <div class="flow-node-inspector-panel">
      <div class="inspector-header">
        <div class="inspector-title-wrap">
          <span class="inspector-badge">Rincian Langkah Node</span>
          <h4 class="inspector-title">${esc(node.label || node.action || 'Detail Langkah')}</h4>
        </div>
        <button class="btn-close-inspector" id="btn-close-inspector" type="button">&times;</button>
      </div>

      <div class="inspector-body-grid">
        <div class="inspector-item">
          <span class="inspector-item-label">Pelaksana / Aktor:</span>
          <span class="inspector-item-val">${esc(node.actor || 'Sistem SIGMA')}</span>
        </div>
        <div class="inspector-item">
          <span class="inspector-item-label">Status Verifikasi:</span>
          <span class="inspector-item-val">${esc(node.status || 'Terverifikasi')}</span>
        </div>
        <div class="inspector-item full-width">
          <span class="inspector-item-label">Deskripsi Operasional:</span>
          <span class="inspector-item-val">${esc(node.desc || node.label || '')}</span>
        </div>
        ${node.branch ? `
          <div class="inspector-item full-width branch-highlight">
            <span class="inspector-item-label">Kondisi Percabangan / Logika Kode:</span>
            <span class="inspector-item-val">${esc(node.branch)}</span>
          </div>
        ` : ''}
      </div>

      ${node.route ? `
        <div class="inspector-footer-action">
          <button class="btn-inspector-navigate" data-route="${node.route}" type="button">
            <span>Buka Rute Terkait di HP: <code>${node.route}</code></span>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/** Render Step-by-Step Breakdown List */
function renderStepsBreakdownView(flow) {
  const steps = flow.operationalWorkflow || [];

  return `
    <div class="flow-steps-table-wrapper">
      <div class="steps-table-header">
        <h4>Urutan Langkah Pelaksanaan Terverifikasi</h4>
        <span class="steps-count-badge">${steps.length} Langkah Alur</span>
      </div>
      <div class="flow-steps-vertical-list">
        ${steps.map(s => `
          <div class="step-breakdown-row">
            <div class="step-num-col">
              <span class="step-bubble">${String(s.step).padStart(2, '0')}</span>
            </div>
            <div class="step-main-col">
              <div class="step-title-line">
                <span class="step-name">${esc(s.action || s.title)}</span>
                ${s.actor ? `<span class="step-actor-tag">Aktor: ${esc(s.actor)}</span>` : ''}
                ${s.status ? `<span class="step-status-tag">${esc(s.status)}</span>` : ''}
              </div>
              <p class="step-desc-p">${esc(s.desc)}</p>
              ${s.branch ? `<div class="step-branch-alert"><strong>Percabangan:</strong> ${esc(s.branch)}</div>` : ''}
            </div>
            ${s.route ? `
              <div class="step-action-col">
                <button class="btn-step-open" data-route="${s.route}" type="button" title="Buka rute di layar HP">
                  Buka Rute
                </button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Render Section Bukti Sumber & Ketertelusuran Kode (Section 6) */
function renderFlowTraceabilitySection(flow) {
  const proof = flow.sourceProof;
  if (!proof) return '';

  const sourceFiles = proof.sourceFiles || [];
  const handlers = proof.handlers || [];

  return `
    <div class="flow-traceability-card">
      <div class="traceability-header">
        <div class="traceability-title-row">
          <span class="traceability-icon">🔍</span>
          <h4>Ketertelusuran & Bukti Kode Sumber Aktual</h4>
          <span class="traceability-status-tag ${proof.verificationStatus === 'Terverifikasi' ? 'verified' : 'partial'}">
            ${esc(proof.verificationStatus)}
          </span>
        </div>
        <p class="traceability-subtitle">
          Alur flowchart ini diaudit langsung dari implementasi handler, state route, dan repositori penyimpanan data berikut:
        </p>
      </div>

      <div class="traceability-grid">
        <div class="traceability-col">
          <span class="traceability-col-label">File Sumber Utama:</span>
          <ul class="traceability-file-list">
            ${sourceFiles.map(f => `<li><code>${esc(f)}</code></li>`).join('')}
          </ul>
        </div>
        <div class="traceability-col">
          <span class="traceability-col-label">Fungsi & Handler Pembukti:</span>
          <div class="traceability-tags-wrap">
            ${handlers.map(h => `<span class="handler-tag"><code>${esc(h)}()</code></span>`).join('')}
          </div>
        </div>
      </div>

      <div class="traceability-relation-box">
        <strong>Hubungan Kode dengan Alur:</strong>
        <p>${esc(proof.codeRelation)}</p>
      </div>

      ${proof.unverifiedNotes ? `
        <div class="traceability-unverified-alert">
          <strong>Catatan Verifikasi:</strong> ${esc(proof.unverifiedNotes)}
        </div>
      ` : ''}
    </div>
  `;
}

/** Render 4-Box Technical Metadata (Prasyarat, Output, Status, Keterbatasan) */
function renderFlowMetadataGrid(flow) {
  const inputs = flow.inputs || ['Identitas Sesi Aktif', 'Koneksi Offline Storage Browser (IndexedDB / LocalStorage)'];
  const outputs = flow.outputs || ['Log Mutasi Transaksi', 'Dokumen Verifikasi Sistem'];
  const rules = flow.rules || ['Wajib mengikuti SOP Pembibitan Karet Socfindo.'];
  const limitations = flow.limitations || ['Berjalan di lingkungan PWA Offline-First dengan simulasi browser storage.'];

  return `
    <div class="flow-metadata-section">
      <div class="metadata-section-title">
        <h4>Spesifikasi Tata Kelola, Status & Batasan Teknis</h4>
        <p>Ringkasan aturan validasi, dokumen masukan/keluaran, serta transparansi lingkungan uji.</p>
      </div>

      <div class="flow-meta-4grid">
        <!-- 1. Prasyarat & Input -->
        <div class="flow-meta-card">
          <div class="meta-card-head">
            <span class="meta-icon">📥</span>
            <h5>Prasyarat & Dokumen Input</h5>
          </div>
          <ul class="meta-list">
            ${inputs.map(i => `<li>${esc(i)}</li>`).join('')}
          </ul>
        </div>

        <!-- 2. Hasil & Output -->
        <div class="flow-meta-card">
          <div class="meta-card-head">
            <span class="meta-icon">📤</span>
            <h5>Hasil & Dokumen Output</h5>
          </div>
          <ul class="meta-list">
            ${outputs.map(o => `<li>${esc(o)}</li>`).join('')}
          </ul>
        </div>

        <!-- 3. Aturan Ketentuan SOP -->
        <div class="flow-meta-card">
          <div class="meta-card-head">
            <span class="meta-icon">⚖️</span>
            <h5>Ketentuan Bisnis & SOP Kebun</h5>
          </div>
          <ul class="meta-list rule-list">
            ${rules.map(r => `<li>${esc(r)}</li>`).join('')}
          </ul>
        </div>

        <!-- 4. Keterbatasan & Simulasi -->
        <div class="flow-meta-card warning-tint">
          <div class="meta-card-head">
            <span class="meta-icon">⚠️</span>
            <h5>Keterbatasan & Status Simulasi</h5>
          </div>
          <ul class="meta-list limitation-list">
            ${limitations.map(l => `<li><strong>${esc(l)}</strong></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
  `;
}

/**
 * Pasang Event Listeners Interaktif untuk Tab Flow & Inisialisasi Renderer Mermaid
 */
export function attachFlowProcessEvents(container, refreshCallback) {
  if (!container) return;

  // 1. Kategori Switcher (Siklus Utama, Role, Modul)
  container.querySelectorAll('.flow-cat-btn[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      selectedNodeData = null;
      zoomLevel = 1.0;
      if (refreshCallback) refreshCallback();
    });
  });

  // 2. Role Selector Chips
  container.querySelectorAll('.flow-role-select-chip[data-role-id]').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedRoleId = chip.dataset.roleId;
      selectedNodeData = null;
      zoomLevel = 1.0;
      if (refreshCallback) refreshCallback();
    });
  });

  // 3. Module Selector Chips
  container.querySelectorAll('.flow-module-select-chip[data-mod-id]').forEach(chip => {
    chip.addEventListener('click', () => {
      const rawId = chip.dataset.modId;
      selectedModuleId = rawId.replace('mod-', '').replace(/-/g, '_');
      selectedNodeData = null;
      zoomLevel = 1.0;
      if (refreshCallback) refreshCallback();
    });
  });

  // 4. Module Search Input
  const searchInput = container.querySelector('#flow-module-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      moduleSearchQuery = e.target.value;
      if (refreshCallback) refreshCallback();
    });
  }

  const clearSearchBtn = container.querySelector('#flow-module-search-clear');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      moduleSearchQuery = '';
      if (refreshCallback) refreshCallback();
    });
  }

  // 5. View Mode Switcher (DIAGRAM / STEPS)
  container.querySelectorAll('.view-mode-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeViewMode = btn.dataset.view;
      if (refreshCallback) refreshCallback();
    });
  });

  // 6. Close Node Inspector
  container.querySelector('#btn-close-inspector')?.addEventListener('click', () => {
    selectedNodeData = null;
    if (refreshCallback) refreshCallback();
  });

  // 7. Zoom Controls
  container.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
    if (zoomLevel < 1.8) {
      zoomLevel = parseFloat((zoomLevel + 0.15).toFixed(2));
      updateCanvasZoom(container);
    }
  });

  container.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
    if (zoomLevel > 0.5) {
      zoomLevel = parseFloat((zoomLevel - 0.15).toFixed(2));
      updateCanvasZoom(container);
    }
  });

  container.querySelector('#btn-zoom-reset')?.addEventListener('click', () => {
    zoomLevel = 1.0;
    updateCanvasZoom(container);
  });

  // 8. Buka Layar di HP Buttons
  container.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const route = btn.dataset.route;
      if (route) {
        navigate(route);
        toast(`Membuka rute di simulator HP: ${route}`, 'info');

        // Jika di layar mobile (< 768px), otomatis geser tampilan ke frame HP
        if (window.innerWidth < 768) {
          const hpTab = document.getElementById('tab-mobile-view');
          if (hpTab) hpTab.click();
        }
      }
    });
  });

  // 9. Render Diagram Mermaid jika dalam mode DIAGRAM
  if (activeViewMode === 'DIAGRAM') {
    initMermaidDiagramRender(container, refreshCallback);
  }
}

/** Render Mermaid SVG into Canvas */
async function initMermaidDiagramRender(container, refreshCallback) {
  const el = container.querySelector('#mermaid-flow-renderer');
  if (!el) return;

  const rawMermaid = el.dataset.mermaid;
  if (!rawMermaid) return;

  if (typeof window !== 'undefined' && window.mermaid) {
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          curve: 'basis'
        }
      });

      const uniqueId = 'mermaid-flow-' + Math.random().toString(36).substr(2, 9);
      const { svg } = await window.mermaid.render(uniqueId, rawMermaid);
      el.innerHTML = svg;

      // Attach Node Click Interactivity on SVG elements
      const svgEl = el.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';

        const currentFlow = getCurrentFlowData();
        const steps = currentFlow.operationalWorkflow || [];

        svgEl.querySelectorAll('.node').forEach(nodeGroup => {
          nodeGroup.style.cursor = 'pointer';
          nodeGroup.addEventListener('click', () => {
            const nodeText = nodeGroup.textContent.trim();
            // Match with steps or extract label
            const matchedStep = steps.find(s => 
              s.action && (nodeText.includes(s.action) || s.action.includes(nodeText.slice(0, 15)))
            ) || {
              label: nodeText,
              actor: 'Sistem SIGMA Nursery',
              desc: `Langkah alur: ${nodeText}`,
              status: 'Terverifikasi'
            };

            selectedNodeData = matchedStep;
            if (refreshCallback) refreshCallback();
          });
        });
      }
    } catch (err) {
      console.error('[flow-process-ui] Mermaid render error:', err);
      el.innerHTML = `
        <div class="mermaid-error-box">
          <div class="mermaid-error-title">⚠️ Gagal Merender Diagram Mermaid</div>
          <div class="mermaid-error-msg">${esc(err.message || String(err))}</div>
          <pre class="mermaid-code-fallback"><code>${esc(rawMermaid)}</code></pre>
        </div>
      `;
    }
  } else {
    el.innerHTML = `
      <div class="mermaid-fallback-raw">
        <div class="fallback-note">Renderer Mermaid vendor belum aktif. Sintaks diagram:</div>
        <pre><code>${esc(rawMermaid)}</code></pre>
      </div>
    `;
  }
}

function updateCanvasZoom(container) {
  const stage = container.querySelector('#mermaid-diagram-stage');
  const zoomDisplay = container.querySelector('#flow-zoom-display');
  if (stage) {
    stage.style.transform = `scale(${zoomLevel})`;
  }
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
}
