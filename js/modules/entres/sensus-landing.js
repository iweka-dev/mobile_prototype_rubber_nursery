import { navigate } from '../../core/router.js';
import { storage } from '../../core/storage.js';
import { todayISO, esc } from '../../core/utils.js';
import { getCurrentUserContext } from '../../core/user-context.js';
import { getCensusPeriodForDate, getAllCensusPeriods } from '../../data/census-period-master.js';
import { matchActor } from '../../core/transaction-actor.js';
import { toast } from '../../components/toast.js';

const STORAGE_KEY = 'entres_census_transactions';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('id-ID');
}

function getStatusLabel(record) {
  const status = String(record.status || record.verificationStatus || '').toUpperCase();
  if (status === 'DISETUJUI' || status === 'TERVERIFIKASI' || record.isFinal) return 'Disetujui';
  if (status === 'DIKEMBALIKAN' || status === 'REVISION') return 'Perlu Koreksi';
  if (status === 'MENUNGGU_VERIFIKASI' || status === 'SUBMITTED_TO_ASB') return 'Menunggu Verifikasi';
  return 'Belum Dikirim';
}

function canEditBeforeSubmit(record) {
  const status = String(record.status || '').trim().toUpperCase();
  if (record.isFinal || !['DRAFT', 'READY_TO_CONFIRM'].includes(status)) return false;

  const submittedStatuses = new Set([
    'MENUNGGU_VERIFIKASI',
    'MENUNGGU_VERIFIKASI_ASISTEN_BIBITAN',
    'SUBMITTED_TO_ASB',
    'PENDING_ASB',
    'DISETUJUI',
    'TERVERIFIKASI',
    'VERIFIED',
    'APPROVED'
  ]);
  const lifecycleStatuses = [record.submissionStatus, record.verificationStatus]
    .filter(Boolean)
    .map(value => String(value).trim().toUpperCase());
  const hasSubmittedTimestamp = [record.submittedAt, record.confirmedAt]
    .some(value => Boolean(value && String(value).trim() && String(value).trim() !== '-'));

  return !hasSubmittedTimestamp && !lifecycleStatuses.some(value => submittedStatuses.has(value));
}

