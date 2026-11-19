/**
 * Master Periode Sensus Kebun Entres untuk prototype mobile.
 * Dataset periode Januari-Desember 2026 mengikuti format YYYY-MM.
 */

const MONTH_NAMES_ID = Object.freeze([
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
]);

const buildPeriod = (month) => {
  const year = 2026;
  const monthCode = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Object.freeze({
    id: `CENSUS-PERIOD-${year}-${monthCode}`,
    code: `${year}-${monthCode}`,
    name: `Periode ${MONTH_NAMES_ID[month - 1]} ${year}`,
    year,
    month,
    monthName: MONTH_NAMES_ID[month - 1],
    startDate: `${year}-${monthCode}-01`,
    endDate: `${year}-${monthCode}-${String(lastDay).padStart(2, '0')}`
  });
};

export const CENSUS_PERIOD_MASTER = Object.freeze(
  Array.from({ length: 12 }, (_, index) => buildPeriod(index + 1))
);

export function getAllCensusPeriods() {
  return [...CENSUS_PERIOD_MASTER];
}

export function getCensusPeriodById(id) {
  if (!id) return null;
  const clean = String(id).trim().toUpperCase();
  return CENSUS_PERIOD_MASTER.find((period) => period.id === clean) || null;
}

export function getCensusPeriodByCode(code) {
  if (!code) return null;
  const clean = String(code).trim();
  return CENSUS_PERIOD_MASTER.find((period) => period.code === clean) || null;
}

export function getCensusPeriodForDate(date = new Date()) {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const code = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
  return getCensusPeriodByCode(code);
}
