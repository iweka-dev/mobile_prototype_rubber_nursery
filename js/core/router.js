/**
 * core/router.js — client-side router sederhana (hash-based).
 * Route divalidasi melalui permission layer.
 */

import { session } from './session.js';
import { permissions, ROLES } from './permissions.js';
import { getGlobalAttendanceGateStatus, showAttendanceRequirementModal } from './attendance-gate-service.js';
import { toast } from '../components/toast.js';

const routes = new Map();
let notFoundHandler = null;
let guard = null;
let currentRoute = null;
let currentParams = null;

const TRANSACTION_CREATION_ROUTES = [
  '/seeding/form',
  '/seeding/scan',
  '/seeding/issue-select',
  '/seeding/dederan/scan',
  '/seeding/dederan/form',
  '/seeding/dederan/inspection',
  '/budding/grafting',
  '/budding/grafting/scan',
  '/budding/grafting/form',
  '/budding/regrafting',
  '/inspection/scan',
  '/inspection/form',
  '/inspection/dederan/form',
  '/entres/menunas',
  '/entres/menunas/form',
  '/entres/topping',
  '/entres/topping/form',
  '/entres/sensus/scan',
  '/entres/sensus/form',
  '/nursery-activity/form',
  '/request/kebun-sepupu/form',
  '/request/kebun-sendiri/form',
  '/request/mata-entres/form',
  '/dispatch/report',
  '/reception/benih',
  '/reception/benih/sir',
  '/reception/benih/camera'
];

function parseHash() {
  const raw = location.hash || '#/login';
  const clean = raw.replace(/^#/, '');
  const [pathPart, queryPart] = clean.split('?');
  const path = pathPart || '/login';
  const query = new URLSearchParams(queryPart || '');
  return { path, query };
}

function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const pt = pathParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(pt);
    } else if (pp !== pt) {
      return null;
    }
  }
  return params;
}

export function registerRoute(pattern, handler) {
  routes.set(pattern, handler);
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

/** Guard dipanggil sebelum render; return true untuk izinkan, false untuk blokir. */
export function setGuard(fn) {
  guard = fn;
}

export function navigate(path, options = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (options.replace) {
    if (location.hash === target) {
      handleRouteChange();
    } else {
      location.replace(target);
      // location.replace() tidak selalu memicu event hashchange, panggil handler secara eksplisit
      handleRouteChange();
    }
    return;
  }
  if (location.hash === target) {
    // paksa render ulang bila sama
    handleRouteChange();
  } else {
    location.hash = target;
  }
}

export function getCurrent() {
  return { route: currentRoute, params: currentParams };
}

export function getParams() {
  return currentParams || {};
}

function findRoute(path) {
  for (const [pattern, handler] of routes.entries()) {
    const params = matchPath(pattern, path);
    if (params !== null) {
      return { handler, params };
    }
  }
  return null;
}

function defaultGuard(path) {
  const PUBLIC = ['/login'];
  if (PUBLIC.some((p) => path.startsWith(p))) return true;
  if (!session.isAuthenticated()) return { redirect: '/login' };

  // GLOBAL ATTENDANCE GATE FOR TRANSACTION CREATION ROUTES
  const role = session.getRole();
  if (role === ROLES.MANTRI_TANAMAN) {
    const isCreationRoute = TRANSACTION_CREATION_ROUTES.some((cr) => path === cr || path.startsWith(`${cr}/`) || path.startsWith(cr));
    if (isCreationRoute) {
      const gate = getGlobalAttendanceGateStatus();
      if (!gate.isGateUnlocked) {
        // Tentukan fallback redirect route (landing halaman modul)
        const pathSegments = path.split('/').filter(Boolean);
        const parentModule = pathSegments[0] ? `/${pathSegments[0]}` : '/home';
        
        // Show informative notification
        if (typeof toast !== 'undefined' && toast.warning) {
          toast.warning(gate.errorMessage || 'Presensi harian diperlukan sebelum membuat transaksi.');
        }

        // Tampilkan modal jika di browser
        if (typeof document !== 'undefined' && document.body) {
          setTimeout(() => {
            showAttendanceRequirementModal({ targetModuleName: pathSegments[0] || 'Transaksi' });
          }, 150);
        }

        return { redirect: parentModule };
      }
    }
  }

  return true;
}

async function handleRouteChange() {
  const { path, query } = parseHash();
  const result = findRoute(path);

  if (!result) {
    if (notFoundHandler) {
      await notFoundHandler(path);
    } else {
      document.getElementById('app').innerHTML =
        '<div class="page"><h1>404</h1><p>Halaman tidak ditemukan.</p></div>';
    }
    return;
  }

  // Permission guard
  const g = guard || defaultGuard;
  const decision = g(path);
  if (decision === false) {
    navigate('/login');
    return;
  }
  if (decision && decision.redirect) {
    navigate(decision.redirect);
    return;
  }

  // validasi akses via permission layer untuk route terproteksi
  if (!['/login'].some((p) => path.startsWith(p))) {
    if (!permissions.canAccessRoute(path)) {
      navigate('/login');
      return;
    }
  }

  currentRoute = path;
  currentParams = { ...result.params, ...Object.fromEntries(query.entries()) };

  // Reset state UI tiap render
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  const externalActionArea = document.getElementById('external-action-area');
  if (modalRoot) modalRoot.innerHTML = '';
  if (toastRoot) toastRoot.innerHTML = '';
  if (externalActionArea) externalActionArea.remove();

  await result.handler({ params: currentParams, query });
}

export function initRouter() {
  window.addEventListener('hashchange', handleRouteChange);
  // render awal
  if (!location.hash) {
    location.replace('#/login');
  } else {
    handleRouteChange();
  }
}
