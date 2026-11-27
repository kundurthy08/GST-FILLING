import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { getDb, logAuditEvent, UPLOADS_DIR } from '../db.ts';
import {
  validateGstin,
  normalizeInvoiceNumber,
  toPaise,
  calcTaxPaise,
  sanitizeSpreadsheetText,
  getFinancialYearFromDate,
} from './gstUtils.ts';

export interface ParsedPreview {
  filename: string;
  fileChecksum: string;
  fileFormat: string;
  worksheets: string[];
  selectedWorksheet: string;
  detectedHeaderRow: number;
  headers: string[];
  sampleRows: Record<string, unknown>[];
  totalRows: number;
  suggestedMapping: Record<string, string>;
  duplicateFileWarning: boolean;
}

const CANONICAL_HINTS: Record<string, string[]> = {
  invoice_number: ['invoice no', 'invoice number', 'inv no', 'doc no', 'document number', 'bill no', 'note number'],
  invoice_date: ['invoice date', 'inv date', 'doc date', 'document date', 'date', 'note date'],
  customer_gstin: ['customer gstin', 'buyer gstin', 'recipient gstin', 'gstin of recipient', 'party gstin', 'ctin'],
  supplier_gstin: ['supplier gstin', 'vendor gstin', 'seller gstin', 'gstin of supplier', 'stin'],
  party_name: ['customer name', 'supplier name', 'party name', 'legal name', 'vendor name', 'trade name'],
  place_of_supply: ['place of supply', 'pos', 'state code', 'destination state'],
  hsn_code: ['hsn', 'hsn code', 'sac', 'hsn/sac'],
  product_description: ['description', 'item description', 'product', 'material', 'goods description'],
  uqc: ['uqc', 'unit', 'uom'],
  quantity: ['qty', 'quantity', 'mts', 'weight'],
  basic_value: ['basic value', 'gross value', 'base amount'],
  discount: ['discount', 'inv discount', 'trade discount'],
  taxable_value: ['taxable value', 'taxable amount', 'assessable value', 'net value'],
  gst_rate: ['gst rate', 'rate', 'tax rate', 'rate %'],
  igst: ['igst', 'igst amount', 'integrated tax'],
  cgst: ['cgst', 'cgst amount', 'central tax'],
  sgst: ['sgst', 'sgst amount', 'utgst', 'state tax'],
  cess: ['cess', 'cess amount', 'comp cess'],
  irn: ['irn', 'invoice reference number', 'e-invoice irn'],
  expense_category: ['expense category', 'category', 'gl head', 'supply nature'],
  rcm_flag: ['rcm', 'reverse charge', 'is rcm'],
  capital_goods_flag: ['capital goods', 'is capital', 'capex'],
};

