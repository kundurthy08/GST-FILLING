import { getDb, buildValidGstin, logAuditEvent } from '../db.ts';
import { normalizeInvoiceNumber, calcTaxPaise } from './gstUtils.ts';

// Synthetic Pilot Test Fixture Seeder (explicitly user-triggered; clearly labeled as synthetic test data)
export function loadSyntheticPilotData(actorUserId: number, actorUsername: string): {
  companyId: number;
  gstinIds: number[];
  summary: string;
} {
  const db = getDb();

  const existing = db.prepare("SELECT id FROM companies WHERE pan = 'AAACP4829K'").get() as { id: number } | undefined;
  if (existing) {
    const regs = db.prepare('SELECT id FROM gst_registrations WHERE company_id = ?').all(existing.id) as { id: number }[];
    return {
      companyId: existing.id,
      gstinIds: regs.map((r) => r.id),
      summary: 'Synthetic pilot test dataset already loaded.',
    };
  }

  const tsGstin = buildValidGstin('36AAACP4829K1Z');
  const apGstin = buildValidGstin('37AAACP4829K1Z');
  const custGstin1 = buildValidGstin('36AABCU9603R1Z');
  const custGstin2 = buildValidGstin('29AAACW3775F1Z');
  const custGstin3 = buildValidGstin('37AADCB2230M1Z');
  const suppCoal = buildValidGstin('21AAACS7924M1Z');
  const suppPack = buildValidGstin('36AABCP3312E1Z');
  const suppGta = buildValidGstin('36AADCG5541H1Z');
  const suppMach = buildValidGstin('27AAACL0140P1Z');

  const tx = db.transaction(() => {
    const compRes = db
      .prepare(
        `INSERT INTO companies (legal_name, trade_name, pan, cin, industry, registered_address)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'Parasakti Cement Industries Limited [SYNTHETIC PILOT]',
        'PCIL Cement',
        'AAACP4829K',
        'L26942TG1994PLC018412',
        'Cement Manufacturing',
        'Plot 42, Jubilee Hills Road No. 12, Hyderabad, Telangana 500033'
      );
    const companyId = Number(compRes.lastInsertRowid);

    const regTs = Number(
      db
        .prepare(
          `INSERT INTO gst_registrations (company_id, gstin, state_code, state_name, registration_type, filing_frequency, effective_from)
           VALUES (?, ?, '36', 'Telangana', 'Regular', 'Monthly', '2017-07-01')`
        )
        .run(companyId, tsGstin).lastInsertRowid
    );

    const regAp = Number(
      db
        .prepare(
          `INSERT INTO gst_registrations (company_id, gstin, state_code, state_name, registration_type, filing_frequency, effective_from)
           VALUES (?, ?, '37', 'Andhra Pradesh', 'Regular', 'Monthly', '2017-07-01')`
        )
        .run(companyId, apGstin).lastInsertRowid
    );

    // Branches: Factories & Depots
    const branchTsFactory = Number(
      db
        .prepare(
          `INSERT INTO branches (gst_registration_id, branch_code, branch_name, branch_type, state_code, address)
           VALUES (?, 'TS-FAC-01', 'Jettapalli Clinker & Grinding Works', 'Factory', '36', 'Suryapet District, Telangana')`
        )
        .run(regTs).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO branches (gst_registration_id, branch_code, branch_name, branch_type, state_code, address)
       VALUES (?, 'TS-DEP-01', 'Hyderabad Central Railhead Depot', 'Depot', '36', 'Sanathnagar, Hyderabad')`
    ).run(regTs);
    db.prepare(
      `INSERT INTO branches (gst_registration_id, branch_code, branch_name, branch_type, state_code, address)
       VALUES (?, 'AP-DEP-01', 'Vijayawada Regional Depot', 'Depot', '37', 'Autonagar, Vijayawada, AP')`
    ).run(regAp);

    // Customers & Suppliers
    db.prepare(
      `INSERT INTO customers (company_id, customer_code, legal_name, gstin, category, state_code) VALUES
       (?, 'CUST-001', 'Deccan Infra Buildcon Pvt Ltd', ?, 'B2B', '36'),
       (?, 'CUST-002', 'Karnataka Highway Projects Ltd', ?, 'B2B', '29'),
       (?, 'CUST-003', 'Coastal Amaravati Developers LLP', ?, 'B2B', '37'),
       (?, 'CUST-004', 'Retail Walk-in & Rural Dealers (B2C)', NULL, 'B2C', '36')`
    ).run(companyId, custGstin1, companyId, custGstin2, companyId, custGstin3, companyId);

    db.prepare(
      `INSERT INTO suppliers (company_id, supplier_code, legal_name, gstin, category, state_code, rcm_default) VALUES
       (?, 'SUPP-001', 'Mahanadi Coal & Fuels Corporation', ?, 'Registered', '21', 0),
       (?, 'SUPP-002', 'Telangana PolySacks Packaging Ltd', ?, 'Registered', '36', 0),
       (?, 'SUPP-003', 'Surya Bulk Cement Carriers (GTA)', ?, 'GTA', '36', 1),
       (?, 'SUPP-004', 'Larsen Heavy Grinding Systems Ltd', ?, 'Registered', '27', 0)`
    ).run(companyId, suppCoal, companyId, suppPack, companyId, suppGta, companyId, suppMach);

    // Products
    db.prepare(
      `INSERT INTO products (company_id, product_code, product_name, product_group, hsn_code, uqc) VALUES
       (?, 'OPC-53', 'Parasakti OPC 53 Grade Cement (50kg)', 'OPC', '25232910', 'MTS'),
       (?, 'PPC-01', 'Parasakti PPC Gold Cement (50kg)', 'PPC', '25232930', 'MTS'),
       (?, 'CLNK-01', 'Ordinary Portland Clinker Bulk', 'Clinker', '25231000', 'MTS'),
       (?, 'SCRP-01', 'Mill Liner Ferrous Scrap', 'Scrap', '72044900', 'MTS')`
    ).run(companyId, companyId, companyId, companyId);

    // Return Periods (Oct 2026 & Sep 2026)
    db.prepare(
      `INSERT INTO return_periods (gst_registration_id, financial_year, return_period, period_label, status)
       VALUES (?, '2026-27', '102026', 'Oct 2026', 'Imported'),
              (?, '2026-27', '092026', 'Sep 2026', 'Filed'),
              (?, '2026-27', '102026', 'Oct 2026', 'Imported')`
    ).run(regTs, regTs, regAp);

    // Import Batch for Oct 2026 Sales
    const salesBatchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (batch_code, gst_registration_id, return_period, register_type, original_filename, worksheet_name, file_checksum, total_rows, imported_rows, rejected_rows, control_taxable_paise, control_tax_paise, imported_by)
           VALUES ('PILOT-SLS-102026', ?, '102026', 'sales_register', 'SYNTHETIC_PCIL_Sales_Oct2026.xlsx', 'Sales_Register', 'pilot-sha256-sales-102026', 6, 6, 0, 5000000000, 1400000000, ?)`
        )
        .run(regTs, actorUserId).lastInsertRowid
    );

    // 6 Synthetic Sales Invoices for Telangana GSTIN (Oct 2026) totaling ~5.00 Cr taxable for clear testing
    const salesData = [
      {
        inv: 'PCIL/TS/26-27/1001',
        date: '2026-10-05',
        cName: 'Deccan Infra Buildcon Pvt Ltd',
        cGstin: custGstin1,
        cat: 'B2B',
        pos: '36',
        inter: 0,
        hsn: '25232910',
        desc: 'Parasakti OPC 53 Grade Cement (50kg)',
        qty: 2000000, // 2000 MTS
        basic: 1550000000,
        disc: 50000000,
        taxable: 1500000000, // 1.50 Cr
        rateBps: 2800,
        srcIgst: 0,
        srcCgst: 210000000,
        srcSgst: 210000000,
        irn: 'a1b2c3d4e5f60001000200030004000500060007000800090010001100120001',
        irnStatus: 'Active',
        row: 2,
      },
      {
        inv: 'PCIL/TS/26-27/1002',
        date: '2026-10-09',
        cName: 'Karnataka Highway Projects Ltd',
        cGstin: custGstin2,
        cat: 'B2B',
        pos: '29',
        inter: 1,
        hsn: '25232930',
        desc: 'Parasakti PPC Gold Cement (50kg)',
        qty: 2500000,
        basic: 1850000000,
        disc: 50000000,
        taxable: 1800000000, // 1.80 Cr
        rateBps: 2800,
        srcIgst: 504000000,
        srcCgst: 0,
        srcSgst: 0,
        irn: 'a1b2c3d4e5f60001000200030004000500060007000800090010001100120002',
        irnStatus: 'Active',
        row: 3,
      },
      {
        // Intentional rate/tax difference test case: source CGST/SGST short by Rs 1,000 each vs 28% statutory rate
        inv: 'PCIL/TS/26-27/1003',
        date: '2026-10-14',
        cName: 'Deccan Infra Buildcon Pvt Ltd',
        cGstin: custGstin1,
        cat: 'B2B',
        pos: '36',
        inter: 0,
        hsn: '25232930',
        desc: 'Parasakti PPC Gold Cement (50kg)',
        qty: 1200000,
        basic: 900000000,
        disc: 0,
        taxable: 900000000, // 90 Lakh
        rateBps: 2800,
        srcIgst: 0,
        srcCgst: 125900000, // 12,59,000 instead of 12,60,000 (Rs 1,000 diff!)
        srcSgst: 125900000,
        irn: 'a1b2c3d4e5f60001000200030004000500060007000800090010001100120003',
        irnStatus: 'Active',
        row: 4,
      },
      {
        inv: 'PCIL/TS/26-27/1004',
        date: '2026-10-18',
        cName: 'Coastal Amaravati Developers LLP',
        cGstin: custGstin3,
        cat: 'B2B',
        pos: '37',
        inter: 1,
        hsn: '25231000',
        desc: 'Ordinary Portland Clinker Bulk',
        qty: 1000000,
        basic: 500000000,
        disc: 0,
        taxable: 500000000, // 50 Lakh
        rateBps: 2800,
        srcIgst: 140000000,
        srcCgst: 0,
        srcSgst: 0,
        irn: null, // Missing IRN test case!
        irnStatus: 'Missing IRN',
        row: 5,
      },
      {
        inv: 'PCIL/TS/26-27/1005',
        date: '2026-10-22',
        cName: 'Retail Walk-in & Rural Dealers (B2C)',
        cGstin: null,
        cat: 'B2C',
        pos: '36',
        inter: 0,
        hsn: '25232910',
        desc: 'Parasakti OPC 53 Grade Cement (50kg)',
        qty: 350000,
        basic: 250000000,
        disc: 0,
        taxable: 250000000, // 25 Lakh
        rateBps: 2800,
        srcIgst: 0,
        srcCgst: 35000000,
        srcSgst: 35000000,
        irn: null,
        irnStatus: 'Not Applicable',
        row: 6,
      },
      {
        inv: 'PCIL/TS/26-27/1006',
        date: '2026-10-27',
        cName: 'Deccan Infra Buildcon Pvt Ltd',
        cGstin: custGstin1,
        cat: 'B2B',
        pos: '36',
        inter: 0,
        hsn: '72044900',
        desc: 'Mill Liner Ferrous Scrap',
        qty: 120000,
        basic: 50000000,
        disc: 0,
        taxable: 50000000, // 5 Lakh @ 18%
        rateBps: 1800,
        srcIgst: 0,
        srcCgst: 4500000,
        srcSgst: 4500000,
        irn: 'a1b2c3d4e5f60001000200030004000500060007000800090010001100120006',
        irnStatus: 'Active',
        row: 7,
      },
    ];

    const insertedSalesIds: number[] = [];
    for (const s of salesData) {
      const calcIgst = s.inter ? calcTaxPaise(s.taxable, s.rateBps) : 0;
      const calcCgst = s.inter ? 0 : calcTaxPaise(s.taxable, s.rateBps / 2);
      const calcSgst = s.inter ? 0 : calcTaxPaise(s.taxable, s.rateBps / 2);
      const srcTotal = s.taxable + s.srcIgst + s.srcCgst + s.srcSgst;
      const calcTotal = s.taxable + calcIgst + calcCgst + calcSgst;

      const invId = Number(
        db
          .prepare(
            `INSERT INTO sales_invoices (
              gst_registration_id, branch_id, import_batch_id, financial_year, return_period,
              supplier_gstin, customer_gstin, customer_name, customer_category, invoice_number,
              normalized_invoice_number, invoice_date, document_type, supply_category, place_of_supply,
              is_interstate, irn, irn_status, source_basic_paise, source_discount_paise,
              source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise,
              source_total_paise, calc_taxable_paise, calc_igst_paise, calc_cgst_paise,
              calc_sgst_paise, calc_total_paise, verification_status, source_filename, worksheet_name, source_row_number
            ) VALUES (?, ?, ?, '2026-27', '102026', ?, ?, ?, ?, ?, ?, ?, 'INV', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'SYNTHETIC_PCIL_Sales_Oct2026.xlsx', 'Sales_Register', ?)`
          )
          .run(
            regTs,
            branchTsFactory,
            salesBatchId,
            tsGstin,
            s.cGstin,
            s.cName,
            s.cat,
            s.inv,
            normalizeInvoiceNumber(s.inv),
            s.date,
            s.cat,
            s.pos,
            s.inter,
            s.irn,
            s.irnStatus,
            s.basic,
            s.disc,
            s.taxable,
            s.srcIgst,
            s.srcCgst,
            s.srcSgst,
            srcTotal,
            s.taxable,
            calcIgst,
            calcCgst,
            calcSgst,
            calcTotal,
            s.row
          ).lastInsertRowid
      );
      insertedSalesIds.push(invId);

      db.prepare(
        `INSERT INTO sales_items (
          sales_invoice_id, line_number, product_description, hsn_code, uqc, quantity_milli,
          basic_paise, discount_paise, taxable_paise, gst_rate_bps,
          source_igst_paise, source_cgst_paise, source_sgst_paise,
          calc_igst_paise, calc_cgst_paise, calc_sgst_paise
        ) VALUES (?, 1, ?, ?, 'MTS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invId,
        s.desc,
        s.hsn,
        s.qty,
        s.basic,
        s.disc,
        s.taxable,
        s.rateBps,
        s.srcIgst,
        s.srcCgst,
        s.srcSgst,
        calcIgst,
        calcCgst,
        calcSgst
      );

      if (s.irn) {
        db.prepare(
          `INSERT INTO einvoice_records (gst_registration_id, return_period, irn, ack_no, ack_date, document_number, document_date, document_type, buyer_gstin, taxable_paise, tax_paise, irn_status, matched_sales_invoice_id, reconciliation_status)
           VALUES (?, '102026', ?, ?, ?, ?, ?, 'INV', ?, ?, ?, 'Active', ?, 'Matched')`
        ).run(regTs, s.irn, `1126${s.row}88991`, s.date, s.inv, s.date, s.cGstin, s.taxable, s.srcIgst + s.srcCgst + s.srcSgst, invId);
      }
    }

    // Discounts & Credit Notes (including 1 Commercial Credit Note & 1 PPC Special Discount)
    db.prepare(
      `INSERT INTO discounts (gst_registration_id, return_period, discount_category, note_number, note_date, original_invoice_number, original_invoice_id, customer_gstin, customer_name, accounting_value_paise, gst_adjustable_value_paise, igst_paise, cgst_paise, sgst_paise, double_deduction_flag, statutory_status, agreement_ref, reason, source_filename, source_row_number)
       VALUES
       (?, '102026', 'Commercial Credit Note', 'CCN/TS/26-27/041', '2026-10-25', 'PCIL/TS/26-27/1001', ?, ?, 'Deccan Infra Buildcon Pvt Ltd', 12000000, 0, 0, 0, 0, 0, 'Verified Commercial Only', 'YEAR-END-TARGET-2026', 'Post-sale turnover incentive without Sec 15(3) ITC reversal undertaking', 'SYNTHETIC_Discounts_Oct2026.xlsx', 2),
       (?, '102026', 'PPC Special Discount', 'GCN/TS/26-27/012', '2026-10-26', 'PCIL/TS/26-27/1002', ?, ?, 'Karnataka Highway Projects Ltd', 25000000, 25000000, 7000000, 0, 0, 0, 'Approved GST Credit Note', 'AGMT-KHP-PPC-09', 'Pre-agreed PPC bulk rate difference per contract clause 4.2', 'SYNTHETIC_Discounts_Oct2026.xlsx', 3)`
    ).run(regTs, insertedSalesIds[0], custGstin1, regTs, insertedSalesIds[1], custGstin2);

    db.prepare(
      `INSERT INTO credit_debit_notes (gst_registration_id, return_period, note_type, note_number, note_date, original_invoice_number, original_invoice_date, counterparty_gstin, counterparty_name, taxable_paise, gst_rate_bps, igst_paise, cgst_paise, sgst_paise, reduces_gst_liability, verification_status, source_filename, source_row_number)
       VALUES
       (?, '102026', 'Commercial Credit Note', 'CCN/TS/26-27/041', '2026-10-25', 'PCIL/TS/26-27/1001', '2026-10-05', ?, 'Deccan Infra Buildcon Pvt Ltd', 12000000, 0, 0, 0, 0, 0, 'Verified', 'SYNTHETIC_Discounts_Oct2026.xlsx', 2),
       (?, '102026', 'GST Credit Note', 'GCN/TS/26-27/012', '2026-10-26', 'PCIL/TS/26-27/1002', '2026-10-09', ?, 'Karnataka Highway Projects Ltd', 25000000, 2800, 7000000, 0, 0, 1, 'Verified', 'SYNTHETIC_Discounts_Oct2026.xlsx', 3)`
    ).run(regTs, custGstin1, regTs, custGstin2);

    // Stock Transfer (Factory in Telangana -> Depot in Andhra Pradesh)
    db.prepare(
      `INSERT INTO stock_transfers (from_gst_registration_id, to_gst_registration_id, from_branch_name, to_branch_name, to_gstin, return_period, challan_or_invoice_no, transfer_date, hsn_code, product_description, quantity_milli, taxable_paise, igst_paise, receipt_confirmed, receipt_date, reconciliation_status)
       VALUES (?, ?, 'Jettapalli Clinker & Grinding Works', 'Vijayawada Regional Depot', ?, '102026', 'PCIL/STF/26-27/088', '2026-10-15', '25232930', 'PPC Cement Interstate Stock Transfer', 800000, 320000000, 89600000, 1, '2026-10-17', 'Matched')`
    ).run(regTs, regAp, apGstin);

    // Purchase Invoices + GSTR-2B Records
    const purBatchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (batch_code, gst_registration_id, return_period, register_type, original_filename, worksheet_name, file_checksum, total_rows, imported_rows, rejected_rows, control_taxable_paise, control_tax_paise, imported_by)
           VALUES ('PILOT-PUR-102026', ?, '102026', 'purchase_register', 'SYNTHETIC_PCIL_Purchase_Oct2026.xlsx', 'Purchase_Register', 'pilot-sha256-pur-102026', 4, 4, 0, 1650000000, 223000000, ?)`
        )
        .run(regTs, actorUserId).lastInsertRowid
    );

    const p1 = Number(
      db
        .prepare(
          `INSERT INTO purchase_invoices (gst_registration_id, import_batch_id, financial_year, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, expense_category, is_capital_goods, is_rcm_applicable, source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_cess_paise, source_total_paise, calc_taxable_paise, calc_igst_paise, itc_eligibility_status, source_filename, source_row_number)
           VALUES (?, ?, '2026-27', '102026', ?, ?, 'Mahanadi Coal & Fuels Corporation', 'MCF/26-27/4410', 'MCF26274410', '2026-10-04', 'Coal & Fuel', 0, 0, 800000000, 40000000, 0, 0, 80000000, 920000000, 800000000, 40000000, 'Eligible', 'SYNTHETIC_PCIL_Purchase_Oct2026.xlsx', 2)`
        )
        .run(regTs, purBatchId, tsGstin, suppCoal).lastInsertRowid
    );

    const p2 = Number(
      db
        .prepare(
          `INSERT INTO purchase_invoices (gst_registration_id, import_batch_id, financial_year, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, expense_category, is_capital_goods, is_rcm_applicable, source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_total_paise, calc_taxable_paise, calc_cgst_paise, calc_sgst_paise, itc_eligibility_status, source_filename, source_row_number)
           VALUES (?, ?, '2026-27', '102026', ?, ?, 'Telangana PolySacks Packaging Ltd', 'TPS-26/918', 'TPS26918', '2026-10-11', 'Packing Material', 0, 0, 350000000, 0, 31500000, 31500000, 413000000, 350000000, 31500000, 31500000, 'Eligible', 'SYNTHETIC_PCIL_Purchase_Oct2026.xlsx', 3)`
        )
        .run(regTs, purBatchId, tsGstin, suppPack).lastInsertRowid
    );

    const p3 = Number(
      db
        .prepare(
          `INSERT INTO purchase_invoices (gst_registration_id, import_batch_id, financial_year, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, expense_category, is_capital_goods, is_rcm_applicable, source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_total_paise, calc_taxable_paise, calc_igst_paise, itc_eligibility_status, source_filename, source_row_number)
           VALUES (?, ?, '2026-27', '102026', ?, ?, 'Larsen Heavy Grinding Systems Ltd', 'LHGS/INV/772', 'LHGSINV772', '2026-10-16', 'Capital Goods', 1, 0, 400000000, 72000000, 0, 0, 472000000, 400000000, 72000000, 'Pending Review', 'SYNTHETIC_PCIL_Purchase_Oct2026.xlsx', 4)`
        )
        .run(regTs, purBatchId, tsGstin, suppMach).lastInsertRowid
    );

    const p4 = Number(
      db
        .prepare(
          `INSERT INTO purchase_invoices (gst_registration_id, import_batch_id, financial_year, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, expense_category, is_capital_goods, is_rcm_applicable, source_taxable_paise, source_igst_paise, source_cgst_paise, source_sgst_paise, source_total_paise, calc_taxable_paise, calc_cgst_paise, calc_sgst_paise, itc_eligibility_status, source_filename, source_row_number)
           VALUES (?, ?, '2026-27', '102026', ?, ?, 'Surya Bulk Cement Carriers (GTA)', 'SBCC/26/312', 'SBCC26312', '2026-10-20', 'GTA Freight (RCM 5%)', 0, 1, 100000000, 0, 0, 0, 100000000, 100000000, 2500000, 2500000, 'Eligible', 'SYNTHETIC_PCIL_Purchase_Oct2026.xlsx', 5)`
        )
        .run(regTs, purBatchId, tsGstin, suppGta).lastInsertRowid
    );

    // GSTR-2B Portal Downloaded Records (p1 exact match, p2 normalized punctuation diff, p3 missing in 2B, plus 1 portal record missing in books)
    const g2b1 = Number(
      db
        .prepare(
          `INSERT INTO gstr2b_records (gst_registration_id, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_availability_portal, source_filename, source_row_number)
           VALUES (?, '102026', ?, ?, 'Mahanadi Coal & Fuels Corporation', 'MCF/26-27/4410', 'MCF26274410', '2026-10-04', 800000000, 40000000, 0, 0, 80000000, 'Yes', 'SYNTHETIC_GSTR2B_102026.json', 1)`
        )
        .run(regTs, tsGstin, suppCoal).lastInsertRowid
    );

    const g2b2 = Number(
      db
        .prepare(
          `INSERT INTO gstr2b_records (gst_registration_id, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_availability_portal, source_filename, source_row_number)
           VALUES (?, '102026', ?, ?, 'Telangana PolySacks Packaging Ltd', 'TPS/26/0918', 'TPS260918', '2026-10-11', 350000000, 0, 31500000, 31500000, 0, 'Yes', 'SYNTHETIC_GSTR2B_102026.json', 2)`
        )
        .run(regTs, tsGstin, suppPack).lastInsertRowid
    );

    const g2bExtra = Number(
      db
        .prepare(
          `INSERT INTO gstr2b_records (gst_registration_id, return_period, recipient_gstin, supplier_gstin, supplier_name, invoice_number, normalized_invoice_number, invoice_date, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_availability_portal, source_filename, source_row_number)
           VALUES (?, '102026', ?, ?, 'Larsen Heavy Grinding Systems Ltd', 'LHGS-772', 'LHGS772', '2026-10-16', 395000000, 71100000, 0, 0, 0, 'Yes', 'SYNTHETIC_GSTR2B_102026.json', 3)`
        )
        .run(regTs, tsGstin, suppMach).lastInsertRowid
    );

    // RCM Register
    db.prepare(
      `INSERT INTO rcm_register (gst_registration_id, purchase_invoice_id, return_period, supplier_name, supplier_gstin, supplier_category, supply_nature, rcm_rule_citation, taxable_paise, gst_rate_bps, igst_liability_paise, cgst_liability_paise, sgst_liability_paise, cash_paid_paise, itc_eligible, itc_claim_period, verification_status)
       VALUES (?, ?, '102026', 'Surya Bulk Cement Carriers (GTA)', ?, 'GTA', 'Bulk Clinker & Cement Road Freight', 'CBIC Notif 13/2017-CT(R) Sl.1 @ 5% RCM', 100000000, 500, 0, 2500000, 2500000, 5000000, 1, '102026', 'Verified')`
    ).run(regTs, p4, suppGta);

    // ITC Register initial entries
    db.prepare(
      `INSERT INTO itc_register (gst_registration_id, purchase_invoice_id, gstr2b_record_id, return_period, itc_category, eligibility_status, igst_paise, cgst_paise, sgst_paise, cess_paise, claim_period, legal_basis, supporting_evidence)
       VALUES
       (?, ?, ?, '102026', 'Inputs', 'Eligible', 40000000, 0, 0, 80000000, '102026', 'Sec 16(1) & 16(2)(aa) Coal for Clinker Kiln', 'Weighbridge Slip #WB-4410'),
       (?, ?, ?, '102026', 'Inputs', 'Eligible', 0, 31500000, 31500000, 0, '102026', 'Sec 16(1) Packing Bags', 'GRN #GRN-918'),
       (?, ?, ?, '102026', 'Capital Goods', 'Pending Verification', 72000000, 0, 0, 0, NULL, 'Sec 16(2)(aa) Taxable diff vs GSTR-2B', 'Awaiting supplier debit/credit clarification'),
       (?, ?, NULL, '102026', 'RCM ITC', 'Eligible', 0, 2500000, 2500000, 0, '102026', 'Sec 16(2) RCM Freight after Cash Payment', 'LR & Cash Challan')`
    ).run(regTs, p1, g2b1, regTs, p2, g2b2, regTs, p3, g2bExtra, regTs, p4);

    // Electronic GST Ledgers
    db.prepare(
      `INSERT INTO gst_ledgers (gst_registration_id, return_period, ledger_type, igst_balance_paise, cgst_balance_paise, sgst_balance_paise, cess_balance_paise, as_on_date, source_filename)
       VALUES
       (?, '102026', 'Electronic Credit Ledger', 125000000, 45000000, 45000000, 15000000, '2026-10-31', 'SYNTHETIC_Credit_Ledger.json'),
       (?, '102026', 'Electronic Cash Ledger', 5000000, 15000000, 15000000, 0, '2026-10-31', 'SYNTHETIC_Cash_Ledger.json')`
    ).run(regTs, regTs);

    // AP Registration sample record so multi-GSTIN isolation is immediately verifiable
    db.prepare(
      `INSERT INTO sales_invoices (
        gst_registration_id, import_batch_id, financial_year, return_period,
        supplier_gstin, customer_gstin, customer_name, customer_category, invoice_number,
        normalized_invoice_number, invoice_date, document_type, supply_category, place_of_supply,
        is_interstate, source_basic_paise, source_taxable_paise, source_cgst_paise, source_sgst_paise,
        source_total_paise, calc_taxable_paise, calc_cgst_paise, calc_sgst_paise, calc_total_paise,
        verification_status, source_filename, source_row_number
      ) VALUES (?, NULL, '2026-27', '102026', ?, ?, 'Coastal Amaravati Developers LLP', 'B2B', 'PCIL/AP/26-27/0201', 'PCILAP26270201', '2026-10-12', 'INV', 'B2B', '37', 0, 850000000, 850000000, 119000000, 119000000, 1088000000, 850000000, 119000000, 119000000, 1088000000, 'Verified', 'SYNTHETIC_AP_Sales_Oct2026.xlsx', 2)`
    ).run(regAp, apGstin, custGstin3);

    logAuditEvent(actorUserId, actorUsername, 'LOAD_SYNTHETIC_PILOT_DATA', 'companies', companyId, null, {
      tsGstin,
      apGstin,
      period: '102026',
    });

    return {
      companyId,
      gstinIds: [regTs, regAp],
      summary: 'Synthetic Pilot Test Dataset loaded for Telangana & Andhra Pradesh GSTINs (Oct 2026).',
    };
  });

  return tx();
}

export function removeSyntheticPilotData(actorUserId: number, actorUsername: string): {
  removed: boolean;
  summary: string;
} {
  const db = getDb();
  const pilotCompany = db.prepare("SELECT id, legal_name FROM companies WHERE pan = 'AAACP4829K'").get() as
    | { id: number; legal_name: string }
    | undefined;

  if (!pilotCompany) {
    return {
      removed: false,
      summary: 'No synthetic sample dataset is currently present in the database.',
    };
  }

  const regs = db
    .prepare('SELECT id FROM gst_registrations WHERE company_id = ?')
    .all(pilotCompany.id) as { id: number }[];
  const regIds = regs.map((r) => r.id);

  const tx = db.transaction(() => {
    if (regIds.length > 0) {
      const ph = regIds.map(() => '?').join(', ');

      const periodRows = db
        .prepare(`SELECT id FROM return_periods WHERE gst_registration_id IN (${ph})`)
        .all(...regIds) as { id: number }[];
      const periodIds = periodRows.map((p) => p.id);
      if (periodIds.length > 0) {
        const pPh = periodIds.map(() => '?').join(', ');
        db.prepare(`DELETE FROM approval_history WHERE return_period_id IN (${pPh})`).run(...periodIds);
        db.prepare(`DELETE FROM gstr1_returns WHERE return_period_id IN (${pPh})`).run(...periodIds);
        db.prepare(`DELETE FROM gstr3b_returns WHERE return_period_id IN (${pPh})`).run(...periodIds);
        db.prepare(`DELETE FROM return_versions WHERE return_period_id IN (${pPh})`).run(...periodIds);
      }

      db.prepare(`DELETE FROM audit_exceptions WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM reconciliation_results WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM export_history WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM filing_history WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM gstr1a_returns WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM gst_ledgers WHERE gst_registration_id IN (${ph})`).run(...regIds);

      db.prepare(`DELETE FROM itc_reclaims WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM itc_reversals WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM itc_register WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM rcm_register WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM ims_actions WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM gstr2b_records WHERE gst_registration_id IN (${ph})`).run(...regIds);

      db.prepare(`DELETE FROM einvoice_records WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(
        `DELETE FROM stock_transfers WHERE from_gst_registration_id IN (${ph}) OR to_gst_registration_id IN (${ph})`
      ).run(...regIds, ...regIds);
      db.prepare(`DELETE FROM credit_debit_notes WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM discounts WHERE gst_registration_id IN (${ph})`).run(...regIds);

      db.prepare(`DELETE FROM sales_invoices WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM purchase_invoices WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM source_records WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM import_batches WHERE gst_registration_id IN (${ph})`).run(...regIds);

      db.prepare(`DELETE FROM return_periods WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM branches WHERE gst_registration_id IN (${ph})`).run(...regIds);
      db.prepare(`DELETE FROM gst_registrations WHERE company_id = ?`).run(pilotCompany.id);
    }

    db.prepare('DELETE FROM products WHERE company_id = ?').run(pilotCompany.id);
    db.prepare('DELETE FROM suppliers WHERE company_id = ?').run(pilotCompany.id);
    db.prepare('DELETE FROM customers WHERE company_id = ?').run(pilotCompany.id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(pilotCompany.id);

    logAuditEvent(actorUserId, actorUsername, 'REMOVE_SYNTHETIC_PILOT_DATA', 'companies', pilotCompany.id, {
      legal_name: pilotCompany.legal_name,
      pan: 'AAACP4829K',
      removed_gstins: regIds.length,
    }, null);
  });

  tx();

  return {
    removed: true,
    summary: `Removed synthetic sample dataset (${pilotCompany.legal_name}) and its ${regIds.length} sample GSTIN(s). Your organization records remain intact.`,
  };
}
