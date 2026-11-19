const PROTOTYPE_PREMI_PER_POKOK = 150;

export function getOkulasiPremiRateSnapshot(type) {
  const normalizedType = String(type || '').trim().toUpperCase();
  if (normalizedType !== 'GRAFTING' && normalizedType !== 'REGRAFTING') return null;
  return PROTOTYPE_PREMI_PER_POKOK;
}

export function resolveOkulasiPremiRate(worker, type) {
  if (worker?.premiRatePerPokokSnapshot === null || worker?.premiRatePerPokokSnapshot === '') {
    return getOkulasiPremiRateSnapshot(type) ?? PROTOTYPE_PREMI_PER_POKOK;
  }
  const snapshot = Number(worker?.premiRatePerPokokSnapshot);
  if (Number.isFinite(snapshot) && snapshot >= 0) return snapshot;
  return getOkulasiPremiRateSnapshot(type) ?? PROTOTYPE_PREMI_PER_POKOK;
}

export function formatRupiah(value) {
  const amount = Number(value) || 0;
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}

function isCancelledInspection(insp) {
  const cancelledStatuses = new Set(['BATAL', 'CANCELLED', 'CANCELED', 'VOID']);
  return cancelledStatuses.has(String(insp?.status || '').trim().toUpperCase())
    || cancelledStatuses.has(String(insp?.verificationStatus || '').trim().toUpperCase());
}

function isFinalApprovedInspection(insp) {
  const finalStatuses = new Set(['DISETUJUI', 'APPROVED']);
  const verifiedStatuses = new Set(['TERVERIFIKASI', 'VERIFIED']);
  const nonFinalStatuses = new Set(['MENUNGGU_VERIFIKASI_MANTRI', 'PENDING_SUBMISSION', 'DIKEMBALIKAN', 'REVISION', 'RETURNED']);
  if (nonFinalStatuses.has(String(insp?.status || '').trim().toUpperCase())
    || nonFinalStatuses.has(String(insp?.verificationStatus || '').trim().toUpperCase())) return false;
  return !isCancelledInspection(insp) && (
    insp?.isFinal === true
    || finalStatuses.has(String(insp?.status || '').trim().toUpperCase())
    || verifiedStatuses.has(String(insp?.verificationStatus || '').trim().toUpperCase())
  );
}

export function aggregateOkulasiWorkerPremium(relatedInspections, buddingType) {
  const uniqueInspections = new Map();
  (relatedInspections || []).forEach((insp, index) => {
    if (!insp || isCancelledInspection(insp)) return;
    const identity = String(insp.id || insp.docNo || `inspection-${index}`);
    if (!uniqueInspections.has(identity)) uniqueInspections.set(identity, insp);
  });

  const workersByKey = new Map();
  uniqueInspections.forEach(insp => {
    const approved = isFinalApprovedInspection(insp);
    (Array.isArray(insp.workers) ? insp.workers : []).forEach(worker => {
      const id = String(worker?.id || '').trim();
      const code = String(worker?.code || '').trim();
      const normalizedName = String(worker?.name || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
      const key = id ? `id:${id}` : (code && code !== '-' ? `code:${code}` : (normalizedName ? `name:${normalizedName}` : ''));
      if (!key) return;

      if (!workersByKey.has(key)) {
        workersByKey.set(key, {
          id,
          code,
          name: String(worker?.name || 'Pekerja').trim(),
          successfulQty: 0,
          approvedQty: 0,
          approvedRecords: 0,
          approvedPremium: 0,
          estimatedQty: 0,
          estimatedRecords: 0,
          estimatedPremium: 0
        });
      }
      const summary = workersByKey.get(key);
      if (!summary.code && code) summary.code = code;
      if ((!summary.name || summary.name === 'Pekerja') && worker?.name) summary.name = String(worker.name).trim();
      const successfulQty = Math.max(0, Number.parseInt(worker?.jlhBerhasil, 10) || 0);
      const premium = successfulQty * resolveOkulasiPremiRate(worker, buddingType);
      summary.successfulQty += successfulQty;
      if (approved) {
        summary.approvedRecords += 1;
        summary.approvedQty += successfulQty;
        summary.approvedPremium += premium;
      } else {
        summary.estimatedRecords += 1;
        summary.estimatedQty += successfulQty;
        summary.estimatedPremium += premium;
      }
    });
  });
  return [...workersByKey.values()];
}
