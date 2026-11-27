-- PCIL GST Compliance Manager V2.0
-- Production SQLite Relational Schema (All monetary amounts stored as INTEGER paise)
-- Foreign Keys & Transactional Integrity Enforced

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1. Masters Domain
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  pan TEXT NOT NULL UNIQUE,
  cin TEXT,
  industry TEXT NOT NULL DEFAULT 'Cement Manufacturing',
  registered_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gst_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  gstin TEXT NOT NULL UNIQUE,
  state_code TEXT NOT NULL,
  state_name TEXT NOT NULL,
  registration_type TEXT NOT NULL DEFAULT 'Regular',
  filing_frequency TEXT NOT NULL DEFAULT 'Monthly',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gst_reg_company ON gst_registrations(company_id);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id) ON DELETE RESTRICT,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  branch_type TEXT NOT NULL CHECK (branch_type IN ('Factory', 'Branch', 'Depot', 'Head Office', 'ISD')),
  state_code TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (gst_registration_id, branch_code)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  category TEXT NOT NULL CHECK (category IN ('B2B', 'B2C', 'SEZ', 'Export', 'Deemed Export', 'Unregistered', 'Composition')),
  state_code TEXT NOT NULL,
  effective_from TEXT NOT NULL DEFAULT '2017-07-01',
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, customer_code)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  supplier_code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  category TEXT NOT NULL CHECK (category IN ('Registered', 'Unregistered', 'Composition', 'GTA', 'Advocate', 'Import', 'ISD', 'SEZ')),
  state_code TEXT NOT NULL,
  rcm_default INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL DEFAULT '2017-07-01',
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS hsn_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hsn_code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  chapter TEXT NOT NULL,
  supply_type TEXT NOT NULL CHECK (supply_type IN ('Goods', 'Services')),
  approved_uqc TEXT NOT NULL DEFAULT 'MTS',
  cement_category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_group TEXT NOT NULL CHECK (product_group IN ('OPC', 'PPC', 'Clinker', 'Other Cement', 'Packing Material', 'Scrap', 'Raw Material', 'Coal & Fuel', 'Gypsum & Fly Ash', 'Capital Goods', 'Services')),
  hsn_code TEXT NOT NULL REFERENCES hsn_master(hsn_code),
  uqc TEXT NOT NULL DEFAULT 'MTS',
  is_exempt INTEGER NOT NULL DEFAULT 0,
  is_nil_rated INTEGER NOT NULL DEFAULT 0,
  is_non_gst INTEGER NOT NULL DEFAULT 0,
  UNIQUE (company_id, product_code)
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hsn_code TEXT NOT NULL REFERENCES hsn_master(hsn_code),
  cgst_bps INTEGER NOT NULL,
  sgst_bps INTEGER NOT NULL,
  igst_bps INTEGER NOT NULL,
  cess_bps INTEGER NOT NULL DEFAULT 0,
  cess_per_unit_paise INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  legal_basis TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  approval_status TEXT NOT NULL DEFAULT 'Approved',
  UNIQUE (hsn_code, effective_from, version)
);

CREATE TABLE IF NOT EXISTS gst_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_code TEXT NOT NULL,
  rule_category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_citation TEXT NOT NULL,
  rule_payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  package_checksum TEXT,
  approval_status TEXT NOT NULL DEFAULT 'Approved',
  approved_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (rule_code, version)
);

-- 2. Security & Users
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  can_import INTEGER NOT NULL DEFAULT 0,
  can_prepare INTEGER NOT NULL DEFAULT 0,
  can_review INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0,
  can_export INTEGER NOT NULL DEFAULT 0,
  can_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES user_roles(role_code),
  allowed_gstin_ids TEXT NOT NULL DEFAULT 'ALL',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- 3. Return Periods & Versions
