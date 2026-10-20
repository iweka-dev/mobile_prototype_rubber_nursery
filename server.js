/**
 * server.js — Server Backend Dinamis Sigma Nursery
 * Menyajikan REST API untuk Catatan Perbaikan / Review & Feedback, Database,
 * Notifikasi Email, serta Frontend Progressive Web App (PWA).
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  initDB,
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getStats
} from './server/db.js';
import { sendNewNoteNotification, sendStatusUpdateNotification, sendTestEmail } from './server/mailer.js';
import {
  readData as pmReadData,
  getRequirements,
  getRequirementById,
  createRequirement as pmCreateRequirement,
  updateRequirement as pmUpdateRequirement,
  archiveRequirement as pmArchiveRequirement,
  restoreRequirement as pmRestoreRequirement,
  getFlows,
  getFlowById,
  upsertFlowNode,
  upsertFlowEdge,
  getBusinessRules,
  getBusinessRuleById,
  createBusinessRule as pmCreateBusinessRule,
  updateBusinessRule as pmUpdateBusinessRule,
  getMappings,
  createMapping as pmCreateMapping,
  deleteMapping as pmDeleteMapping,
  getAuditLogs
} from './server/process-mapping-db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Inisialisasi DB
initDB();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request Logger sederhana
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.path} - ${new Date().toLocaleTimeString('id-ID')}`);
  }
  next();
});

// Menyajikan file statis PWA (HTML, CSS, JS, Assets, Manifest, SW) dengan no-cache
app.use(express.static(__dirname, {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

/* -------------------------------------------------------------
 * API ROUTES: CATATAN PERBAIKAN & REVIEW FEEDBACK
 * ------------------------------------------------------------- */

/**
 * GET /api/notes — Mengambil seluruh daftar catatan perbaikan beserta statistik
 */
app.get('/api/notes', (req, res) => {
  try {
    const notes = getAllNotes();
    const stats = getStats();
    res.json({
      success: true,
      total: notes.length,
      stats,
      data: notes
    });
  } catch (err) {
    console.error('[API Error] Gagal mengambil notes:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data catatan' });
  }
});

/**
 * GET /api/notes/:id — Mengambil detail satu catatan
 */
app.get('/api/notes/:id', (req, res) => {
  try {
    const note = getNoteById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, error: 'Catatan tidak ditemukan' });
    }
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notes — Menambahkan catatan perbaikan baru & mengirim notifikasi email
 */
app.post('/api/notes', async (req, res) => {
  try {
    const { author, creatorRole, email, page, pageTitle, description, status, marker } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, error: 'Deskripsi catatan perbaikan wajib diisi' });
    }

    // 1. Simpan ke database
    const newNote = createNote({
      author: author ? author.trim() : 'Customer',
      creatorRole: creatorRole ? creatorRole.trim() : 'Customer / User Field',
      email: email ? email.trim() : '',
      page: page || '/home',
      pageTitle: pageTitle || 'Halaman',
      description: description.trim(),
      status: status || 'Baru',
      marker: marker || { x: 50.0, y: 40.0 }
    });

    console.log(`[API] Catatan baru #${newNote.number} berhasil disimpan oleh ${newNote.author}`);

    // 2. Kirim notifikasi email — kegagalan tidak memblokir penyimpanan catatan
    let emailResult = { sent: false, simulated: false };
    try {
      emailResult = await sendNewNoteNotification(newNote);
      if (emailResult.simulated) {
        console.warn('[API] Email tidak dikirim: SMTP belum dikonfigurasi di environment server. Periksa .env di VPS.');
      } else if (!emailResult.sent) {
        console.warn('[API] Email gagal dikirim:', emailResult.error || 'Alasan tidak diketahui');
      }
    } catch (mailErr) {
      console.warn('[API] Peringatan: Gagal mengirim email notifikasi:', mailErr);
      emailResult = { sent: false, simulated: false, error: mailErr.message };
    }

    // Pisahkan status penyimpanan catatan dari status pengiriman email
    const emailSent = Boolean(emailResult.sent && !emailResult.simulated);

    res.status(201).json({
      success: true,
      noteSaved: true,
      emailSent,
      message: emailSent
        ? 'Catatan perbaikan berhasil disimpan & notifikasi email terkirim!'
        : 'Catatan perbaikan berhasil disimpan. Notifikasi email tidak terkirim — periksa konfigurasi SMTP di server.',
      data: newNote,
      emailStatus: emailResult
    });
  } catch (err) {
    console.error('[API Error] Gagal menyimpan catatan:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat menyimpan catatan' });
  }
});

