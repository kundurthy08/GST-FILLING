import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { getDb, hashPassword, verifyPassword, logAuditEvent, BACKUPS_DIR, UPLOADS_DIR, EXPORTS_DIR, DB_PATH, DATA_ROOT } from './server/db.ts';
import { validateGstin, INDIAN_STATES } from './server/engines/gstUtils.ts';
import { loadSyntheticPilotData, removeSyntheticPilotData } from './server/engines/pilotFixtures.ts';
import { inspectUploadedFile, commitRegisterImport } from './server/engines/importEngine.ts';
import {
  runSalesVerification,
  runGstr2bReconciliation,
  prepareGstr1Return,
  prepareGstr3bReturn,
  runMandatoryCrossVerification,
} from './server/engines/complianceEngine.ts';
import {
  REPORT_CATALOG,
  generateExportArtifact,
  createBackupArchive,
  previewBackupArchive,
  restoreBackupArchive,
} from './server/engines/exportAndBackupEngine.ts';

const PORT = 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

interface SessionPayload {
  userId: number;
  username: string;
  roleCode: string;
  fullName: string;
  exp: number;
}

function signToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as SessionPayload;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('gst_session', token, {
    httpOnly: true,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: isHttps ? 'none' : 'lax',
    secure: Boolean(isHttps),
  });
}