export function renderEntresCensusLanding() {
  const app = document.getElementById('app');
  if (!app) return;

  const user = getCurrentUserContext();
  const periods = getAllCensusPeriods();
  const currentPeriod = getCensusPeriodForDate(todayISO());
  const selectedPeriod = periods.find(period => period.id === currentPeriod?.id) || currentPeriod;
  if (selectedPeriod) storage.set('entres_census_selected_period_id', selectedPeriod.id);
  const transactions = storage.get(STORAGE_KEY, [])
    .filter(tx => matchActor(tx, user))
    .filter(tx => !selectedPeriod || tx.periodId === selectedPeriod.id)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const returned = transactions.filter(tx => getStatusLabel(tx) === 'Perlu Koreksi');
  const canStart = Boolean(selectedPeriod);

  app.innerHTML = `
    <div class="page entres-census-page" style="display:flex;flex-direction:column;height:100%;min-height:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <header style="display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 16px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="btn-census-back" type="button" aria-label="Kembali ke Kebun Entres" style="padding:6px;margin-left:-6px;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#116834;">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
          <h1 style="font-size:1.05rem;font-weight:800;color:#0F172A;margin:0;line-height:1.2;">Sensus Entres</h1>
        </div>
        <button id="btn-refresh-census" type="button" aria-label="Segarkan" style="background:none;border:0;cursor:pointer;padding:6px;margin-right:-6px;display:flex;align-items:center;justify-content:center;color:#116834;">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      </header>
      <main style="flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;">
        <section style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:14px;">
          <label for="census-period-select" style="display:block;font-size:.76rem;font-weight:700;color:#475569;margin-bottom:7px;">Periode Sensus</label>
          <div id="census-period-current" aria-label="Periode Sensus saat ini" style="width:100%;min-height:42px;padding:11px 10px;border:1px solid #CBD5E1;border-radius:7px;background:#F8FAFC;color:#0F172A;font-size:.84rem;box-sizing:border-box;">${esc(selectedPeriod?.name || 'Periode bulan berjalan belum tersedia')}</div>
          <div style="font-size:.73rem;color:#64748B;margin-top:7px;">Periode Sensus mengikuti bulan berjalan.</div>
        </section>

        <section>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">
            <h2 style="margin:0;font-size:.94rem;font-weight:800;color:#0F172A;">Riwayat Sensus</h2>
            <span style="font-size:.72rem;color:#64748B;">${transactions.length} transaksi</span>
          </div>
          ${transactions.length ? transactions.map(tx => {
            const status = getStatusLabel(tx);
            const isReturned = status === 'Perlu Koreksi';
            const canManageBeforeSubmit = canEditBeforeSubmit(tx);
            const badgeColor = status === 'Disetujui' ? '#166534' : status === 'Perlu Koreksi' ? '#B91C1C' : status === 'Menunggu Verifikasi' ? '#1D4ED8' : '#475569';
            const badgeBg = status === 'Disetujui' ? '#DCFCE7' : status === 'Perlu Koreksi' ? '#FEE2E2' : status === 'Menunggu Verifikasi' ? '#DBEAFE' : '#F1F5F9';
            return `<article style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:9px;padding:12px;margin-bottom:9px;">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="min-width:0;">
                  <div style="font-size:.88rem;font-weight:800;color:#0F172A;">${esc(tx.kodePlot || tx.plotName || '-')} · ${esc(tx.cloneName || '-')}</div>
                  <div style="font-size:.73rem;color:#64748B;margin-top:4px;">${esc(tx.docNo || '-')} · ${formatDate(tx.tanggalSensus || tx.tanggal)}</div>
                  <div style="font-size:.7rem;color:#64748B;margin-top:3px;">Periode Sensus: ${esc(tx.periodName || tx.periodCode || selectedPeriod?.name || '-')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;position:relative;">
                  <span style="background:${badgeBg};color:${badgeColor};border-radius:12px;padding:4px 8px;font-size:.67rem;font-weight:700;white-space:nowrap;">${status}</span>
                  ${canManageBeforeSubmit ? `<button class="btn-census-card-menu" data-id="${esc(tx.id)}" type="button" aria-label="Menu transaksi ${esc(tx.docNo || '')}" style="width:28px;height:28px;padding:0;background:transparent;border:0;border-radius:6px;color:#64748B;display:flex;align-items:center;justify-content:center;cursor:pointer;">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                  </button>
                  <div class="census-card-menu" data-menu-id="${esc(tx.id)}" style="display:none;position:absolute;top:32px;right:0;min-width:120px;background:#FFFFFF;border:1px solid #D9D9D9;border-radius:7px;box-shadow:0 4px 12px rgba(0,0,0,.14);z-index:20;overflow:hidden;flex-direction:column;">
                    <button class="btn-census-menu-edit" data-id="${esc(tx.id)}" type="button" style="width:100%;padding:10px 12px;text-align:left;background:#FFFFFF;border:0;border-bottom:1px solid #EFEFEF;color:#116834;font-size:.78rem;font-weight:600;cursor:pointer;">Edit</button>
                    <button class="btn-census-menu-delete" data-id="${esc(tx.id)}" type="button" style="width:100%;padding:10px 12px;text-align:left;background:#FFFFFF;border:0;color:#D32F2F;font-size:.78rem;font-weight:600;cursor:pointer;">Hapus</button>
                  </div>` : ''}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin-top:11px;padding-top:9px;border-top:1px solid #E2E8F0;">
                <div><div style="font-size:.65rem;color:#64748B;">Pokok Awal</div><strong style="font-size:.78rem;color:#0F172A;">${Number(tx.populasiAcuan || 0).toLocaleString('id-ID')} Pkk</strong></div>
                <div><div style="font-size:.65rem;color:#64748B;">Pokok Mati</div><strong style="font-size:.78rem;color:#0F172A;">${Number(tx.pokokMati || 0).toLocaleString('id-ID')} Pkk</strong></div>
                <div><div style="font-size:.65rem;color:#64748B;">Jumlah Cabang</div><strong style="font-size:.78rem;color:#0F172A;">${Number(tx.jumlahCabang || 0).toLocaleString('id-ID')}</strong></div>
                <div><div style="font-size:.65rem;color:#64748B;">Panjang</div><strong style="font-size:.78rem;color:#0F172A;">${Number(tx.totalPanjangCabangMeter || 0).toLocaleString('id-ID')} m</strong></div>
              </div>
              ${isReturned ? `<div style="margin-top:9px;padding:8px 9px;background:#FEF2F2;border-radius:6px;color:#991B1B;font-size:.72rem;">${esc(tx.returnReason || 'Transaksi perlu diperbaiki sesuai catatan Asisten Bibitan.')}</div>` : ''}
              ${isReturned ? `<button class="btn-census-edit" data-id="${esc(tx.id)}" type="button" style="width:100%;height:38px;margin-top:9px;background:#FFFFFF;color:#116834;border:1px solid #86EFAC;border-radius:6px;font-size:.78rem;font-weight:700;cursor:pointer;">Perbaiki Sensus</button>` : ''}
            </article>`;
          }).join('') : `<div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:9px;padding:24px 16px;text-align:center;color:#64748B;font-size:.82rem;line-height:1.5;">Belum ada sensus pada periode ini.</div>`}
        </section>
      </main>
      <footer style="flex:none;padding:12px 16px;background:#FFFFFF;border-top:1px solid #E2E8F0;">
        <button id="btn-start-census" type="button" ${canStart ? '' : 'disabled'} style="width:100%;height:44px;background:${canStart ? '#116834' : '#94A3B8'};color:#FFFFFF;border:0;border-radius:7px;font-size:.84rem;font-weight:700;cursor:${canStart ? 'pointer' : 'not-allowed'};">Mulai Sensus</button>
      </footer>
    </div>`;

  app.querySelector('#btn-census-back')?.addEventListener('click', () => navigate('/entres'));
  app.querySelector('#btn-refresh-census')?.addEventListener('click', renderEntresCensusLanding);
  app.querySelector('#btn-start-census')?.addEventListener('click', () => {
    if (!selectedPeriod) return;
    storage.set('entres_census_selected_period_id', selectedPeriod.id);
    navigate('/entres/sensus/scan');
  });
  app.querySelectorAll('.btn-census-edit').forEach(button => {
    button.addEventListener('click', () => {
      const record = transactions.find(item => item.id === button.dataset.id);
      if (!record || getStatusLabel(record) !== 'Perlu Koreksi') return;
      storage.set('editing_entres_census_id', button.dataset.id);
      if (record?.periodId) storage.set('entres_census_selected_period_id', record.periodId);
      navigate('/entres/sensus/form');
    });
  });

  app.querySelectorAll('.btn-census-card-menu').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const id = button.dataset.id;
      const targetMenu = [...app.querySelectorAll('.census-card-menu')].find(menu => menu.dataset.menuId === id);
      app.querySelectorAll('.census-card-menu').forEach(menu => {
        if (menu !== targetMenu) menu.style.display = 'none';
      });
      if (targetMenu) targetMenu.style.display = targetMenu.style.display === 'flex' ? 'none' : 'flex';
    });
  });

  app.querySelectorAll('.btn-census-menu-edit').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const allRecords = storage.get(STORAGE_KEY, []);
      const record = allRecords.find(item => item.id === button.dataset.id);
      if (!record || !matchActor(record, user) || !canEditBeforeSubmit(record)) {
        toast.error('Transaksi Sensus Entres hanya dapat diedit sebelum dikirim ke Asisten Bibitan.');
        return;
      }
      storage.set('editing_entres_census_id', record.id);
      storage.set('entres_census_selected_period_id', record.periodId);
      navigate('/entres/sensus/form');
    });
  });

  app.querySelectorAll('.btn-census-menu-delete').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const allRecords = storage.get(STORAGE_KEY, []);
      const record = allRecords.find(item => item.id === button.dataset.id);
      if (!record || !matchActor(record, user) || !canEditBeforeSubmit(record)) {
        toast.error('Transaksi Sensus Entres hanya dapat dihapus sebelum dikirim ke Asisten Bibitan.');
        return;
      }
      if (!window.confirm(`Hapus transaksi Sensus Entres ${record.docNo || ''}? Data yang dihapus tidak dapat dipulihkan.`)) return;

      storage.set(STORAGE_KEY, allRecords.filter(item => item.id !== record.id));
      if (storage.get('editing_entres_census_id', null) === record.id) storage.remove('editing_entres_census_id');
      storage.remove('entres_census_selected_plot');
      toast.success(`Transaksi Sensus Entres ${record.docNo || ''} berhasil dihapus.`);
      renderEntresCensusLanding();
    });
  });
}
