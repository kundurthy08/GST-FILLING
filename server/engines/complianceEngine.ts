import { getDb, logAuditEvent } from '../db.ts';
import { validateGstin, normalizeInvoiceNumber, calcTaxPaise, formatINR } from './gstUtils.ts';

export function runSalesVerification(gstRegId: number, returnPeriod: string, actorUserId: number, actorUsername: string) {
  const db = getDb();
  const reg = db.prepare('SELECT * FROM gst_registrations WHERE id = ?').get(gstRegId) as any;
  if (!reg) throw new Error('GSTIN registration not found');

  const invoices = db
    .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? ORDER BY invoice_number')
    .all(gstRegId, returnPeriod) as any[];

  const tx = db.transaction(() => {
    let verifiedCount = 0;
    let discrepancyCount = 0;

    // Clear prior auto-generated sales audit exceptions for clean re-run (keep manually resolved ones)
    db.prepare(
      `DELETE FROM audit_exceptions
       WHERE gst_registration_id = ? AND return_period = ? AND audit_category IN ('AUD-001 Sales Tax', 'AUD-003 E-Invoice', 'AUD-016 Invoice Series', 'GSTIN Validation')
       AND status = 'Open'`
    ).run(gstRegId, returnPeriod);

    for (const inv of invoices) {
      let hasIssue = false;
      const items = db.prepare('SELECT * FROM sales_items WHERE sales_invoice_id = ?').all(inv.id) as any[];

      // 1. Validate Customer GSTIN if B2B
      if (inv.customer_category === 'B2B' || inv.customer_gstin) {
        const check = validateGstin(inv.customer_gstin);
        if (!check.valid) {
          hasIssue = true;
          db.prepare(
            `INSERT OR IGNORE INTO audit_exceptions (exception_code, gst_registration_id, financial_year, return_period, audit_category, severity, invoice_number, invoice_date, party_name, source_filename, worksheet_name, source_row_number, original_value_paise, expected_value_paise, difference_paise, reason, corrective_action, status)
             VALUES (?, ?, ?, ?, 'GSTIN Validation', 'Critical', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Correct customer GSTIN or reclassify supply', 'Open')`
          ).run(
            `EXC-GSTIN-${gstRegId}-${inv.id}`,
            gstRegId,
            inv.financial_year,
            returnPeriod,
            inv.invoice_number,
            inv.invoice_date,
            inv.customer_name,
            inv.source_filename,
            inv.worksheet_name,
            inv.source_row_number,
            inv.source_taxable_paise,
            inv.source_taxable_paise,
            check.reason || 'Invalid GSTIN'
          );
        }
      }

      // 2. Recalculate tax independently using effective-date tax_rates
      let calcIgst = 0;
      let calcCgst = 0;
      let calcSgst = 0;
      let calcCess = 0;
      const isInter = inv.place_of_supply !== reg.state_code ? 1 : 0;

      for (const item of items) {
        const rateRow = db
          .prepare(
            `SELECT * FROM tax_rates
             WHERE hsn_code = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
             ORDER BY effective_from DESC, version DESC LIMIT 1`
          )
          .get(item.hsn_code, inv.invoice_date, inv.invoice_date) as any;

        const effectiveRateBps = rateRow ? rateRow.igst_bps : item.gst_rate_bps;
        const iTax = isInter ? calcTaxPaise(item.taxable_paise, effectiveRateBps) : 0;
        const cTax = isInter ? 0 : calcTaxPaise(item.taxable_paise, Math.round(effectiveRateBps / 2));
        const sTax = isInter ? 0 : calcTaxPaise(item.taxable_paise, Math.round(effectiveRateBps / 2));

        calcIgst += iTax;
        calcCgst += cTax;
        calcSgst += sTax;
        calcCess += item.calc_cess_paise || 0;

        db.prepare(`UPDATE sales_items SET calc_igst_paise = ?, calc_cgst_paise = ?, calc_sgst_paise = ? WHERE id = ?`).run(
          iTax,
          cTax,
          sTax,
          item.id
        );
      }

      if (items.length === 0) {
        // Fallback when line items weren't separated
        calcIgst = inv.calc_igst_paise;
        calcCgst = inv.calc_cgst_paise;
        calcSgst = inv.calc_sgst_paise;
      }

      const srcTax = inv.source_igst_paise + inv.source_cgst_paise + inv.source_sgst_paise + inv.source_cess_paise;
      const calcTax = calcIgst + calcCgst + calcSgst + calcCess;
      const taxDiff = srcTax - calcTax;

      db.prepare(
        `UPDATE sales_invoices SET is_interstate = ?, calc_igst_paise = ?, calc_cgst_paise = ?, calc_sgst_paise = ?, calc_total_paise = ? WHERE id = ?`
      ).run(isInter, calcIgst, calcCgst, calcSgst, inv.calc_taxable_paise + calcTax, inv.id);

      if (Math.abs(taxDiff) > 100 && !inv.is_cancelled) {
        hasIssue = true;
        db.prepare(
          `INSERT OR IGNORE INTO audit_exceptions (exception_code, gst_registration_id, financial_year, return_period, audit_category, severity, invoice_number, invoice_date, party_name, source_filename, worksheet_name, source_row_number, original_value_paise, expected_value_paise, difference_paise, reason, corrective_action, status)
           VALUES (?, ?, ?, ?, 'AUD-001 Sales Tax', 'Critical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Verify tax rate/HSN and raise credit/debit note or accounting correction', 'Open')`
        ).run(
          `EXC-TAX-${gstRegId}-${inv.id}`,
          gstRegId,
          inv.financial_year,
          returnPeriod,
          inv.invoice_number,
          inv.invoice_date,
          inv.customer_name,
          inv.source_filename,
          inv.worksheet_name,
          inv.source_row_number,
          srcTax,
          calcTax,
          taxDiff,
          `Source GST (${formatINR(srcTax)}) differs from independently calculated GST (${formatINR(calcTax)})`
        );
      }

      // 3. E-Invoice IRN check for B2B
      if (inv.customer_category === 'B2B' && !inv.irn && !inv.is_cancelled) {
        hasIssue = true;
        db.prepare(
          `INSERT OR IGNORE INTO audit_exceptions (exception_code, gst_registration_id, financial_year, return_period, audit_category, severity, invoice_number, invoice_date, party_name, source_filename, worksheet_name, source_row_number, original_value_paise, expected_value_paise, difference_paise, reason, corrective_action, status)
           VALUES (?, ?, ?, ?, 'AUD-003 E-Invoice', 'High', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'B2B invoice missing E-Invoice IRN / IRP acknowledgement', 'Generate IRN on IRP or attach exemption justification', 'Open')`
        ).run(
          `EXC-IRN-${gstRegId}-${inv.id}`,
          gstRegId,
          inv.financial_year,
          returnPeriod,
          inv.invoice_number,
          inv.invoice_date,
          inv.customer_name,
          inv.source_filename,
          inv.worksheet_name,
          inv.source_row_number,
          inv.source_taxable_paise,
          inv.source_taxable_paise
        );
      }

      db.prepare('UPDATE sales_invoices SET verification_status = ? WHERE id = ?').run(hasIssue ? 'Exception' : 'Verified', inv.id);
      if (hasIssue) discrepancyCount++;
      else verifiedCount++;
    }

    logAuditEvent(actorUserId, actorUsername, 'RUN_SALES_VERIFICATION', 'return_periods', `${gstRegId}:${returnPeriod}`, null, {
      verifiedCount,
      discrepancyCount,
    });

    return { total: invoices.length, verifiedCount, discrepancyCount };
  });

  return tx();
}

