-- Migration 001: Initial PCIL GST Compliance Manager V2.0 Schema
-- Managed by schema_migrations; executes inside a single SQLite transaction.

INSERT OR IGNORE INTO user_roles (role_code, role_name, can_import, can_prepare, can_review, can_approve, can_export, can_admin) VALUES
  ('ADMIN', 'Administrator', 1, 1, 1, 1, 1, 1),
  ('DATA_ENTRY', 'Data Entry Operator', 1, 0, 0, 0, 0, 0),
  ('ACCOUNTS_EXEC', 'Accounts Executive', 1, 1, 0, 0, 0, 0),
  ('GST_REVIEWER', 'GST Reviewer', 0, 0, 1, 0, 0, 0),
  ('APPROVING_OFFICER', 'Approving Officer', 0, 0, 1, 1, 1, 0),
  ('AUDITOR', 'Auditor', 0, 0, 0, 0, 1, 0),
  ('READ_ONLY', 'Read-only User', 0, 0, 0, 0, 0, 0);

-- Approved baseline HSN / SAC master for Cement Manufacturing (reference baseline; editable & versioned)
INSERT OR IGNORE INTO hsn_master (hsn_code, description, chapter, supply_type, approved_uqc, cement_category) VALUES
  ('25232910', 'Ordinary Portland Cement (OPC) - 43/53 Grade', '25', 'Goods', 'MTS', 'OPC'),
  ('25232930', 'Portland Pozzolana Cement (PPC)', '25', 'Goods', 'MTS', 'PPC'),
  ('25231000', 'Cement Clinker', '25', 'Goods', 'MTS', 'Clinker'),
  ('25239010', 'Slag Cement & Other Hydraulic Cements', '25', 'Goods', 'MTS', 'Other Cement'),
  ('39232990', 'PP Woven Sacks / HDPE Packing Bags', '39', 'Goods', 'NOS', 'Packing Material'),
  ('72044900', 'Ferrous Scrap & Mill Scale', '72', 'Goods', 'MTS', 'Scrap'),
  ('27011200', 'Bituminous Coal / Petcoke Fuel', '27', 'Goods', 'MTS', 'Coal & Fuel'),
  ('25201010', 'Natural Gypsum', '25', 'Goods', 'MTS', 'Gypsum & Fly Ash'),
  ('26219000', 'Fly Ash (Thermal Power Plant Residue)', '26', 'Goods', 'MTS', 'Gypsum & Fly Ash'),
  ('84742090', 'Cement Crushing & Grinding Machinery (Capital Goods)', '84', 'Goods', 'NOS', 'Capital Goods'),
  ('996511', 'Goods Transport Agency (GTA) Road Freight Services', '99', 'Services', 'OTH', 'Services'),
  ('998211', 'Legal Consultancy & Advocate Services', '99', 'Services', 'OTH', 'Services'),
  ('998821', 'Job Work & Grinding Processing Services', '99', 'Services', 'OTH', 'Services');

