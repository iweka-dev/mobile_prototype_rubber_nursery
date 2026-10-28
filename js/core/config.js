/**
 * Global Configuration for Sigma Nursery
 * Berisi konstanta dan pengaturan aplikasi.
 */

export const CONFIG = {
  APP_NAME: 'Sigma Nursery',
  APP_VERSION: '1.0.0',
  
  // Konfigurasi Database IndexedDB
  DB_NAME: 'sigma-nursery-db',
  DB_VERSION: 1,
  
  // Mode Development / Demo
  IS_DEMO_MODE: true, // Mengaktifkan Role Switcher & Mock Login
  
  // Endpoint API (untuk integrasi di fase mendatang)
  API_BASE_URL: '', // Dikosongkan karena saat ini berjalan murni tanpa backend

  // Fitur tambahan dibuat terisolasi agar dapat dinonaktifkan tanpa mengubah flow lama.
  FEATURES: Object.freeze({
    PHYSICAL_STOCK_INSPECTION: true
  })
};