CREATE TABLE IF NOT EXISTS return_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id) ON DELETE RESTRICT,
  financial_year TEXT NOT NULL,
  return_period TEXT NOT NULL, -- MMYYYY e.g. 102026
  period_label TEXT NOT NULL,  -- e.g. Oct 2026
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Imported', 'Verified', 'Reconciled', 'Reviewer Approved', 'Final Approved', 'Exported', 'Filed', 'Locked')),
  current_version INTEGER NOT NULL DEFAULT 1,
  gstr1_arn TEXT,
  gstr1_filed_date TEXT,
  gstr3b_arn TEXT,
  gstr3b_filed_date TEXT,
  locked_by INTEGER REFERENCES users(id),
  locked_at TEXT,
  UNIQUE (gst_registration_id, return_period)
);

CREATE INDEX IF NOT EXISTS idx_return_periods_gstin ON return_periods(gst_registration_id, financial_year);

CREATE TABLE IF NOT EXISTS return_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_period_id INTEGER NOT NULL REFERENCES return_periods(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  return_type TEXT NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR1A', 'GSTR3B')),
  prepared_by INTEGER REFERENCES users(id),
  prepared_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Submitted', 'Reviewer Approved', 'Final Approved', 'Invalidated', 'Filed')),
  invalidation_reason TEXT,
  snapshot_json TEXT,
  UNIQUE (return_period_id, return_type, version_number)
);

-- 4. Source Evidence & Import Engine
CREATE TABLE IF NOT EXISTS import_mapping_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_name TEXT NOT NULL UNIQUE,
  register_type TEXT NOT NULL,
  file_format TEXT NOT NULL,
  header_row_index INTEGER NOT NULL DEFAULT 1,
  worksheet_name TEXT,
  column_mapping_json TEXT NOT NULL,
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code TEXT NOT NULL UNIQUE,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  register_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  worksheet_name TEXT,
  file_checksum TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  control_taxable_paise INTEGER NOT NULL DEFAULT 0,
  control_tax_paise INTEGER NOT NULL DEFAULT 0,
  imported_by INTEGER REFERENCES users(id),
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'Completed'
);

CREATE INDEX IF NOT EXISTS idx_import_batches_checksum ON import_batches(gst_registration_id, return_period, file_checksum);

CREATE TABLE IF NOT EXISTS source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  worksheet_name TEXT,
  source_row_number INTEGER NOT NULL,
  raw_payload_json TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('Accepted', 'Quarantined', 'Rejected')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_source_records_batch ON source_records(import_batch_id);

-- 5. Sales & Discounts Domain
CREATE TABLE IF NOT EXISTS sales_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  branch_id INTEGER REFERENCES branches(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  source_record_id INTEGER REFERENCES source_records(id),
  financial_year TEXT NOT NULL,
  return_period TEXT NOT NULL,
  supplier_gstin TEXT NOT NULL,
  customer_gstin TEXT,
  customer_name TEXT NOT NULL,
  customer_category TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  normalized_invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'INV',
  supply_category TEXT NOT NULL DEFAULT 'B2B',
  place_of_supply TEXT NOT NULL,
  is_interstate INTEGER NOT NULL DEFAULT 0,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  is_amended INTEGER NOT NULL DEFAULT 0,
  irn TEXT,
  irn_status TEXT DEFAULT 'Pending',
  source_basic_paise INTEGER NOT NULL DEFAULT 0,
  source_discount_paise INTEGER NOT NULL DEFAULT 0,
  source_taxable_paise INTEGER NOT NULL DEFAULT 0,
  source_igst_paise INTEGER NOT NULL DEFAULT 0,
  source_cgst_paise INTEGER NOT NULL DEFAULT 0,
  source_sgst_paise INTEGER NOT NULL DEFAULT 0,
  source_cess_paise INTEGER NOT NULL DEFAULT 0,
  source_total_paise INTEGER NOT NULL DEFAULT 0,
  calc_taxable_paise INTEGER NOT NULL DEFAULT 0,
  calc_igst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_sgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cess_paise INTEGER NOT NULL DEFAULT 0,
  calc_total_paise INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'Pending',
  source_filename TEXT,
  worksheet_name TEXT,
  source_row_number INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gst_registration_id, financial_year, normalized_invoice_number, document_type)
);

