import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import Ajv from 'ajv';
import { getDb, reopenDb, DATA_ROOT, DB_PATH, BACKUPS_DIR, EXPORTS_DIR, logAuditEvent } from '../db.ts';
import { paiseToRupees, formatINR } from './gstUtils.ts';

const ajv = new Ajv({ allErrors: true });

export const REPORT_CATALOG = [
  { key: 'GSTR1_Official_Excel', label: 'GSTR-1 Official Format Worksheet', category: 'Government', format: 'xlsx', requiresCleanCritical: true },
  { key: 'GSTR1_Validated_JSON', label: 'GSTR-1 Validated JSON (Schema Checked)', category: 'Government', format: 'json', requiresCleanCritical: true },
  { key: 'GSTR1A_Amendment_Report', label: 'GSTR-1A Amendment Report', category: 'Government', format: 'xlsx', requiresCleanCritical: false },
  { key: 'GSTR3B_Official_Format', label: 'GSTR-3B Filing Worksheet', category: 'Government', format: 'xlsx', requiresCleanCritical: true },
  { key: 'GSTR3B_JSON', label: 'GSTR-3B JSON (Schema Checked)', category: 'Government', format: 'json', requiresCleanCritical: true },
  { key: 'GSTR2B_Reconciliation', label: 'GSTR-2B vs Purchase Reconciliation', category: 'Reconciliation', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Sales_Verification', label: 'Sales Verification & Tax Recalculation', category: 'Reconciliation', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Discount_Verification', label: 'Discounts & Credit Notes Verification', category: 'Reconciliation', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Purchase_Verification', label: 'Purchase Register Verification', category: 'Reconciliation', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Missing_Invoices', label: 'Missing Invoices (Books vs 2B / E-Invoice)', category: 'Exceptions', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Duplicate_Invoices', label: 'Duplicate Invoice & Claim Prevention Log', category: 'Exceptions', format: 'xlsx', requiresCleanCritical: false },
  { key: 'GST_Rate_Mismatch', label: 'GST Rate & Tax Variance Report', category: 'Exceptions', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Taxable_Value_Mismatch', label: 'Taxable Value Variance Report', category: 'Exceptions', format: 'xlsx', requiresCleanCritical: false },
  { key: 'ITC_Eligibility', label: 'ITC Eligibility & Sec 17(5) Register', category: 'ITC / RCM', format: 'xlsx', requiresCleanCritical: false },
  { key: 'ITC_Reversal_Reclaim', label: 'ITC Reversal & Reclaim Ledger', category: 'ITC / RCM', format: 'xlsx', requiresCleanCritical: false },
  { key: 'RCM_Verification', label: 'Reverse Charge Mechanism Verification', category: 'ITC / RCM', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Stock_Transfer_Reconciliation', label: 'Factory-to-Depot Stock Transfer Reconciliation', category: 'Reconciliation', format: 'xlsx', requiresCleanCritical: false },
  { key: 'GSTR1_vs_GSTR3B', label: 'GSTR-1 vs GSTR-3B Output Liability Check', category: 'Cross-checks', format: 'xlsx', requiresCleanCritical: false },
  { key: 'GSTR2B_vs_GSTR3B', label: 'GSTR-2B vs GSTR-3B ITC Check', category: 'Cross-checks', format: 'xlsx', requiresCleanCritical: false },
  { key: 'GSTIN_Wise_Tax_Summary', label: 'GSTIN-Wise Tax Summary', category: 'Management', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Consolidated_Management_Report', label: 'Consolidated All-GSTIN Management Report', category: 'Management', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Audit_Exception_Register', label: 'Audit Exception Register (All Severities)', category: 'Exceptions', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Final_Audit_Approval', label: 'Final Audit Approval Certificate (PDF)', category: 'Management', format: 'pdf', requiresCleanCritical: true },
  { key: 'Filing_History', label: 'Return Filing & ARN Archive Register', category: 'Management', format: 'xlsx', requiresCleanCritical: false },
  { key: 'Annual_GST_Reconciliation', label: 'Annual FY GST Reconciliation Summary', category: 'Management', format: 'xlsx', requiresCleanCritical: false },
] as const;

const GSTR1_SCHEMA = {
  type: 'object',
  required: ['gstin', 'fp', 'b2b', 'hsn', 'doc_issue'],
  properties: {
    gstin: { type: 'string', minLength: 15, maxLength: 15 },
    fp: { type: 'string', pattern: '^[0-9]{6}$' },
    b2b: { type: 'array' },
    b2cl: { type: 'array' },
    b2cs: { type: 'array' },
    cdnr: { type: 'array' },
    hsn: { type: 'object', required: ['data'] },
    doc_issue: { type: 'object' },
  },
};

const GSTR3B_SCHEMA = {
  type: 'object',
  required: ['gstin', 'ret_period', 'sup_details', 'itc_elg', 'intr_ltfee'],
  properties: {
    gstin: { type: 'string', minLength: 15, maxLength: 15 },
    ret_period: { type: 'string', pattern: '^[0-9]{6}$' },
    sup_details: { type: 'object' },
    itc_elg: { type: 'object' },
    intr_ltfee: { type: 'object' },
  },
};

function styleHeaderRow(sheet: ExcelJS.Worksheet, colCount: number) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2942' } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  header.height = 24;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (colCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
  }
}

export async function generateExportArtifact(params: {
  reportKey: string;
  gstRegistrationId: number;
  returnPeriod: string;
  actorUserId: number;
  actorUsername: string;
}): Promise<{ buffer: Buffer; filename: string; contentType: string; schemaValidated: boolean; savedOutputPath: string }> {
  const db = getDb();
  const meta = REPORT_CATALOG.find((r) => r.key === params.reportKey);
  if (!meta) throw new Error(`Unknown report key: ${params.reportKey}`);

  const reg = db.prepare('SELECT * FROM gst_registrations WHERE id = ?').get(params.gstRegistrationId) as any;
  if (!reg) throw new Error('GSTIN registration not found');

  // Critical exception gate for official return exports & final approval PDF
  if (meta.requiresCleanCritical) {
    const crit = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM audit_exceptions
           WHERE gst_registration_id = ? AND return_period = ? AND severity = 'Critical'
           AND status NOT IN ('Resolved', 'Approved explanation')`
        )
        .get(params.gstRegistrationId, params.returnPeriod) as { c: number }
    ).c;
    if (crit > 0) {
      throw new Error(
        `Export blocked: ${crit} unresolved Critical audit exception(s) remain for ${reg.gstin} (${params.returnPeriod}). Resolve or document approved explanations first.`
      );
    }
  }

  let buffer: Buffer;
  let contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let filename = `${params.reportKey}_${reg.gstin}_${params.returnPeriod}.${meta.format}`;
  let schemaValidated = false;

  if (meta.format === 'json') {
    if (params.reportKey === 'GSTR1_Validated_JSON') {
      const sales = db
        .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? AND is_cancelled = 0')
        .all(params.gstRegistrationId, params.returnPeriod) as any[];
      const b2bMap = new Map<string, any[]>();
      for (const s of sales.filter((x) => x.customer_gstin)) {
        const arr = b2bMap.get(s.customer_gstin) || [];
        arr.push({
          inum: s.invoice_number,
          idt: s.invoice_date.split('-').reverse().join('-'),
          val: paiseToRupees(s.source_total_paise),
          pos: s.place_of_supply,
          rchrg: 'N',
          inv_typ: 'R',
          itms: [
            {
              num: 1,
              itm_det: {
                txval: paiseToRupees(s.source_taxable_paise),
                iamt: paiseToRupees(s.source_igst_paise),
                camt: paiseToRupees(s.source_cgst_paise),
                samt: paiseToRupees(s.source_sgst_paise),
                csamt: paiseToRupees(s.source_cess_paise),
              },
            },
          ],
        });
        b2bMap.set(s.customer_gstin, arr);
      }

      const hsnRows = db
        .prepare(
          `SELECT si.hsn_code, si.uqc, SUM(si.quantity_milli) as qty_milli, SUM(si.taxable_paise) as txval, SUM(si.source_igst_paise) as iamt, SUM(si.source_cgst_paise) as camt, SUM(si.source_sgst_paise) as samt, MAX(si.gst_rate_bps) as rt_bps
           FROM sales_items si JOIN sales_invoices s ON s.id = si.sales_invoice_id
           WHERE s.gst_registration_id = ? AND s.return_period = ? AND s.is_cancelled = 0
           GROUP BY si.hsn_code, si.uqc`
        )
        .all(params.gstRegistrationId, params.returnPeriod) as any[];

      const payload = {
        gstin: reg.gstin,
        fp: params.returnPeriod,
        version: 'GST3.1.6-INTERNAL-SCHEMA',
        b2b: Array.from(b2bMap.entries()).map(([ctin, inv]) => ({ ctin, inv })),
        b2cl: [],
        b2cs: sales
          .filter((x) => !x.customer_gstin)
          .map((s) => ({
            pos: s.place_of_supply,
            txval: paiseToRupees(s.source_taxable_paise),
            iamt: paiseToRupees(s.source_igst_paise),
            camt: paiseToRupees(s.source_cgst_paise),
            samt: paiseToRupees(s.source_sgst_paise),
          })),
        cdnr: [],
        hsn: {
          data: hsnRows.map((h, i) => ({
            num: i + 1,
            hsn_sc: h.hsn_code,
            uqc: h.uqc,
            qty: h.qty_milli / 1000,
            rt: h.rt_bps / 100,
            txval: paiseToRupees(h.txval),
            iamt: paiseToRupees(h.iamt),
            camt: paiseToRupees(h.camt),
            samt: paiseToRupees(h.samt),
          })),
        },
        doc_issue: {
          doc_det: [{ doc_num: 1, docs: [{ num: 1, totnum: sales.length, cancel: 0, net_issue: sales.length }] }],
        },
      };

      const validate = ajv.compile(GSTR1_SCHEMA);
      schemaValidated = Boolean(validate(payload));
      if (!schemaValidated) {
        throw new Error(`GSTR-1 JSON Schema validation failed: ${ajv.errorsText(validate.errors)}`);
      }
      buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
    } else {
      const rp = db
        .prepare('SELECT id, current_version FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
        .get(params.gstRegistrationId, params.returnPeriod) as any;
      const g3b = rp
        ? (db.prepare('SELECT * FROM gstr3b_returns WHERE return_period_id = ? AND version_number = ?').all(rp.id, rp.current_version) as any[])
        : [];
      const row31a = g3b.find((r) => r.table_code === '3.1(a)') || { taxable_paise: 0, igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0 };
      const row31d = g3b.find((r) => r.table_code === '3.1(d)') || { taxable_paise: 0, igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0 };
      const row4c = g3b.find((r) => r.table_code === '4(C)') || { igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0 };

      const payload = {
        gstin: reg.gstin,
        ret_period: params.returnPeriod,
        sup_details: {
          osup_det: {
            txval: paiseToRupees(row31a.taxable_paise),
            iamt: paiseToRupees(row31a.igst_paise),
            camt: paiseToRupees(row31a.cgst_paise),
            samt: paiseToRupees(row31a.sgst_paise),
            csamt: paiseToRupees(row31a.cess_paise),
          },
          isup_rev: {
            txval: paiseToRupees(row31d.taxable_paise),
            iamt: paiseToRupees(row31d.igst_paise),
            camt: paiseToRupees(row31d.cgst_paise),
            samt: paiseToRupees(row31d.sgst_paise),
            csamt: 0,
          },
        },
        itc_elg: {
          itc_net: {
            iamt: paiseToRupees(row4c.igst_paise),
            camt: paiseToRupees(row4c.cgst_paise),
            samt: paiseToRupees(row4c.sgst_paise),
            csamt: paiseToRupees(row4c.cess_paise),
          },
        },
        intr_ltfee: { intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 } },
      };

      const validate = ajv.compile(GSTR3B_SCHEMA);
      schemaValidated = Boolean(validate(payload));
      if (!schemaValidated) {
        throw new Error(`GSTR-3B JSON Schema validation failed: ${ajv.errorsText(validate.errors)}`);
      }
      buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
    }
    contentType = 'application/json';
  } else if (meta.format === 'pdf') {
    buffer = await buildFinalAuditPdf(reg, params.returnPeriod);
    contentType = 'application/pdf';
    schemaValidated = true;
  } else {
    buffer = await buildExcelReport(params.reportKey, reg, params.returnPeriod);
    schemaValidated = true;
  }

  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  db.prepare(
    `INSERT INTO export_history (gst_registration_id, return_period, export_category, filename, file_format, file_checksum, schema_validated, exported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(params.gstRegistrationId, params.returnPeriod, meta.category, filename, meta.format, checksum, schemaValidated ? 1 : 0, params.actorUserId);

  const safeGstin = path.basename(reg.gstin);
  const safePeriod = path.basename(params.returnPeriod.replace(/[^0-9A-Za-z_-]/g, ''));
  const safeFilename = path.basename(filename);
  const outDir = path.join(EXPORTS_DIR, safeGstin, safePeriod);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, safeFilename), buffer);
  const savedOutputPath = `${safeGstin}/${safePeriod}/${safeFilename}`;

  logAuditEvent(params.actorUserId, params.actorUsername, 'EXPORT_REPORT', 'export_history', filename, null, {
    reportKey: params.reportKey,
    checksum,
    savedOutputPath,
  });

  return { buffer, filename, contentType, schemaValidated, savedOutputPath };
}

async function buildExcelReport(reportKey: string, reg: any, returnPeriod: string): Promise<Buffer> {
  const db = getDb();
  const comp = db.prepare('SELECT legal_name FROM companies WHERE id = ?').get(reg.company_id) as { legal_name: string } | undefined;
  const wb = new ExcelJS.Workbook();
  wb.creator = `${comp?.legal_name || 'GST Compliance Manager'} — GST Compliance Suite`;
  wb.created = new Date();

  const inrFmt = '₹ #,##,##0.00';
  const addMoneyCols = (sheet: ExcelJS.Worksheet, indices: number[]) => {
    for (const idx of indices) {
      sheet.getColumn(idx).numFmt = inrFmt;
    }
  };

  if (reportKey === 'Sales_Verification' || reportKey === 'GSTR1_Official_Excel' || reportKey === 'GST_Rate_Mismatch') {
    const sheet = wb.addWorksheet(reportKey === 'GSTR1_Official_Excel' ? 'b2b_and_outward' : 'Sales_Verification');
    sheet.columns = [
      { header: 'Invoice No', key: 'invoice_number', width: 22 },
      { header: 'Date', key: 'invoice_date', width: 13 },
      { header: 'Customer GSTIN', key: 'customer_gstin', width: 18 },
      { header: 'Customer Name', key: 'customer_name', width: 28 },
      { header: 'POS', key: 'place_of_supply', width: 8 },
      { header: 'Source Taxable (INR)', key: 'src_taxable', width: 20 },
      { header: 'Source Total Tax (INR)', key: 'src_tax', width: 20 },
      { header: 'Calc Total Tax (INR)', key: 'calc_tax', width: 20 },
      { header: 'Tax Variance (INR)', key: 'diff', width: 18 },
      { header: 'IRN Status', key: 'irn_status', width: 15 },
      { header: 'Verification', key: 'verification_status', width: 14 },
      { header: 'Source File / Row', key: 'source_ref', width: 28 },
    ];
    const rows = db
      .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? ORDER BY invoice_date, invoice_number')
      .all(reg.id, returnPeriod) as any[];
    for (const r of rows) {
      const srcTax = r.source_igst_paise + r.source_cgst_paise + r.source_sgst_paise + r.source_cess_paise;
      const calcTax = r.calc_igst_paise + r.calc_cgst_paise + r.calc_sgst_paise + r.calc_cess_paise;
      const diff = srcTax - calcTax;
      if (reportKey === 'GST_Rate_Mismatch' && Math.abs(diff) <= 100) continue;
      const row = sheet.addRow({
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        customer_gstin: r.customer_gstin || 'B2C',
        customer_name: r.customer_name,
        place_of_supply: r.place_of_supply,
        src_taxable: paiseToRupees(r.source_taxable_paise),
        src_tax: paiseToRupees(srcTax),
        calc_tax: paiseToRupees(calcTax),
        diff: paiseToRupees(diff),
        irn_status: r.irn_status,
        verification_status: r.verification_status,
        source_ref: `${r.source_filename || 'Manual'} #${r.source_row_number || '-'}`,
      });
      if (Math.abs(diff) > 100) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      }
    }
    styleHeaderRow(sheet, 12);
    addMoneyCols(sheet, [6, 7, 8, 9]);
  } else if (reportKey === 'GSTR2B_Reconciliation' || reportKey === 'Missing_Invoices') {
    const sheet = wb.addWorksheet('GSTR2B_Reconciliation');
    sheet.columns = [
      { header: 'Supplier GSTIN', key: 'supplier_gstin', width: 18 },
      { header: 'Supplier Name', key: 'supplier_name', width: 28 },
      { header: 'Invoice No', key: 'invoice_number', width: 20 },
      { header: 'Date', key: 'invoice_date', width: 13 },
      { header: 'Portal Taxable (INR)', key: 'taxable', width: 20 },
      { header: 'Portal Tax (INR)', key: 'tax', width: 18 },
      { header: 'Taxable Diff (INR)', key: 'taxable_diff', width: 18 },
      { header: 'Tax Diff (INR)', key: 'tax_diff', width: 18 },
      { header: 'Matching Stage', key: 'match_stage', width: 20 },
      { header: 'Reconciliation Status', key: 'match_status', width: 28 },
    ];
    const rows = db
      .prepare('SELECT * FROM gstr2b_records WHERE gst_registration_id = ? AND return_period = ? ORDER BY supplier_gstin, invoice_date')
      .all(reg.id, returnPeriod) as any[];
    for (const r of rows) {
      if (reportKey === 'Missing_Invoices' && r.match_status === 'Fully Matched') continue;
      const row = sheet.addRow({
        supplier_gstin: r.supplier_gstin,
        supplier_name: r.supplier_name,
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        taxable: paiseToRupees(r.taxable_paise),
        tax: paiseToRupees(r.igst_paise + r.cgst_paise + r.sgst_paise + r.cess_paise),
        taxable_diff: paiseToRupees(r.taxable_diff_paise),
        tax_diff: paiseToRupees(r.tax_diff_paise),
        match_stage: r.match_stage || '-',
        match_status: r.match_status,
      });
      if (r.match_status !== 'Fully Matched') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      }
    }
    styleHeaderRow(sheet, 10);
    addMoneyCols(sheet, [5, 6, 7, 8]);
  } else if (reportKey === 'Audit_Exception_Register') {
    const sheet = wb.addWorksheet('Audit_Exceptions');
    sheet.columns = [
      { header: 'Exception ID', key: 'exception_code', width: 22 },
      { header: 'Category', key: 'audit_category', width: 20 },
      { header: 'Severity', key: 'severity', width: 12 },
      { header: 'Invoice No', key: 'invoice_number', width: 22 },
      { header: 'Party Name', key: 'party_name', width: 26 },
      { header: 'Original (INR)', key: 'orig', width: 18 },
      { header: 'Expected (INR)', key: 'exp', width: 18 },
      { header: 'Difference (INR)', key: 'diff', width: 18 },
      { header: 'Reason', key: 'reason', width: 42 },
      { header: 'Status', key: 'status', width: 20 },
    ];
    const rows = db
      .prepare('SELECT * FROM audit_exceptions WHERE gst_registration_id = ? AND return_period = ? ORDER BY severity, id')
      .all(reg.id, returnPeriod) as any[];
    for (const r of rows) {
      sheet.addRow({
        exception_code: r.exception_code,
        audit_category: r.audit_category,
        severity: r.severity,
        invoice_number: r.invoice_number,
        party_name: r.party_name,
        orig: paiseToRupees(r.original_value_paise),
        exp: paiseToRupees(r.expected_value_paise),
        diff: paiseToRupees(r.difference_paise),
        reason: r.reason,
        status: r.status,
      });
    }
    styleHeaderRow(sheet, 10);
    addMoneyCols(sheet, [6, 7, 8]);
  } else {
    // Generalized structured multi-table report for GSTR-3B, Consolidated, ITC, RCM, Cross-checks
    const sheet = wb.addWorksheet(reportKey.slice(0, 30));
    sheet.columns = [
      { header: 'Code / Reference', key: 'code', width: 20 },
      { header: 'Description / Particulars', key: 'desc', width: 48 },
      { header: 'Taxable / Books (INR)', key: 'books', width: 22 },
      { header: 'IGST / Comp (INR)', key: 'igst', width: 18 },
      { header: 'CGST (INR)', key: 'cgst', width: 18 },
      { header: 'SGST (INR)', key: 'sgst', width: 18 },
      { header: 'Cash / Variance (INR)', key: 'cash', width: 20 },
      { header: 'Status', key: 'status', width: 18 },
    ];
    const reconRows = db
      .prepare('SELECT * FROM reconciliation_results WHERE gst_registration_id = ? AND return_period = ? ORDER BY audit_code')
      .all(reg.id, returnPeriod) as any[];
    for (const rr of reconRows) {
      sheet.addRow({
        code: rr.audit_code,
        desc: rr.audit_title,
        books: paiseToRupees(rr.books_amount_paise),
        igst: paiseToRupees(rr.comparison_amount_paise),
        cgst: 0,
        sgst: 0,
        cash: paiseToRupees(rr.difference_paise),
        status: rr.status,
      });
    }
    styleHeaderRow(sheet, 8);
    addMoneyCols(sheet, [3, 4, 5, 6, 7]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function buildFinalAuditPdf(reg: any, returnPeriod: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const db = getDb();
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const comp = db.prepare('SELECT legal_name FROM companies WHERE id = ?').get(reg.company_id) as { legal_name: string } | undefined;
    const reconRows = db
      .prepare('SELECT * FROM reconciliation_results WHERE gst_registration_id = ? AND return_period = ? ORDER BY audit_code')
      .all(reg.id, returnPeriod) as any[];
    const rp = db
      .prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
      .get(reg.id, returnPeriod) as any;

    doc.fontSize(16).fillColor('#0F2942').text((comp?.legal_name || 'ORGANIZATION').toUpperCase());
    doc.fontSize(12).fillColor('#1E3A5F').text('Final GST Audit & Compliance Approval Certificate');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#334155').text(`GSTIN: ${reg.gstin} (${reg.state_name}) | Return Period: ${returnPeriod} | Status: ${rp?.status || 'Draft'}`);
    doc.text(`Generated: ${new Date().toISOString()} | Version: v${rp?.current_version || 1}`);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0F2942').text('20-Point Cross-Verification Matrix Summary');
    doc.moveDown(0.4);
    for (const r of reconRows) {
      doc
        .fontSize(8.5)
        .fillColor(r.status === 'Critical' ? '#DC2626' : r.status === 'Warning' ? '#D97706' : '#16A34A')
        .text(`${r.audit_code} [${r.status}] `, { continued: true })
        .fillColor('#1E293B')
        .text(`${r.audit_title} — Diff: ${formatINR(r.difference_paise)} (Exceptions: ${r.exception_count})`);
    }

    doc.moveDown(1.5);
    doc.fontSize(9).fillColor('#475569').text('Maker-Checker Declaration: All critical discrepancies must be resolved before authorized portal filing. Final legal authentication remains with the authorized company officer.');
    doc.end();
  });
}

export async function createBackupArchive(params: {
  backupType: 'Manual' | 'Automatic' | 'Pre-Upgrade' | 'Pre-Lock';
  passphrase?: string;
  actorUserId: number;
  actorUsername: string;
}): Promise<{ filename: string; filePath: string; manifestChecksum: string; sizeBytes: number; encrypted: boolean }> {
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDbPath = path.join(BACKUPS_DIR, `snapshot_${stamp}.db`);
  // Consistent SQLite online backup API
  await db.backup(tempDbPath);

  const zipName = `GST_Compliance_Backup_${stamp}.zip`;
  const zipPath = path.join(BACKUPS_DIR, zipName);
  const dbBytes = fs.readFileSync(tempDbPath);
  const dbHash = crypto.createHash('sha256').update(dbBytes).digest('hex');

  const manifest = {
    application: 'GST Compliance Manager V2.0',
    created_at: new Date().toISOString(),
    created_by: params.actorUsername,
    backup_type: params.backupType,
    db_filename: 'pcil_gst.db',
    db_sha256: dbHash,
    schema_migrations: db.prepare('SELECT version, description FROM schema_migrations ORDER BY version').all(),
    counts: {
      companies: (db.prepare('SELECT COUNT(*) as c FROM companies').get() as any).c,
      gst_registrations: (db.prepare('SELECT COUNT(*) as c FROM gst_registrations').get() as any).c,
      sales_invoices: (db.prepare('SELECT COUNT(*) as c FROM sales_invoices').get() as any).c,
      purchase_invoices: (db.prepare('SELECT COUNT(*) as c FROM purchase_invoices').get() as any).c,
    },
  };

  const manifestStr = JSON.stringify(manifest, null, 2);
  const manifestChecksum = crypto.createHash('sha256').update(manifestStr).digest('hex');

  const zip = new AdmZip();
  if (params.passphrase && params.passphrase.trim().length > 0) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(params.passphrase.trim(), salt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(dbBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([Buffer.from('PCILENC1'), salt, iv, tag, encrypted]);
    zip.addFile('pcil_gst.db.enc', envelope);
  } else {
    zip.addFile('pcil_gst.db', dbBytes);
  }
  zip.addFile('manifest.json', Buffer.from(manifestStr, 'utf-8'));
  zip.writeZip(zipPath);

  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  const stats = fs.statSync(zipPath);

  db.prepare(
    `INSERT INTO backup_history (backup_filename, backup_type, is_encrypted, manifest_checksum, file_size_bytes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(zipName, params.backupType, params.passphrase ? 1 : 0, manifestChecksum, stats.size, params.actorUserId);

  logAuditEvent(params.actorUserId, params.actorUsername, 'CREATE_BACKUP', 'backup_history', zipName, null, {
    encrypted: Boolean(params.passphrase),
    size: stats.size,
  });

  return {
    filename: zipName,
    filePath: zipPath,
    manifestChecksum,
    sizeBytes: stats.size,
    encrypted: Boolean(params.passphrase),
  };
}

export function previewBackupArchive(zipBuffer: Buffer, passphrase?: string) {
  const zip = new AdmZip(zipBuffer);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Invalid backup package: manifest.json is missing.');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));

  const encEntry = zip.getEntry('pcil_gst.db.enc');
  const plainEntry = zip.getEntry('pcil_gst.db');
  if (!encEntry && !plainEntry) throw new Error('Invalid backup package: database payload missing.');

  let dbBytes: Buffer;
  if (encEntry) {
    if (!passphrase) throw new Error('This backup is encrypted. Please provide the backup passphrase.');
    const buf = encEntry.getData();
    const magic = buf.subarray(0, 8).toString('utf-8');
    if (magic !== 'PCILENC1') throw new Error('Corrupted encrypted backup header.');
    const salt = buf.subarray(8, 24);
    const iv = buf.subarray(24, 36);
    const tag = buf.subarray(36, 52);
    const ciphertext = buf.subarray(52);
    const key = crypto.scryptSync(passphrase.trim(), salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
      dbBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error('Wrong backup passphrase or tampered backup file.');
    }
  } else {
    dbBytes = plainEntry!.getData();
  }

  const actualHash = crypto.createHash('sha256').update(dbBytes).digest('hex');
  if (actualHash !== manifest.db_sha256) {
    throw new Error('Backup integrity verification failed: SHA-256 checksum mismatch.');
  }

  return { manifest, verified: true, encrypted: Boolean(encEntry), dbSizeBytes: dbBytes.length };
}

export async function restoreBackupArchive(zipBuffer: Buffer, passphrase: string | undefined, actorUserId: number, actorUsername: string) {
  // Verify first before touching active database
  const preview = previewBackupArchive(zipBuffer, passphrase);
  // Create safety snapshot before overwriting active DB
  await createBackupArchive({ backupType: 'Pre-Upgrade', actorUserId, actorUsername });

  const zip = new AdmZip(zipBuffer);
  const encEntry = zip.getEntry('pcil_gst.db.enc');
  const plainEntry = zip.getEntry('pcil_gst.db');
  let dbBytes: Buffer;
  if (encEntry) {
    const buf = encEntry.getData();
    const salt = buf.subarray(8, 24);
    const iv = buf.subarray(24, 36);
    const tag = buf.subarray(36, 52);
    const ciphertext = buf.subarray(52);
    const key = crypto.scryptSync((passphrase || '').trim(), salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    dbBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } else {
    dbBytes = plainEntry!.getData();
  }

  // Close current SQLite handle, remove WAL/SHM sidecars, write restored DB, reopen
  const currentDb = getDb();
  currentDb.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = DB_PATH + suffix;
    if (fs.existsSync(target) && suffix !== '') fs.unlinkSync(target);
  }
  fs.writeFileSync(DB_PATH, dbBytes);
  reopenDb();

  return { restored: true, manifest: preview.manifest };
}
