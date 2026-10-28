/* Sigma Nursery - Service Worker */
/*
 * Mode pengembangan: network-first untuk HTML/CSS/JS.
 * Setiap perubahan file langsung terlihat setelah refresh (tanpa clear cache,
 * tanpa unregister, tanpa hard refresh). Sifat PWA tetap dipertahankan.
 */
const CACHE_NAME = 'sigma-nursery-v201';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/components.css',
  './css/pages.css',
  './css/review.css',
  './js/app.js',
  './js/modules/destruction/destruction-landing.js',
  './js/core/router.js',
  './js/core/session.js',
  './js/core/user-context.js',
  './js/core/role-profiles.js',
  './js/core/menu-registry.js',
  './js/core/transaction-actor.js',
  './js/core/permissions.js',
  './js/core/workflow.js',
  './js/core/storage.js',
  './js/core/utils.js',
  './js/core/export-screen.js',
  './js/db/indexeddb.js',
  './js/db/seed.js',
  './js/db/repositories.js',
  './js/data/master-data.js',
  './js/data/material-master.js',
  './js/data/material-issue-data.js',
  './js/data/cfna-master.js',
  './js/data/worker-master.js',
  './js/data/klon-master.js',
  './js/data/budwood-master.js',
  './js/data/budwood-plot-master.js',
  './js/data/block-master.js',
  './js/data/demo-data.js',
  './js/data/demo-personas.js',
  './js/components/drawer.js',
  './js/components/modal.js',
  './js/components/toast.js',
  './js/modules/auth/login.js',
  './js/modules/auth/splash.js',
  './js/modules/auth/sync.js',
  './js/modules/dashboard/beranda.js',
  './js/modules/attendance/attendance-landing.js',
  './js/modules/attendance/attendance-supervisor.js',
  './js/modules/attendance/attendance-supervisor-result.js',
  './js/modules/attendance/attendance-workers.js',
  './js/modules/attendance/attendance-summary.js',
  './js/modules/maintenance/nursery-activity.js',
  './js/modules/master/material-master.js',
  './js/modules/profile/profile.js',
  './js/modules/receipt/receipt-landing.js',
  './js/modules/receipt/receipt-benih.js',
  './js/modules/receipt/receipt-sir.js',
  './js/modules/receipt/receipt-camera.js',
  './js/modules/receipt/receipt-summary.js',
  './js/modules/receipt/receipt-placeholder.js',
  './js/modules/seeding/seeding-landing.js',
  './js/modules/seeding/seeding-form.js',
  './js/modules/seeding/seeding-scan.js',
  './js/modules/budding/budding-landing.js',
  './js/modules/budding/budding-grafting.js',
  './js/modules/budding/budding-scan.js',
  './js/modules/budding/budding-regrafting.js',
  './js/modules/budding/budding-form.js',
  './js/modules/inspection/inspection-landing.js',
  './js/modules/physical-stock-inspection/physical-stock-inspection-manager.js',
  './js/modules/physical-stock-inspection/physical-stock-inspection-landing.js',
  './js/modules/inspection/inspection-scan.js',
  './js/modules/inspection/inspection-form.js',
  './js/modules/selection/selection-landing.js',
  './js/modules/history/nursery-history.js',
  './js/modules/entres/entres-landing.js',
  './js/modules/entres/topping-form.js',
  './js/modules/entres/topping-scan.js',
  './js/modules/entres/menunas-form.js',
  './js/modules/entres/menunas-scan.js',
  './js/modules/request/request-landing.js',
  './js/modules/request/request-kebun-sepupu-form.js',
  './js/modules/dispatch/dispatch-landing.js',
  './js/modules/dispatch/dispatch-report.js',
  './js/modules/placeholder/analysis-placeholder.js',
  './js/modules/review/review-workspace.js',
  './js/modules/transactions/transaction-manager.js',
  './js/modules/verification/mantri-confirmation-service.js',
  './js/modules/verification/mantri-confirmation-landing.js',
  './assets/icons/supervisor_wagiman.jpg',
  './assets/icons/worker_fadilah.jpg',
  './assets/icons/worker_adek.jpg',
  './assets/icons/worker_bidara.jpg',
  './assets/icons/worker_tugiman.jpg',
  './assets/icons/login_icon.png',
  './assets/icons/icon_splash.jpeg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // Network-first: selalu ambil versi terbaru dari jaringan.
  // Jika offline, jatuh ke cache. HTML/CSS/JS tidak pernah disajikan stale.
  const navigation =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html');

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Hanya cache tanggapan yang valid (200/opaque) dan boleh di-cache.
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (navigation) return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
