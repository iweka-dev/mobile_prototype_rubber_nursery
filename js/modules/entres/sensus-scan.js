import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { todayISO, esc } from '../../core/utils.js';
import { toast } from '../../components/toast.js';
import { getAllBudwoodPlots } from '../../data/budwood-plot-master.js';
import { getCensusPeriodForDate } from '../../data/census-period-master.js';

function plotSnapshot(plot, verifiedMethod) {
  return {
    plotId: plot.id,
    plotName: plot.plotName,
    kodePlot: `Plot ${plot.plotName}`,
    cloneName: plot.cloneName,
    populasiAcuan: Number(plot.numberOfPlants || 0),
    budwoodCode: plot.budwoodCode,
    yearOfPlanting: plot.yearOfPlanting,
    verifiedMethod
  };
}

export function renderEntresCensusScan() {
  const app = document.getElementById('app');
  if (!app) return;

  const period = getCensusPeriodForDate(todayISO());
  if (!period) {
    app.innerHTML = '<div class="page" style="display:flex;flex-direction:column;height:100%;background:#F8FAFC;color:#334155;font-family:Arial,sans-serif;"><header style="height:56px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;"><button id="btn-census-scan-back" type="button" aria-label="Kembali ke Sensus Entres" style="padding:6px;margin-left:-6px;background:transparent;border:0;color:#116834;"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></button><strong>Sensus Entres</strong></header><p style="padding:16px;">Periode sensus belum dipilih. Kembali dan pilih periode yang tersedia.</p></div>';
    app.querySelector('#btn-census-scan-back')?.addEventListener('click', () => navigate('/entres/sensus'));
    return;
  }
  storage.set('entres_census_selected_period_id', period.id);

  const plots = getAllBudwoodPlots().filter(plot => plot.status === 'ACTIVE');
  const plotButtons = plots.slice(0, 5).map(plot => `
    <button type="button" class="btn-census-simulated-plot" data-id="${esc(plot.id)}" style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:#86EFAC;font-size:.72rem;font-weight:600;padding:5px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;">
      ${esc(`Plot ${plot.plotName}`)}
    </button>`).join('');

  app.innerHTML = `
    <div class="page census-scan-page" style="display:flex;flex-direction:column;height:100%;min-height:0;background:#0F172A;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;position:relative;overflow:hidden;">
      <header style="display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 16px;background:rgba(15,23,42,.9);border-bottom:1px solid rgba(255,255,255,.1);z-index:10;flex:none;">
        <button id="btn-census-scan-back" type="button" aria-label="Kembali ke Sensus Entres" style="padding:8px;margin-left:-8px;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#FFFFFF;">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <div style="text-align:center;flex:1;padding:0 8px;min-width:0;">
          <h1 style="font-size:1rem;font-weight:700;margin:0;color:#FFFFFF;">Identifikasi QR Plot Entres</h1>
          <div style="font-size:.68rem;color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(period.name)}</div>
        </div>
        <button id="btn-census-toggle-flash" type="button" aria-label="Flashlight" style="padding:8px;margin-right:-8px;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#FBBF24;">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        </button>
      </header>

      <main style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:16px 16px 20px;position:relative;z-index:5;overflow-y:auto;">
        <div style="background:rgba(30,41,59,.7);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 14px;width:100%;max-width:330px;display:flex;justify-content:space-between;align-items:center;box-sizing:border-box;">
          <div><div style="font-size:.66rem;color:#94A3B8;">Periode Sensus</div><div style="font-size:.78rem;font-weight:700;color:#F8FAFC;">${esc(period.name)}</div></div>
          <span style="font-size:.65rem;font-weight:700;padding:3px 8px;border-radius:4px;background:rgba(34,197,94,.2);color:#4ADE80;border:1px solid rgba(34,197,94,.3);">${plots.length} Plot</span>
        </div>

        <div style="position:relative;width:220px;height:220px;flex:none;margin:18px 0;display:flex;align-items:center;justify-content:center;">
          <video id="census-scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:none;"></video>
          <div id="census-scan-mock-bg" style="position:absolute;inset:0;background:radial-gradient(circle,rgba(17,104,52,.2) 0%,rgba(15,23,42,.8) 100%);border-radius:16px;"></div>
          <div style="position:absolute;inset:0;pointer-events:none;">
            <i style="position:absolute;top:0;left:0;width:32px;height:32px;border-top:4px solid #22C55E;border-left:4px solid #22C55E;border-top-left-radius:14px;"></i>
            <i style="position:absolute;top:0;right:0;width:32px;height:32px;border-top:4px solid #22C55E;border-right:4px solid #22C55E;border-top-right-radius:14px;"></i>
            <i style="position:absolute;bottom:0;left:0;width:32px;height:32px;border-bottom:4px solid #22C55E;border-left:4px solid #22C55E;border-bottom-left-radius:14px;"></i>
            <i style="position:absolute;bottom:0;right:0;width:32px;height:32px;border-bottom:4px solid #22C55E;border-right:4px solid #22C55E;border-bottom-right-radius:14px;"></i>
          </div>
          <div id="census-laser-line" style="position:absolute;left:10px;right:10px;height:2px;background:linear-gradient(90deg,transparent,#22C55E,#4ADE80,#22C55E,transparent);box-shadow:0 0 12px #22C55E;animation:censusScanLine 2s infinite ease-in-out;"></div>
          <div style="color:rgba(255,255,255,.3);pointer-events:none;">
            <svg viewBox="0 0 24 24" width="54" height="54" stroke="currentColor" stroke-width="1.2" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </div>
        </div>

        <p style="font-size:.76rem;color:#CBD5E1;text-align:center;margin:0 0 8px;max-width:280px;line-height:1.4;">Arahkan kamera ke <strong>QR Code</strong> pada patok Plot Entres yang akan disensus.</p>
        <div id="census-scan-status" style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:20px;padding:4px 12px;margin-bottom:12px;">
          <span style="width:7px;height:7px;border-radius:50%;background:#22C55E;box-shadow:0 0 6px #22C55E;"></span><span style="font-size:.72rem;color:#86EFAC;font-weight:600;">Memindai QR Plot...</span>
        </div>

        <section style="width:100%;max-width:330px;background:rgba(30,41,59,.85);border:1px dashed rgba(34,197,94,.4);border-radius:8px;padding:10px 12px;margin-bottom:10px;box-sizing:border-box;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:.7rem;font-weight:700;color:#4ADE80;text-transform:uppercase;">Simulasi Scan QR</span>
            <button id="btn-census-simulate-fail" type="button" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#FCA5A5;font-size:.63rem;font-weight:700;padding:3px 7px;border-radius:4px;cursor:pointer;">Uji QR Gagal</button>
          </div>
          <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:3px;scrollbar-width:none;">${plotButtons || '<span style="font-size:.72rem;color:#CBD5E1;">Belum ada Plot aktif untuk dipilih.</span>'}</div>
        </section>

        <div id="census-scan-failed" style="display:none;width:100%;max-width:330px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 14px;margin-bottom:8px;text-align:center;box-sizing:border-box;">
          <div style="font-size:.82rem;font-weight:800;color:#991B1B;margin-bottom:3px;">QR Plot tidak terbaca</div>
          <p style="font-size:.72rem;color:#7F1D1D;margin:0 0 10px;line-height:1.35;">Pilih Plot secara manual untuk melanjutkan pencatatan sensus.</p>
          <button id="btn-census-open-manual" type="button" style="width:100%;height:42px;background:#DC2626;color:#FFFFFF;border:0;border-radius:6px;font-weight:800;font-size:.82rem;cursor:pointer;">Pilih Plot Manual</button>
        </div>
      </main>

      <div id="census-manual-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.65);z-index:50;"></div>
      <section id="census-manual-sheet" style="display:none;position:absolute;left:0;right:0;bottom:0;background:#FFFFFF;color:#111827;border-radius:18px 18px 0 0;padding:20px 16px 24px;z-index:51;flex-direction:column;max-height:75%;box-shadow:0 -8px 24px rgba(0,0,0,.3);box-sizing:border-box;">
        <div style="width:36px;height:4px;background:#E2E8F0;border-radius:2px;margin:0 auto 14px;flex:none;"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex:none;">
          <div><h2 style="font-size:.98rem;font-weight:800;color:#111827;margin:0 0 2px;">Pilih Plot Manual</h2><p style="font-size:.72rem;color:#64748B;margin:0;">${esc(period.name)} · Sensus Entres</p></div>
          <button id="btn-census-close-manual" type="button" aria-label="Tutup" style="background:#F1F5F9;border:0;border-radius:50%;width:28px;height:28px;cursor:pointer;color:#475569;">✕</button>
        </div>
        <div style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-bottom:10px;min-height:0;">
          ${plots.length ? plots.map(plot => `<button class="btn-census-manual-plot" type="button" data-id="${esc(plot.id)}" style="text-align:left;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;color:#0F172A;"><span><strong style="display:block;font-size:.88rem;">Plot ${esc(plot.plotName)}</strong><span style="display:block;font-size:.7rem;color:#64748B;margin-top:3px;">Klon ${esc(plot.cloneName)} · Populasi ${Number(plot.numberOfPlants || 0).toLocaleString('id-ID')} Pkk</span></span><strong style="font-size:.76rem;color:#116834;">Pilih →</strong></button>`).join('') : '<div style="padding:24px 12px;text-align:center;color:#64748B;font-size:.78rem;">Belum ada Plot aktif di Master Plot Entres.</div>'}
        </div>
      </section>

      <style>
        @keyframes censusScanLine { 0% { top: 10px; opacity: .8; } 50% { top: 190px; opacity: 1; } 100% { top: 10px; opacity: .8; } }
      </style>
    </div>`;

  const video = app.querySelector('#census-scan-video');
  const mockBackground = app.querySelector('#census-scan-mock-bg');
  let mediaStream = null;
  let scanFailed = false;
  if (navigator.mediaDevices?.getUserMedia && video) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        mediaStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        if (mockBackground) mockBackground.style.display = 'none';
      })
      .catch(() => {});
  }

  const stopCamera = () => mediaStream?.getTracks().forEach(track => track.stop());
  const navigateBack = () => {
    clearTimeout(failTimer);
    stopCamera();
    navigate('/entres/sensus');
  };
  const triggerScanFailure = () => {
    if (scanFailed) return;
    scanFailed = true;
    const laser = app.querySelector('#census-laser-line');
    const status = app.querySelector('#census-scan-status');
    if (laser) {
      laser.style.background = 'linear-gradient(90deg,transparent,#EF4444,#F87171,#EF4444,transparent)';
      laser.style.boxShadow = '0 0 12px #EF4444';
    }
    if (status) {
      status.style.background = 'rgba(239,68,68,.15)';
      status.style.borderColor = 'rgba(239,68,68,.35)';
      status.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#EF4444;"></span><span style="font-size:.72rem;color:#FCA5A5;font-weight:600;">QR tidak terbaca</span>';
    }
    app.querySelector('#census-scan-failed').style.display = 'block';
    toast('QR Plot tidak terdeteksi. Pilih Plot secara manual.', 'error');
  };
  const failTimer = setTimeout(triggerScanFailure, 6000);

  const selectPlot = (plotId, method) => {
    const plot = plots.find(item => item.id === plotId);
    if (!plot) {
      toast('Plot tidak ditemukan pada Master Plot Entres.', 'error');
      return;
    }
    clearTimeout(failTimer);
    stopCamera();
    storage.set('entres_census_selected_plot', plotSnapshot(plot, method));
    navigate('/entres/sensus/form');
  };

  app.querySelector('#btn-census-scan-back')?.addEventListener('click', navigateBack);
  app.querySelector('#btn-census-simulate-fail')?.addEventListener('click', triggerScanFailure);
  app.querySelector('#btn-census-open-manual')?.addEventListener('click', () => {
    app.querySelector('#census-manual-overlay').style.display = 'block';
    app.querySelector('#census-manual-sheet').style.display = 'flex';
  });
  app.querySelector('#census-manual-overlay')?.addEventListener('click', () => {
    app.querySelector('#census-manual-overlay').style.display = 'none';
    app.querySelector('#census-manual-sheet').style.display = 'none';
  });
  app.querySelector('#btn-census-close-manual')?.addEventListener('click', () => {
    app.querySelector('#census-manual-overlay').style.display = 'none';
    app.querySelector('#census-manual-sheet').style.display = 'none';
  });
  app.querySelectorAll('.btn-census-simulated-plot').forEach(button => {
    button.addEventListener('click', () => selectPlot(button.dataset.id, 'QR_SCAN_SIMULATION'));
  });
  app.querySelectorAll('.btn-census-manual-plot').forEach(button => {
    button.addEventListener('click', () => selectPlot(button.dataset.id, 'MANUAL'));
  });
}
