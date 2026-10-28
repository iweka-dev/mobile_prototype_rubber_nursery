/**
 * app.js — entry point Sigma Nursery.
 * Bootstrap: register PWA SW → seed IndexedDB → init router.
 * Alur: Login → Splash → Sinkronisasi.
 */

import { registerRoute, initRouter, navigate, setNotFound } from './core/router.js';
import { renderLogin } from './modules/auth/login.js';
import { renderSplash } from './modules/auth/splash.js';
import { renderSync } from './modules/auth/sync.js';
import { renderBeranda } from './modules/dashboard/beranda.js';
import { renderAttendanceLanding } from './modules/attendance/attendance-landing.js';
import { renderAttendanceSupervisor } from './modules/attendance/attendance-supervisor.js';
import { renderAttendanceSupervisorResult } from './modules/attendance/attendance-supervisor-result.js';
import { renderAttendanceWorkers } from './modules/attendance/attendance-workers.js';
import { renderAttendanceSummary } from './modules/attendance/attendance-summary.js';
import { initReviewWorkspace } from './modules/review/review-workspace.js';
import { initWorkspaceViewMode } from './core/workspace-view.js';
import { renderReceiptLanding } from './modules/receipt/receipt-landing.js';
import { renderReceiptKebunSepupuLanding } from './modules/receipt/receipt-kebun-sepupu-landing.js';
import { renderReceiptBenih } from './modules/receipt/receipt-benih.js';
import { renderReceiptSir } from './modules/receipt/receipt-sir.js';
import { renderReceiptCamera } from './modules/receipt/receipt-camera.js';
import { renderReceiptSummary } from './modules/receipt/receipt-summary.js';
import { renderReceiptPlaceholder } from './modules/receipt/receipt-placeholder.js';
import { renderSeedingLanding } from './modules/seeding/seeding-landing.js';
import { renderSeedingScan } from './modules/seeding/seeding-scan.js';
import { renderSeedingForm } from './modules/seeding/seeding-form.js';
import { renderSeedingIssueSelector } from './modules/seeding/seeding-issue-selector.js';
import { renderDederanScan } from './modules/seeding/dederan-scan.js';
import { renderDederanForm } from './modules/seeding/dederan-form.js';
import { renderDederanInspectionForm } from './modules/seeding/dederan-inspection-form.js';
import { renderBuddingLanding } from './modules/budding/budding-landing.js';
import { renderBuddingGrafting } from './modules/budding/budding-grafting.js';
import { renderBuddingScan } from './modules/budding/budding-scan.js';
import { renderBuddingRegrafting } from './modules/budding/budding-regrafting.js';
import { renderBuddingForm } from './modules/budding/budding-form.js';
import { renderInspectionLanding } from './modules/inspection/inspection-landing.js';
import { renderInspectionScan } from './modules/inspection/inspection-scan.js';
import { renderInspectionForm } from './modules/inspection/inspection-form.js';
import { renderPhysicalStockInspectionLanding } from './modules/physical-stock-inspection/physical-stock-inspection-landing.js';
import { renderSelectionLanding } from './modules/selection/selection-landing.js?v=177';
import { renderNurseryHistory } from './modules/history/nursery-history.js';
import { renderTransactionManager } from './modules/transactions/transaction-manager.js';
import { renderEntresLanding } from './modules/entres/entres-landing.js';
import { renderEntresStockLanding } from './modules/entres/entres-stock-landing.js';
import { renderEntresStockDetail } from './modules/entres/entres-stock-detail.js';
import { renderMenunasScan } from './modules/entres/menunas-scan.js';
import { renderMenunasForm } from './modules/entres/menunas-form.js';
import { renderToppingScan } from './modules/entres/topping-scan.js';
import { renderToppingForm } from './modules/entres/topping-form.js';
import { renderNurseryActivityLanding, renderNurseryActivityMandoranList, renderNurseryActivityForm } from './modules/maintenance/nursery-activity.js';
import { renderMandoranConsolidation, renderMandoranPotongJamDetail } from './modules/maintenance/mandoran-consolidation.js';
import { renderRequestLanding } from './modules/request/request-landing.js';
import { renderRequestKebunSepupuLanding } from './modules/request/request-kebun-sepupu-landing.js';
import { renderRequestKebunSepupuForm } from './modules/request/request-kebun-sepupu-form.js';
import { renderRequestKebunSendiriLanding } from './modules/request/request-kebun-sendiri-landing.js';
import { renderRequestKebunSendiriForm } from './modules/request/request-kebun-sendiri-form.js';
import { renderRequestMataEntresLanding } from './modules/request/request-mata-entres-landing.js';
import { renderRequestMataEntresForm } from './modules/request/request-mata-entres-form.js';
import { renderDispatchLanding } from './modules/dispatch/dispatch-landing.js';
import { renderDispatchReport } from './modules/dispatch/dispatch-report.js';
import { renderMasterBedengan } from './modules/master/master-bedengan.js';
import { renderMasterBatch } from './modules/master/master-batch.js';
import { renderMaterialMaster } from './modules/master/material-master.js';
import { renderDestructionLanding } from './modules/destruction/destruction-landing.js?v=182';
import { renderConsolidationLanding } from './modules/consolidation/consolidation-landing.js';
import { renderVerificationLanding } from './modules/verification/verification-landing.js';
import { renderMantriConfirmationLanding } from './modules/verification/mantri-confirmation-landing.js';
import { renderMantriOverdueLanding } from './modules/verification/mantri-overdue-landing.js';
import { renderReportsLanding } from './modules/reports/reports-landing.js';
import { renderNurseryStockReport } from './modules/reports/nursery-stock-report.js';
import { renderReturnedDocumentsReport } from './modules/reports/returned-documents-report.js';
import { renderAnalysisPlaceholder } from './modules/placeholder/analysis-placeholder.js';
import { renderProfile } from './modules/profile/profile.js';
import { seedDatabase } from './db/seed.js';
import { initExportScreenToolbar } from './core/export-screen.js';
import { session } from './core/session.js';
import { storage } from './core/storage.js';
import { reconcileStartupRecovery, getStartupRecoveryStatus } from './core/batch-inventory-service.js';

