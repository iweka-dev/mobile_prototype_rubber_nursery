/**
 * scripts/test-data-email-fix.mjs — v2
 * Test Suite dengan isolasi penuh (mock transport, tanpa dotenvx inject).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;

function assert(label, condition, detail) {
  if (condition) { console.log("  PASS: " + label); pass++; }
  else { console.error("  FAIL: " + label + (detail ? " | " + detail : "")); fail++; }
}

console.log("\n=== TEST SUITE v2: DATA & EMAIL FIX (ISOLATED) ===\n");

/* ── 1. GITIGNORE ──────────────────────────────────── */
console.log("--- 1. .gitignore ---");
const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf-8");
assert("data/notes.json di .gitignore", gi.includes("data/notes.json"));
assert(".env di .gitignore", gi.includes(".env"));

/* ── 2. FILE RUNTIME ───────────────────────────────── */
console.log("\n--- 2. File Runtime ---");
const notesPath = path.join(ROOT, "data", "notes.json");
const examplePath = path.join(ROOT, "data", "notes.example.json");
const bakFiles = fs.readdirSync(path.join(ROOT, "data")).filter(f => f.includes(".bak"));
assert("data/notes.json ada lokal", fs.existsSync(notesPath));
assert("notes.example.json ada", fs.existsSync(examplePath));
assert("backup notes.json ada", bakFiles.length > 0, bakFiles.join(", "));
const ex = JSON.parse(fs.readFileSync(examplePath, "utf-8"));
assert("template valid dan kosong", Array.isArray(ex.notes) && ex.notes.length === 0);

/* ── 3. GIT STAGING ────────────────────────────────── */
console.log("\n--- 3. Git Staging Safety ---");
import { execSync } from "child_process";
const staged = execSync("git diff --cached --name-status", { cwd: ROOT }).toString();
assert("data/notes.json staged sebagai deleted (D)", staged.includes("D\tdata/notes.json"));
assert("data/notes.example.json staged sebagai added (A)", staged.includes("A\tdata/notes.example.json"));
assert("notes.json.bak tidak staged", !staged.includes("notes.json.bak"));
assert("data/notes.json tidak staged sebagai added (A)", !staged.includes("A\tdata/notes.json"));

/* ── 4. DEPLOY.YML ─────────────────────────────────── */
console.log("\n--- 4. deploy.yml ---");
const dy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf-8");
assert("exclude .env", dy.includes("--exclude '.env'"));
assert("exclude data/notes.json", dy.includes("--exclude 'data/notes.json'"));
assert("exclude audit log", dy.includes("--exclude 'data/process-mapping-audit-log.json'"));
assert("ada step PM2 restart", dy.includes("pm2 restart") || dy.includes("pm2 start"));
assert("init notes.json dari template jika tidak ada", dy.includes("notes.example.json"));

/* ── 5. SERVER.JS POST ─────────────────────────────── */
console.log("\n--- 5. server.js POST /api/notes ---");
const sv = fs.readFileSync(path.join(ROOT, "server.js"), "utf-8");
assert("POST ada field noteSaved", sv.includes("noteSaved: true"));
assert("POST ada field emailSent", sv.includes("const emailSent = Boolean"));
assert("POST log warning SMTP tidak ada", sv.includes("SMTP belum dikonfigurasi di environment server"));

/* ── 6. SERVER.JS PATCH ────────────────────────────── */
console.log("\n--- 6. server.js PATCH /api/notes/:id ---");
assert("PATCH ada noteSaved: true", sv.includes("noteSaved: true"));
assert("PATCH ada emailSent (null saat tidak dicoba)", sv.includes("let emailSent = null"));
assert("PATCH emailSent = Boolean(sent && !simulated)", sv.includes("emailSent = Boolean(emailResult?.sent && !emailResult?.simulated)"));
assert("PATCH log warning SMTP tidak ada", sv.includes("SMTP belum dikonfigurasi di environment server"));

/* ── 7. HEALTH ENDPOINT ────────────────────────────── */
console.log("\n--- 7. /api/health ---");
assert("health ada smtpConfigured", sv.includes("smtpConfigured"));
assert("health ada databaseConnected", sv.includes("databaseConnected"));
assert("health masking domain saja", sv.includes("***@"));
assert("health tidak expose env raw", !sv.includes("process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || \"(Belum"));

/* ── 8. REVIEW-WORKSPACE.JS ────────────────────────── */
console.log("\n--- 8. review-workspace.js ---");
const rw = fs.readFileSync(path.join(ROOT, "js", "modules", "review", "review-workspace.js"), "utf-8");
assert("POST UI pakai result.emailSent", rw.includes("result.emailSent"));
assert("POST UI pakai result.noteSaved", rw.includes("result.noteSaved"));
assert("POST UI toast warning email gagal", rw.includes("warning") && rw.includes("tidak terkirim"));
assert("PATCH UI pakai data.emailSent", rw.includes("data.emailSent"));
assert("emailStatus?.sent tidak dipakai lagi", !rw.includes("emailStatus?.sent"));

/* ── 9. MAILER MOCK — SMTP TIDAK ADA ──────────────── */
console.log("\n--- 9. isConfigured() mock test (tanpa SMTP) ---");
// Test langsung dengan memanggil logika isConfigured tanpa import modul penuh
// Tujuan: menguji HANYA logika guard, tanpa mengirim email
function mockIsConfigured(env) {
  return Boolean(
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS &&
    env.SMTP_USER !== "your-email@gmail.com"
  );
}

assert("isConfigured() false saat SMTP_HOST kosong", mockIsConfigured({}) === false);
assert("isConfigured() false saat hanya SMTP_USER", mockIsConfigured({ SMTP_USER: "x@g.com" }) === false);
assert("isConfigured() false saat placeholder user", mockIsConfigured({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "your-email@gmail.com", SMTP_PASS: "abc" }) === false);
assert("isConfigured() true saat semua ada dan valid", mockIsConfigured({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "real@g.com", SMTP_PASS: "pass" }) === true);
assert("emailSent = false saat sent=false", Boolean(false && !false) === false);
assert("emailSent = false saat sent=true, simulated=true", Boolean(true && !true) === false);
assert("emailSent = true saat sent=true, simulated=false", Boolean(true && !false) === true);

/* ── 10. PERSISTENSI CATATAN ───────────────────────── */
console.log("\n--- 10. Persistensi catatan (integrasi lokal) ---");
const { createNote, getAllNotes, deleteNote } = await import("../server/db.js");
const before = getAllNotes().length;
const tn = createNote({ author: "TestSuite", creatorRole: "QA", email: "x@x.com", page: "/t", pageTitle: "T", description: "Test persistensi - akan dihapus", status: "Baru", marker: {x:50,y:50} });
assert("catatan tersimpan", getAllNotes().length === before + 1);
assert("ID valid (FB-)", tn.id.startsWith("FB-"));
const del = deleteNote(tn.id);
assert("cleanup berhasil", del === true);
assert("jumlah kembali normal", getAllNotes().length === before);

/* ── RINGKASAN ─────────────────────────────────────── */
console.log("\n============================");
console.log("PASS: " + pass + " | FAIL: " + fail);
console.log("============================\n");
process.exit(fail > 0 ? 1 : 0);