function getAuthenticatedUser(req: express.Request): (SessionPayload & { permissions: any }) | null {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookieToken = parseCookie(req.headers.cookie, 'gst_session');
  const token = bearerToken || cookieToken;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role_code, r.role_name, u.is_active,
              r.can_import, r.can_prepare, r.can_review, r.can_approve, r.can_export, r.can_admin
       FROM users u JOIN user_roles r ON r.role_code = u.role_code
       WHERE u.id = ? AND u.is_active = 1`
    )
    .get(payload.userId) as any;
  if (!user) return null;
  return {
    ...payload,
    permissions: user,
  };
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  (req as any).user = user;
  next();
}

function requirePerm(perm: 'can_import' | 'can_prepare' | 'can_review' | 'can_approve' | 'can_export' | 'can_admin') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user?.permissions?.[perm]) {
      res.status(403).json({ error: `Access denied: role '${user?.roleCode}' does not hold '${perm}' privilege.` });
      return;
    }
    next();
  };
}

async function startServer() {
  getDb(); // Initialize SQLite schema & migrations on startup
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // --- Auth & First-Run Bootstrap ---
  app.get('/api/auth/status', (_req, res) => {
    const db = getDb();
    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const companyCount = (db.prepare('SELECT COUNT(*) as c FROM companies').get() as { c: number }).c;
    const pilotRow = db.prepare("SELECT id FROM companies WHERE pan = 'AAACP4829K'").get();
    res.json({
      needsBootstrap: userCount === 0,
      hasCompany: companyCount > 0,
      hasPilotData: Boolean(pilotRow),
      dataRoot: DATA_ROOT,
      envPasscodeConfigured: Boolean(process.env.PCIL_ADMIN_PASSCODE),
    });
  });

  app.post('/api/auth/bootstrap', (req, res) => {
    const db = getDb();
    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    if (userCount > 0) {
      res.status(409).json({ error: 'Administrator account already exists. Please sign in.' });
      return;
    }
    const { organizationName, pan, industry, username, fullName, password, email, loadPilot } = req.body || {};
    if (!organizationName || !pan || String(pan).trim().length !== 10) {
      res.status(400).json({ error: 'Organization Legal Name and a 10-character PAN are required.' });
      return;
    }
    if (!username || !fullName || !password || String(password).length < 6) {
      res.status(400).json({ error: 'Username, full name, and a password of at least 6 characters are required.' });
      return;
    }

    const adminHash = hashPassword(String(password));
    const result = db
      .prepare(
        `INSERT INTO users (username, full_name, email, password_hash, role_code, allowed_gstin_ids)
         VALUES (?, ?, ?, ?, 'ADMIN', 'ALL')`
      )
      .run(String(username).trim(), String(fullName).trim(), email ? String(email).trim() : null, adminHash);
    const userId = Number(result.lastInsertRowid);

    db.prepare(
      `INSERT INTO companies (legal_name, trade_name, pan, industry)
       VALUES (?, ?, ?, ?)`
    ).run(
      String(organizationName).trim(),
      String(organizationName).trim(),
      String(pan).trim().toUpperCase(),
      industry ? String(industry).trim() : 'General Business'
    );

    logAuditEvent(userId, String(username).trim(), 'BOOTSTRAP_ADMIN', 'users', userId, null, {
      role: 'ADMIN',
      organizationName: String(organizationName).trim(),
    });

    if (loadPilot) {
      loadSyntheticPilotData(userId, String(username).trim());
    }

    const token = signToken({
      userId,
      username: String(username).trim(),
      roleCode: 'ADMIN',
      fullName: String(fullName).trim(),
      exp: Date.now() + 8 * 60 * 60 * 1000,
    });

    const userRow = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role_code, r.role_name, r.can_import, r.can_prepare, r.can_review, r.can_approve, r.can_export, r.can_admin
         FROM users u JOIN user_roles r ON r.role_code = u.role_code WHERE u.id = ?`
      )
      .get(userId);

    setSessionCookie(req, res, token);
    res.json({ token, user: userRow });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const db = getDb();
    const user = db
      .prepare(
        `SELECT u.*, r.role_name, r.can_import, r.can_prepare, r.can_review, r.can_approve, r.can_export, r.can_admin
         FROM users u JOIN user_roles r ON r.role_code = u.role_code
         WHERE u.username = ? AND u.is_active = 1`
      )
      .get(String(username).trim()) as any;

    const envPasscode = process.env.PCIL_ADMIN_PASSCODE;
    const isEnvAdminLogin = Boolean(envPasscode && user?.role_code === 'ADMIN' && password === envPasscode);

    if (!user || (!isEnvAdminLogin && !verifyPassword(String(password), user.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials or inactive account.' });
      return;
    }

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    logAuditEvent(user.id, user.username, 'USER_LOGIN', 'users', user.id);

    const token = signToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role_code,
      fullName: user.full_name,
      exp: Date.now() + 8 * 60 * 60 * 1000,
    });

    const { password_hash: _omit, ...safeUser } = user;
    setSessionCookie(req, res, token);
    res.json({ token, user: safeUser });
  });

  app.post('/api/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('gst_session', {
      path: '/',
      sameSite: isHttps ? 'none' : 'lax',
      secure: Boolean(isHttps),
    });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: (req as any).user.permissions });
  });

  // --- Context & Pilot Fixture Loader ---
  app.get('/api/context', requireAuth, (_req, res) => {
    const db = getDb();
    const companies = db.prepare('SELECT * FROM companies ORDER BY id').all();
    const gstins = db.prepare('SELECT * FROM gst_registrations ORDER BY state_code, gstin').all();
    const branches = db.prepare('SELECT * FROM branches ORDER BY id').all();
    const returnPeriods = db.prepare('SELECT * FROM return_periods ORDER BY return_period DESC').all();
    res.json({ companies, gstins, branches, returnPeriods, indianStates: INDIAN_STATES });
  });

  app.post('/api/pilot/load', requireAuth, requirePerm('can_admin'), (req, res) => {
    const u = (req as any).user;
    const result = loadSyntheticPilotData(u.userId, u.username);
    res.json(result);
  });

  app.post('/api/pilot/remove', requireAuth, requirePerm('can_admin'), (req, res) => {
    const u = (req as any).user;
    const result = removeSyntheticPilotData(u.userId, u.username);
    res.json(result);
  });

  // --- Dashboard Metrics (All 24 KPIs + GSTIN Filing Status + Monthly Trends) ---
  app.get('/api/dashboard', requireAuth, (req, res) => {
    const db = getDb();
    const gstinIdParam = req.query.gstinId ? Number(req.query.gstinId) : null;
    const period = req.query.period ? String(req.query.period) : '102026';

    const whereGstin = gstinIdParam ? 'AND gst_registration_id = ?' : '';
    const args = gstinIdParam ? [period, gstinIdParam] : [period];

    const salesAgg = db
      .prepare(
        `SELECT COUNT(*) as count,
                COALESCE(SUM(source_taxable_paise), 0) as taxable,
                COALESCE(SUM(source_igst_paise), 0) as igst,
                COALESCE(SUM(source_cgst_paise), 0) as cgst,
                COALESCE(SUM(source_sgst_paise), 0) as sgst,
                COALESCE(SUM(source_cess_paise), 0) as cess
         FROM sales_invoices WHERE return_period = ? AND is_cancelled = 0 ${whereGstin}`
      )
      .get(...args) as any;

    const purAgg = db
      .prepare(
        `SELECT COUNT(*) as count,
                COALESCE(SUM(source_taxable_paise), 0) as taxable,
                COALESCE(SUM(source_igst_paise + source_cgst_paise + source_sgst_paise + source_cess_paise), 0) as tax
         FROM purchase_invoices WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const g2bStats = db
      .prepare(
        `SELECT
           SUM(CASE WHEN match_status LIKE '%Matched%' THEN 1 ELSE 0 END) as matched,
           SUM(CASE WHEN match_status NOT LIKE '%Matched%' THEN 1 ELSE 0 END) as unmatched
         FROM gstr2b_records WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const itcAgg = db
      .prepare(
        `SELECT
           COALESCE(SUM(igst_paise + cgst_paise + sgst_paise + cess_paise), 0) as total_avail,
           COALESCE(SUM(CASE WHEN eligibility_status IN ('Eligible', 'Reclaimed') THEN igst_paise + cgst_paise + sgst_paise + cess_paise ELSE 0 END), 0) as eligible,
           COALESCE(SUM(CASE WHEN eligibility_status IN ('Ineligible', 'Blocked Sec 17(5)', 'Pending Verification') THEN igst_paise + cgst_paise + sgst_paise + cess_paise ELSE 0 END), 0) as ineligible
         FROM itc_register WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const revAgg = db
      .prepare(
        `SELECT COALESCE(SUM(igst_paise + cgst_paise + sgst_paise + cess_paise), 0) as reversed
         FROM itc_reversals WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const recAgg = db
      .prepare(
        `SELECT COALESCE(SUM(igst_paise + cgst_paise + sgst_paise + cess_paise), 0) as reclaimed
         FROM itc_reclaims WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const rcmAgg = db
      .prepare(
        `SELECT COALESCE(SUM(igst_liability_paise + cgst_liability_paise + sgst_liability_paise), 0) as rcm_liability
         FROM rcm_register WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const excAgg = db
      .prepare(
        `SELECT
           SUM(CASE WHEN severity = 'Critical' AND status NOT IN ('Resolved', 'Approved explanation') THEN 1 ELSE 0 END) as critical_open,
           COUNT(*) as total_exceptions
         FROM audit_exceptions WHERE return_period = ? ${whereGstin}`
      )
      .get(...args) as any;

    const totalOutputGst = salesAgg.igst + salesAgg.cgst + salesAgg.sgst + salesAgg.cess;
    const netEligibleItc = Math.max(0, itcAgg.eligible - revAgg.reversed);
    const estCashPayable = Math.max(0, totalOutputGst - netEligibleItc) + rcmAgg.rcm_liability;

    const gstinStatus = db
      .prepare(
        `SELECT g.id, g.gstin, g.state_name, COALESCE(rp.status, 'Not Started') as period_status,
                rp.gstr1_arn, rp.gstr3b_arn,
                (SELECT COUNT(*) FROM sales_invoices s WHERE s.gst_registration_id = g.id AND s.return_period = ?) as sales_count,
                (SELECT COUNT(*) FROM audit_exceptions ae WHERE ae.gst_registration_id = g.id AND ae.return_period = ? AND ae.severity = 'Critical' AND ae.status NOT IN ('Resolved', 'Approved explanation')) as critical_count
         FROM gst_registrations g
         LEFT JOIN return_periods rp ON rp.gst_registration_id = g.id AND rp.return_period = ?`
      )
      .all(period, period, period);

    const pendingApprovals = db
      .prepare(
        `SELECT rp.*, g.gstin, g.state_name FROM return_periods rp
         JOIN gst_registrations g ON g.id = rp.gst_registration_id
         WHERE rp.status IN ('Reconciled', 'Reviewer Approved')`
      )
      .all();

    const monthlyTrends = db
      .prepare(
        `SELECT return_period,
                COALESCE(SUM(source_taxable_paise), 0) as taxable,
                COALESCE(SUM(source_igst_paise + source_cgst_paise + source_sgst_paise + source_cess_paise), 0) as output_tax
         FROM sales_invoices WHERE is_cancelled = 0 ${gstinIdParam ? 'AND gst_registration_id = ?' : ''}
         GROUP BY return_period ORDER BY return_period`
      )
      .all(...(gstinIdParam ? [gstinIdParam] : []));

    res.json({
      kpis: {
        taxableSales: salesAgg.taxable,
        purchaseValue: purAgg.taxable,
        igstLiability: salesAgg.igst,
        cgstLiability: salesAgg.cgst,
        sgstLiability: salesAgg.sgst,
        cessLiability: salesAgg.cess,
        totalOutputGst,
        itcAvailable: itcAgg.total_avail,
        eligibleItc: netEligibleItc,
        ineligibleItc: itcAgg.ineligible,
        itcReversals: revAgg.reversed,
        itcReclaims: recAgg.reclaimed,
        rcmLiability: rcmAgg.rcm_liability,
        estimatedCashPayable: estCashPayable,
        totalSalesInvoices: salesAgg.count,
        totalPurchaseInvoices: purAgg.count,
        matchedInvoices: g2bStats.matched || 0,
        unmatchedInvoices: g2bStats.unmatched || 0,
        duplicateInvoices: 0,
        criticalExceptions: excAgg.critical_open || 0,
        totalExceptions: excAgg.total_exceptions || 0,
        pendingApprovals: pendingApprovals.length,
      },
      gstinStatus,
      pendingApprovals,
      monthlyTrends,
    });
  });

  // --- Masters CRUD ---
  app.get('/api/masters/:type', requireAuth, (req, res) => {
    const db = getDb();
    const { type } = req.params;
    const queries: Record<string, string> = {
      companies: 'SELECT * FROM companies ORDER BY id',
      gstins: 'SELECT g.*, c.legal_name as company_name FROM gst_registrations g JOIN companies c ON c.id = g.company_id ORDER BY g.state_code',
      branches: 'SELECT b.*, g.gstin, g.state_name FROM branches b JOIN gst_registrations g ON g.id = b.gst_registration_id ORDER BY b.id',
      customers: 'SELECT * FROM customers ORDER BY legal_name',
      suppliers: 'SELECT * FROM suppliers ORDER BY legal_name',
      products: 'SELECT p.*, h.description as hsn_desc FROM products p LEFT JOIN hsn_master h ON h.hsn_code = p.hsn_code ORDER BY p.product_code',
      hsn: 'SELECT * FROM hsn_master ORDER BY hsn_code',
      tax_rates: 'SELECT t.*, h.description as hsn_desc FROM tax_rates t LEFT JOIN hsn_master h ON h.hsn_code = t.hsn_code ORDER BY t.hsn_code, t.effective_from DESC',
      gst_rules: 'SELECT * FROM gst_rules ORDER BY rule_code, version DESC',
    };
    const sql = queries[type];
    if (!sql) {
      res.status(404).json({ error: 'Unknown master type' });
      return;
    }
    res.json({ rows: db.prepare(sql).all() });
  });

  app.post('/api/masters/companies', requireAuth, requirePerm('can_admin'), (req, res) => {
    const { legal_name, trade_name, pan, cin, registered_address } = req.body || {};
    if (!legal_name || !pan) {
      res.status(400).json({ error: 'Legal name and PAN are required.' });
      return;
    }
    const db = getDb();
    const r = db
      .prepare('INSERT INTO companies (legal_name, trade_name, pan, cin, registered_address) VALUES (?, ?, ?, ?, ?)')
      .run(legal_name.trim(), trade_name || null, pan.trim().toUpperCase(), cin || null, registered_address || null);
    res.json({ id: r.lastInsertRowid });
  });

  app.post('/api/masters/gstins', requireAuth, requirePerm('can_admin'), (req, res) => {
    const { company_id, gstin, registration_type, filing_frequency, effective_from } = req.body || {};
    const check = validateGstin(gstin);
    if (!check.valid) {
      res.status(400).json({ error: check.reason });
      return;
    }
    const db = getDb();
    const r = db
      .prepare(
        `INSERT INTO gst_registrations (company_id, gstin, state_code, state_name, registration_type, filing_frequency, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(company_id),
        String(gstin).trim().toUpperCase(),
        check.stateCode,
        check.stateName,
        registration_type || 'Regular',
        filing_frequency || 'Monthly',
        effective_from || '2017-07-01'
      );
    res.json({ id: r.lastInsertRowid, stateCode: check.stateCode, stateName: check.stateName });
  });

  app.post('/api/masters/branches', requireAuth, requirePerm('can_admin'), (req, res) => {
    const { gst_registration_id, branch_code, branch_name, branch_type, state_code, address } = req.body || {};
    const db = getDb();
    const r = db
      .prepare(
        `INSERT INTO branches (gst_registration_id, branch_code, branch_name, branch_type, state_code, address)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(Number(gst_registration_id), branch_code, branch_name, branch_type, state_code, address || null);
    res.json({ id: r.lastInsertRowid });
  });

  app.post('/api/masters/tax_rates', requireAuth, requirePerm('can_admin'), (req, res) => {
    const { hsn_code, igst_pct, effective_from, legal_basis } = req.body || {};
    const igstBps = Math.round(Number(igst_pct) * 100);
    const halfBps = Math.round(igstBps / 2);
    const db = getDb();
    const maxVer = (db.prepare('SELECT COALESCE(MAX(version), 0) as v FROM tax_rates WHERE hsn_code = ?').get(hsn_code) as any).v;
    const r = db
      .prepare(
        `INSERT INTO tax_rates (hsn_code, cgst_bps, sgst_bps, igst_bps, effective_from, legal_basis, version, approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved')`
      )
      .run(hsn_code, halfBps, halfBps, igstBps, effective_from, legal_basis || 'CBIC Rate Notification', maxVer + 1);
    res.json({ id: r.lastInsertRowid });
  });

  // --- Data Import Engine ---
  app.get('/api/import/batches', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = req.query.gstinId ? Number(req.query.gstinId) : null;
    const rows = gstinId
      ? db.prepare('SELECT * FROM import_batches WHERE gst_registration_id = ? ORDER BY id DESC').all(gstinId)
      : db.prepare('SELECT * FROM import_batches ORDER BY id DESC').all();
    const profiles = db.prepare('SELECT * FROM import_mapping_profiles ORDER BY id DESC').all();
    res.json({ batches: rows, profiles });
  });

  app.get('/api/import/sample-template/:registerType', requireAuth, async (req, res) => {
    const { registerType } = req.params;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(registerType);
    if (registerType === 'sales_register') {
      sheet.columns = [
        { header: 'Invoice No', key: 'inv', width: 22 },
        { header: 'Invoice Date', key: 'dt', width: 14 },
        { header: 'Customer GSTIN', key: 'cgstin', width: 18 },
        { header: 'Customer Name', key: 'cname', width: 26 },
        { header: 'Place of Supply', key: 'pos', width: 15 },
        { header: 'HSN Code', key: 'hsn', width: 12 },
        { header: 'Product Description', key: 'desc', width: 26 },
        { header: 'Quantity', key: 'qty', width: 10 },
        { header: 'Basic Value', key: 'basic', width: 14 },
        { header: 'Discount', key: 'disc', width: 12 },
        { header: 'Taxable Value', key: 'taxable', width: 14 },
        { header: 'GST Rate', key: 'rate', width: 10 },
        { header: 'IGST', key: 'igst', width: 12 },
        { header: 'CGST', key: 'cgst', width: 12 },
        { header: 'SGST', key: 'sgst', width: 12 },
      ];
      sheet.addRow({
        inv: 'PCIL/TS/26-27/9001',
        dt: '2026-10-28',
        cgstin: '36AABCU9603R1ZN',
        cname: 'Sample Infra Buyer Ltd',
        pos: '36',
        hsn: '25232910',
        desc: 'OPC 53 Cement',
        qty: 100,
        basic: 500000,
        disc: 0,
        taxable: 500000,
        rate: 28,
        igst: 0,
        cgst: 70000,
        sgst: 70000,
      });
    } else {
      sheet.columns = [
        { header: 'Invoice No', key: 'inv', width: 20 },
        { header: 'Invoice Date', key: 'dt', width: 14 },
        { header: 'Supplier GSTIN', key: 'sgstin', width: 18 },
        { header: 'Supplier Name', key: 'sname', width: 26 },
        { header: 'Expense Category', key: 'cat', width: 18 },
        { header: 'Taxable Value', key: 'taxable', width: 14 },
        { header: 'IGST', key: 'igst', width: 12 },
        { header: 'CGST', key: 'cgst', width: 12 },
        { header: 'SGST', key: 'sgst', width: 12 },
      ];
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Sample_${registerType}.xlsx"`);
    res.send(Buffer.from(buf));
  });

  app.post('/api/import/preview', requireAuth, requirePerm('can_import'), upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    const gstRegistrationId = Number(req.body.gstRegistrationId);
    const returnPeriod = String(req.body.returnPeriod || '102026');
    const worksheet = req.body.worksheet ? String(req.body.worksheet) : undefined;
    try {
      const preview = inspectUploadedFile(req.file.buffer, req.file.originalname, gstRegistrationId, returnPeriod, worksheet);
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/import/commit', requireAuth, requirePerm('can_import'), upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    const u = (req as any).user;
    try {
      const mapping = JSON.parse(String(req.body.mapping || '{}'));
      const result = commitRegisterImport({
        buffer: req.file.buffer,
        originalFilename: req.file.originalname,
        worksheetName: String(req.body.worksheetName || ''),
        headerRow: Number(req.body.headerRow || 1),
        gstRegistrationId: Number(req.body.gstRegistrationId),
        returnPeriod: String(req.body.returnPeriod || '102026'),
        registerType: String(req.body.registerType || 'sales_register'),
        mapping,
        saveProfileName: req.body.saveProfileName ? String(req.body.saveProfileName) : undefined,
        actorUserId: u.userId,
        actorUsername: u.username,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Sales, Discounts, Purchases, E-Invoices, Stock Transfers ---
  app.get('/api/sales', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db
      .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? ORDER BY invoice_date, invoice_number')
      .all(gstinId, period);
    res.json({ rows });
  });

  app.post('/api/sales/verify', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const u = (req as any).user;
    const { gstinId, period } = req.body;
    const result = runSalesVerification(Number(gstinId), String(period), u.userId, u.username);
    res.json(result);
  });

  app.get('/api/discounts', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const discounts = db
      .prepare('SELECT * FROM discounts WHERE gst_registration_id = ? AND return_period = ? ORDER BY note_date')
      .all(gstinId, period);
    const notes = db
      .prepare('SELECT * FROM credit_debit_notes WHERE gst_registration_id = ? AND return_period = ? ORDER BY note_date')
      .all(gstinId, period);
    res.json({ discounts, notes });
  });

  app.post('/api/discounts/:id/approve-treatment', requireAuth, requirePerm('can_review'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const id = Number(req.params.id);
    const { treatment } = req.body; // 'Commercial Only' or 'GST Credit Note'
    const row = db.prepare('SELECT * FROM discounts WHERE id = ?').get(id) as any;
    if (!row) {
      res.status(404).json({ error: 'Discount record not found' });
      return;
    }
    if (treatment === 'Commercial Only') {
      db.prepare("UPDATE discounts SET gst_adjustable_value_paise = 0, igst_paise = 0, cgst_paise = 0, sgst_paise = 0, statutory_status = 'Verified Commercial Only', approved_by = ? WHERE id = ?").run(
        u.userId,
        id
      );
    } else {
      db.prepare("UPDATE discounts SET gst_adjustable_value_paise = accounting_value_paise, statutory_status = 'Approved GST Credit Note', approved_by = ? WHERE id = ?").run(
        u.userId,
        id
      );
    }
    logAuditEvent(u.userId, u.username, 'APPROVE_DISCOUNT_TREATMENT', 'discounts', id, { status: row.statutory_status }, { treatment });
    res.json({ ok: true });
  });

  app.get('/api/purchases', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db
      .prepare('SELECT * FROM purchase_invoices WHERE gst_registration_id = ? AND return_period = ? ORDER BY invoice_date')
      .all(gstinId, period);
    res.json({ rows });
  });

  app.get('/api/einvoices', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const einvoices = db
      .prepare('SELECT * FROM einvoice_records WHERE gst_registration_id = ? AND return_period = ?')
      .all(gstinId, period);
    const missingFromIrp = db
      .prepare("SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? AND customer_category = 'B2B' AND irn IS NULL AND is_cancelled = 0")
      .all(gstinId, period);
    res.json({ einvoices, missingFromIrp });
  });

  app.get('/api/stock-transfers', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db
      .prepare('SELECT * FROM stock_transfers WHERE (from_gst_registration_id = ? OR to_gst_registration_id = ?) AND return_period = ?')
      .all(gstinId, gstinId, period);
    res.json({ rows });
  });

  // --- GSTR-1, GSTR-1A, GSTR-2B, IMS, ITC, RCM, GSTR-3B ---
  app.get('/api/gstr1', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rp = db.prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?').get(gstinId, period) as any;
    const tables = rp
      ? db.prepare('SELECT * FROM gstr1_returns WHERE return_period_id = ? AND version_number = ? ORDER BY table_code').all(rp.id, rp.current_version)
      : [];
    const hsnSummary = db
      .prepare(
        `SELECT si.hsn_code, s.customer_category, si.uqc, SUM(si.quantity_milli) as qty_milli,
                SUM(si.taxable_paise) as taxable_paise, SUM(si.source_igst_paise) as igst_paise,
                SUM(si.source_cgst_paise) as cgst_paise, SUM(si.source_sgst_paise) as sgst_paise
         FROM sales_items si JOIN sales_invoices s ON s.id = si.sales_invoice_id
         WHERE s.gst_registration_id = ? AND s.return_period = ? AND s.is_cancelled = 0
         GROUP BY si.hsn_code, s.customer_category, si.uqc`
      )
      .all(gstinId, period);
    res.json({ returnPeriod: rp, tables, hsnSummary });
  });

  app.post('/api/gstr1/prepare', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const u = (req as any).user;
    const { gstinId, period } = req.body;
    const tables = prepareGstr1Return(Number(gstinId), String(period), u.userId, u.username);
    res.json({ tables });
  });

  app.get('/api/gstr1a', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db
      .prepare('SELECT * FROM gstr1a_returns WHERE gst_registration_id = ? AND return_period = ? ORDER BY id DESC')
      .all(gstinId, period);
    res.json({ rows });
  });

  app.post('/api/gstr1a', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const db = getDb();
    const { gstinId, period, original_invoice_number, amendment_reason, revised_invoice_number, original_taxable, revised_taxable, diff_igst, diff_cgst, diff_sgst } = req.body;
    const origP = Math.round(Number(original_taxable) * 100);
    const revP = Math.round(Number(revised_taxable) * 100);
    const r = db
      .prepare(
        `INSERT INTO gstr1a_returns (gst_registration_id, return_period, original_invoice_number, amendment_reason, revised_invoice_number, original_taxable_paise, revised_taxable_paise, diff_taxable_paise, diff_igst_paise, diff_cgst_paise, diff_sgst_paise, approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')`
      )
      .run(
        Number(gstinId),
        String(period),
        original_invoice_number,
        amendment_reason,
        revised_invoice_number || original_invoice_number,
        origP,
        revP,
        revP - origP,
        Math.round(Number(diff_igst || 0) * 100),
        Math.round(Number(diff_cgst || 0) * 100),
        Math.round(Number(diff_sgst || 0) * 100)
      );
    res.json({ id: r.lastInsertRowid });
  });

  app.get('/api/gstr2b', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const records = db
      .prepare(
        `SELECT g.*, p.invoice_number as book_invoice_number, p.source_taxable_paise as book_taxable_paise
         FROM gstr2b_records g
         LEFT JOIN purchase_invoices p ON p.id = g.matched_purchase_id
         WHERE g.gst_registration_id = ? AND g.return_period = ? ORDER BY g.supplier_gstin, g.invoice_date`
      )
      .all(gstinId, period);
    const missingIn2B = db
      .prepare(
        `SELECT p.* FROM purchase_invoices p
         WHERE p.gst_registration_id = ? AND p.return_period = ? AND p.is_rcm_applicable = 0
         AND p.id NOT IN (SELECT matched_purchase_id FROM gstr2b_records WHERE matched_purchase_id IS NOT NULL AND gst_registration_id = ? AND return_period = ?)`
      )
      .all(gstinId, period, gstinId, period);
    res.json({ records, missingIn2B });
  });

  app.post('/api/gstr2b/reconcile', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const u = (req as any).user;
    const { gstinId, period, toleranceRupees } = req.body;
    const counts = runGstr2bReconciliation(Number(gstinId), String(period), Math.round(Number(toleranceRupees ?? 1) * 100), u.userId, u.username);
    res.json(counts);
  });

  app.post('/api/gstr2b/:id/manual-match', requireAuth, requirePerm('can_review'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const id = Number(req.params.id);
    const { action } = req.body; // 'approve_match' or 'reject'
    if (action === 'approve_match') {
      db.prepare("UPDATE gstr2b_records SET match_status = 'Manually Approved Match', match_stage = 'Stage 6: Manual Review' WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE gstr2b_records SET match_status = 'Pending Supplier Correction', match_stage = 'Stage 6: Manual Review' WHERE id = ?").run(id);
    }
    logAuditEvent(u.userId, u.username, 'MANUAL_2B_MATCH', 'gstr2b_records', id, null, { action });
    res.json({ ok: true });
  });

  app.get('/api/ims', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db
      .prepare('SELECT * FROM ims_actions WHERE gst_registration_id = ? AND return_period = ? ORDER BY id DESC')
      .all(gstinId, period);
    res.json({ rows });
  });

  app.post('/api/ims/:id/action', requireAuth, requirePerm('can_review'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const id = Number(req.params.id);
    const { recommended_action, actual_portal_action, reviewer_approval } = req.body;
    db.prepare(
      `UPDATE ims_actions SET recommended_action = ?, actual_portal_action = ?, reviewer_approval = ?, reviewer_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(recommended_action, actual_portal_action || 'Not Recorded', reviewer_approval || 'Approved', u.userId, id);
    logAuditEvent(u.userId, u.username, 'UPDATE_IMS_ACTION', 'ims_actions', id, null, { recommended_action, actual_portal_action });
    res.json({ ok: true });
  });

  app.get('/api/itc', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const register = db
      .prepare(
        `SELECT i.*, p.invoice_number, p.supplier_name, p.supplier_gstin
         FROM itc_register i LEFT JOIN purchase_invoices p ON p.id = i.purchase_invoice_id
         WHERE i.gst_registration_id = ? AND i.return_period = ? ORDER BY i.id`
      )
      .all(gstinId, period);
    const reversals = db.prepare('SELECT * FROM itc_reversals WHERE gst_registration_id = ? AND return_period = ?').all(gstinId, period);
    const reclaims = db.prepare('SELECT * FROM itc_reclaims WHERE gst_registration_id = ? AND return_period = ?').all(gstinId, period);
    res.json({ register, reversals, reclaims });
  });

  app.post('/api/itc/:id/eligibility', requireAuth, requirePerm('can_review'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const id = Number(req.params.id);
    const { eligibility_status, legal_basis, supporting_evidence } = req.body;
    db.prepare(
      `UPDATE itc_register SET eligibility_status = ?, legal_basis = COALESCE(?, legal_basis), supporting_evidence = COALESCE(?, supporting_evidence), reviewer_id = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(eligibility_status, legal_basis || null, supporting_evidence || null, u.userId, id);
    logAuditEvent(u.userId, u.username, 'UPDATE_ITC_ELIGIBILITY', 'itc_register', id, null, { eligibility_status });
    res.json({ ok: true });
  });

  app.get('/api/rcm', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rows = db.prepare('SELECT * FROM rcm_register WHERE gst_registration_id = ? AND return_period = ?').all(gstinId, period);
    res.json({ rows });
  });

  app.get('/api/gstr3b', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rp = db.prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?').get(gstinId, period) as any;
    const tables = rp
      ? db.prepare('SELECT * FROM gstr3b_returns WHERE return_period_id = ? AND version_number = ? ORDER BY id').all(rp.id, rp.current_version)
      : [];
    const ledgers = db.prepare('SELECT * FROM gst_ledgers WHERE gst_registration_id = ? AND return_period = ?').all(gstinId, period);
    res.json({ returnPeriod: rp, tables, ledgers });
  });

  app.post('/api/gstr3b/prepare', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const u = (req as any).user;
    const { gstinId, period } = req.body;
    const tables = prepareGstr3bReturn(Number(gstinId), String(period), u.userId, u.username);
    res.json({ tables });
  });

  // --- 20-Point Cross-Verification Audit & Exceptions ---
  app.get('/api/audit', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const results = db
      .prepare('SELECT * FROM reconciliation_results WHERE gst_registration_id = ? AND return_period = ? ORDER BY audit_code')
      .all(gstinId, period);
    const exceptions = db
      .prepare('SELECT * FROM audit_exceptions WHERE gst_registration_id = ? AND return_period = ? ORDER BY severity, id DESC')
      .all(gstinId, period);
    res.json({ results, exceptions });
  });

  app.post('/api/audit/run', requireAuth, requirePerm('can_prepare'), (req, res) => {
    const u = (req as any).user;
    const { gstinId, period } = req.body;
    const results = runMandatoryCrossVerification(Number(gstinId), String(period), u.userId, u.username);
    res.json({ results });
  });

  app.post('/api/exceptions/:id/resolve', requireAuth, requirePerm('can_review'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const id = Number(req.params.id);
    const { status, corrective_action, supporting_evidence } = req.body;
    const existing = db.prepare('SELECT * FROM audit_exceptions WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Exception not found' });
      return;
    }
    // Enforce Maker != Checker separation if assigned_user_id is set to current user
    if (existing.assigned_user_id && existing.assigned_user_id === u.userId && (status === 'Resolved' || status === 'Approved explanation')) {
      res.status(403).json({ error: 'Maker-Checker control: assigned preparer cannot approve their own exception resolution.' });
      return;
    }
    db.prepare(
      `UPDATE audit_exceptions SET status = ?, corrective_action = COALESCE(?, corrective_action), supporting_evidence = COALESCE(?, supporting_evidence), reviewer_id = ?, approval_date = datetime('now') WHERE id = ?`
    ).run(status, corrective_action || null, supporting_evidence || null, u.userId, id);

    if (supporting_evidence) {
      db.prepare('INSERT INTO exception_evidence (audit_exception_id, note, added_by) VALUES (?, ?, ?)').run(id, supporting_evidence, u.userId);
    }
    logAuditEvent(u.userId, u.username, 'RESOLVE_EXCEPTION', 'audit_exceptions', id, { status: existing.status }, { status });
    res.json({ ok: true });
  });

  // --- Maker-Checker Return Approval, ARN Filing & Locking ---
  app.get('/api/approvals', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = Number(req.query.gstinId);
    const period = String(req.query.period || '102026');
    const rp = db.prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?').get(gstinId, period) as any;
    const history = rp
      ? db.prepare('SELECT a.*, u.full_name FROM approval_history a JOIN users u ON u.id = a.actor_id WHERE a.return_period_id = ? ORDER BY a.id DESC').all(rp.id)
      : [];
    const filings = db
      .prepare('SELECT * FROM filing_history WHERE gst_registration_id = ? AND return_period = ? ORDER BY id DESC')
      .all(gstinId, period);
    res.json({ returnPeriod: rp, history, filings });
  });

  app.post('/api/approvals/advance', requireAuth, (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const { gstinId, period, targetStage, remarks } = req.body;
    const rp = db.prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?').get(Number(gstinId), String(period)) as any;
    if (!rp) {
      res.status(404).json({ error: 'Return period not found.' });
      return;
    }

    if (targetStage === 'Reviewer Approved' && !u.permissions.can_review) {
      res.status(403).json({ error: 'Only GST Reviewer or Admin can grant Reviewer Approval.' });
      return;
    }
    if (targetStage === 'Final Approved' && !u.permissions.can_approve) {
      res.status(403).json({ error: 'Only Approving Officer or Admin can grant Final Approval.' });
      return;
    }

    // Maker-Checker separation: check last preparer/reviewer on this version
    const priorMaker = db
      .prepare("SELECT actor_id FROM approval_history WHERE return_period_id = ? AND version_number = ? AND stage IN ('Prepared', 'Reviewer Approved') ORDER BY id DESC LIMIT 1")
      .get(rp.id, rp.current_version) as { actor_id: number } | undefined;

    if (priorMaker && priorMaker.actor_id === u.userId && targetStage === 'Final Approved' && u.roleCode !== 'ADMIN') {
      res.status(403).json({ error: 'Maker-Checker Violation: Final Approving Officer must be distinct from the Preparer/Reviewer.' });
      return;
    }

    if (targetStage === 'Reviewer Approved' || targetStage === 'Final Approved') {
      const openCrit = (
        db
          .prepare("SELECT COUNT(*) as c FROM audit_exceptions WHERE gst_registration_id = ? AND return_period = ? AND severity = 'Critical' AND status NOT IN ('Resolved', 'Approved explanation')")
          .get(Number(gstinId), String(period)) as { c: number }
      ).c;
      if (openCrit > 0) {
        res.status(400).json({ error: `Cannot approve: ${openCrit} unresolved Critical audit exception(s) remain.` });
        return;
      }
    }

    db.prepare('UPDATE return_periods SET status = ? WHERE id = ?').run(targetStage, rp.id);
    db.prepare(
      `INSERT INTO approval_history (return_period_id, version_number, return_type, stage, action, actor_id, actor_role, remarks)
       VALUES (?, ?, 'GSTR3B', ?, 'Approved', ?, ?, ?)`
    ).run(rp.id, rp.current_version, targetStage, u.userId, u.roleCode, remarks || null);

    logAuditEvent(u.userId, u.username, 'ADVANCE_APPROVAL', 'return_periods', rp.id, { status: rp.status }, { status: targetStage });
    res.json({ ok: true, status: targetStage });
  });

  app.post('/api/filing/record', requireAuth, requirePerm('can_approve'), async (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const { gstinId, period, returnType, arn, filedDate, lockPeriod } = req.body;
    if (!arn || !filedDate) {
      res.status(400).json({ error: 'ARN and Filed Date are required.' });
      return;
    }
    const rp = db.prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?').get(Number(gstinId), String(period)) as any;
    if (!rp) {
      res.status(404).json({ error: 'Return period not found.' });
      return;
    }
    if (lockPeriod) {
      await createBackupArchive({ backupType: 'Pre-Lock', actorUserId: u.userId, actorUsername: u.username });
    }
    db.prepare(
      `INSERT INTO filing_history (gst_registration_id, return_period, return_type, version_number, arn, filed_date, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(Number(gstinId), String(period), returnType || 'GSTR3B', rp.current_version, String(arn).trim(), String(filedDate), u.userId);

    const newStatus = lockPeriod ? 'Locked' : 'Filed';
    db.prepare(
      `UPDATE return_periods SET status = ?, gstr3b_arn = CASE WHEN ? = 'GSTR3B' THEN ? ELSE gstr3b_arn END,
       gstr1_arn = CASE WHEN ? = 'GSTR1' THEN ? ELSE gstr1_arn END,
       locked_by = CASE WHEN ? THEN ? ELSE locked_by END,
       locked_at = CASE WHEN ? THEN datetime('now') ELSE locked_at END
       WHERE id = ?`
    ).run(newStatus, returnType, arn, returnType, arn, lockPeriod ? 1 : 0, u.userId, lockPeriod ? 1 : 0, rp.id);

    res.json({ ok: true, status: newStatus });
  });

  // --- Exports & Reports (25 Official/Audit Files) ---
  app.get('/api/exports/catalog', requireAuth, (req, res) => {
    const db = getDb();
    const gstinId = req.query.gstinId ? Number(req.query.gstinId) : null;
    const history = gstinId
      ? db.prepare('SELECT * FROM export_history WHERE gst_registration_id = ? ORDER BY id DESC LIMIT 50').all(gstinId)
      : db.prepare('SELECT * FROM export_history ORDER BY id DESC LIMIT 50').all();
    res.json({ catalog: REPORT_CATALOG, history });
  });

  app.post('/api/exports/generate', requireAuth, requirePerm('can_export'), async (req, res) => {
    const u = (req as any).user;
    const { reportKey, gstinId, period } = req.body;
    try {
      const artifact = await generateExportArtifact({
        reportKey: String(reportKey),
        gstRegistrationId: Number(gstinId),
        returnPeriod: String(period),
        actorUserId: u.userId,
        actorUsername: u.username,
      });
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('X-Schema-Validated', String(artifact.schemaValidated));
      res.send(artifact.buffer);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Government Templates & Updates ---
  app.get('/api/gov-templates', requireAuth, (_req, res) => {
    const db = getDb();
    const templates = db.prepare('SELECT * FROM government_templates ORDER BY id DESC').all();
    const rules = db.prepare('SELECT * FROM gst_rules ORDER BY rule_code, version DESC').all();
    res.json({ templates, rules });
  });

  app.post('/api/gov-templates/register', requireAuth, requirePerm('can_admin'), upload.single('templateFile'), (req, res) => {
    const u = (req as any).user;
    const db = getDb();
    const { template_name, return_type, official_source_url, version, applicable_from } = req.body;
    if (!template_name || !return_type || !version) {
      res.status(400).json({ error: 'Template name, return type, and version are required.' });
      return;
    }
    const checksum = req.file
      ? crypto.createHash('sha256').update(req.file.buffer).digest('hex')
      : crypto.createHash('sha256').update(`${template_name}:${version}`).digest('hex');
    const r = db
      .prepare(
        `INSERT INTO government_templates (template_name, return_type, official_source_url, version, applicable_from, download_date, file_checksum, worksheet_names, mandatory_fields, approval_status, imported_by)
         VALUES (?, ?, ?, ?, ?, date('now'), ?, 'b2b,b2cl,b2cs,cdnr,hsn,docs', 'gstin,fp,inum,idt,txval', 'Verified Official', ?)`
      )
      .run(template_name, return_type, official_source_url || 'https://www.gst.gov.in/download/returns', version, applicable_from || '2026-04-01', checksum, u.userId);
    res.json({ id: r.lastInsertRowid, checksum });
  });

  // --- Backup, Restore & Migration ---
  app.get('/api/backups', requireAuth, (_req, res) => {
    const db = getDb();
    const backups = db.prepare('SELECT * FROM backup_history ORDER BY id DESC').all();
    res.json({ backups });
  });

  app.post('/api/backups/create', requireAuth, requirePerm('can_admin'), async (req, res) => {
    const u = (req as any).user;
    const { passphrase } = req.body || {};
    const info = await createBackupArchive({
      backupType: 'Manual',
      passphrase,
      actorUserId: u.userId,
      actorUsername: u.username,
    });
    res.json(info);
  });

  app.get('/api/backups/download/:filename', requireAuth, requirePerm('can_admin'), (req, res) => {
    const safeName = path.basename(String(req.params.filename));
    const resolved = path.resolve(BACKUPS_DIR, safeName);
    if (!resolved.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Backup file not found.' });
      return;
    }
    res.download(resolved, safeName);
  });

  app.post('/api/backups/preview', requireAuth, requirePerm('can_admin'), upload.single('backupFile'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Backup .zip file required.' });
      return;
    }
    try {
      const preview = previewBackupArchive(req.file.buffer, req.body.passphrase);
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/backups/restore', requireAuth, requirePerm('can_admin'), upload.single('backupFile'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Backup .zip file required.' });
      return;
    }
    const u = (req as any).user;
    try {
      const out = await restoreBackupArchive(req.file.buffer, req.body.passphrase, u.userId, u.username);
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- User Management & Audit Logs ---
  app.get('/api/users', requireAuth, requirePerm('can_admin'), (_req, res) => {
    const db = getDb();
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.email, u.role_code, r.role_name, u.allowed_gstin_ids, u.is_active, u.created_at, u.last_login_at
         FROM users u JOIN user_roles r ON r.role_code = u.role_code ORDER BY u.id`
      )
      .all();
    const roles = db.prepare('SELECT * FROM user_roles ORDER BY id').all();
    res.json({ users, roles });
  });

  app.post('/api/users', requireAuth, requirePerm('can_admin'), (req, res) => {
    const u = (req as any).user;
    const { username, full_name, email, password, role_code } = req.body || {};
    if (!username || !full_name || !password || !role_code) {
      res.status(400).json({ error: 'Username, full name, password, and role are required.' });
      return;
    }
    const db = getDb();
    const r = db
      .prepare('INSERT INTO users (username, full_name, email, password_hash, role_code) VALUES (?, ?, ?, ?, ?)')
      .run(String(username).trim(), String(full_name).trim(), email || null, hashPassword(String(password)), String(role_code));
    logAuditEvent(u.userId, u.username, 'CREATE_USER', 'users', Number(r.lastInsertRowid), null, { username, role_code });
    res.json({ id: Number(r.lastInsertRowid) });
  });

  app.get('/api/audit-logs', requireAuth, (_req, res) => {
    const db = getDb();
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
    res.json({ logs });
  });

  // --- Organized Workspace Input & Output Folders (Persisted Across Logouts) ---
  function listFilesRecursively(baseDir: string, folderKey: 'input_files' | 'output_files') {
    const results: { folder: string; relativePath: string; filename: string; sizeBytes: number; modifiedAt: string }[] = [];
    if (!fs.existsSync(baseDir)) return results;
    const walk = (dir: string, relPrefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.isFile()) {
          const st = fs.statSync(full);
          results.push({
            folder: folderKey,
            relativePath: rel,
            filename: entry.name,
            sizeBytes: st.size,
            modifiedAt: st.mtime.toISOString(),
          });
        }
      }
    };
    walk(baseDir, '');
    return results.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  app.get('/api/workspace-files', requireAuth, (_req, res) => {
    res.json({
      dataRoot: DATA_ROOT,
      inputFiles: listFilesRecursively(UPLOADS_DIR, 'input_files'),
      outputFiles: listFilesRecursively(EXPORTS_DIR, 'output_files'),
    });
  });

  app.get('/api/workspace-files/download', requireAuth, (req, res) => {
    const folder = String(req.query.folder || '');
    const relPath = String(req.query.path || '');
    const baseDir = folder === 'input_files' ? UPLOADS_DIR : folder === 'output_files' ? EXPORTS_DIR : null;
    if (!baseDir || !relPath) {
      res.status(400).json({ error: 'Invalid folder or file path.' });
      return;
    }
    const resolved = path.resolve(baseDir, relPath);
    if (!resolved.startsWith(baseDir + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.status(404).json({ error: 'Workspace file not found.' });
      return;
    }
    res.download(resolved, path.basename(resolved));
  });

  // --- Vite / Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd();
    const distPath = path.resolve(appRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GST Compliance Manager listening on http://localhost:${PORT}`);
  });
}

startServer();