// Hard reset master runtime storage baseline once (TASK-HARD-CLEAR-MASTER-RUNTIME-01)
if (storage.get('master_reset_hard_v2') !== true) {
  storage.set('bedengan_master', []);
  storage.set('nursery_batches', []);
  storage.set('master_reset_hard_v2', true);
}

/* ---- PWA: service worker ---- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[sw] register gagal:', err);
    });
  });
}

/* ---- Routes ---- */
registerRoute('/', () => navigate('/login', { replace: true }));
registerRoute('/login', renderLogin);
registerRoute('/splash', renderSplash);
registerRoute('/sync', renderSync);
registerRoute('/home', renderBeranda);
registerRoute('/attendance', renderAttendanceLanding);
registerRoute('/attendance/supervisor', renderAttendanceSupervisor);
registerRoute('/attendance/supervisor/result', renderAttendanceSupervisorResult);
registerRoute('/attendance/workers', renderAttendanceWorkers);
registerRoute('/attendance/summary', renderAttendanceSummary);
registerRoute('/reception', () => {
  const r = session.getRole();
  if (r === 'PENGURUS' || r === 'PENGURUS_KEBUN_SEPUPU' || r === 'ASKEP' || r === 'ASISTEN_KEPALA' || r === 'ASISTEN' || r === 'ASISTEN_DIVISI' || r === 'ASISTEN_LAPANGAN' || r === 'ASISTEN_BIBITAN') {
    renderReceiptKebunSepupuLanding();
  } else {
    renderReceiptLanding();
  }
});
registerRoute('/reception/kebun-sepupu', renderReceiptKebunSepupuLanding);
registerRoute('/reception/benih', renderReceiptBenih);
registerRoute('/reception/benih/sir', renderReceiptSir);
registerRoute('/reception/benih/camera', renderReceiptCamera);
registerRoute('/reception/summary', renderReceiptSummary);
registerRoute('/reception/placeholder', renderReceiptPlaceholder);
registerRoute('/seeding', renderSeedingLanding);
registerRoute('/seeding/scan', renderSeedingScan);
registerRoute('/seeding/form', renderSeedingForm);
registerRoute('/seeding/issue-select', renderSeedingIssueSelector);
registerRoute('/seeding/dederan/scan', renderDederanScan);
registerRoute('/seeding/dederan/form', renderDederanForm);
registerRoute('/seeding/dederan/inspection', renderDederanInspectionForm);
registerRoute('/budding', renderBuddingLanding);
registerRoute('/budding/grafting', renderBuddingGrafting);
registerRoute('/budding/grafting/scan', renderBuddingScan);
registerRoute('/budding/grafting/form', renderBuddingForm);
registerRoute('/budding/regrafting', renderBuddingRegrafting);
registerRoute('/inspection', renderInspectionLanding);
registerRoute('/inspection/scan', renderInspectionScan);
registerRoute('/inspection/form', renderInspectionForm);
registerRoute('/inspection/physical-stock', renderPhysicalStockInspectionLanding);
registerRoute('/inspection/dederan/form', renderDederanInspectionForm);
registerRoute('/selection', () => {
  const r = session.getRole ? session.getRole() : session.get()?.role;
  if (r === 'ASISTEN_BIBITAN') {
    toast('Pemeriksaan Hasil Seleksi kini disatukan di menu Verifikasi (Single Gate Approval)', 'info');
    navigate('/verification');
  } else {
    renderSelectionLanding();
  }
});
registerRoute('/history', renderNurseryHistory);
registerRoute('/transactions', renderTransactionManager);

