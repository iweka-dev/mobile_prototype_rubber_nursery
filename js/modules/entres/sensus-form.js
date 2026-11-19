import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { todayISO, generateUniqueDocNo, esc } from '../../core/utils.js';
import { getCurrentUserContext } from '../../core/user-context.js';
import { assertAttendanceGateOrThrow } from '../../core/attendance-gate-service.js';
import { applyTransactionActor, AUDIT_EVENT_TYPES } from '../../core/transaction-actor.js';
import { getPlotById } from '../../data/budwood-plot-master.js';
import { getCensusPeriodById, getCensusPeriodForDate } from '../../data/census-period-master.js';
import { SELECTION_CULL_REASONS } from '../../data/master-data.js';
import { toast } from '../../components/toast.js';

const STORAGE_KEY = 'entres_census_transactions';

function numberValue(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  return Number(value);
}

export function renderEntresCensusForm() {
  const app = document.getElementById('app');
  if (!app) return;

  const transactions = storage.get(STORAGE_KEY, []);
  const editingId = storage.get('editing_entres_census_id', null);
  const editingRecord = editingId ? transactions.find(item => item.id === editingId) : null;
  const selectedPlot = editingRecord || storage.get('entres_census_selected_plot', null);
  const period = editingRecord
    ? getCensusPeriodById(editingRecord.periodId)
    : getCensusPeriodForDate(todayISO());
  const plot = getPlotById(selectedPlot?.plotId);
  if (!selectedPlot || !plot || !period) {
    app.innerHTML = '<div class="page" style="display:flex;flex-direction:column;height:100%;background:#F8FAFC;color:#334155;font-family:Arial,sans-serif;"><header style="height:56px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;"><button id="btn-census-form-back" type="button" aria-label="Kembali ke Sensus Entres" style="padding:6px;margin-left:-6px;background:transparent;border:0;color:#116834;"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></button><strong>Sensus Entres</strong></header><p style="padding:16px;">Identitas Plot atau periode sensus tidak valid. Silakan mulai kembali dari halaman Sensus Entres.</p></div>';
    app.querySelector('#btn-census-form-back')?.addEventListener('click', () => navigate('/entres/sensus'));
    return;
  }

  const isEdit = Boolean(editingRecord);
  const deadValue = isEdit ? Number(editingRecord.pokokMati || 0) : '';
  const reasonVisible = Number(deadValue) > 0;
  const selectedReason = SELECTION_CULL_REASONS.find(reason => reason.toUpperCase() === String(editingRecord?.alasan || '').trim().toUpperCase()) || '';
  const inputStyle = 'width:100%;height:40px;padding:0 10px;border:1px solid #CBD5E1;border-radius:7px;background:#FFFFFF;color:#0F172A;font-size:.84rem;box-sizing:border-box;';
  const labelStyle = 'display:block;margin:11px 0 5px;font-size:.75rem;font-weight:700;color:#334155;';

  app.innerHTML = `
    <div class="page" style="display:flex;flex-direction:column;height:100%;min-height:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;">
      <header style="height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;">
        <button id="btn-census-form-back" type="button" aria-label="Kembali ke Sensus Entres" style="padding:6px;margin-left:-6px;background:transparent;border:0;color:#116834;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <h1 style="font-size:1rem;margin:0;font-weight:800;">${isEdit ? 'Perbaiki Sensus Entres' : 'Input Sensus Entres'}</h1>
      </header>
      <main style="flex:1;min-height:0;overflow:auto;padding:16px;">
        <section style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:9px;padding:14px;margin-bottom:12px;">
          <div style="font-size:.7rem;font-weight:700;color:#64748B;text-transform:uppercase;">Periode Sensus</div>
          <strong style="display:block;margin-top:3px;font-size:.88rem;">${esc(period.name)}</strong>
          <div style="height:1px;background:#E2E8F0;margin:11px 0;"></div>
          <div style="font-size:.7rem;font-weight:700;color:#64748B;text-transform:uppercase;">Plot Entres</div>
          <strong style="display:block;margin-top:3px;font-size:.9rem;">${esc(selectedPlot.kodePlot || `Plot ${plot.plotName}`)} · ${esc(plot.cloneName)}</strong>
          <div style="font-size:.75rem;color:#475569;margin-top:5px;">Kebun ${esc(plot.budwoodCode)} · Populasi acuan ${Number(plot.numberOfPlants || 0).toLocaleString('id-ID')} Pkk</div>
        </section>
        <section style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:9px;padding:14px;">
          <div style="font-size:.84rem;font-weight:800;margin-bottom:4px;">Hasil Sensus</div>
          <label for="census-dead" style="${labelStyle}">Pokok Mati <span style="color:#DC2626;">*</span></label>
          <input id="census-dead" type="number" min="0" max="${Number(plot.numberOfPlants || 0)}" step="1" value="${isEdit ? Number(editingRecord.pokokMati || 0) : ''}" placeholder="Masukkan jumlah pokok mati" style="${inputStyle}" />
          <div style="font-size:.68rem;color:#64748B;margin-top:4px;">Maksimal ${Number(plot.numberOfPlants || 0).toLocaleString('id-ID')} pokok.</div>
          <div id="census-reason-wrap" style="display:${reasonVisible ? 'block' : 'none'};">
            <label for="census-reason" style="${labelStyle}">Alasan Pokok Mati <span style="color:#DC2626;">*</span></label>
            <select id="census-reason" style="${inputStyle}">
              <option value="" ${selectedReason ? '' : 'selected'} disabled>Pilih alasan pokok mati</option>
              ${SELECTION_CULL_REASONS.map(reason => `<option value="${esc(reason)}" ${selectedReason === reason ? 'selected' : ''}>${esc(reason)}</option>`).join('')}
            </select>
          </div>
          <label for="census-branches" style="${labelStyle}">Jumlah Cabang <span style="color:#DC2626;">*</span></label>
          <input id="census-branches" type="number" min="0" step="1" value="${isEdit ? Number(editingRecord.jumlahCabang || 0) : ''}" placeholder="Masukkan jumlah cabang" style="${inputStyle}" />
          <label for="census-length" style="${labelStyle}">Jumlah Panjang Cabang (Meter) <span style="color:#DC2626;">*</span></label>
          <input id="census-length" type="number" min="0" step="0.01" value="${isEdit ? Number(editingRecord.totalPanjangCabangMeter || 0) : ''}" placeholder="Masukkan total panjang dalam meter" style="${inputStyle}" />
          <label for="census-notes" style="${labelStyle}">Catatan</label>
          <textarea id="census-notes" rows="3" placeholder="Catatan tambahan (opsional)" style="width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:7px;background:#FFFFFF;color:#0F172A;font:inherit;font-size:.8rem;box-sizing:border-box;resize:vertical;">${esc(editingRecord?.catatan || '')}</textarea>
        </section>
      </main>
      <footer style="flex:none;display:flex;gap:8px;padding:12px 16px;background:#FFFFFF;border-top:1px solid #E2E8F0;">
        <button id="btn-census-cancel" type="button" style="height:42px;flex:1;background:#FFFFFF;border:1px solid #CBD5E1;border-radius:7px;color:#334155;font-size:.8rem;font-weight:700;">Batal</button>
        <button id="btn-census-save" type="button" style="height:42px;flex:1.4;background:#116834;border:0;border-radius:7px;color:#FFFFFF;font-size:.8rem;font-weight:700;">${isEdit ? 'Simpan Perbaikan' : 'Simpan Sensus'}</button>
      </footer>
    </div>`;

  const goBack = () => navigate('/entres/sensus');
  app.querySelector('#btn-census-form-back')?.addEventListener('click', goBack);
  app.querySelector('#btn-census-cancel')?.addEventListener('click', goBack);
  app.querySelector('#census-dead')?.addEventListener('input', event => {
    app.querySelector('#census-reason-wrap').style.display = Number(event.target.value) > 0 ? 'block' : 'none';
  });
  app.querySelector('#btn-census-save')?.addEventListener('click', () => {
    try {
      assertAttendanceGateOrThrow();
    } catch (error) {
      toast(error.message || 'Presensi harian diperlukan sebelum membuat transaksi.', 'error');
      return;
    }

    const pokokMati = numberValue(app.querySelector('#census-dead')?.value);
    const jumlahCabang = numberValue(app.querySelector('#census-branches')?.value);
    const totalPanjangCabangMeter = numberValue(app.querySelector('#census-length')?.value);
    const alasan = app.querySelector('#census-reason')?.value || '';
    const catatan = app.querySelector('#census-notes')?.value.trim() || '';
    const errors = [];
    if (!Number.isInteger(pokokMati) || pokokMati < 0) errors.push('Pokok Mati wajib diisi angka bulat nol atau lebih.');
    else if (pokokMati > Number(plot.numberOfPlants || 0)) errors.push('Pokok Mati tidak boleh melebihi populasi acuan Plot.');
    if (!Number.isInteger(jumlahCabang) || jumlahCabang < 0) errors.push('Jumlah Cabang wajib diisi angka bulat nol atau lebih.');
    if (!Number.isFinite(totalPanjangCabangMeter) || totalPanjangCabangMeter < 0) errors.push('Jumlah Panjang Cabang wajib diisi angka nol atau lebih.');
    if (pokokMati > 0 && !SELECTION_CULL_REASONS.includes(alasan)) errors.push('Pilih alasan dari daftar karena terdapat pokok mati.');
    if (errors.length) {
      toast(errors.join(' '), 'error');
      return;
    }

    const duplicate = transactions.find(item => item.id !== editingRecord?.id && item.plotId === plot.id && item.periodId === period.id);
    if (duplicate) {
      toast(`Plot ini sudah memiliki transaksi pada ${period.name}. Gunakan transaksi yang ada untuk melakukan koreksi.`, 'error');
      return;
    }

    const user = getCurrentUserContext();
    const date = todayISO();
    const now = new Date().toISOString();
    const snapshot = {
      ...(editingRecord || {}),
      ...(editingRecord ? {} : {
        id: `CENSUS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        docNo: generateUniqueDocNo('SEN', transactions, Number(String(date).slice(0, 4)) || new Date().getFullYear()),
        createdAt: now
      }),
      activityType: 'SENSUS_ENTRES',
      type: 'SENSUS_ENTRES',
      referenceType: 'SENSUS_ENTRES',
      periodId: period.id,
      periodCode: period.code,
      periodName: period.name,
      tanggal: date,
      tanggalSensus: editingRecord?.tanggalSensus || date,
      plotId: plot.id,
      plotName: plot.plotName,
      kodePlot: `Plot ${plot.plotName}`,
      cloneName: plot.cloneName,
      budwoodCode: plot.budwoodCode,
      yearOfPlanting: plot.yearOfPlanting,
      populasiAcuan: Number(plot.numberOfPlants || 0),
      pokokMati,
      jumlahCabang,
      totalPanjangCabangMeter,
      alasan,
      catatan,
      verifiedMethod: editingRecord?.verifiedMethod || selectedPlot.verifiedMethod || 'MANUAL',
      mantri: user?.name || 'Mantri Bibitan',
      actorName: user?.name || 'Mantri Bibitan',
      actorCode: user?.code || user?.userId || 'MNT001',
      status: editingRecord ? 'READY_TO_CONFIRM' : 'DRAFT',
      submissionStatus: editingRecord ? 'READY_TO_CONFIRM' : '',
      verificationStatus: null,
      isFinal: false,
      isCorrected: Boolean(editingRecord),
      returnReason: editingRecord?.returnReason || null,
      updatedAt: editingRecord ? now : null
    };
    const savedRecord = applyTransactionActor(
      snapshot,
      editingRecord ? AUDIT_EVENT_TYPES.UPDATE : AUDIT_EVENT_TYPES.CREATE,
      user,
      editingRecord ? `Perbaikan sensus entres ${snapshot.docNo}` : `Pencatatan sensus entres ${snapshot.docNo}`
    );
    if (editingRecord) {
      const index = transactions.findIndex(item => item.id === editingRecord.id);
      transactions[index] = savedRecord;
    } else {
      transactions.push(savedRecord);
    }
    storage.set(STORAGE_KEY, transactions);
    storage.remove('editing_entres_census_id');
    storage.remove('entres_census_selected_plot');
    toast(`Sensus ${savedRecord.docNo} berhasil disimpan. Kirim melalui Konfirmasi untuk Verifikasi.`, 'success');
    navigate('/entres/sensus');
  });
}
