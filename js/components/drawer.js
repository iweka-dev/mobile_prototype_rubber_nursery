/**
 * components/drawer.js — Sidebar Navigation Drawer.
 * Sesuai desain acuan: Profil (Avatar, Nama, Posisi), Menu (Beranda, Riwayat Data,
 * Sinkronisasi, Profil Saya, Keluar Aplikasi), dan Footer App Version 1.0.
 */

import { session } from '../core/session.js';
import { ROLE_LABELS, ROLES } from '../core/permissions.js';
import { navigate, getCurrent } from '../core/router.js';
import { toast } from './toast.js';
import { esc } from '../core/utils.js';
import { getDemoPersonas, getDemoPersonaByCode } from '../data/demo-personas.js';
import { getCurrentUserContext, normalizeRole } from '../core/user-context.js';
import { ASISTEN_BIBITAN_DATA_MASTER_MENUS } from '../core/menu-registry.js';
import { isSimulationActive, openSimulationClockModal } from '../core/simulation-clock-service.js';

let drawerEl = null;

/* SVGs persis sesuai desain acuan */
const SVGS = {
  avatar: `
    <svg viewBox="0 0 64 64" width="68" height="68">
      <circle cx="32" cy="32" r="30" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2.5"/>
      <circle cx="32" cy="24" r="9.5" fill="#cbd5e1"/>
      <path d="M15 50 C15 40 22.5 36 32 36 C41.5 36 49 40 49 50 Z" fill="#cbd5e1"/>
    </svg>
  `,
  home: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="#116834">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  `,
  document: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  `,
  sprout: `
    <svg viewBox="2 1.5 28 19" width="22" height="22" fill="#116834">
      <path d="M16 2.5 C16 2.5 11.5 8.5 11.5 14 C11.5 16.8 13.5 19 16 19 C18.5 19 20.5 16.8 20.5 14 C20.5 8.5 16 2.5 16 2.5 Z" fill="#116834"/>
      <path d="M13.2 19.5 C9.5 19.5 3.5 15.2 3.5 9 C9.5 8.5 13.8 13.2 13.8 17 C13.8 18 13.5 18.8 13.2 19.5 Z" fill="#116834"/>
      <path d="M18.8 19.5 C22.5 19.5 28.5 15.2 28.5 9 C22.5 8.5 18.2 13.2 18.2 17 C18.2 18 18.5 18.8 18.8 19.5 Z" fill="#116834"/>
    </svg>
  `,
  calendar: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
      <line x1="8" y1="14" x2="8.01" y2="14"></line>
      <line x1="12" y1="14" x2="12.01" y2="14"></line>
      <line x1="16" y1="14" x2="16.01" y2="14"></line>
      <line x1="8" y1="18" x2="8.01" y2="18"></line>
      <line x1="12" y1="18" x2="12.01" y2="18"></line>
      <line x1="16" y1="18" x2="16.01" y2="18"></line>
    </svg>
  `,
  sync: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
  `,
  checkCircle: `
    <svg viewBox="0 0 20 20" width="20" height="20" fill="#22c55e">
      <circle cx="10" cy="10" r="9" fill="#22c55e"/>
      <path d="M6 10.5 L8.5 13 L14 7.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  `,
  profile: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  `,
  logout: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
      <line x1="12" y1="2" x2="12" y2="12"></line>
    </svg>
  `,
  chevron: `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `,
  database: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
  `,
  clock: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
  `
};