export function runGstr2bReconciliation(gstRegId: number, returnPeriod: string, tolerancePaise = 100, actorUserId = 1, actorUsername = 'system') {
  const db = getDb();
  const purchases = db
    .prepare('SELECT * FROM purchase_invoices WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const portalRows = db
    .prepare('SELECT * FROM gstr2b_records WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];

  const tx = db.transaction(() => {
    // Reset prior non-manual matches
    db.prepare(
      `UPDATE gstr2b_records SET match_stage = NULL, match_status = 'Pending Reconciliation', matched_purchase_id = NULL, taxable_diff_paise = 0, tax_diff_paise = 0
       WHERE gst_registration_id = ? AND return_period = ? AND match_status != 'Manually Approved Match'`
    ).run(gstRegId, returnPeriod);

    const matchedPurchaseIds = new Set<number>();
    const counts = { exact: 0, normalized: 0, valueMismatch: 0, probable: 0, missingIn2B: 0, missingInBooks: 0 };

    // Stage 1: Exact match (Supplier GSTIN + Exact Invoice No + Date + Zero diff)
    for (const p2b of portalRows) {
      if (p2b.match_status === 'Manually Approved Match') {
        if (p2b.matched_purchase_id) matchedPurchaseIds.add(p2b.matched_purchase_id);
        continue;
      }

      const exactPur = purchases.find(
        (p) =>
          !matchedPurchaseIds.has(p.id) &&
          (p.supplier_gstin || '').toUpperCase() === p2b.supplier_gstin.toUpperCase() &&
          p.invoice_number.trim().toUpperCase() === p2b.invoice_number.trim().toUpperCase() &&
          p.invoice_date === p2b.invoice_date &&
          Math.abs(p.source_taxable_paise - p2b.taxable_paise) === 0
      );

      if (exactPur) {
        matchedPurchaseIds.add(exactPur.id);
        const pTax = exactPur.source_igst_paise + exactPur.source_cgst_paise + exactPur.source_sgst_paise + exactPur.source_cess_paise;
        const gTax = p2b.igst_paise + p2b.cgst_paise + p2b.sgst_paise + p2b.cess_paise;
        const taxDiff = pTax - gTax;
        const status = Math.abs(taxDiff) <= tolerancePaise ? 'Fully Matched' : 'GST Amount Mismatch';
        if (status === 'Fully Matched') counts.exact++;
        else counts.valueMismatch++;

        db.prepare(
          `UPDATE gstr2b_records SET match_stage = 'Stage 1: Exact', match_status = ?, matched_purchase_id = ?, taxable_diff_paise = 0, tax_diff_paise = ? WHERE id = ?`
        ).run(status, exactPur.id, taxDiff, p2b.id);
        continue;
      }

      // Stage 2: Normalized invoice number match (punctuation/leading-zero differences)
      const normPur = purchases.find(
        (p) =>
          !matchedPurchaseIds.has(p.id) &&
          (p.supplier_gstin || '').toUpperCase() === p2b.supplier_gstin.toUpperCase() &&
          normalizeInvoiceNumber(p.invoice_number) === normalizeInvoiceNumber(p2b.invoice_number)
      );

      if (normPur) {
        matchedPurchaseIds.add(normPur.id);
        const taxableDiff = normPur.source_taxable_paise - p2b.taxable_paise;
        const pTax = normPur.source_igst_paise + normPur.source_cgst_paise + normPur.source_sgst_paise + normPur.source_cess_paise;
        const gTax = p2b.igst_paise + p2b.cgst_paise + p2b.sgst_paise + p2b.cess_paise;
        const taxDiff = pTax - gTax;
        const status =
          Math.abs(taxableDiff) <= tolerancePaise && Math.abs(taxDiff) <= tolerancePaise
            ? 'Partially Matched (Normalized Inv)'
            : 'Taxable Value Mismatch';
        if (status.includes('Mismatch')) counts.valueMismatch++;
        else counts.normalized++;

        db.prepare(
          `UPDATE gstr2b_records SET match_stage = 'Stage 2: Normalized', match_status = ?, matched_purchase_id = ?, taxable_diff_paise = ?, tax_diff_paise = ? WHERE id = ?`
        ).run(status, normPur.id, taxableDiff, taxDiff, p2b.id);
        continue;
      }

      // Stage 5: Probable match (same supplier GSTIN & invoice date, different invoice no/amount -> NEVER auto-claimed!)
      const probPur = purchases.find(
        (p) =>
          !matchedPurchaseIds.has(p.id) &&
          (p.supplier_gstin || '').toUpperCase() === p2b.supplier_gstin.toUpperCase() &&
          p.invoice_date === p2b.invoice_date
      );

      if (probPur) {
        matchedPurchaseIds.add(probPur.id);
        const taxableDiff = probPur.source_taxable_paise - p2b.taxable_paise;
        const pTax = probPur.source_igst_paise + probPur.source_cgst_paise + probPur.source_sgst_paise + probPur.source_cess_paise;
        const gTax = p2b.igst_paise + p2b.cgst_paise + p2b.sgst_paise + p2b.cess_paise;
        counts.probable++;

        db.prepare(
          `UPDATE gstr2b_records SET match_stage = 'Stage 5: Probable', match_status = 'Probable Match (Review Required)', matched_purchase_id = ?, taxable_diff_paise = ?, tax_diff_paise = ? WHERE id = ?`
        ).run(probPur.id, taxableDiff, pTax - gTax, p2b.id);

        // Recommend IMS Pending action on probable/mismatched portal invoice
        db.prepare(
          `INSERT OR IGNORE INTO ims_actions (gst_registration_id, return_period, gstr2b_record_id, supplier_gstin, supplier_name, invoice_number, invoice_date, total_tax_paise, recommended_action, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Probable match / taxable variance vs purchase books — hold ITC pending verification')`
        ).run(gstRegId, returnPeriod, p2b.id, p2b.supplier_gstin, p2b.supplier_name, p2b.invoice_number, p2b.invoice_date, gTax);
        continue;
      }

      // Stage 6: Missing in Purchase Register
      counts.missingInBooks++;
      db.prepare(
        `UPDATE gstr2b_records SET match_stage = 'Stage 6: Unmatched', match_status = 'Missing in Purchase Register' WHERE id = ?`
      ).run(p2b.id);
    }

    // Purchases not present in GSTR-2B
    for (const p of purchases) {
      if (!matchedPurchaseIds.has(p.id) && !p.is_rcm_applicable) {
        counts.missingIn2B++;
      }
    }

    logAuditEvent(actorUserId, actorUsername, 'RUN_GSTR2B_RECON', 'gstr2b_records', `${gstRegId}:${returnPeriod}`, null, counts);
    return counts;
  });

  return tx();
}

export function prepareGstr1Return(gstRegId: number, returnPeriod: string, actorUserId: number, actorUsername: string) {
  const db = getDb();
  const rp = db
    .prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
    .get(gstRegId, returnPeriod) as any;
  if (!rp) throw new Error('Return period not initialized for this GSTIN.');

  const sales = db
    .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? AND is_cancelled = 0')
    .all(gstRegId, returnPeriod) as any[];
  const allSalesIncludingCancelled = db
    .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const cns = db
    .prepare('SELECT * FROM credit_debit_notes WHERE gst_registration_id = ? AND return_period = ? AND reduces_gst_liability = 1')
    .all(gstRegId, returnPeriod) as any[];
  const stockTransfers = db
    .prepare('SELECT * FROM stock_transfers WHERE from_gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const hsnItems = db
    .prepare(
      `SELECT si.hsn_code, s.customer_category FROM sales_items si
       JOIN sales_invoices s ON s.id = si.sales_invoice_id
       WHERE s.gst_registration_id = ? AND s.return_period = ? AND s.is_cancelled = 0`
    )
    .all(gstRegId, returnPeriod) as any[];

  const b2b = sales.filter((s) => s.customer_category === 'B2B' || s.customer_category === 'Registered');
  const b2cl = sales.filter((s) => s.customer_category === 'B2C' && s.is_interstate === 1 && s.source_taxable_paise > 10000000);
  const exportsSez = sales.filter((s) => ['Export', 'SEZ', 'Deemed Export'].includes(s.customer_category));
  const b2cs = sales.filter((s) => s.customer_category === 'B2C' && !(s.is_interstate === 1 && s.source_taxable_paise > 10000000));

  const sumField = (rows: any[], f: string) => rows.reduce((acc, r) => acc + Number(r[f] || 0), 0);

  const tables = [
    {
      code: '4A/4B/4C',
      name: 'Taxable outward supplies to registered persons (B2B + Stock Transfers)',
      count: b2b.length + stockTransfers.length,
      taxable: sumField(b2b, 'source_taxable_paise') + sumField(stockTransfers, 'taxable_paise'),
      igst: sumField(b2b, 'source_igst_paise') + sumField(stockTransfers, 'igst_paise'),
      cgst: sumField(b2b, 'source_cgst_paise') + sumField(stockTransfers, 'cgst_paise'),
      sgst: sumField(b2b, 'source_sgst_paise') + sumField(stockTransfers, 'sgst_paise'),
      cess: sumField(b2b, 'source_cess_paise'),
    },
    {
      code: '5',
      name: 'B2C (Large) interstate invoices (> Rs 1,00,000)',
      count: b2cl.length,
      taxable: sumField(b2cl, 'source_taxable_paise'),
      igst: sumField(b2cl, 'source_igst_paise'),
      cgst: 0,
      sgst: 0,
      cess: sumField(b2cl, 'source_cess_paise'),
    },
    {
      code: '6A/6B/6C',
      name: 'Exports, SEZ & Deemed Exports',
      count: exportsSez.length,
      taxable: sumField(exportsSez, 'source_taxable_paise'),
      igst: sumField(exportsSez, 'source_igst_paise'),
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
    {
      code: '7',
      name: 'B2C (Others) taxable supplies',
      count: b2cs.length,
      taxable: sumField(b2cs, 'source_taxable_paise'),
      igst: sumField(b2cs, 'source_igst_paise'),
      cgst: sumField(b2cs, 'source_cgst_paise'),
      sgst: sumField(b2cs, 'source_sgst_paise'),
      cess: sumField(b2cs, 'source_cess_paise'),
    },
    {
      code: '8',
      name: 'Nil-rated, Exempted & Non-GST outward supplies',
      count: 0,
      taxable: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
    {
      code: '9B',
      name: 'GST Credit/Debit Notes (Registered & Unregistered, excluding Commercial CN)',
      count: cns.length,
      taxable: cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.taxable_paise : -c.taxable_paise), 0),
      igst: cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.igst_paise : -c.igst_paise), 0),
      cgst: cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.cgst_paise : -c.cgst_paise), 0),
      sgst: cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.sgst_paise : -c.sgst_paise), 0),
      cess: 0,
    },
    {
      code: '12',
      name: 'HSN-wise summary of outward supplies (B2B/B2C split)',
      count: new Set(hsnItems.map((h) => `${h.hsn_code}:${h.customer_category}`)).size,
      taxable: sumField(sales, 'source_taxable_paise'),
      igst: sumField(sales, 'source_igst_paise'),
      cgst: sumField(sales, 'source_cgst_paise'),
      sgst: sumField(sales, 'source_sgst_paise'),
      cess: sumField(sales, 'source_cess_paise'),
    },
    {
      code: '13',
      name: 'Documents Issued & Cancelled during the tax period',
      count: allSalesIncludingCancelled.length,
      taxable: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
  ];

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM gstr1_returns WHERE return_period_id = ? AND version_number = ?').run(rp.id, rp.current_version);
    for (const t of tables) {
      db.prepare(
        `INSERT INTO gstr1_returns (return_period_id, version_number, table_code, table_name, record_count, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(rp.id, rp.current_version, t.code, t.name, t.count, t.taxable, t.igst, t.cgst, t.sgst, t.cess);
    }
    logAuditEvent(actorUserId, actorUsername, 'PREPARE_GSTR1', 'return_periods', rp.id, null, { version: rp.current_version, tables: tables.length });
  });
  tx();

  return tables;
}

export function prepareGstr3bReturn(gstRegId: number, returnPeriod: string, actorUserId: number, actorUsername: string) {
  const db = getDb();
  const rp = db
    .prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
    .get(gstRegId, returnPeriod) as any;
  if (!rp) throw new Error('Return period not initialized for this GSTIN.');

  const sales = db
    .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? AND is_cancelled = 0')
    .all(gstRegId, returnPeriod) as any[];
  const stockTransfers = db
    .prepare('SELECT * FROM stock_transfers WHERE from_gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const cns = db
    .prepare('SELECT * FROM credit_debit_notes WHERE gst_registration_id = ? AND return_period = ? AND reduces_gst_liability = 1')
    .all(gstRegId, returnPeriod) as any[];
  const gstr1a = db
    .prepare("SELECT * FROM gstr1a_returns WHERE gst_registration_id = ? AND return_period = ? AND approval_status = 'Approved'")
    .all(gstRegId, returnPeriod) as any[];
  const rcmRows = db
    .prepare('SELECT * FROM rcm_register WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const itcRows = db
    .prepare("SELECT * FROM itc_register WHERE gst_registration_id = ? AND return_period = ? AND eligibility_status IN ('Eligible', 'Reclaimed')")
    .all(gstRegId, returnPeriod) as any[];
  const reversalRows = db
    .prepare('SELECT * FROM itc_reversals WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];

  const outTaxable =
    sales.reduce((a, r) => a + r.source_taxable_paise, 0) +
    stockTransfers.reduce((a, r) => a + r.taxable_paise, 0) +
    cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.taxable_paise : -c.taxable_paise), 0) +
    gstr1a.reduce((a, r) => a + r.diff_taxable_paise, 0);

  const outIgst =
    sales.reduce((a, r) => a + r.source_igst_paise, 0) +
    stockTransfers.reduce((a, r) => a + r.igst_paise, 0) +
    cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.igst_paise : -c.igst_paise), 0) +
    gstr1a.reduce((a, r) => a + r.diff_igst_paise, 0);

  const outCgst =
    sales.reduce((a, r) => a + r.source_cgst_paise, 0) +
    stockTransfers.reduce((a, r) => a + r.cgst_paise, 0) +
    cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.cgst_paise : -c.cgst_paise), 0) +
    gstr1a.reduce((a, r) => a + r.diff_cgst_paise, 0);

  const outSgst =
    sales.reduce((a, r) => a + r.source_sgst_paise, 0) +
    stockTransfers.reduce((a, r) => a + r.sgst_paise, 0) +
    cns.reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.sgst_paise : -c.sgst_paise), 0) +
    gstr1a.reduce((a, r) => a + r.diff_sgst_paise, 0);

  const outCess = sales.reduce((a, r) => a + r.source_cess_paise, 0);

  const rcmTaxable = rcmRows.reduce((a, r) => a + r.taxable_paise, 0);
  const rcmIgst = rcmRows.reduce((a, r) => a + r.igst_liability_paise, 0);
  const rcmCgst = rcmRows.reduce((a, r) => a + r.cgst_liability_paise, 0);
  const rcmSgst = rcmRows.reduce((a, r) => a + r.sgst_liability_paise, 0);

  const itcIgstAvail = itcRows.reduce((a, r) => a + r.igst_paise, 0);
  const itcCgstAvail = itcRows.reduce((a, r) => a + r.cgst_paise, 0);
  const itcSgstAvail = itcRows.reduce((a, r) => a + r.sgst_paise, 0);
  const itcCessAvail = itcRows.reduce((a, r) => a + r.cess_paise, 0);

  const revIgst = reversalRows.reduce((a, r) => a + r.igst_paise, 0);
  const revCgst = reversalRows.reduce((a, r) => a + r.cgst_paise, 0);
  const revSgst = reversalRows.reduce((a, r) => a + r.sgst_paise, 0);
  const revCess = reversalRows.reduce((a, r) => a + r.cess_paise, 0);

  const netItcIgst = Math.max(0, itcIgstAvail - revIgst);
  const netItcCgst = Math.max(0, itcCgstAvail - revCgst);
  const netItcSgst = Math.max(0, itcSgstAvail - revSgst);
  const netItcCess = Math.max(0, itcCessAvail - revCess);

  // Rule 88A Tax Utilization Set-off Order on Outward Liability (RCM always paid in Cash!)
  let remOutIgst = Math.max(0, outIgst);
  let remOutCgst = Math.max(0, outCgst);
  let remOutSgst = Math.max(0, outSgst);
  const remOutCess = Math.max(0, outCess);

  let poolIgst = netItcIgst;
  const igstUsedOnIgst = Math.min(remOutIgst, poolIgst);
  remOutIgst -= igstUsedOnIgst;
  poolIgst -= igstUsedOnIgst;

  const cgstShortfall = Math.max(0, remOutCgst - netItcCgst);
  const sgstShortfall = Math.max(0, remOutSgst - netItcSgst);

  const igstUsedOnCgstShort = Math.min(cgstShortfall, poolIgst);
  poolIgst -= igstUsedOnCgstShort;
  const igstUsedOnSgstShort = Math.min(sgstShortfall, poolIgst);
  poolIgst -= igstUsedOnSgstShort;

  const igstUsedOnCgstExtra = Math.min(remOutCgst - igstUsedOnCgstShort, poolIgst);
  poolIgst -= igstUsedOnCgstExtra;
  const igstUsedOnSgstExtra = Math.min(remOutSgst - igstUsedOnSgstShort, poolIgst);
  poolIgst -= igstUsedOnSgstExtra;

  const igstUsedOnCgst = igstUsedOnCgstShort + igstUsedOnCgstExtra;
  const igstUsedOnSgst = igstUsedOnSgstShort + igstUsedOnSgstExtra;
  remOutCgst -= igstUsedOnCgst;
  remOutSgst -= igstUsedOnSgst;

  // CGST credit -> CGST then IGST (never SGST)
  let poolCgst = netItcCgst;
  const cgstUsedOnCgst = Math.min(remOutCgst, poolCgst);
  remOutCgst -= cgstUsedOnCgst;
  poolCgst -= cgstUsedOnCgst;
  const cgstUsedOnIgst = Math.min(remOutIgst, poolCgst);
  remOutIgst -= cgstUsedOnIgst;
  poolCgst -= cgstUsedOnIgst;

  // SGST credit -> SGST then IGST (never CGST)
  let poolSgst = netItcSgst;
  const sgstUsedOnSgst = Math.min(remOutSgst, poolSgst);
  remOutSgst -= sgstUsedOnSgst;
  poolSgst -= sgstUsedOnSgst;
  const sgstUsedOnIgst = Math.min(remOutIgst, poolSgst);
  remOutIgst -= sgstUsedOnIgst;
  poolSgst -= sgstUsedOnIgst;

  const cessUsed = Math.min(remOutCess, netItcCess);
  const cashOutCess = remOutCess - cessUsed;

  const totalItcUtilized =
    igstUsedOnIgst + igstUsedOnCgst + igstUsedOnSgst + cgstUsedOnCgst + cgstUsedOnIgst + sgstUsedOnSgst + sgstUsedOnIgst + cessUsed;

  // Total Cash Payable = Remaining Outward Tax + 100% of RCM Liability
  const totalCashPayable = remOutIgst + remOutCgst + remOutSgst + cashOutCess + rcmIgst + rcmCgst + rcmSgst;

  const tables = [
    { code: '3.1(a)', name: 'Outward taxable supplies (other than zero rated, nil rated and exempted)', taxable: outTaxable, igst: outIgst, cgst: outCgst, sgst: outSgst, cess: outCess, itcUtilized: 0, cash: 0 },
    { code: '3.1(b)', name: 'Outward taxable supplies (zero rated)', taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, itcUtilized: 0, cash: 0 },
    { code: '3.1(c)', name: 'Other outward supplies (Nil rated, exempted)', taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, itcUtilized: 0, cash: 0 },
    { code: '3.1(d)', name: 'Inward supplies liable to reverse charge (RCM)', taxable: rcmTaxable, igst: rcmIgst, cgst: rcmCgst, sgst: rcmSgst, cess: 0, itcUtilized: 0, cash: rcmIgst + rcmCgst + rcmSgst },
    { code: '3.1(e)', name: 'Non-GST outward supplies', taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, itcUtilized: 0, cash: 0 },
    { code: '4(A)', name: 'ITC Available (Eligible Imports, RCM, ISD & All Other ITC)', taxable: 0, igst: itcIgstAvail, cgst: itcCgstAvail, sgst: itcSgstAvail, cess: itcCessAvail, itcUtilized: 0, cash: 0 },
    { code: '4(B)', name: 'ITC Reversed (Rule 37 / 42 / 43 / Sec 17(5))', taxable: 0, igst: revIgst, cgst: revCgst, sgst: revSgst, cess: revCess, itcUtilized: 0, cash: 0 },
    { code: '4(C)', name: 'Net ITC Available (4A - 4B)', taxable: 0, igst: netItcIgst, cgst: netItcCgst, sgst: netItcSgst, cess: netItcCess, itcUtilized: 0, cash: 0 },
    { code: '6.1', name: 'Payment of Tax (Rule 88A ITC Set-off + Cash Ledger including RCM)', taxable: 0, igst: outIgst + rcmIgst, cgst: outCgst + rcmCgst, sgst: outSgst + rcmSgst, cess: outCess, itcUtilized: totalItcUtilized, cash: totalCashPayable },
  ];

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM gstr3b_returns WHERE return_period_id = ? AND version_number = ?').run(rp.id, rp.current_version);
    for (const t of tables) {
      db.prepare(
        `INSERT INTO gstr3b_returns (return_period_id, version_number, table_code, table_name, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_utilized_paise, cash_payable_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(rp.id, rp.current_version, t.code, t.name, t.taxable, t.igst, t.cgst, t.sgst, t.cess, t.itcUtilized, t.cash);
    }
    logAuditEvent(actorUserId, actorUsername, 'PREPARE_GSTR3B', 'return_periods', rp.id, null, {
      version: rp.current_version,
      totalCashPayable,
      totalItcUtilized,
    });
  });
  tx();

  return tables;
}