export function inspectUploadedFile(
  buffer: Buffer,
  originalFilename: string,
  gstRegistrationId: number,
  returnPeriod: string,
  requestedSheet?: string
): ParsedPreview {
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = originalFilename.split('.').pop()?.toLowerCase() || '';

  const db = getDb();
  const existingBatch = db
    .prepare(
      `SELECT id FROM import_batches
       WHERE gst_registration_id = ? AND return_period = ? AND file_checksum = ?`
    )
    .get(gstRegistrationId, returnPeriod, checksum);

  let worksheets: string[] = ['JSON_Root'];
  let selectedWorksheet = 'JSON_Root';
  let rowsMatrix: unknown[][] = [];

  if (ext === 'json') {
    const parsed = JSON.parse(buffer.toString('utf-8'));
    let records: Record<string, unknown>[] = [];
    if (Array.isArray(parsed)) {
      records = parsed;
    } else if (parsed?.data?.docdata?.b2b) {
      // Official GSTR-2B style nested JSON extraction
      for (const supp of parsed.data.docdata.b2b) {
        for (const inv of supp.inv || []) {
          const itemSum = (inv.items || []).reduce(
            (acc: { txval: number; igst: number; cgst: number; sgst: number; cess: number }, it: any) => ({
              txval: acc.txval + Number(it.txval || 0),
              igst: acc.igst + Number(it.igst || 0),
              cgst: acc.cgst + Number(it.cgst || 0),
              sgst: acc.sgst + Number(it.sgst || 0),
              cess: acc.cess + Number(it.cess || 0),
            }),
            { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
          );
          records.push({
            supplier_gstin: supp.ctin,
            supplier_name: supp.trdnm || supp.ctin,
            invoice_number: inv.inum,
            invoice_date: inv.dt,
            taxable_value: itemSum.txval || inv.val,
            igst: itemSum.igst,
            cgst: itemSum.cgst,
            sgst: itemSum.sgst,
            cess: itemSum.cess,
            itc_availability: inv.itcavl || 'Y',
          });
        }
      }
    } else if (typeof parsed === 'object' && parsed !== null) {
      const firstArrKey = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
      if (firstArrKey) records = parsed[firstArrKey];
    }

    const headers = records.length > 0 ? Object.keys(records[0]) : [];
    const suggestedMapping = suggestMappings(headers);
    return {
      filename: originalFilename,
      fileChecksum: checksum,
      fileFormat: 'json',
      worksheets,
      selectedWorksheet,
      detectedHeaderRow: 1,
      headers,
      sampleRows: records.slice(0, 8),
      totalRows: records.length,
      suggestedMapping,
      duplicateFileWarning: Boolean(existingBatch),
    };
  }

  // Excel / CSV via SheetJS
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  worksheets = wb.SheetNames;
  selectedWorksheet = requestedSheet && worksheets.includes(requestedSheet) ? requestedSheet : worksheets[0];
  const sheet = wb.Sheets[selectedWorksheet];
  rowsMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  // Auto-detect probable header row (row with highest non-empty string headers among first 10 rows)
  let headerRowIdx = 0;
  let maxScore = -1;
  for (let i = 0; i < Math.min(10, rowsMatrix.length); i++) {
    const row = rowsMatrix[i] || [];
    const nonEmptyStrings = row.filter((c) => typeof c === 'string' && c.trim().length > 1).length;
    if (nonEmptyStrings > maxScore) {
      maxScore = nonEmptyStrings;
      headerRowIdx = i;
    }
  }

  const rawHeaders = (rowsMatrix[headerRowIdx] || []).map((h, idx) => String(h || `Column_${idx + 1}`).trim());
  const dataRows = rowsMatrix.slice(headerRowIdx + 1).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));

  const sampleRows = dataRows.slice(0, 8).map((r) => {
    const obj: Record<string, unknown> = {};
    rawHeaders.forEach((h, idx) => {
      const val = r[idx];
      obj[h] = val instanceof Date ? val.toISOString().slice(0, 10) : val;
    });
    return obj;
  });

  return {
    filename: originalFilename,
    fileChecksum: checksum,
    fileFormat: ext || 'xlsx',
    worksheets,
    selectedWorksheet,
    detectedHeaderRow: headerRowIdx + 1,
    headers: rawHeaders,
    sampleRows,
    totalRows: dataRows.length,
    suggestedMapping: suggestMappings(rawHeaders),
    duplicateFileWarning: Boolean(existingBatch),
  };
}

function suggestMappings(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const [canonical, hints] of Object.entries(CANONICAL_HINTS)) {
    const idx = lowerHeaders.findIndex((lh) => hints.some((hint) => lh === hint || lh.includes(hint)));
    if (idx >= 0) {
      mapping[canonical] = headers[idx];
    }
  }
  return mapping;
}

export function extractAllRows(buffer: Buffer, originalFilename: string, worksheetName: string, headerRow1Based: number): Record<string, unknown>[] {
  const ext = originalFilename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'json') {
    const parsed = JSON.parse(buffer.toString('utf-8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed?.data?.docdata?.b2b) {
      const out: Record<string, unknown>[] = [];
      for (const supp of parsed.data.docdata.b2b) {
        for (const inv of supp.inv || []) {
          const itemSum = (inv.items || []).reduce(
            (acc: { txval: number; igst: number; cgst: number; sgst: number; cess: number }, it: any) => ({
              txval: acc.txval + Number(it.txval || 0),
              igst: acc.igst + Number(it.igst || 0),
              cgst: acc.cgst + Number(it.cgst || 0),
              sgst: acc.sgst + Number(it.sgst || 0),
              cess: acc.cess + Number(it.cess || 0),
            }),
            { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
          );
          out.push({
            supplier_gstin: supp.ctin,
            supplier_name: supp.trdnm || supp.ctin,
            invoice_number: inv.inum,
            invoice_date: inv.dt,
            taxable_value: itemSum.txval || inv.val,
            igst: itemSum.igst,
            cgst: itemSum.cgst,
            sgst: itemSum.sgst,
            cess: itemSum.cess,
            itc_availability: inv.itcavl || 'Y',
          });
        }
      }
      return out;
    }
    const firstArrKey = Object.keys(parsed || {}).find((k) => Array.isArray(parsed[k]));
    return firstArrKey ? parsed[firstArrKey] : [];
  }

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[worksheetName] || wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const headerIdx = Math.max(0, headerRow1Based - 1);
  const headers = (matrix[headerIdx] || []).map((h, i) => String(h || `Column_${i + 1}`).trim());
  const out: Record<string, unknown>[] = [];

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || !row.some((c) => String(c ?? '').trim() !== '')) continue;
    const obj: Record<string, unknown> = { __sourceRow: r + 1 };
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    });
    out.push(obj);
  }
  return out;
}

