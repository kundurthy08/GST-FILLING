export type NavKey =
  | 'dashboard'
  | 'company_master'
  | 'gstin_master'
  | 'branch_master'
  | 'customer_master'
  | 'supplier_master'
  | 'product_hsn_master'
  | 'gst_rate_master'
  | 'import_registers'
  | 'sales_verification'
  | 'discount_verification'
  | 'purchase_verification'
  | 'einvoice_reconciliation'
  | 'gstr1_preparation'
  | 'gstr1a_amendments'
  | 'gstr2b_reconciliation'
  | 'ims_review'
  | 'itc_verification'
  | 'rcm_verification'
  | 'stock_transfer_verification'
  | 'gstr3b_preparation'
  | 'gst_return_comparison'
  | 'audit_exceptions'
  | 'government_export'
  | 'historical_returns'
  | 'management_reports'
  | 'user_management'
  | 'backup_restore'
  | 'government_updates'
  | 'settings_help';

export interface NavItem {
  key: NavKey;
  label: string;
  section: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', section: 'Overview' },
  { key: 'company_master', label: 'Company Master', section: 'Masters' },
  { key: 'gstin_master', label: 'GSTIN Master', section: 'Masters' },
  { key: 'branch_master', label: 'Branch Master', section: 'Masters' },
  { key: 'customer_master', label: 'Customer Master', section: 'Masters' },
  { key: 'supplier_master', label: 'Supplier Master', section: 'Masters' },
  { key: 'product_hsn_master', label: 'Product and HSN Master', section: 'Masters' },
  { key: 'gst_rate_master', label: 'GST Rate Master', section: 'Masters' },
  { key: 'import_registers', label: 'Import Accounting Registers', section: 'Ingestion & Sales' },
  { key: 'sales_verification', label: 'Sales Verification', section: 'Ingestion & Sales' },
  { key: 'discount_verification', label: 'Discount Verification', section: 'Ingestion & Sales' },
  { key: 'purchase_verification', label: 'Purchase Verification', section: 'Purchases & ITC' },
  { key: 'einvoice_reconciliation', label: 'E-Invoice Reconciliation', section: 'Ingestion & Sales' },
  { key: 'gstr1_preparation', label: 'GSTR-1 Preparation', section: 'Returns' },
  { key: 'gstr1a_amendments', label: 'GSTR-1A Amendments', section: 'Returns' },
  { key: 'gstr2b_reconciliation', label: 'GSTR-2B Reconciliation', section: 'Purchases & ITC' },
  { key: 'ims_review', label: 'IMS Review', section: 'Purchases & ITC' },
  { key: 'itc_verification', label: 'ITC Verification', section: 'Purchases & ITC' },
  { key: 'rcm_verification', label: 'Reverse Charge Verification', section: 'Purchases & ITC' },
  { key: 'stock_transfer_verification', label: 'Stock Transfer Verification', section: 'Ingestion & Sales' },
  { key: 'gstr3b_preparation', label: 'GSTR-3B Preparation', section: 'Returns' },
  { key: 'gst_return_comparison', label: 'GST Return Comparison', section: 'Returns' },
  { key: 'audit_exceptions', label: 'Audit and Exception Reports', section: 'Audit & Export' },
  { key: 'government_export', label: 'Government Format Export', section: 'Audit & Export' },
  { key: 'historical_returns', label: 'Historical Returns', section: 'Audit & Export' },
  { key: 'management_reports', label: 'Management Reports', section: 'Audit & Export' },
  { key: 'user_management', label: 'User Management', section: 'Governance' },
  { key: 'backup_restore', label: 'Backup and Restore', section: 'Governance' },
  { key: 'government_updates', label: 'Government Updates', section: 'Governance' },
  { key: 'settings_help', label: 'Settings and Help', section: 'Governance' },
];

export interface UserSession {
  id: number;
  username: string;
  full_name: string;
  role_code: string;
  role_name: string;
  can_import: number;
  can_prepare: number;
  can_review: number;
  can_approve: number;
  can_export: number;
  can_admin: number;
}

export interface GstRegistration {
  id: number;
  company_id: number;
  gstin: string;
  state_code: string;
  state_name: string;
  registration_type: string;
  filing_frequency: string;
  effective_from: string;
}

export function formatINR(paise: number | null | undefined): string {
  const val = (Number(paise || 0)) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatShortINR(paise: number | null | undefined): string {
  const rupees = (Number(paise || 0)) / 100;
  if (Math.abs(rupees) >= 10000000) {
    return `₹ ${(rupees / 10000000).toFixed(2)} Cr`;
  }
  if (Math.abs(rupees) >= 100000) {
    return `₹ ${(rupees / 100000).toFixed(2)} L`;
  }
  return formatINR(paise);
}