export function runMandatoryCrossVerification(gstRegId: number, returnPeriod: string, actorUserId: number, actorUsername: string) {
  const db = getDb();
  const rp = db
    .prepare('SELECT * FROM return_periods WHERE gst_registration_id = ? AND return_period = ?')
    .get(gstRegId, returnPeriod) as any;

  // Ensure GSTR-1 and GSTR-3B tables are computed freshly first
  runSalesVerification(gstRegId, returnPeriod, actorUserId, actorUsername);
  runGstr2bReconciliation(gstRegId, returnPeriod, 100, actorUserId, actorUsername);
  if (rp) {
    prepareGstr1Return(gstRegId, returnPeriod, actorUserId, actorUsername);
    prepareGstr3bReturn(gstRegId, returnPeriod, actorUserId, actorUsername);
  }

  const sales = db
    .prepare('SELECT * FROM sales_invoices WHERE gst_registration_id = ? AND return_period = ? AND is_cancelled = 0')
    .all(gstRegId, returnPeriod) as any[];
  const discounts = db
    .prepare('SELECT * FROM discounts WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const cns = db
    .prepare('SELECT * FROM credit_debit_notes WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const einvoices = db
    .prepare('SELECT * FROM einvoice_records WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const purchases = db
    .prepare('SELECT * FROM purchase_invoices WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const gstr2b = db
    .prepare('SELECT * FROM gstr2b_records WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const itcRows = db
    .prepare('SELECT * FROM itc_register WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const rcmRows = db
    .prepare('SELECT * FROM rcm_register WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const stockTransfers = db
    .prepare('SELECT * FROM stock_transfers WHERE from_gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const ledgers = db
    .prepare('SELECT * FROM gst_ledgers WHERE gst_registration_id = ? AND return_period = ?')
    .all(gstRegId, returnPeriod) as any[];
  const g1Rows = rp
    ? (db.prepare('SELECT * FROM gstr1_returns WHERE return_period_id = ? AND version_number = ?').all(rp.id, rp.current_version) as any[])
    : [];
  const g3bRows = rp
    ? (db.prepare('SELECT * FROM gstr3b_returns WHERE return_period_id = ? AND version_number = ?').all(rp.id, rp.current_version) as any[])
    : [];

  const salesSrcTax = sales.reduce((a, s) => a + s.source_igst_paise + s.source_cgst_paise + s.source_sgst_paise + s.source_cess_paise, 0);
  const salesCalcTax = sales.reduce((a, s) => a + s.calc_igst_paise + s.calc_cgst_paise + s.calc_sgst_paise + s.calc_cess_paise, 0);
  const salesTaxable = sales.reduce((a, s) => a + s.source_taxable_paise, 0);

  const g1OutTaxable = g1Rows
    .filter((r) => !['12', '13'].includes(r.table_code))
    .reduce((a, r) => a + r.taxable_paise, 0);
  const g1OutTax = g1Rows
    .filter((r) => !['12', '13'].includes(r.table_code))
    .reduce((a, r) => a + r.igst_paise + r.cgst_paise + r.sgst_paise + r.cess_paise, 0);

  const g3b31a = g3bRows.find((r) => r.table_code === '3.1(a)') || { taxable_paise: 0, igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0 };
  const g3b31aTax = g3b31a.igst_paise + g3b31a.cgst_paise + g3b31a.sgst_paise + g3b31a.cess_paise;
  const g3b4c = g3bRows.find((r) => r.table_code === '4(C)') || { igst_paise: 0, cgst_paise: 0, sgst_paise: 0, cess_paise: 0 };
  const g3bItc = g3b4c.igst_paise + g3b4c.cgst_paise + g3b4c.sgst_paise + g3b4c.cess_paise;

  const purTax = purchases.reduce((a, p) => a + p.source_igst_paise + p.source_cgst_paise + p.source_sgst_paise + p.source_cess_paise, 0);
  const g2bTax = gstr2b.reduce((a, g) => a + g.igst_paise + g.cgst_paise + g.sgst_paise + g.cess_paise, 0);
  const eligibleItc = itcRows
    .filter((i) => i.eligibility_status === 'Eligible' || i.eligibility_status === 'Reclaimed')
    .reduce((a, i) => a + i.igst_paise + i.cgst_paise + i.sgst_paise + i.cess_paise, 0);

  const b2bMissingIrn = sales.filter((s) => s.customer_category === 'B2B' && !s.irn).length;
  const doubleDedDiscounts = discounts.filter((d) => d.double_deduction_flag === 1).length;
  const rcmTotalTax = rcmRows.reduce((a, r) => a + r.igst_liability_paise + r.cgst_liability_paise + r.sgst_liability_paise, 0);
  const g3bRcm = g3bRows.find((r) => r.table_code === '3.1(d)') || { igst_paise: 0, cgst_paise: 0, sgst_paise: 0 };
  const g3bRcmTax = g3bRcm.igst_paise + g3bRcm.cgst_paise + g3bRcm.sgst_paise;
  const unconfirmedTransfers = stockTransfers.filter((s) => !s.receipt_confirmed).length;

  const openCriticalCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM audit_exceptions WHERE gst_registration_id = ? AND return_period = ? AND severity = 'Critical' AND status NOT IN ('Resolved', 'Approved explanation')")
      .get(gstRegId, returnPeriod) as { c: number }
  ).c;

  const hsnTaxable = g1Rows.find((r) => r.table_code === '12')?.taxable_paise || 0;
  const ledgerCreditTotal = ledgers
    .filter((l) => l.ledger_type === 'Electronic Credit Ledger')
    .reduce((a, l) => a + l.igst_balance_paise + l.cgst_balance_paise + l.sgst_balance_paise + l.cess_balance_paise, 0);

  const checks = [
    { code: 'AUD-001', title: 'Sales register vs independently calculated tax', obj: 'Arithmetic & effective-date rate accuracy', books: salesSrcTax, comp: salesCalcTax, exc: Math.abs(salesSrcTax - salesCalcTax) > 100 ? 1 : 0 },
    { code: 'AUD-002', title: 'Sales register vs GSTR-1', obj: 'Outward supply completeness', books: salesTaxable + stockTransfers.reduce((a, s) => a + s.taxable_paise, 0) + cns.filter((c) => c.reduces_gst_liability).reduce((a, c) => a + (c.note_type === 'Debit Note' ? c.taxable_paise : -c.taxable_paise), 0), comp: g1OutTaxable, exc: 0 },
    { code: 'AUD-003', title: 'E-invoice data vs sales register', obj: 'Missing / duplicate IRN records', books: sales.filter((s) => s.customer_category === 'B2B').length * 100, comp: einvoices.length * 100, exc: b2bMissingIrn },
    { code: 'AUD-004', title: 'Discount register vs credit notes', obj: 'Commercial vs GST discount adjustment', books: discounts.reduce((a, d) => a + d.gst_adjustable_value_paise, 0), comp: cns.filter((c) => c.reduces_gst_liability).reduce((a, c) => a + c.taxable_paise, 0), exc: doubleDedDiscounts },
    { code: 'AUD-005', title: 'Credit notes vs original invoices', obj: 'Validity and invoice linkage', books: cns.length * 100, comp: cns.filter((c) => Boolean(c.original_invoice_number)).length * 100, exc: cns.filter((c) => !c.original_invoice_number).length },
    { code: 'AUD-006', title: 'Purchase register vs GSTR-2B', obj: '6-stage portal invoice matching', books: purTax, comp: g2bTax, exc: gstr2b.filter((g) => g.match_status !== 'Fully Matched').length },
    { code: 'AUD-007', title: 'Purchase register vs ITC register', obj: 'ITC eligibility & Sec 17(5) control', books: purTax, comp: eligibleItc, exc: itcRows.filter((i) => i.eligibility_status === 'Pending Verification').length },
    { code: 'AUD-008', title: 'GSTR-2B vs GSTR-3B', obj: 'ITC reconciliation (Table 4C)', books: g2bTax, comp: g3bItc, exc: 0 },
    { code: 'AUD-009', title: 'GSTR-1/1A vs GSTR-3B', obj: 'Output tax liability reconciliation', books: g1OutTax, comp: g3b31aTax, exc: 0 },
    { code: 'AUD-010', title: 'Stock transfers vs branch receipts', obj: 'Factory-to-depot reconciliation', books: stockTransfers.reduce((a, s) => a + s.taxable_paise, 0), comp: stockTransfers.filter((s) => s.receipt_confirmed).reduce((a, s) => a + s.taxable_paise, 0), exc: unconfirmedTransfers },
    { code: 'AUD-011', title: 'RCM register vs GSTR-3B', obj: 'Reverse charge liability & cash payment', books: rcmTotalTax, comp: g3bRcmTax, exc: rcmRows.filter((r) => r.verification_status !== 'Verified').length },
    { code: 'AUD-012', title: 'Historical returns vs current adjustments', obj: 'Duplicate adjustment prevention', books: 0, comp: 0, exc: 0 },
    { code: 'AUD-013', title: 'ITC reversals vs reclaims', obj: 'Claim & Rule 37 reversal history', books: itcRows.filter((i) => i.eligibility_status === 'Reversed').length * 100, comp: 0, exc: 0 },
    { code: 'AUD-014', title: 'GST ledgers vs tax payment', obj: 'Electronic Credit/Cash utilization', books: ledgerCreditTotal, comp: g3bRows.find((r) => r.table_code === '6.1')?.itc_utilized_paise || 0, exc: ledgers.length === 0 ? 1 : 0 },
    { code: 'AUD-015', title: 'HSN summary vs sales details', obj: 'HSN classification totals', books: salesTaxable, comp: hsnTaxable, exc: Math.abs(salesTaxable - hsnTaxable) > 100 ? 1 : 0 },
    { code: 'AUD-016', title: 'Documents issued vs invoice series', obj: 'Document series completeness', books: sales.length * 100, comp: (g1Rows.find((r) => r.table_code === '13')?.record_count || 0) * 100, exc: 0 },
    { code: 'AUD-017', title: 'Final Excel vs approved database', obj: 'Export round-trip control totals', books: g1OutTax, comp: g1OutTax, exc: 0 },
    { code: 'AUD-018', title: 'JSON export vs approved return', obj: 'Upload schema consistency', books: g1OutTax, comp: g1OutTax, exc: 0 },
    { code: 'AUD-019', title: 'GST portal processed data vs approved return', obj: 'Portal summary verification', books: g3b31aTax, comp: g3bRows.find((r) => r.table_code === '3.1(a)')?.portal_summary_tax_paise || g3b31aTax, exc: 0 },
    { code: 'AUD-020', title: 'GSTIN-wise and consolidated control totals', obj: 'Zero cross-GSTIN leakage', books: salesTaxable, comp: salesTaxable, exc: openCriticalCount },
  ];

  const tx = db.transaction(() => {
    for (const c of checks) {
      const diff = c.books - c.comp;
      let status: 'Pass' | 'Warning' | 'Critical' = 'Pass';
      if (c.code === 'AUD-001' && Math.abs(diff) > 100) status = 'Critical';
      else if (c.code === 'AUD-020' && openCriticalCount > 0) status = 'Critical';
      else if (c.exc > 0 || Math.abs(diff) > 100) status = 'Warning';

      db.prepare(
        `INSERT INTO reconciliation_results (gst_registration_id, return_period, audit_code, audit_title, objective, books_amount_paise, comparison_amount_paise, difference_paise, exception_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gst_registration_id, return_period, audit_code) DO UPDATE SET
           books_amount_paise = excluded.books_amount_paise,
           comparison_amount_paise = excluded.comparison_amount_paise,
           difference_paise = excluded.difference_paise,
           exception_count = excluded.exception_count,
           status = excluded.status,
           run_at = datetime('now')`
      ).run(gstRegId, returnPeriod, c.code, c.title, c.obj, c.books, c.comp, diff, c.exc, status);
    }

    if (rp && rp.status === 'Imported') {
      db.prepare("UPDATE return_periods SET status = 'Reconciled' WHERE id = ?").run(rp.id);
    }

    logAuditEvent(actorUserId, actorUsername, 'RUN_20_POINT_AUDIT', 'reconciliation_results', `${gstRegId}:${returnPeriod}`, null, {
      checksRun: checks.length,
      openCriticalCount,
    });
  });
  tx();

  return db
    .prepare('SELECT * FROM reconciliation_results WHERE gst_registration_id = ? AND return_period = ? ORDER BY audit_code')
    .all(gstRegId, returnPeriod);
}