CREATE INDEX IF NOT EXISTS idx_sales_period ON sales_invoices(gst_registration_id, return_period);

CREATE TABLE IF NOT EXISTS sales_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  product_code TEXT,
  product_description TEXT NOT NULL,
  hsn_code TEXT NOT NULL,
  uqc TEXT NOT NULL DEFAULT 'MTS',
  quantity_milli INTEGER NOT NULL DEFAULT 0,
  basic_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate_bps INTEGER NOT NULL DEFAULT 0,
  source_igst_paise INTEGER NOT NULL DEFAULT 0,
  source_cgst_paise INTEGER NOT NULL DEFAULT 0,
  source_sgst_paise INTEGER NOT NULL DEFAULT 0,
  source_cess_paise INTEGER NOT NULL DEFAULT 0,
  calc_igst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_sgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cess_paise INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  return_period TEXT NOT NULL,
  discount_category TEXT NOT NULL,
  note_number TEXT NOT NULL,
  note_date TEXT NOT NULL,
  original_invoice_number TEXT,
  original_invoice_id INTEGER REFERENCES sales_invoices(id),
  customer_gstin TEXT,
  customer_name TEXT NOT NULL,
  accounting_value_paise INTEGER NOT NULL DEFAULT 0,
  gst_adjustable_value_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  double_deduction_flag INTEGER NOT NULL DEFAULT 0,
  statutory_status TEXT NOT NULL DEFAULT 'Review Required',
  agreement_ref TEXT,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  source_filename TEXT,
  source_row_number INTEGER,
  UNIQUE (gst_registration_id, return_period, note_number)
);

CREATE TABLE IF NOT EXISTS credit_debit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  note_type TEXT NOT NULL CHECK (note_type IN ('GST Credit Note', 'Commercial Credit Note', 'Debit Note')),
  note_number TEXT NOT NULL,
  note_date TEXT NOT NULL,
  original_invoice_number TEXT,
  original_invoice_date TEXT,
  counterparty_gstin TEXT,
  counterparty_name TEXT NOT NULL,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate_bps INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  reduces_gst_liability INTEGER NOT NULL DEFAULT 0,
  time_limit_valid INTEGER NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL DEFAULT 'Pending',
  source_filename TEXT,
  source_row_number INTEGER,
  UNIQUE (gst_registration_id, note_type, note_number)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  to_gst_registration_id INTEGER REFERENCES gst_registrations(id),
  from_branch_name TEXT NOT NULL,
  to_branch_name TEXT NOT NULL,
  to_gstin TEXT NOT NULL,
  return_period TEXT NOT NULL,
  challan_or_invoice_no TEXT NOT NULL,
  transfer_date TEXT NOT NULL,
  hsn_code TEXT NOT NULL,
  product_description TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL DEFAULT 0,
  uqc TEXT NOT NULL DEFAULT 'MTS',
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  receipt_confirmed INTEGER NOT NULL DEFAULT 0,
  receipt_date TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'Pending Receipt',
  UNIQUE (from_gst_registration_id, challan_or_invoice_no)
);

CREATE TABLE IF NOT EXISTS einvoice_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  irn TEXT NOT NULL UNIQUE,
  ack_no TEXT,
  ack_date TEXT,
  document_number TEXT NOT NULL,
  document_date TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'INV',
  buyer_gstin TEXT,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  irn_status TEXT NOT NULL DEFAULT 'Active',
  matched_sales_invoice_id INTEGER REFERENCES sales_invoices(id),
  reconciliation_status TEXT NOT NULL DEFAULT 'Unmatched'
);