/* Modul Material & Simulasi Issue Gudang */
registerRoute('/material', renderMaterialMaster);
registerRoute('/nursery-activity', renderNurseryActivityLanding);
registerRoute('/nursery-activity/mandoran', renderNurseryActivityMandoranList);
registerRoute('/nursery-activity/form', renderNurseryActivityForm);
registerRoute('/nursery-activity/consolidation', renderMandoranConsolidation);
registerRoute('/nursery-activity/consolidation/worker/:groupKey/:workerId', renderMandoranPotongJamDetail);
registerRoute('/request', renderRequestLanding);
registerRoute('/request/kebun-sepupu', renderRequestKebunSepupuLanding);
registerRoute('/request/kebun-sepupu/form', renderRequestKebunSepupuForm);
registerRoute('/request/kebun-sendiri', renderRequestKebunSendiriLanding);
registerRoute('/request/kebun-sendiri/form', renderRequestKebunSendiriForm);
registerRoute('/request/mata-entres', renderRequestMataEntresLanding);
registerRoute('/request/mata-entres/form', renderRequestMataEntresForm);
registerRoute('/dispatch', renderDispatchLanding);
registerRoute('/dispatch/report', renderDispatchReport);
registerRoute('/entres', renderEntresLanding);
registerRoute('/entres/stock', renderEntresStockLanding);
registerRoute('/entres/stock/detail', renderEntresStockDetail);
registerRoute('/entres/menunas', renderMenunasScan);
registerRoute('/entres/menunas/form', renderMenunasForm);
registerRoute('/entres/topping', renderToppingScan);
registerRoute('/entres/topping/form', renderToppingForm);
registerRoute('/master/bedengan', renderMasterBedengan);
registerRoute('/master/batch', renderMasterBatch);
registerRoute('/destruction', renderDestructionLanding);
registerRoute('/selection/culling', renderDestructionLanding);
registerRoute('/consolidation', renderConsolidationLanding);
registerRoute('/verification', renderVerificationLanding);
registerRoute('/mantri-confirmation', renderMantriConfirmationLanding);
registerRoute('/mantri-confirmation/overdue', renderMantriOverdueLanding);
registerRoute('/reports', renderReportsLanding);
registerRoute('/reports/stock', renderNurseryStockReport);
registerRoute('/reports/returned-docs', renderReturnedDocumentsReport);
registerRoute('/profile', renderProfile);

/* Fallback Not Found */
setNotFound(renderAnalysisPlaceholder);

/* ---- Bootstrap ---- */
let isBootstrapInitialized = false;

window.addEventListener('DOMContentLoaded', async () => {
  if (isBootstrapInitialized) return;
  isBootstrapInitialized = true;

  try {
    await seedDatabase();
  } catch (err) {
    console.error('[bootstrap] seed gagal:', err);
  }

  // Rekonsiliasi crash boundaries persistence pada startup sebelum router dan alur transaksi diaktifkan
  try {
    const recoveryResults = await reconcileStartupRecovery();
    if (Array.isArray(recoveryResults) && recoveryResults.length > 0) {
      console.info(`[bootstrap] Reconcile startup recovery selesai: ${recoveryResults.length} intent diproses.`, recoveryResults);
    }
  } catch (err) {
    console.error('[bootstrap] Reconcile startup recovery gagal (Fail-Closed):', err);
  }

  initRouter();
  initWorkspaceViewMode();
  initReviewWorkspace();
  initExportScreenToolbar();
});