/**
 * PATCH /api/notes/:id — Memperbarui status atau data catatan
 */
app.patch('/api/notes/:id', async (req, res) => {
  try {
    const currentNote = getNoteById(req.params.id);
    if (!currentNote) {
      return res.status(404).json({ success: false, error: 'Catatan tidak ditemukan' });
    }

    const oldStatus = currentNote.status;
    const isStatusChanged = req.body.status && req.body.status !== oldStatus;

    const updated = updateNote(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Gagal memperbarui catatan' });
    }

    // Email hanya dikirim saat status berubah
    let emailResult = null;
    let emailSent = null; // null = tidak dicoba (bukan error)
    if (isStatusChanged) {
      console.log(`[API] Status Catatan #${updated.number} berubah: ${oldStatus} -> ${updated.status}`);
      try {
        emailResult = await sendStatusUpdateNotification(updated, oldStatus, updated.status);
        if (emailResult.simulated) {
          console.warn('[API] Email status tidak dikirim: SMTP belum dikonfigurasi di environment server.');
        } else if (!emailResult.sent) {
          console.warn('[API] Email status gagal dikirim:', emailResult.error || 'Alasan tidak diketahui');
        }
      } catch (mailErr) {
        console.warn('[API] Peringatan: Gagal mengirim email pembaruan status:', mailErr);
        emailResult = { sent: false, simulated: false, error: mailErr.message };
      }
      emailSent = Boolean(emailResult?.sent && !emailResult?.simulated);
    }

    res.json({
      success: true,
      noteSaved: true,
      emailSent,
      message: isStatusChanged
        ? (emailSent
            ? `Status catatan diperbarui & email notifikasi terkirim!`
            : `Status catatan diperbarui. Email notifikasi tidak terkirim.`)
        : 'Catatan berhasil diperbarui',
      data: updated,
      emailStatus: emailResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/notes/:id — Menghapus catatan perbaikan
 */
app.delete('/api/notes/:id', (req, res) => {
  try {
    const deleted = deleteNote(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Catatan tidak ditemukan' });
    }
    console.log(`[API] Catatan ${req.params.id} berhasil dihapus`);
    res.json({
      success: true,
      message: 'Catatan berhasil dihapus'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notes/test-email — Endpoint pengujian email notifikasi
 */
app.post('/api/notes/test-email', async (req, res) => {
  try {
    const targetEmail = req.body?.email;
    const result = await sendTestEmail(targetEmail);
    res.json({
      success: true,
      message: 'Pengujian email selesai dijalankan',
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/health — Endpoint status server
 * Mengembalikan status konfigurasi secara aman tanpa mengekspos secret.
 */
app.get('/api/health', (req, res) => {
  const smtpConfigured = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_USER !== 'your-email@gmail.com'
  );
  const adminEmailRaw = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || '';
  // Masking: hanya tampilkan domain, bukan alamat penuh
  const adminEmailMasked = adminEmailRaw.includes('@')
    ? `***@${adminEmailRaw.split('@')[1]}`
    : '(Belum diset)';

  // Cek database terjangkau
  let databaseOk = false;
  try {
    const notes = getAllNotes();
    databaseOk = Array.isArray(notes);
  } catch (_) {
    databaseOk = false;
  }

  res.json({
    status: 'online',
    appName: 'Sigma Nursery PWA Backend',
    uptime: `${Math.floor(process.uptime())} detik`,
    smtpConfigured,
    emailConfigured: smtpConfigured,
    adminEmail: adminEmailMasked,
    databaseConnected: databaseOk,
    database: databaseOk ? 'JSON Persistent Store OK' : 'JSON Store ERROR',
    timestamp: new Date().toISOString()
  });
});


/* =============================================================================
 * API ROUTES: PROCESS MAPPING CRUD
 * Isolated namespace: /api/process-mapping/*
 * These routes do NOT interfere with /api/notes or any mobile prototype.
 * ============================================================================= */

// ---------- FULL DATA READ ----------

app.get('/api/process-mapping/data', (req, res) => {
  try {
    const data = pmReadData();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[PM-API] GET /data error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- REQUIREMENTS ----------

app.get('/api/process-mapping/requirements', (req, res) => {
  try {
    const filters = {
      moduleId: req.query.moduleId || undefined,
      role: req.query.role || undefined,
      status: req.query.status || undefined,
      search: req.query.search || undefined,
      includeArchived: req.query.includeArchived === 'true'
    };
    const reqs = getRequirements(filters);
    res.json({ success: true, total: reqs.length, data: reqs });
  } catch (err) {
    console.error('[PM-API] GET /requirements error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/process-mapping/requirements/:id', (req, res) => {
  try {
    const requirement = getRequirementById(req.params.id);
    if (!requirement) {
      return res.status(404).json({ success: false, error: `Requirement ${req.params.id} not found` });
    }
    res.json({ success: true, data: requirement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/process-mapping/requirements', (req, res) => {
  try {
    const { requirement, actor, reason } = req.body;
    if (!requirement || !requirement.id) {
      return res.status(400).json({ success: false, error: 'Request body must include requirement object with id' });
    }
    const created = pmCreateRequirement(requirement, actor || 'local-user', reason || '');
    res.status(201).json({ success: true, message: 'Requirement created', data: created });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('Duplicate') ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.put('/api/process-mapping/requirements/:id', (req, res) => {
  try {
    const { updates, actor, reason } = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must include updates object' });
    }
    const updated = pmUpdateRequirement(req.params.id, updates, actor || 'local-user', reason || '');
    res.json({ success: true, message: 'Requirement updated', data: updated });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.patch('/api/process-mapping/requirements/:id/archive', (req, res) => {
  try {
    const { actor, reason } = req.body || {};
    const archived = pmArchiveRequirement(req.params.id, actor || 'local-user', reason || '');
    res.json({ success: true, message: 'Requirement archived', data: archived });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : err.message.includes('already archived') ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.patch('/api/process-mapping/requirements/:id/restore', (req, res) => {
  try {
    const { actor, reason } = req.body || {};
    const restored = pmRestoreRequirement(req.params.id, actor || 'local-user', reason || '');
    res.json({ success: true, message: 'Requirement restored', data: restored });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : err.message.includes('not archived') ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ---------- FLOWS ----------

app.get('/api/process-mapping/flows', (req, res) => {
  try {
    const flows = getFlows();
    res.json({ success: true, data: flows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/process-mapping/flows/:moduleId/:featureId', (req, res) => {
  try {
    const flow = getFlowById(`${req.params.moduleId}/${req.params.featureId}`);
    if (!flow) {
      return res.status(404).json({ success: false, error: `Flow ${req.params.moduleId}/${req.params.featureId} not found` });
    }
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/process-mapping/flows', (req, res) => {
  try {
    const { moduleId, featureId, node, edge, actor, reason } = req.body;
    if (!moduleId || !featureId) {
      return res.status(400).json({ success: false, error: 'moduleId and featureId are required' });
    }
    if (node) {
      if (!node.id) return res.status(400).json({ success: false, error: 'node.id is required' });
      const result = upsertFlowNode(moduleId, featureId, node, actor || 'local-user', reason || '');
      return res.status(201).json({ success: true, message: 'Flow node created/updated', data: result });
    }
    if (edge) {
      const result = upsertFlowEdge(moduleId, featureId, edge, actor || 'local-user', reason || '');
      return res.status(201).json({ success: true, message: 'Flow edge created/updated', data: result });
    }
    return res.status(400).json({ success: false, error: 'Request body must include either node or edge object' });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('Duplicate') ? 409
      : err.message.includes('not found') ? 404
      : err.message.includes('Self-loop') ? 400
      : err.message.includes('Broken edge') ? 400
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.put('/api/process-mapping/flows/:moduleId/:featureId', (req, res) => {
  try {
    const { node, edge, actor, reason } = req.body;
    const { moduleId, featureId } = req.params;
    if (node) {
      if (!node.id) return res.status(400).json({ success: false, error: 'node.id is required' });
      const result = upsertFlowNode(moduleId, featureId, node, actor || 'local-user', reason || '');
      return res.json({ success: true, message: 'Flow node updated', data: result });
    }
    if (edge) {
      if (!edge.id) return res.status(400).json({ success: false, error: 'edge.id is required for update' });
      const result = upsertFlowEdge(moduleId, featureId, edge, actor || 'local-user', reason || '');
      return res.json({ success: true, message: 'Flow edge updated', data: result });
    }
    return res.status(400).json({ success: false, error: 'Request body must include either node or edge object' });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ---------- BUSINESS RULES ----------

app.get('/api/process-mapping/rules', (req, res) => {
  try {
    const rules = getBusinessRules();
    res.json({ success: true, total: rules.length, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/process-mapping/rules/:id', (req, res) => {
  try {
    const rule = getBusinessRuleById(req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, error: `Business Rule ${req.params.id} not found` });
    }
    res.json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/process-mapping/rules', (req, res) => {
  try {
    const { rule, actor, reason } = req.body;
    if (!rule || !(rule.id || rule.code)) {
      return res.status(400).json({ success: false, error: 'Request body must include rule object with id' });
    }
    const created = pmCreateBusinessRule(rule, actor || 'local-user', reason || '');
    res.status(201).json({ success: true, message: 'Business Rule created', data: created });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('Duplicate') ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.put('/api/process-mapping/rules/:id', (req, res) => {
  try {
    const { updates, actor, reason } = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must include updates object' });
    }
    const updated = pmUpdateBusinessRule(req.params.id, updates, actor || 'local-user', reason || '');
    res.json({ success: true, message: 'Business Rule updated', data: updated });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ---------- MAPPINGS ----------

app.get('/api/process-mapping/mappings', (req, res) => {
  try {
    const mappings = getMappings();
    res.json({ success: true, total: mappings.length, data: mappings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/process-mapping/mappings', (req, res) => {
  try {
    const { mapping, actor, reason } = req.body;
    if (!mapping) {
      return res.status(400).json({ success: false, error: 'Request body must include mapping object' });
    }
    const created = pmCreateMapping(mapping, actor || 'local-user', reason || '');
    res.status(201).json({ success: true, message: 'Mapping created', data: created });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('already exists') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

app.delete('/api/process-mapping/mappings/:id', (req, res) => {
  try {
    const { sourceEntity, sourceId, targetEntity, targetId, moduleId, featureId, actor, reason } = req.body || {};
    if (!sourceEntity || !sourceId || !targetEntity || !targetId) {
      return res.status(400).json({ success: false, error: 'Request body must include sourceEntity, sourceId, targetEntity, targetId' });
    }
    pmDeleteMapping(req.params.id, { sourceEntity, sourceId, targetEntity, targetId, moduleId, featureId }, actor || 'local-user', reason || '');
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (err) {
    const status = err.message.includes('WRITE_LOCK_BUSY') ? 409
      : err.message.includes('not found') ? 404
      : err.message.includes('does not exist') ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ---------- AUDIT LOGS ----------

app.get('/api/process-mapping/audit-logs', (req, res) => {
  try {
    const filters = {
      entity: req.query.entity || undefined,
      entityId: req.query.entityId || undefined,
      action: req.query.action || undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 100
    };
    const logs = getAuditLogs(filters);
    res.json({ success: true, total: logs.length, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback untuk semua rute frontend PWA (SPA fallback)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  next();
});

// Start Server
app.listen(PORT, () => {
  console.log('========================================================');
  console.log(`🌿 SIGMA NURSERY BACKEND SERVER BERJALAN`);
  console.log(`📡 URL Lokal      : http://localhost:${PORT}`);
  console.log(`📁 Database       : data/notes.json`);
  console.log(`📧 Notifikasi Email: ${process.env.ADMIN_NOTIFICATION_EMAIL || '(Atur di .env)'}`);
  console.log('========================================================');
});