-- 6. Purchases, GSTR-2B, IMS, ITC & RCM Domain
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  source_record_id INTEGER REFERENCES source_records(id),
  financial_year TEXT NOT NULL,
  return_period TEXT NOT NULL,
  recipient_gstin TEXT NOT NULL,
  supplier_gstin TEXT,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  normalized_invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'INV',
  expense_category TEXT NOT NULL DEFAULT 'Raw Material',
  is_capital_goods INTEGER NOT NULL DEFAULT 0,
  is_rcm_applicable INTEGER NOT NULL DEFAULT 0,
  source_taxable_paise INTEGER NOT NULL DEFAULT 0,
  source_igst_paise INTEGER NOT NULL DEFAULT 0,
  source_cgst_paise INTEGER NOT NULL DEFAULT 0,
  source_sgst_paise INTEGER NOT NULL DEFAULT 0,
  source_cess_paise INTEGER NOT NULL DEFAULT 0,
  source_total_paise INTEGER NOT NULL DEFAULT 0,
  calc_taxable_paise INTEGER NOT NULL DEFAULT 0,
  calc_igst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_sgst_paise INTEGER NOT NULL DEFAULT 0,
  calc_cess_paise INTEGER NOT NULL DEFAULT 0,
  itc_eligibility_status TEXT NOT NULL DEFAULT 'Pending Review',
  wrong_gstin_flag INTEGER NOT NULL DEFAULT 0,
  duplicate_claim_flag INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT,
  worksheet_name TEXT,
  source_row_number INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gst_registration_id, supplier_gstin, normalized_invoice_number, invoice_date, document_type)
);

CREATE INDEX IF NOT EXISTS idx_purchase_period ON purchase_invoices(gst_registration_id, return_period);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  hsn_code TEXT NOT NULL,
  uqc TEXT NOT NULL DEFAULT 'MTS',
  quantity_milli INTEGER NOT NULL DEFAULT 0,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate_bps INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gstr2b_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  return_period TEXT NOT NULL,
  recipient_gstin TEXT NOT NULL,
  supplier_gstin TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  normalized_invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'INV',
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  itc_availability_portal TEXT NOT NULL DEFAULT 'Yes',
  portal_reason TEXT,
  is_amended INTEGER NOT NULL DEFAULT 0,
  match_stage TEXT,
  match_status TEXT NOT NULL DEFAULT 'Pending Reconciliation',
  matched_purchase_id INTEGER REFERENCES purchase_invoices(id),
  taxable_diff_paise INTEGER NOT NULL DEFAULT 0,
  tax_diff_paise INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT,
  source_row_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gstr2b_period ON gstr2b_records(gst_registration_id, return_period);

CREATE TABLE IF NOT EXISTS ims_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  gstr2b_record_id INTEGER REFERENCES gstr2b_records(id),
  supplier_gstin TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  total_tax_paise INTEGER NOT NULL DEFAULT 0,
  recommended_action TEXT NOT NULL CHECK (recommended_action IN ('Accept', 'Reject', 'Pending', 'No Action')),
  reason TEXT NOT NULL,
  reviewer_approval TEXT NOT NULL DEFAULT 'Pending' CHECK (reviewer_approval IN ('Pending', 'Approved', 'Modified')),
  reviewer_id INTEGER REFERENCES users(id),
  actual_portal_action TEXT DEFAULT 'Not Recorded',
  recomputed_2b_effect_paise INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itc_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  purchase_invoice_id INTEGER REFERENCES purchase_invoices(id),
  gstr2b_record_id INTEGER REFERENCES gstr2b_records(id),
  return_period TEXT NOT NULL,
  itc_category TEXT NOT NULL CHECK (itc_category IN ('Inputs', 'Capital Goods', 'Input Services', 'Import of Goods', 'Import of Services', 'RCM ITC', 'ISD')),
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('Eligible', 'Ineligible', 'Blocked Sec 17(5)', 'Pending Verification', 'Pending Supplier Reporting', 'Reversed', 'Reclaimed')),
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  claim_period TEXT,
  legal_basis TEXT,
  supporting_evidence TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  UNIQUE (gst_registration_id, purchase_invoice_id)
);

