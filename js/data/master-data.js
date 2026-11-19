/**
 * data/master-data.js — master data statis (roles, clones, stages, reasons, growth stages, program).
 * Data dummy; jangan ubah requirement tanpa konfirmasi.
 */

export const ROLES_MASTER = [
  { id: 'MANTRI_TANAMAN', code: 'MANTRI_TANAMAN', name: 'Mantri Bibitan', desc: 'Input & pelaksanaan kegiatan operasional' },
  { id: 'ASISTEN', code: 'ASISTEN', name: 'Asisten', desc: 'Verifikasi & review/koreksi transaksi' },
  { id: 'ASISTEN_BIBITAN', code: 'ASISTEN_BIBITAN', name: 'Asisten Bibitan', desc: 'Verifikasi & approval bibitan' },
  { id: 'ASKEP', code: 'ASKEP', name: 'Askep', desc: 'Monitoring & approval sesuai kewenangan' },
  { id: 'PENGURUS', code: 'PENGURUS', name: 'Pengurus', desc: 'Monitoring & approval/penentuan sumber' },
  { id: 'TEKNIKER_I', code: 'TEKNIKER_I', name: 'Tekniker I', desc: 'Monitoring teknis kegiatan nursery' },
  { id: 'KTU', code: 'KTU', name: 'KTU', desc: 'Monitoring administrasi kegiatan nursery' }
];

export const CLONES = [
  { id: 'CLONE-PB260', code: 'PB 260', name: 'PB 260' },
  { id: 'CLONE-RRIM600', code: 'RRIM 600', name: 'RRIM 600' },
  { id: 'CLONE-GT1', code: 'GT 1', name: 'GT 1' }
];

export const GROWTH_STAGES = [
  { id: 'STAGE-RMN', code: 'RMN', name: 'Rootstock Mother Nursery' },
  { id: 'STAGE-RAPM', code: 'RAPM', name: 'RAPM' }
];

export const RECEPTION_STAGES = [
  { id: 'STAGE-RMN', code: 'RMN', name: 'RMN' },
  { id: 'STAGE-RAPM', code: 'RAPM', name: 'RAPM' }
];

export const ORIGIN_TYPES = [
  { id: 'SUPPLIER', code: 'Supplier', name: 'Supplier' },
  { id: 'OWN_ESTATE', code: 'Own Estate', name: 'Own Estate' },
  { id: 'OTHERS', code: 'Others', name: 'Others' }
];

export const RECEIPT_TYPES = [
  { id: 'RT-SEED', code: 'BIJI', name: 'Biji' },
  { id: 'RT-STUMP', code: 'STUMP', name: 'Stump' },
  { id: 'RT-SEEDLING', code: 'BIBIT', name: 'Bibit' }
];

export const REASONS = [
  { id: 'REASON-DEAD', code: 'MATI', name: 'Mati' },
  { id: 'REASON-ABNORMAL', code: 'ABNORMAL', name: 'Abnormal' },
  { id: 'REASON-DAMAGED', code: 'RUSAK', name: 'Rusak' }
];

export const SELECTION_CULL_REASONS = Object.freeze([
  'Busuk',
  'Fomes',
  'Jamur Lainnya',
  'Kerdil',
  'Mati',
  'Patah',
  'Rusak'
]);

export const BEDS = [];

export {
  CENSUS_PERIOD_MASTER,
  getAllCensusPeriods,
  getCensusPeriodById,
  getCensusPeriodByCode,
  getCensusPeriodForDate
} from './census-period-master.js';

export {
  STANDARD_WORK_HOUR_MASTER,
  getAllStandardWorkHours,
  getStandardWorkHoursByDay,
  getStandardWorkHoursForDate
} from './standard-work-hour-master.js';

export {
  PROGRAM_MASTER,
  PROGRAM_MASTER as MASTER_PROGRAM_PEMBIBITAN,
  PROGRAM_STATUS,
  getAllPrograms,
  getOpenPrograms,
  getActivePrograms,
  getProgramById,
  getProgramByCode,
  getProgramsByEstate,
  getProgramsByDivision,
  getProgramsByBlock,
  resolveProgram,
  resolveProgramLegacy,
  isProgramOpen,
  isProgramActive
} from './program-master.js';

export {
  BEDENGAN_STATUS,
  DEFAULT_BEDENGAN_MASTER,
  DEFAULT_BEDENGAN_MASTER as BEDS_MASTER,
  getAllBedengan,
  getActiveBedengan,
  getBedenganById,
  getBedenganByCode,
  getBedenganByQR,
  getBedenganByProgram,
  getBedenganByEstate,
  getBedenganByDivision,
  isBedenganActive,
  createBedengan,
  updateBedengan,
  activateBedengan,
  deactivateBedengan,
  resolveBedenganLegacy
} from './bedengan-master.js';

export {
  STORAGE_KEY_NURSERY_BATCHES,
  BATCH_MASTER_STATUS,
  BATCH_STATUS,
  BATCH_CATEGORIES,
  BATCH_GROWTH_STAGES,
  DEFAULT_CANONICAL_BATCHES,
  DEFAULT_CANONICAL_BATCHES as BATCH_MASTER,
  getAllBatches,
  getActiveBatches,
  getBatchById,
  getBatchByCode,
  getBatchesByProgram,
  getBatchesByEstate,
  getBatchesByDivision,
  getBatchesByClone,
  getBatchesByGrowthStage,
  getBatchesByBedengan,
  isBatchActive,
  getAvailableBatchStock,
  createBatch,
  updateBatch,
  activateBatch,
  deactivateBatch,
  resolveBatchLegacy
} from './batch-master.js';