-- Versioned Tax Rates with effective dates and CBIC citations (bps: 2800 = 28.00%)
INSERT OR IGNORE INTO tax_rates (hsn_code, cgst_bps, sgst_bps, igst_bps, cess_bps, cess_per_unit_paise, effective_from, effective_to, legal_basis, version, approval_status) VALUES
  ('25232910', 1400, 1400, 2800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch IV Sl.18', 1, 'Approved'),
  ('25232930', 1400, 1400, 2800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch IV Sl.18', 1, 'Approved'),
  ('25231000', 1400, 1400, 2800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch IV Sl.18', 1, 'Approved'),
  ('25239010', 1400, 1400, 2800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch IV Sl.18', 1, 'Approved'),
  ('39232990', 900, 900, 1800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch III', 1, 'Approved'),
  ('72044900', 900, 900, 1800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch III (RCM u/s 9(3) if from unregistered)', 1, 'Approved'),
  ('27011200', 250, 250, 500, 0, 40000, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch I + GST Compensation Cess Rs 400/MT', 1, 'Approved'),
  ('25201010', 250, 250, 500, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch I', 1, 'Approved'),
  ('26219000', 250, 250, 500, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch I (Fly Ash)', 1, 'Approved'),
  ('84742090', 900, 900, 1800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 01/2017-Central Tax (Rate) Sch III', 1, 'Approved'),
  ('996511', 250, 250, 500, 0, 0, '2017-07-01', NULL, 'CBIC Notification 11/2017 & 13/2017-CT(R) GTA 5% RCM / 12% FCM option', 1, 'Approved'),
  ('998211', 900, 900, 1800, 0, 0, '2017-07-01', NULL, 'CBIC Notification 13/2017-CT(R) Sl.2 Legal Services RCM', 1, 'Approved'),
  ('998821', 600, 600, 1200, 0, 0, '2019-10-01', NULL, 'CBIC Notification 20/2019-CT(R) Job Work Services', 1, 'Approved');

-- Versioned Statutory GST Rules Engine Baseline
INSERT OR IGNORE INTO gst_rules (rule_code, rule_category, title, description, effective_from, source_citation, rule_payload, version, approval_status) VALUES
  ('RULE-POS-001', 'Place of Supply', 'Intrastate vs Interstate Supply Classification', 'Supplier State Code == Place of Supply => CGST+SGST; otherwise IGST. SEZ & Exports always IGST/Zero-Rated.', '2017-07-01', 'IGST Act 2017 Sec 7, 8 & 10', '{"interstate_tax":"IGST","intrastate_tax":"CGST+SGST"}', 1, 'Approved'),
  ('RULE-B2CL-001', 'GSTR-1 Threshold', 'B2C Large Interstate Invoice Threshold', 'Interstate B2C invoices exceeding Rs 1,00,000 (revised from Rs 2,50,000) reported in GSTR-1 Table 5.', '2024-08-01', 'CBIC Notification 12/2024-Central Tax', '{"b2cl_threshold_paise":10000000}', 1, 'Approved'),
  ('RULE-DISC-001', 'Discounts & Credit Notes', 'Post-Sale Discount & Commercial Credit Note Control', 'Discounts known at/before supply per agreement with ITC reversal by recipient qualify for GST Credit Note (Sec 15(3)); Commercial Credit Notes do not reduce GST liability.', '2017-07-01', 'CGST Act 2017 Sec 15(3)(b) & Sec 34', '{"allow_commercial_cn_tax_reduction":false,"cn_time_limit_month":"November following FY"}', 1, 'Approved'),
  ('RULE-ITC-001', 'ITC Eligibility', 'GSTR-2B & Sec 16(2)(aa) Restriction', 'ITC eligible only when reflected in GSTR-2B, goods/services received, tax paid, and not blocked under Sec 17(5). Rule 37 requires reversal if unpaid beyond 180 days.', '2022-01-01', 'CGST Act Sec 16(2)(aa), Sec 17(5), Rule 37', '{"require_2b_match":true,"payment_days_limit":180}', 1, 'Approved'),
  ('RULE-RCM-001', 'Reverse Charge', 'GTA & Notified RCM Services', 'GTA services subject to 5% RCM unless supplier opted for 12%/5% Forward Charge declaration. RCM tax must be paid in Cash Ledger (Table 6.1) before claiming ITC.', '2022-07-18', 'CBIC Notification 05/2022-CT(R) & Sec 9(3)', '{"cash_only_payment":true,"auto_rcm_all_transport":false}', 1, 'Approved'),
  ('RULE-SETOFF-001', 'Tax Utilization', 'Rule 88A ITC Set-Off Sequence', 'IGST credit must be exhausted completely (IGST -> CGST/SGST in any order) before utilizing CGST (CGST -> IGST) or SGST (SGST -> IGST). Cross-utilization between CGST and SGST prohibited.', '2019-04-01', 'CGST Rules Rule 88A & Circular 98/17/2019', '{"order":["IGST","CGST","SGST"],"cross_cgst_sgst":false}', 1, 'Approved');