export function commitRegisterImport(params: {
  buffer: Buffer;
  originalFilename: string;
  worksheetName: string;
  headerRow: number;
  gstRegistrationId: number;
  returnPeriod: string;
  registerType: string;
  mapping: Record<string, string>;
  saveProfileName?: string;
  actorUserId: number;
  actorUsername: string;
}): {
  batchId: number;
  batchCode: string;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  controlTaxablePaise: number;
  controlTaxPaise: number;
  savedInputPath: string;
  errors: { row: number; reason: string }[];
} {
  const db = getDb();
  const reg = db.prepare('SELECT * FROM gst_registrations WHERE id = ?').get(params.gstRegistrationId) as
    | { id: number; gstin: string; state_code: string }
    | undefined;
  if (!reg) throw new Error('Selected GSTIN registration not found.');

  const periodCheck = db
    .prepare('SELECT status FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
    .get(params.gstRegistrationId, params.returnPeriod) as { status: string } | undefined;
  if (periodCheck?.status === 'Locked') {
    throw new Error(`Return period ${params.returnPeriod} for ${reg.gstin} is Locked. Unlock or create an amendment period.`);
  }

  const checksum = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const rows = extractAllRows(params.buffer, params.originalFilename, params.worksheetName, params.headerRow);
  const batchCode = `IMP-${params.registerType.slice(0, 3).toUpperCase()}-${Date.now()}`;

  const getVal = (row: Record<string, unknown>, canonical: string): unknown => {
    const col = params.mapping[canonical];
    if (!col) return undefined;
    return row[col];
  };

  const errors: { row: number; reason: string }[] = [];
  let importedRows = 0;
  let rejectedRows = 0;
  let controlTaxablePaise = 0;
  let controlTaxPaise = 0;

  const tx = db.transaction(() => {
    if (params.saveProfileName?.trim()) {
      db.prepare(
        `INSERT INTO import_mapping_profiles (profile_name, register_type, file_format, header_row_index, worksheet_name, column_mapping_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_name) DO UPDATE SET
           column_mapping_json = excluded.column_mapping_json,
           header_row_index = excluded.header_row_index,
           worksheet_name = excluded.worksheet_name`
      ).run(
        params.saveProfileName.trim(),
        params.registerType,
        params.originalFilename.split('.').pop()?.toLowerCase() || 'xlsx',
        params.headerRow,
        params.worksheetName,
        JSON.stringify(params.mapping),
        params.actorUserId
      );
    }

    const batchRes = db
      .prepare(
        `INSERT INTO import_batches (
          batch_code, gst_registration_id, return_period, register_type,
          original_filename, worksheet_name, file_checksum, total_rows, imported_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        batchCode,
        params.gstRegistrationId,
        params.returnPeriod,
        params.registerType,
        params.originalFilename,
        params.worksheetName,
        checksum,
        rows.length,
        params.actorUserId
      );
    const batchId = Number(batchRes.lastInsertRowid);

    // Ensure return period row exists
    const fy = `2026-27`;
    db.prepare(
      `INSERT OR IGNORE INTO return_periods (gst_registration_id, financial_year, return_period, period_label, status)
       VALUES (?, ?, ?, ?, 'Imported')`
    ).run(params.gstRegistrationId, fy, params.returnPeriod, params.returnPeriod);

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const sourceRowNum = Number(row.__sourceRow || idx + 2);
      const rawJson = JSON.stringify(row);
      const recordHash = crypto.createHash('sha256').update(rawJson).digest('hex');

      const invNo = sanitizeSpreadsheetText(getVal(row, 'invoice_number'));
      const invDate = String(getVal(row, 'invoice_date') || '').slice(0, 10);

      if (!invNo || !invDate) {
        rejectedRows++;
        const reason = 'Missing required Invoice Number or Invoice Date (quarantined, never silently discarded).';
        errors.push({ row: sourceRowNum, reason });
        db.prepare(
          `INSERT INTO source_records (import_batch_id, gst_registration_id, return_period, source_filename, worksheet_name, source_row_number, raw_payload_json, record_hash, validation_status, rejection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Quarantined', ?)`
        ).run(batchId, params.gstRegistrationId, params.returnPeriod, params.originalFilename, params.worksheetName, sourceRowNum, rawJson, recordHash, reason);
        continue;
      }

      const srcRecId = Number(
        db
          .prepare(
            `INSERT INTO source_records (import_batch_id, gst_registration_id, return_period, source_filename, worksheet_name, source_row_number, raw_payload_json, record_hash, validation_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Accepted')`
          )
          .run(batchId, params.gstRegistrationId, params.returnPeriod, params.originalFilename, params.worksheetName, sourceRowNum, rawJson, recordHash).lastInsertRowid
      );

      const taxablePaise = toPaise(getVal(row, 'taxable_value'));
      const igstPaise = toPaise(getVal(row, 'igst'));
      const cgstPaise = toPaise(getVal(row, 'cgst'));
      const sgstPaise = toPaise(getVal(row, 'sgst'));
      const cessPaise = toPaise(getVal(row, 'cess'));
      const normInv = normalizeInvoiceNumber(invNo);

      try {
        if (params.registerType === 'sales_register') {
          const custGstin = sanitizeSpreadsheetText(getVal(row, 'customer_gstin')).toUpperCase() || null;
          const partyName = sanitizeSpreadsheetText(getVal(row, 'party_name')) || (custGstin ? custGstin : 'B2C Customer');
          const posRaw = sanitizeSpreadsheetText(getVal(row, 'place_of_supply')) || (custGstin ? custGstin.slice(0, 2) : reg.state_code);
          const pos = posRaw.slice(0, 2).padStart(2, '0');
          const isInter = pos !== reg.state_code ? 1 : 0;
          const hsn = sanitizeSpreadsheetText(getVal(row, 'hsn_code')) || '25232910';
          const desc = sanitizeSpreadsheetText(getVal(row, 'product_description')) || 'Cement Supply';
          const uqc = sanitizeSpreadsheetText(getVal(row, 'uqc')) || 'MTS';
          const qtyMilli = Math.round(Number(getVal(row, 'quantity') || 0) * 1000);
          const basicPaise = toPaise(getVal(row, 'basic_value')) || taxablePaise;
          const discPaise = toPaise(getVal(row, 'discount'));
          const rateNum = Number(getVal(row, 'gst_rate') || 28);
          const rateBps = rateNum > 100 ? Math.round(rateNum) : Math.round(rateNum * 100);
          const calcIgst = isInter ? calcTaxPaise(taxablePaise, rateBps) : 0;
          const calcCgst = isInter ? 0 : calcTaxPaise(taxablePaise, rateBps / 2);
          const calcSgst = isInter ? 0 : calcTaxPaise(taxablePaise, rateBps / 2);
          const invFy = getFinancialYearFromDate(invDate);
          const cat = custGstin ? 'B2B' : 'B2C';
          const irn = sanitizeSpreadsheetText(getVal(row, 'irn')) || null;

          // Validate GSTIN if present
          if (custGstin && !validateGstin(custGstin).valid) {
            db.prepare(
              `INSERT OR IGNORE INTO audit_exceptions (exception_code, gst_registration_id, financial_year, return_period, audit_category, severity, invoice_number, invoice_date, party_name, source_filename, worksheet_name, source_row_number, original_value_paise, expected_value_paise, difference_paise, reason, status)
               VALUES (?, ?, ?, ?, 'GSTIN Validation', 'Critical', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Open')`
            ).run(
              `EXC-GSTIN-${batchId}-${sourceRowNum}`,
              params.gstRegistrationId,
              invFy,
              params.returnPeriod,
              invNo,
              invDate,
              partyName,
              params.originalFilename,
              params.worksheetName,
              sourceRowNum,
              taxablePaise,
              taxablePaise,
              `Invalid customer GSTIN checksum or format: ${custGstin}`
            );
          }

          const saleId = Number(
            db
              .prepare(
                `INSERT INTO sales_invoices (
                  gst_registration_id, import_batch_id, source_record_id, financial_year, return_period,
                  supplier_gstin, customer_gstin, customer_name, customer_category, invoice_number,
                  normalized_invoice_number, invoice_date, document_type, supply_category, place_of_supply,
                  is_interstate, irn, irn_status, source_basic_paise, source_discount_paise,
                  source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_cess_paise,
                  source_total_paise, calc_taxable_paise, calc_igst_paise, calc_cgst_paise, calc_sgst_paise,
                  calc_total_paise, source_filename, worksheet_name, source_row_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INV', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                params.gstRegistrationId,
                batchId,
                srcRecId,
                invFy,
                params.returnPeriod,
                reg.gstin,
                custGstin,
                partyName,
                cat,
                invNo,
                normInv,
                invDate,
                cat,
                pos,
                isInter,
                irn,
                irn ? 'Active' : cat === 'B2B' ? 'Missing IRN' : 'Not Applicable',
                basicPaise,
                discPaise,
                taxablePaise,
                igstPaise,
                cgstPaise,
                sgstPaise,
                cessPaise,
                taxablePaise + igstPaise + cgstPaise + sgstPaise + cessPaise,
                taxablePaise,
                calcIgst,
                calcCgst,
                calcSgst,
                taxablePaise + calcIgst + calcCgst + calcSgst,
                params.originalFilename,
                params.worksheetName,
                sourceRowNum
              ).lastInsertRowid
          );

          db.prepare(
            `INSERT INTO sales_items (sales_invoice_id, line_number, product_description, hsn_code, uqc, quantity_milli, basic_paise, discount_paise, taxable_paise, gst_rate_bps, source_igst_paise, source_cgst_paise, source_sgst_paise, source_cess_paise, calc_igst_paise, calc_cgst_paise, calc_sgst_paise)
             VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(saleId, desc, hsn, uqc, qtyMilli, basicPaise, discPaise, taxablePaise, rateBps, igstPaise, cgstPaise, sgstPaise, cessPaise, calcIgst, calcCgst, calcSgst);
        } else if (params.registerType === 'purchase_register') {
          const suppGstin = sanitizeSpreadsheetText(getVal(row, 'supplier_gstin')).toUpperCase() || null;
          const suppName = sanitizeSpreadsheetText(getVal(row, 'party_name')) || suppGstin || 'Supplier';
          const expCat = sanitizeSpreadsheetText(getVal(row, 'expense_category')) || 'Raw Material';
          const isCap = String(getVal(row, 'capital_goods_flag') || '').toLowerCase() === 'yes' ? 1 : 0;
          const isRcm = String(getVal(row, 'rcm_flag') || '').toLowerCase() === 'yes' ? 1 : 0;
          const invFy = getFinancialYearFromDate(invDate);

          const pId = Number(
            db
              .prepare(
                `INSERT INTO purchase_invoices (
                  gst_registration_id, import_batch_id, source_record_id, financial_year, return_period,
                  recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number,
                  invoice_date, expense_category, is_capital_goods, is_rcm_applicable,
                  source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_cess_paise,
                  source_total_paise, source_filename, worksheet_name, source_row_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                params.gstRegistrationId,
                batchId,
                srcRecId,
                invFy,
                params.returnPeriod,
                reg.gstin,
                suppGstin,
                suppName,
                invNo,
                normInv,
                invDate,
                expCat,
                isCap,
                isRcm,
                taxablePaise,
                igstPaise,
                cgstPaise,
                sgstPaise,
                cessPaise,
                taxablePaise + igstPaise + cgstPaise + sgstPaise + cessPaise,
                params.originalFilename,
                params.worksheetName,
                sourceRowNum
              ).lastInsertRowid
          );

          if (isRcm) {
            db.prepare(
              `INSERT INTO rcm_register (gst_registration_id, purchase_invoice_id, return_period, supplier_name, supplier_gstin, supplier_category, supply_nature, rcm_rule_citation, taxable_paise, gst_rate_bps, igst_liability_paise, cgst_liability_paise, sgst_liability_paise, verification_status)
               VALUES (?, ?, ?, ?, ?, 'Notified RCM', ?, 'Sec 9(3) / 9(4) Imported RCM Flag', ?, 500, ?, ?, ?, 'Pending Review')`
            ).run(params.gstRegistrationId, pId, params.returnPeriod, suppName, suppGstin, expCat, taxablePaise, igstPaise, cgstPaise, sgstPaise);
          }
        } else if (params.registerType === 'gstr2b') {
          const suppGstin = sanitizeSpreadsheetText(getVal(row, 'supplier_gstin')).toUpperCase();
          const suppName = sanitizeSpreadsheetText(getVal(row, 'party_name')) || suppGstin;
          if (!suppGstin) throw new Error('Supplier GSTIN missing in GSTR-2B row.');
          db.prepare(
            `INSERT INTO gstr2b_records (
              gst_registration_id, import_batch_id, return_period, recipient_gstin, supplier_gstin,
              supplier_name, invoice_number, normalized_invoice_number, invoice_date,
              taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, source_filename, source_row_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            params.gstRegistrationId,
            batchId,
            params.returnPeriod,
            reg.gstin,
            suppGstin,
            suppName,
            invNo,
            normInv,
            invDate,
            taxablePaise,
            igstPaise,
            cgstPaise,
            sgstPaise,
            cessPaise,
            params.originalFilename,
            sourceRowNum
          );
        } else if (params.registerType === 'discount_register') {
          const partyName = sanitizeSpreadsheetText(getVal(row, 'party_name')) || 'Customer';
          const custGstin = sanitizeSpreadsheetText(getVal(row, 'customer_gstin')).toUpperCase() || null;
          const cat = sanitizeSpreadsheetText(getVal(row, 'expense_category')) || 'Commercial Credit Note';
          const isGstCn = cat.toLowerCase().includes('gst');
          db.prepare(
            `INSERT INTO discounts (gst_registration_id, import_batch_id, return_period, discount_category, note_number, note_date, customer_gstin, customer_name, accounting_value_paise, gst_adjustable_value_paise, igst_paise, cgst_paise, sgst_paise, statutory_status, source_filename, source_row_number)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            params.gstRegistrationId,
            batchId,
            params.returnPeriod,
            cat,
            invNo,
            invDate,
            custGstin,
            partyName,
            taxablePaise,
            isGstCn ? taxablePaise : 0,
            isGstCn ? igstPaise : 0,
            isGstCn ? cgstPaise : 0,
            isGstCn ? sgstPaise : 0,
            isGstCn ? 'Review Required' : 'Verified Commercial Only',
            params.originalFilename,
            sourceRowNum
          );
        }

        importedRows++;
        controlTaxablePaise += taxablePaise;
        controlTaxPaise += igstPaise + cgstPaise + sgstPaise + cessPaise;
      } catch (err: any) {
        rejectedRows++;
        const reason = err?.message?.includes('UNIQUE constraint')
          ? `Duplicate invoice detected (${invNo}) — prevented duplicate processing.`
          : err?.message || 'Validation error';
        errors.push({ row: sourceRowNum, reason });
        db.prepare(`UPDATE source_records SET validation_status = 'Rejected', rejection_reason = ? WHERE id = ?`).run(reason, srcRecId);
      }
    }

    db.prepare(
      `UPDATE import_batches SET imported_rows = ?, rejected_rows = ?, control_taxable_paise = ?, control_tax_paise = ? WHERE id = ?`
    ).run(importedRows, rejectedRows, controlTaxablePaise, controlTaxPaise, batchId);

    logAuditEvent(params.actorUserId, params.actorUsername, 'IMPORT_REGISTER', 'import_batches', batchId, null, {
      registerType: params.registerType,
      filename: params.originalFilename,
      importedRows,
      rejectedRows,
    });
  });

  tx();

  const safeGstin = path.basename(reg.gstin);
  const safePeriod = path.basename(params.returnPeriod.replace(/[^0-9A-Za-z_-]/g, ''));
  const safeOrig = path.basename(params.originalFilename).replace(/[^0-9A-Za-z._-]/g, '_');
  const destDir = path.join(UPLOADS_DIR, safeGstin, safePeriod);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, `${batchCode}_${safeOrig}`);
  fs.writeFileSync(destFile, params.buffer);
  const savedInputPath = `${safeGstin}/${safePeriod}/${batchCode}_${safeOrig}`;

  return {
    batchId: 0,
    batchCode,
    totalRows: rows.length,
    importedRows,
    rejectedRows,
    controlTaxablePaise,
    controlTaxPaise,
    savedInputPath,
    errors,
  };
}