CREATE TABLE IF NOT EXISTS itc_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  itc_register_id INTEGER REFERENCES itc_register(id),
  return_period TEXT NOT NULL,
  rule_reference TEXT NOT NULL, -- Rule 37 (180 days), Rule 42, Rule 43, Sec 17(5)
  reason TEXT NOT NULL,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itc_reclaims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  reversal_id INTEGER REFERENCES itc_reversals(id),
  return_period TEXT NOT NULL,
  reason TEXT NOT NULL,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  evidence_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rcm_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  purchase_invoice_id INTEGER REFERENCES purchase_invoices(id),
  return_period TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_gstin TEXT,
  supplier_category TEXT NOT NULL,
  supply_nature TEXT NOT NULL,
  rcm_rule_citation TEXT NOT NULL,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate_bps INTEGER NOT NULL DEFAULT 500,
  igst_liability_paise INTEGER NOT NULL DEFAULT 0,
  cgst_liability_paise INTEGER NOT NULL DEFAULT 0,
  sgst_liability_paise INTEGER NOT NULL DEFAULT 0,
  cash_paid_paise INTEGER NOT NULL DEFAULT 0,
  itc_eligible INTEGER NOT NULL DEFAULT 1,
  itc_claim_period TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Verified'
);

CREATE TABLE IF NOT EXISTS gst_ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('Electronic Credit Ledger', 'Electronic Cash Ledger', 'Electronic Liability Register')),
  igst_balance_paise INTEGER NOT NULL DEFAULT 0,
  cgst_balance_paise INTEGER NOT NULL DEFAULT 0,
  sgst_balance_paise INTEGER NOT NULL DEFAULT 0,
  cess_balance_paise INTEGER NOT NULL DEFAULT 0,
  as_on_date TEXT NOT NULL,
  source_filename TEXT,
  UNIQUE (gst_registration_id, return_period, ledger_type)
);

-- 7. Audit & Exception Management
CREATE TABLE IF NOT EXISTS reconciliation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  audit_code TEXT NOT NULL,
  audit_title TEXT NOT NULL,
  objective TEXT NOT NULL,
  books_amount_paise INTEGER NOT NULL DEFAULT 0,
  comparison_amount_paise INTEGER NOT NULL DEFAULT 0,
  difference_paise INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('Pass', 'Warning', 'Critical', 'Not Run')),
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gst_registration_id, return_period, audit_code)
);

CREATE TABLE IF NOT EXISTS audit_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_code TEXT NOT NULL UNIQUE,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  financial_year TEXT NOT NULL,
  return_period TEXT NOT NULL,
  audit_category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low', 'Information')),
  invoice_number TEXT,
  invoice_date TEXT,
  party_name TEXT,
  source_filename TEXT,
  worksheet_name TEXT,
  source_row_number INTEGER,
  original_value_paise INTEGER NOT NULL DEFAULT 0,
  expected_value_paise INTEGER NOT NULL DEFAULT 0,
  difference_paise INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  supporting_evidence TEXT,
  corrective_action TEXT,
  assigned_user_id INTEGER REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id),
  approval_date TEXT,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under review', 'Awaiting clarification', 'Awaiting supplier correction', 'Correction proposed', 'Corrected', 'Approved explanation', 'Resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_exceptions_period ON audit_exceptions(gst_registration_id, return_period, severity, status);