export function openDrawer() {
  closeDrawer();

  const user = getCurrentUserContext();
  const userCtx = user;
  const displayName = user.name;
  const displayRole = user.position || ROLE_LABELS[user.role] || user.role;
  const currentPath = (getCurrent().route || '/home');
  const isAsistenBibitan = userCtx?.role === ROLES.ASISTEN_BIBITAN || user?.role === ROLES.ASISTEN_BIBITAN;
  const isMantri = userCtx?.role === ROLES.MANTRI_TANAMAN || user?.role === ROLES.MANTRI_TANAMAN;
  const normalizedRole = normalizeRole(userCtx?.role || user?.role);
  const isAskep = normalizedRole === ROLES.ASISTEN_KEPALA || normalizedRole === 'ASKEP';
  const isPengurus = normalizedRole === ROLES.PENGURUS || normalizedRole === 'PENGURUS_KEBUN_SEPUPU';
  const isSimActive = isSimulationActive();

  // Load personas from Master Persona Registry excluding hidden switcher roles (KTU & Tekniker I)
  const HIDDEN_SWITCHER_ROLES = [ROLES.KTU, ROLES.TEKNIKER_I];
  const visiblePersonas = getDemoPersonas().filter((p) => !HIDDEN_SWITCHER_ROLES.includes(p.role));
  const tbsPersonas = visiblePersonas.filter((p) => p.estateId === 'EST-TBS');
  const apmPersonas = visiblePersonas.filter((p) => p.estateId === 'EST-APM');

  const currentPersonaCode = user.code || user.userId || user.id;

  const renderPersonaListHtml = (personas) =>
    personas
      .map((p) => {
        const isActive =
          p.code === currentPersonaCode ||
          (p.name === user.name && (p.role === user.role || p.role === userCtx?.role || (p.code === 'PGS002' && user.role === 'PENGURUS_KEBUN_SEPUPU')));
        const isDivision = p.scopeType === 'DIVISION';
        return `
      <button class="persona-card ${isActive ? 'active' : ''}" data-code="${esc(p.code)}" type="button">
        <div class="persona-card-top">
          <span class="persona-card-name">${esc(p.name)}</span>
          ${isActive ? '<span class="persona-badge-active">AKTIF</span>' : ''}
        </div>
        <div class="persona-card-meta">
          <span class="persona-card-role">${esc(ROLE_LABELS[p.role] || p.role)} · ${esc(p.position)}</span>
        </div>
        <div class="persona-card-footer">
          <span class="persona-card-scope ${isDivision ? 'scope-division' : 'scope-estate'}">${esc(p.divisionName)}</span>
        </div>
      </button>
    `;
      })
      .join('');

  let navListHtml = '';
  if (isAsistenBibitan) {
    const masterNavs = ASISTEN_BIBITAN_DATA_MASTER_MENUS.map((m) => {
      const isActive = currentPath === m.route;
      return `
        <button class="drawer-nav-row ${isActive ? 'is-active' : ''}" data-nav-route="${m.route}" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.database}</span>
            <span class="drawer-row-label">${esc(m.label)}</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>
      `;
    }).join('');

    navListHtml = `
      <div class="drawer-nav-list">
        <button class="drawer-nav-row ${currentPath === '/home' ? 'is-active' : ''}" id="menu-beranda" data-nav-route="/home" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.home}</span>
            <span class="drawer-row-label">Beranda</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>

        <div class="drawer-group-header" style="padding: 14px 16px 6px; font-size: 0.72rem; font-weight: 800; color: #64748B; letter-spacing: 0.05em; text-transform: uppercase;">
          DATA MASTER
        </div>

        ${masterNavs}

        <button class="drawer-nav-row ${currentPath === '/sync' ? 'is-active' : ''}" id="menu-sync" data-nav-route="/sync" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.sync}</span>
            <span class="drawer-row-label">Sinkronisasi</span>
          </div>
          <div class="drawer-row-right">
            <span class="drawer-sync-check">${SVGS.checkCircle}</span>
            ${SVGS.chevron}
          </div>
        </button>

        <button class="drawer-nav-row ${currentPath === '/profile' ? 'is-active' : ''}" id="menu-profil" data-nav-route="/profile" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.profile}</span>
            <span class="drawer-row-label">Profil Saya</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>

        <button class="drawer-nav-row" id="menu-logout" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.logout}</span>
            <span class="drawer-row-label">Keluar Aplikasi</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>
      </div>
    `;
  } else {
    navListHtml = `
      <div class="drawer-nav-list">
        <button class="drawer-nav-row ${currentPath === '/home' ? 'is-active' : ''}" id="menu-beranda" data-nav-route="/home" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.home}</span>
            <span class="drawer-row-label">Beranda</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>

        ${(isAskep || isPengurus) ? `
          <button class="drawer-nav-row ${currentPath === '/destruction' ? 'is-active' : ''}" id="menu-pemusnahan-drawer" data-nav-route="/destruction" type="button">
            <div class="drawer-row-left">
              <span class="drawer-row-icon">${SVGS.document}</span>
              <span class="drawer-row-label">Pemusnahan Bibit</span>
            </div>
            <div class="drawer-row-right">
              ${SVGS.chevron}
            </div>
          </button>
        ` : ''}

        <button class="drawer-nav-row ${currentPath === '/history' ? 'is-active' : ''}" id="menu-riwayat" data-nav-route="/history" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.calendar}</span>
            <span class="drawer-row-label">Riwayat Data</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>

        ${isMantri ? `
          <button class="drawer-nav-row" id="menu-simulasi-waktu" type="button">
            <div class="drawer-row-left">
              <span class="drawer-row-icon">${SVGS.clock}</span>
              <span class="drawer-row-label">Simulasi Waktu</span>
              ${isSimActive ? '<span style="font-size: 0.65rem; background: #FEF3C7; color: #92400E; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;">AKTIF</span>' : ''}
            </div>
            <div class="drawer-row-right">
              ${SVGS.chevron}
            </div>
          </button>
        ` : ''}

        <button class="drawer-nav-row ${currentPath === '/sync' ? 'is-active' : ''}" id="menu-sync" data-nav-route="/sync" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.sync}</span>
            <span class="drawer-row-label">Sinkronisasi</span>
          </div>
          <div class="drawer-row-right">
            <span class="drawer-sync-check">${SVGS.checkCircle}</span>
            ${SVGS.chevron}
          </div>
        </button>

        <button class="drawer-nav-row ${currentPath === '/profile' ? 'is-active' : ''}" id="menu-profil" data-nav-route="/profile" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.profile}</span>
            <span class="drawer-row-label">Profil Saya</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>

        <button class="drawer-nav-row" id="menu-logout" type="button">
          <div class="drawer-row-left">
            <span class="drawer-row-icon">${SVGS.logout}</span>
            <span class="drawer-row-label">Keluar Aplikasi</span>
          </div>
          <div class="drawer-row-right">
            ${SVGS.chevron}
          </div>
        </button>
      </div>
    `;
  }

  drawerEl = document.createElement('div');
  drawerEl.className = 'drawer-overlay';
  drawerEl.innerHTML = `
    <div class="drawer-panel">
      <div class="drawer-profile-section">
        <div class="drawer-avatar-wrap">
          ${SVGS.avatar}
        </div>
        <div class="drawer-profile-info">
          <div class="drawer-profile-name">${esc(displayName)}</div>
          <div class="drawer-profile-role">${esc(displayRole)}</div>
        </div>
      </div>

      ${navListHtml}

      <div class="drawer-demo-switch">
        <div class="drawer-demo-head">
          <div class="drawer-demo-head-title">
            <span class="drawer-demo-badge">MODE DEMO</span>
            <span class="drawer-demo-sub">Persona Switcher</span>
          </div>
        </div>

        <div class="drawer-estate-group">
          <div class="drawer-estate-title">
            <span class="drawer-estate-name">🏛️ Tanah Besih</span>
            <span class="drawer-estate-count">${tbsPersonas.length} PERSONA</span>
          </div>
          <div class="drawer-persona-list">
            ${renderPersonaListHtml(tbsPersonas)}
          </div>
        </div>

        <div class="drawer-estate-group">
          <div class="drawer-estate-title">
            <span class="drawer-estate-name">🏛️ Aek Pamingke</span>
            <span class="drawer-estate-count">${apmPersonas.length} PERSONA</span>
          </div>
          <div class="drawer-persona-list">
            ${renderPersonaListHtml(apmPersonas)}
          </div>
        </div>
      </div>

      <div class="drawer-bottom-version">
        App Version 1.0
      </div>
    </div>
  `;

  const container = document.querySelector('.device-screen') || document.getElementById('modal-root') || document.body;
  container.appendChild(drawerEl);

  // Close on backdrop click
  drawerEl.addEventListener('click', (e) => {
    if (e.target === drawerEl) closeDrawer();
  });

  // Nav Route Handlers
  drawerEl.querySelectorAll('[data-nav-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.navRoute;
      closeDrawer();
      if (target) navigate(target);
    });
  });

  // Handler Simulasi Waktu
  drawerEl.querySelector('#menu-simulasi-waktu')?.addEventListener('click', () => {
    closeDrawer();
    openSimulationClockModal();
  });

  drawerEl.querySelector('#menu-logout')?.addEventListener('click', () => {
    session.clear();
    closeDrawer();
    toast('Berhasil keluar aplikasi', 'info');
    navigate('/login');
  });

  // Demo persona switcher card handlers
  drawerEl.querySelectorAll('.persona-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const code = card.dataset.code;
      const targetPersona = getDemoPersonaByCode(code);
      if (targetPersona) {
        // Compatibility mapping: for PGS002 (Mukhsin Haji), preserve legacy role in raw session to protect existing request flow
        const sessionRole = targetPersona.code === 'PGS002' ? 'PENGURUS_KEBUN_SEPUPU' : targetPersona.role;

        session.start({
          userId: targetPersona.code,
          code: targetPersona.code,
          role: sessionRole,
          name: targetPersona.name,
          position: targetPersona.position,
          estateId: targetPersona.estateId,
          estateName: targetPersona.estateName,
          divisionId: targetPersona.divisionId,
          divisionName: targetPersona.divisionName,
          scopeType: targetPersona.scopeType,
          isDemoSession: true
        });

        toast(`Beralih ke persona ${targetPersona.name} (${targetPersona.position} - ${targetPersona.estateName})`, 'info');
        closeDrawer();
        navigate('/splash', { replace: true });
      }
    });
  });
}

export function closeDrawer() {
  if (drawerEl) {
    drawerEl.remove();
    drawerEl = null;
  }
}
