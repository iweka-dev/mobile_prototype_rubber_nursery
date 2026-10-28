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

function isBase64Media(val) {
  return typeof val === 'string' && val.startsWith('data:image/') && val.length > 500;
}

function sanitizeItemMedia(item) {
  if (!item || typeof item !== 'object') return item;
  const copy = { ...item };
  if (Array.isArray(copy.photos) && copy.photos.length > 0) {
    copy.photos = copy.photos.map(p => isBase64Media(p) ? '[COMPACTED_PHOTO]' : p);
  }
  if (isBase64Media(copy.photoData)) {
    copy.photoData = '[PHOTO_PRUNED]';
  }
  if (isBase64Media(copy.photoEvidence)) {
    copy.photoEvidence = (copy.photo?.dataUrl || copy.photoData) ? '[SEE_PHOTO_DATA]' : '[PHOTO_PRUNED]';
  } else if (copy.photoEvidence && typeof copy.photoEvidence === 'object' && isBase64Media(copy.photoEvidence.image)) {
    copy.photoEvidence = { ...copy.photoEvidence, image: '[PHOTO_PRUNED]' };
  }
  if (copy.photo && typeof copy.photo === 'object') {
    let pCopy = null;
    if (isBase64Media(copy.photo.dataUrl)) {
      pCopy = { ...(pCopy || copy.photo), dataUrl: '[PHOTO_PRUNED]' };
    }
    if (isBase64Media(copy.photo.image)) {
      pCopy = { ...(pCopy || copy.photo), image: '[PHOTO_PRUNED]' };
    }
    if (pCopy) copy.photo = pCopy;
  }
  if (isBase64Media(copy.image)) {
    copy.image = '[PHOTO_PRUNED]';
  }
  if (typeof copy.signatureDataUrl === 'string' && copy.signatureDataUrl.startsWith('data:image/') && copy.signatureDataUrl.length > 5000) {
    copy.signatureDataUrl = '[SIGNATURE_PRUNED]';
  }
  return copy;
}

function sanitizeLargeMedia(data, keepRecentCount = 3) {
  if (!data) return data;
  if (Array.isArray(data)) {
    return data.map((item, idx) => {
      // Keep recent items intact
      if (idx >= data.length - keepRecentCount) {
        return item;
      }
      return sanitizeItemMedia(item);
    });
  }
  if (typeof data === 'object') {
    return sanitizeItemMedia(data);
  }
  return data;
}

function pruneStorageQuota(aggressive = false) {
  if (typeof localStorage === 'undefined') return;
  try {
    const keepCount = aggressive ? 1 : 3;
    const minLengthThreshold = aggressive ? 20000 : 50000;

    // Scan all keys starting with PREFIX
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (!fullKey || !fullKey.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(fullKey);
      if (!raw || raw.length < minLengthThreshold) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const compacted = parsed.map((item, idx) => {
            if (idx >= parsed.length - keepCount) return item;
            return sanitizeItemMedia(item);
          });
          const newRaw = JSON.stringify(compacted);
          if (newRaw.length < raw.length) {
            localStorage.setItem(fullKey, newRaw);
          }
        } else if (typeof parsed === 'object' && parsed !== null) {
          const compacted = sanitizeItemMedia(parsed);
          const newRaw = JSON.stringify(compacted);
          if (newRaw.length < raw.length) {
            localStorage.setItem(fullKey, newRaw);
          }
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
        pruneStorageQuota(false);
        const sanitized = sanitizeLargeMedia(value, 3);
        try {
          localStorage.setItem(fullKey, JSON.stringify(sanitized));
          notifyChange(sanitized);
          return;
        } catch (err2) {
          if (isQuotaError(err2)) {
            console.warn(`[storage] LocalStorage still exceeded. Running aggressive compaction for "${key}"...`);
            pruneStorageQuota(true);
            const deeplySanitized = sanitizeLargeMedia(value, 1);
            try {
              localStorage.setItem(fullKey, JSON.stringify(deeplySanitized));
              notifyChange(deeplySanitized);
              return;
            } catch (err3) {
              console.error(`[storage] Critical quota exceeded on "${key}":`, err3?.message || err3);
              throw new Error(`Kapasitas penyimpanan perangkat penuh. Tidak dapat menyimpan "${key}".`);
            }
          }
          throw err2;
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