CREATE TABLE IF NOT EXISTS exception_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_exception_id INTEGER NOT NULL REFERENCES audit_exceptions(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  attachment_name TEXT,
  added_by INTEGER REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Return Engines (GSTR-1, GSTR-1A, GSTR-3B)
CREATE TABLE IF NOT EXISTS gstr1_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_period_id INTEGER NOT NULL REFERENCES return_periods(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  table_code TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  portal_draft_taxable_paise INTEGER NOT NULL DEFAULT 0,
  portal_draft_tax_paise INTEGER NOT NULL DEFAULT 0,
  prepared_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (return_period_id, version_number, table_code)
);

CREATE TABLE IF NOT EXISTS gstr1a_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  original_invoice_number TEXT NOT NULL,
  amendment_reason TEXT NOT NULL,
  revised_invoice_number TEXT,
  original_taxable_paise INTEGER NOT NULL DEFAULT 0,
  revised_taxable_paise INTEGER NOT NULL DEFAULT 0,
  diff_taxable_paise INTEGER NOT NULL DEFAULT 0,
  diff_igst_paise INTEGER NOT NULL DEFAULT 0,
  diff_cgst_paise INTEGER NOT NULL DEFAULT 0,
  diff_sgst_paise INTEGER NOT NULL DEFAULT 0,
  reviewer_id INTEGER REFERENCES users(id),
  approval_status TEXT NOT NULL DEFAULT 'Pending',
  portal_filing_status TEXT NOT NULL DEFAULT 'Not Filed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gstr3b_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_period_id INTEGER NOT NULL REFERENCES return_periods(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  table_code TEXT NOT NULL,
  table_name TEXT NOT NULL,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  itc_utilized_paise INTEGER NOT NULL DEFAULT 0,
  cash_payable_paise INTEGER NOT NULL DEFAULT 0,
  portal_summary_tax_paise INTEGER NOT NULL DEFAULT 0,
  prepared_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (return_period_id, version_number, table_code)
);

-- 9. Government Templates, Approvals, Exports, Filing, Backups & Audit Logs
CREATE TABLE IF NOT EXISTS government_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  return_type TEXT NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR1A', 'GSTR2B', 'GSTR3B', 'IMS')),
  official_source_url TEXT NOT NULL,
  version TEXT NOT NULL,
  applicable_from TEXT NOT NULL,
  download_date TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  worksheet_names TEXT NOT NULL,
  mandatory_fields TEXT NOT NULL,
  json_schema_json TEXT,
  approval_status TEXT NOT NULL DEFAULT 'Pending Verification' CHECK (approval_status IN ('Pending Verification', 'Verified Official', 'Deprecated')),
  imported_by INTEGER REFERENCES users(id),
  UNIQUE (return_type, version)
);

CREATE TABLE IF NOT EXISTS government_field_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  government_template_id INTEGER NOT NULL REFERENCES government_templates(id) ON DELETE CASCADE,
  worksheet_name TEXT NOT NULL,
  official_column_name TEXT NOT NULL,
  internal_field_name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  is_mandatory INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS approval_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_period_id INTEGER NOT NULL REFERENCES return_periods(id),
  version_number INTEGER NOT NULL,
  return_type TEXT NOT NULL,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS export_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  export_category TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_checksum TEXT NOT NULL,
  template_version TEXT,
  schema_validated INTEGER NOT NULL DEFAULT 0,
  exported_by INTEGER REFERENCES users(id),
  exported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS filing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gst_registration_id INTEGER NOT NULL REFERENCES gst_registrations(id),
  return_period TEXT NOT NULL,
  return_type TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  arn TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  total_taxable_paise INTEGER NOT NULL DEFAULT 0,
  total_tax_paise INTEGER NOT NULL DEFAULT 0,
  cash_paid_paise INTEGER NOT NULL DEFAULT 0,
  itc_claimed_paise INTEGER NOT NULL DEFAULT 0,
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_filename TEXT NOT NULL,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('Manual', 'Automatic', 'Pre-Upgrade', 'Pre-Lock')),
  is_encrypted INTEGER NOT NULL DEFAULT 0,
  manifest_checksum TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
