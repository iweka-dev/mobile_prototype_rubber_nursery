/**
 * core/storage.js — localStorage wrapper untuk session & config kecil.
 * IndexedDB = data utama; localStorage hanya session/config.
 */

const PREFIX = 'sigma:';

function isQuotaError(err) {
  return Boolean(
    err &&
    (err.name === 'QuotaExceededError' ||
     err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
     err.code === 22 ||
     err.code === 1014 ||
     (typeof err.message === 'string' && err.message.toLowerCase().includes('quota')))
  );
}

function sanitizeLargeMedia(data) {
  if (!data) return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeLargeMedia(item));
  }
  if (typeof data === 'object') {
    const copy = { ...data };
    if (Array.isArray(copy.photos) && copy.photos.length > 0) {
      copy.photos = copy.photos.map(p => (typeof p === 'string' && p.startsWith('data:image/') && p.length > 500) ? '[COMPACTED_PHOTO]' : p);
    }
    if (typeof copy.photoEvidence === 'string' && copy.photoEvidence.startsWith('data:image/') && copy.photoEvidence.length > 500) {
      if (copy.photo?.dataUrl || copy.photoData) {
        copy.photoEvidence = '[SEE_PHOTO_DATA]';
      }
    }
    return copy;
  }
  return data;
}

function pruneStorageQuota() {
  if (typeof localStorage === 'undefined') return;
  try {
    const heavyKeys = [
      'sigma:selection_documentation_photos',
      'sigma:selection_transactions',
      'sigma:seeding_transactions',
      'sigma:receipt_ksp_transactions'
    ];
    for (const fullKey of heavyKeys) {
      const raw = localStorage.getItem(fullKey);
      if (!raw || raw.length < 300000) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const compacted = parsed.map((item, idx) => {
            // Keep recent 3 photos, compact older ones
            if (idx < parsed.length - 3) {
              const c = { ...item };
              if (c.photoData && c.photoData.length > 5000) {
                c.photoData = '[PHOTO_PRUNED]';
              }
              if (c.photo && c.photo.dataUrl && c.photo.dataUrl.length > 5000) {
                c.photo = { ...c.photo, dataUrl: '[PHOTO_PRUNED]' };
              }
              return c;
            }
            return item;
          });
          localStorage.setItem(fullKey, JSON.stringify(compacted));
        }
      } catch (_) {}
    }
  } catch (_) {}
}

export const storage = {
  get(key, fallback = null) {
    try {
      if (typeof localStorage === 'undefined') return fallback;
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    if (typeof localStorage === 'undefined') return;
    const fullKey = PREFIX + key;
    const notifyChange = (v) => {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('sigma:storage-update', { detail: { key, value: v } }));
        } catch (_) {}
      }
    };
    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
      notifyChange(value);
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`[storage] LocalStorage quota exceeded writing "${key}". Running compaction...`);
        pruneStorageQuota();
        const sanitized = sanitizeLargeMedia(value);
        try {
          localStorage.setItem(fullKey, JSON.stringify(sanitized));
          notifyChange(sanitized);
          return;
        } catch (err2) {
          if (isQuotaError(err2)) {
            try {
              // Deep prune across all keys starting with PREFIX
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(PREFIX) && k !== fullKey) {
                  const val = localStorage.getItem(k);
                  if (val && val.length > 200000) {
                    try {
                      const p = JSON.parse(val);
                      localStorage.setItem(k, JSON.stringify(sanitizeLargeMedia(p)));
                    } catch (_) {}
                  }
                }
              }
              localStorage.setItem(fullKey, JSON.stringify(sanitized));
              notifyChange(sanitized);
              return;
            } catch (err3) {
              console.error(`[storage] Critical quota exceeded on "${key}":`, err3?.message || err3);
            }
          }
        }
      } else {
        throw err;
      }
    }
  },
  remove(key) {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PREFIX + key);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('sigma:storage-update', { detail: { key, value: null } }));
      } catch (_) {}
    }
  },
  has(key) {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(PREFIX + key) !== null;
  }
};

export const KEYS = {
  SESSION: 'session',
  CONFIG: 'config'
};
