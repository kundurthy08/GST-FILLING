import React, { useEffect, useState } from 'react';
import {
  Play,
  Download,
  Lock,
  CheckCircle2,
  ShieldAlert,
  Archive,
  Upload,
  UserPlus,
  FolderOpen,
} from 'lucide-react';
import { apiFetch, apiDownload } from '../api';
import { formatINR } from '../types';
import {
  isFolderPickerSupported,
  connectWorkspaceFolder,
  getConnectedFolderName,
  saveOutputToConnectedFolder,
} from '../utils/localFolderSync';

interface ReturnsAndAuditViewsProps {
  viewKey:
    | 'gstr1_preparation'
    | 'gstr1a_amendments'
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
  selectedGstinId: number | null;
  selectedPeriod: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onContextUpdated: () => void;
}

export const ReturnsAndAuditViews: React.FC<ReturnsAndAuditViewsProps> = ({
  viewKey,
  selectedGstinId,
  selectedPeriod,
  darkMode,
  onToggleDarkMode,
  onContextUpdated,
}) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Forms & modals
  const [arn, setArn] = useState('');
  const [filedDate, setFiledDate] = useState('2026-11-18');
  const [lockOnFile, setLockOnFile] = useState(true);
  const [backupPass, setBackupPass] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [newUser, setNewUser] = useState({ username: '', full_name: '', password: '', role_code: 'GST_REVIEWER' });
  const [newG1a, setNewG1a] = useState({ original_invoice_number: '', amendment_reason: '', revised_invoice_number: '', original_taxable: '', revised_taxable: '', diff_igst: '0', diff_cgst: '0', diff_sgst: '0' });
  const [newTemplate, setNewTemplate] = useState({ template_name: '', return_type: 'GSTR1', version: '', official_source_url: 'https://www.gst.gov.in/download/returns' });
  const [connectedFolder, setConnectedFolder] = useState<string | null>(getConnectedFolderName());

  const load = async () => {
    setError(null);
    try {
      const qs = `gstinId=${selectedGstinId || ''}&period=${selectedPeriod}`;
      if (viewKey === 'gstr1_preparation' && selectedGstinId) {
        setData(await apiFetch(`/api/gstr1?${qs}`));
      } else if (viewKey === 'gstr1a_amendments' && selectedGstinId) {
        setData(await apiFetch(`/api/gstr1a?${qs}`));
      } else if (viewKey === 'gstr3b_preparation' && selectedGstinId) {
        setData(await apiFetch(`/api/gstr3b?${qs}`));
      } else if (viewKey === 'gst_return_comparison' && selectedGstinId) {
        const [g1, g3, aud] = await Promise.all([
          apiFetch(`/api/gstr1?${qs}`),
          apiFetch(`/api/gstr3b?${qs}`),
          apiFetch(`/api/audit?${qs}`),
        ]);
        setData({ g1, g3, aud });
      } else if (viewKey === 'audit_exceptions' && selectedGstinId) {
        setData(await apiFetch(`/api/audit?${qs}`));
      } else if (viewKey === 'government_export') {
        const [cat, ws] = await Promise.all([
          apiFetch(`/api/exports/catalog?${selectedGstinId ? `gstinId=${selectedGstinId}` : ''}`),
          apiFetch('/api/workspace-files'),
        ]);
        setData({ ...cat, outputFiles: ws.outputFiles || [] });
      } else if (viewKey === 'historical_returns' && selectedGstinId) {
        setData(await apiFetch(`/api/approvals?${qs}`));
      } else if (viewKey === 'management_reports') {
        setData(await apiFetch(`/api/dashboard?period=${selectedPeriod}`));
      } else if (viewKey === 'user_management') {
        const [u, logs] = await Promise.all([apiFetch('/api/users'), apiFetch('/api/audit-logs')]);
        setData({ ...u, logs: logs.logs });
      } else if (viewKey === 'backup_restore') {
        setData(await apiFetch('/api/backups'));
      } else if (viewKey === 'government_updates') {
        setData(await apiFetch('/api/gov-templates'));
      } else if (viewKey === 'settings_help') {
        setData(await apiFetch('/api/auth/status'));
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setNotice(null);
    setRestorePreview(null);
    load();
  }, [viewKey, selectedGstinId, selectedPeriod]);

  const requiresGstin = [
    'gstr1_preparation',
    'gstr1a_amendments',
    'gstr3b_preparation',
    'gst_return_comparison',
    'audit_exceptions',
    'historical_returns',
  ].includes(viewKey);

  if (requiresGstin && !selectedGstinId) {
    return (
      <div className="p-8 text-center rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-500">
        Please select a specific GSTIN registration in the top bar. Statutory returns are strictly segregated by GSTIN.
      </div>
    );
  }

  const runPost = async (url: string, body: any, successMsg?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (successMsg) setNotice(successMsg);
      await load();
      onContextUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight capitalize">
            {viewKey.replace(/_/g, ' ')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Period {selectedPeriod} · Versioned statutory processing &amp; maker-checker audit trail
          </p>
        </div>

        <div className="flex items-center gap-2">
          {viewKey === 'gstr1_preparation' && (
            <button
              onClick={() => runPost('/api/gstr1/prepare', { gstinId: selectedGstinId, period: selectedPeriod }, 'GSTR-1 tables independently recomputed from verified sales.')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Prepare GSTR-1</span>
            </button>
          )}
          {viewKey === 'gstr3b_preparation' && (
            <button
              onClick={() => runPost('/api/gstr3b/prepare', { gstinId: selectedGstinId, period: selectedPeriod }, 'GSTR-3B & Rule 88A ITC set-off recomputed.')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Prepare GSTR-3B</span>
            </button>
          )}
          {viewKey === 'audit_exceptions' && (
            <button
              onClick={() => runPost('/api/audit/run', { gstinId: selectedGstinId, period: selectedPeriod }, 'All 20 AUD-001..AUD-020 cross-verification checks completed.')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run 20-Point Cross-Verification</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* GSTR-1 Preparation */}
      {viewKey === 'gstr1_preparation' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                  <th className="py-2.5 px-3">Table</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-right">Count</th>
                  <th className="py-2.5 px-3 text-right">Taxable Value</th>
                  <th className="py-2.5 px-3 text-right">IGST</th>
                  <th className="py-2.5 px-3 text-right">CGST</th>
                  <th className="py-2.5 px-3 text-right">SGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.tables || []).length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-500">Click Prepare GSTR-1 to compute official tables.</td></tr>
                ) : (
                  (data?.tables || []).map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono font-semibold">{t.table_code}</td>
                      <td className="py-2.5 px-3">{t.table_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.record_count}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.taxable_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.igst_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.cgst_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.sgst_paise)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Table 12 HSN-Wise Summary (B2B / B2C Split)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">HSN Code</th>
                  <th className="py-2 px-3">Supply Split</th>
                  <th className="py-2 px-3">UQC</th>
                  <th className="py-2 px-3 text-right">Quantity</th>
                  <th className="py-2 px-3 text-right">Taxable Value</th>
                  <th className="py-2 px-3 text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.hsnSummary || []).map((h: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-mono font-medium">{h.hsn_code}</td>
                    <td className="py-2 px-3">{h.customer_category}</td>
                    <td className="py-2 px-3 font-mono">{h.uqc}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{(h.qty_milli / 1000).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(h.taxable_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(h.igst_paise + h.cgst_paise + h.sgst_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GSTR-1A Amendments */}
      {viewKey === 'gstr1a_amendments' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runPost('/api/gstr1a', { gstinId: selectedGstinId, period: selectedPeriod, ...newG1a }, 'GSTR-1A amendment recorded.');
            }}
            className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs"
          >
            <input required placeholder="Original Invoice No" value={newG1a.original_invoice_number} onChange={(e) => setNewG1a({ ...newG1a, original_invoice_number: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            <input required placeholder="Amendment Reason" value={newG1a.amendment_reason} onChange={(e) => setNewG1a({ ...newG1a, amendment_reason: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            <input required type="number" placeholder="Original Taxable (INR)" value={newG1a.original_taxable} onChange={(e) => setNewG1a({ ...newG1a, original_taxable: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono" />
            <input required type="number" placeholder="Revised Taxable (INR)" value={newG1a.revised_taxable} onChange={(e) => setNewG1a({ ...newG1a, revised_taxable: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono" />
            <div className="md:col-span-4 flex justify-end">
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#0F2942] text-white font-medium">Add GSTR-1A Amendment</button>
            </div>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2.5 px-3">Original Invoice</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3 text-right">Orig Taxable</th>
                  <th className="py-2.5 px-3 text-right">Revised Taxable</th>
                  <th className="py-2.5 px-3 text-right">Delta Taxable</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.rows || []).length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-500">No GSTR-1A amendments recorded for this period.</td></tr>
                ) : (
                  (data?.rows || []).map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-3 font-mono">{r.original_invoice_number}</td>
                      <td className="py-2.5 px-3">{r.amendment_reason}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.original_taxable_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.revised_taxable_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.diff_taxable_paise)}</td>
                      <td className="py-2.5 px-3">{r.approval_status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GSTR-3B Preparation */}
      {viewKey === 'gstr3b_preparation' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                  <th className="py-2.5 px-3">Table</th>
                  <th className="py-2.5 px-3">Particulars</th>
                  <th className="py-2.5 px-3 text-right">Taxable</th>
                  <th className="py-2.5 px-3 text-right">IGST</th>
                  <th className="py-2.5 px-3 text-right">CGST</th>
                  <th className="py-2.5 px-3 text-right">SGST</th>
                  <th className="py-2.5 px-3 text-right">ITC Utilized</th>
                  <th className="py-2.5 px-3 text-right">Cash Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.tables || []).length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-slate-500">Click Prepare GSTR-3B to compute Rule 88A liability and cash payment worksheet.</td></tr>
                ) : (
                  (data?.tables || []).map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono font-semibold">{t.table_code}</td>
                      <td className="py-2.5 px-3">{t.table_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.taxable_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.igst_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.cgst_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(t.sgst_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(t.itc_utilized_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">{formatINR(t.cash_payable_paise)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Electronic Credit &amp; Cash Ledgers (Imported Portal Balances)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Ledger Type</th>
                  <th className="py-2 px-3 text-right">IGST</th>
                  <th className="py-2 px-3 text-right">CGST</th>
                  <th className="py-2 px-3 text-right">SGST</th>
                  <th className="py-2 px-3 text-right">Cess</th>
                  <th className="py-2 px-3">As On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.ledgers || []).map((l: any) => (
                  <tr key={l.id}>
                    <td className="py-2 px-3 font-medium">{l.ledger_type}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(l.igst_balance_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(l.cgst_balance_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(l.sgst_balance_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(l.cess_balance_paise)}</td>
                    <td className="py-2 px-3 font-mono">{l.as_on_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GST Return Comparison */}
      {viewKey === 'gst_return_comparison' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3 text-xs">
          <h3 className="text-sm font-semibold">Cross-Return Control Totals (GSTR-1 vs GSTR-3B vs GSTR-2B)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Audit Code</th>
                  <th className="py-2 px-3">Check</th>
                  <th className="py-2 px-3 text-right">Books / Source</th>
                  <th className="py-2 px-3 text-right">Comparison Return</th>
                  <th className="py-2 px-3 text-right">Difference</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.aud?.results || [])
                  .filter((r: any) => ['AUD-002', 'AUD-008', 'AUD-009', 'AUD-014', 'AUD-019'].includes(r.audit_code))
                  .map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2 px-3 font-mono font-semibold">{r.audit_code}</td>
                      <td className="py-2 px-3">{r.audit_title}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.books_amount_paise)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.comparison_amount_paise)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.difference_paise)}</td>
                      <td className="py-2 px-3 font-medium">{r.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 20-Point Cross-Verification Audit & Permanent Exception Register */}
      {viewKey === 'audit_exceptions' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Mandatory 20-Point Cross-Verification Matrix (AUD-001 through AUD-020)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                  <th className="py-2 px-3">Code</th>
                  <th className="py-2 px-3">Verification</th>
                  <th className="py-2 px-3">Objective</th>
                  <th className="py-2 px-3 text-right">Books</th>
                  <th className="py-2 px-3 text-right">Comparison</th>
                  <th className="py-2 px-3 text-right">Difference</th>
                  <th className="py-2 px-3 text-right">Exceptions</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.results || []).map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-mono font-semibold">{r.audit_code}</td>
                    <td className="py-2 px-3 font-medium">{r.audit_title}</td>
                    <td className="py-2 px-3 text-slate-500">{r.objective}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.books_amount_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.comparison_amount_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(r.difference_paise)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{r.exception_count}</td>
                    <td className={`py-2 px-3 font-semibold ${r.status === 'Critical' ? 'text-red-600' : r.status === 'Warning' ? 'text-amber-600' : 'text-emerald-700'}`}>
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Permanent Exception Register (Unresolved Critical items block official return export)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">ID</th>
                  <th className="py-2 px-3">Severity</th>
                  <th className="py-2 px-3">Invoice / Source</th>
                  <th className="py-2 px-3 text-right">Difference</th>
                  <th className="py-2 px-3">Reason</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Disposition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.exceptions || []).length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-500">No exceptions logged for this GSTIN and period.</td></tr>
                ) : (
                  (data?.exceptions || []).map((ex: any) => (
                    <tr key={ex.id}>
                      <td className="py-2 px-3 font-mono text-[11px]">{ex.exception_code}</td>
                      <td className={`py-2 px-3 font-semibold ${ex.severity === 'Critical' ? 'text-red-600' : 'text-amber-600'}`}>
                        {ex.severity}
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-mono">{ex.invoice_number}</div>
                        <div className="text-[11px] text-slate-500">{ex.source_filename} #{ex.source_row_number}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(ex.difference_paise)}</td>
                      <td className="py-2 px-3 max-w-xs">{ex.reason}</td>
                      <td className="py-2 px-3 font-medium">{ex.status}</td>
                      <td className="py-2 px-3 flex gap-1.5">
                        <button
                          onClick={() =>
                            runPost(`/api/exceptions/${ex.id}/resolve`, {
                              status: 'Approved explanation',
                              supporting_evidence: 'Reviewed by GST compliance officer against original invoice',
                            })
                          }
                          className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          Approve Explanation
                        </button>
                        <button
                          onClick={() =>
                            runPost(`/api/exceptions/${ex.id}/resolve`, {
                              status: 'Resolved',
                              corrective_action: 'Source correction / credit-debit note posted',
                            })
                          }
                          className="px-2 py-1 text-[11px] rounded bg-[#0F2942] text-white whitespace-nowrap"
                        >
                          Mark Resolved
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Government Format Export (25 Deliverables) */}
      {viewKey === 'government_export' && (
        <div className="space-y-5">
          <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
                <span>Separate Output Folder Storage (output_files/)</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Every generated report is stored in <code className="font-mono">output_files/&lt;GSTIN&gt;/&lt;Period&gt;/</code> on the server and remains available after sign-out.
                {connectedFolder && (
                  <span className="ml-1 font-medium text-emerald-700 dark:text-emerald-400">
                    Also auto-saving to PC folder: {connectedFolder}/output_files/
                  </span>
                )}
              </div>
            </div>
            {isFolderPickerSupported() && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await connectWorkspaceFolder();
                    setConnectedFolder(res.name);
                    setNotice(`Connected PC folder "${res.name}". Generated outputs will also save into ${res.name}/output_files/.`);
                  } catch (err: any) {
                    if (err?.name !== 'AbortError') setError(err.message);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{connectedFolder ? `Output Folder: ${connectedFolder}/output_files` : 'Connect PC Output Folder'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(data?.catalog || []).map((rep: any) => (
              <div key={rep.key} className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>{rep.category}</span>
                    <span className="font-mono uppercase">{rep.format}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{rep.label}</div>
                  {rep.requiresCleanCritical && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      Requires zero unresolved Critical exceptions
                    </div>
                  )}
                </div>
                <button
                  disabled={!selectedGstinId}
                  onClick={async () => {
                    setError(null);
                    setNotice(null);
                    try {
                      const dl = await apiDownload(
                        '/api/exports/generate',
                        {
                          method: 'POST',
                          body: JSON.stringify({ reportKey: rep.key, gstinId: selectedGstinId, period: selectedPeriod }),
                        },
                        `${rep.key}.${rep.format}`
                      );
                      const localPath = await saveOutputToConnectedFolder(dl.filename, dl.blob);
                      setNotice(
                        localPath
                          ? `Generated & saved to ${localPath} (and archived in server output_files/).`
                          : `Generated ${dl.filename} and saved in server output_files/ folder.`
                      );
                      await load();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] text-white text-xs font-medium disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Generate &amp; Download</span>
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold">Persisted Output Files Folder (output_files/)</span>
              <span className="font-mono text-[11px] text-slate-500">{(data?.outputFiles || []).length} file(s) retained</span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Output Folder Path</th>
                  <th className="py-2 px-3 text-right">Size</th>
                  <th className="py-2 px-3">Generated At</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.outputFiles || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">No output reports generated yet.</td>
                  </tr>
                ) : (
                  (data?.outputFiles || []).slice(0, 25).map((f: any) => (
                    <tr key={f.relativePath}>
                      <td className="py-2 px-3 font-mono text-[11px]">output_files/{f.relativePath}</td>
                      <td className="py-2 px-3 text-right font-mono">{(f.sizeBytes / 1024).toFixed(1)} KB</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{f.modifiedAt.slice(0, 19).replace('T', ' ')}</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() =>
                            apiDownload(
                              `/api/workspace-files/download?folder=output_files&path=${encodeURIComponent(f.relativePath)}`,
                              {},
                              f.filename
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical Returns, Maker-Checker Approval & Period Locking */}
      {viewKey === 'historical_returns' && (
        <div className="space-y-5">
          <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs text-slate-500">Current Period Status</div>
                <div className="text-lg font-bold text-slate-900 dark:text-white">
                  {data?.returnPeriod?.status || 'Draft'} · Version v{data?.returnPeriod?.current_version || 1}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runPost('/api/approvals/advance', { gstinId: selectedGstinId, period: selectedPeriod, targetStage: 'Reviewer Approved', remarks: 'Verified by GST Reviewer' }, 'Reviewer Approval recorded.')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>1. Reviewer Sign-off</span>
                </button>
                <button
                  onClick={() => runPost('/api/approvals/advance', { gstinId: selectedGstinId, period: selectedPeriod, targetStage: 'Final Approved', remarks: 'Authorized for portal upload' }, 'Final Officer Approval recorded.')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>2. Final Approving Officer</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-3 items-end text-xs">
              <div>
                <label className="block mb-1 font-medium">Portal ARN</label>
                <input value={arn} onChange={(e) => setArn(e.target.value)} placeholder="e.g. AA361126009842Z" className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono" />
              </div>
              <div>
                <label className="block mb-1 font-medium">Filing Date</label>
                <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono" />
              </div>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" checked={lockOnFile} onChange={(e) => setLockOnFile(e.target.checked)} />
                <span>Create Pre-Lock Backup &amp; Lock Period</span>
              </label>
              <button
                onClick={() => runPost('/api/filing/record', { gstinId: selectedGstinId, period: selectedPeriod, returnType: 'GSTR3B', arn, filedDate, lockPeriod: lockOnFile }, 'ARN archived and period updated.')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Archive ARN &amp; Lock</span>
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">Approval &amp; Filing History</div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Stage</th>
                  <th className="py-2 px-3">Actor</th>
                  <th className="py-2 px-3">Role</th>
                  <th className="py-2 px-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.history || []).map((h: any) => (
                  <tr key={h.id}>
                    <td className="py-2 px-3 font-mono text-[11px]">{h.created_at}</td>
                    <td className="py-2 px-3 font-medium">{h.stage}</td>
                    <td className="py-2 px-3">{h.full_name}</td>
                    <td className="py-2 px-3 font-mono">{h.actor_role}</td>
                    <td className="py-2 px-3">{h.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Management Reports */}
      {viewKey === 'management_reports' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="text-sm font-semibold">Consolidated All-GSTIN Executive Summary (Non-Statutory Management View)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-3.5 rounded border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">All-India Taxable Sales</div>
              <div className="text-base font-bold font-mono tabular-nums mt-1">{formatINR(data?.kpis?.taxableSales)}</div>
            </div>
            <div className="p-3.5 rounded border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">All-India Output Tax</div>
              <div className="text-base font-bold font-mono tabular-nums mt-1">{formatINR(data?.kpis?.totalOutputGst)}</div>
            </div>
            <div className="p-3.5 rounded border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">All-India Eligible ITC</div>
              <div className="text-base font-bold font-mono tabular-nums mt-1">{formatINR(data?.kpis?.eligibleItc)}</div>
            </div>
            <div className="p-3.5 rounded border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">Est. Cash Outflow</div>
              <div className="text-base font-bold font-mono tabular-nums mt-1">{formatINR(data?.kpis?.estimatedCashPayable)}</div>
            </div>
          </div>
        </div>
      )}

      {/* User Management & Audit Logs */}
      {viewKey === 'user_management' && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runPost('/api/users', newUser, `User '${newUser.username}' created with role ${newUser.role_code}.`);
              setNewUser({ username: '', full_name: '', password: '', role_code: 'GST_REVIEWER' });
            }}
            className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-5 gap-3 text-xs items-end"
          >
            <div>
              <label className="block mb-1 font-medium">Username</label>
              <input required value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            <div>
              <label className="block mb-1 font-medium">Full Name</label>
              <input required value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            <div>
              <label className="block mb-1 font-medium">Password</label>
              <input required type="password" minLength={6} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </div>
            <div>
              <label className="block mb-1 font-medium">Role</label>
              <select value={newUser.role_code} onChange={(e) => setNewUser({ ...newUser, role_code: e.target.value })} className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                {(data?.roles || []).map((r: any) => (
                  <option key={r.role_code} value={r.role_code}>{r.role_name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F2942] text-white font-medium">
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create User</span>
            </button>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Username</th>
                  <th className="py-2 px-3">Full Name</th>
                  <th className="py-2 px-3">Role</th>
                  <th className="py-2 px-3">Last Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.users || []).map((u: any) => (
                  <tr key={u.id}>
                    <td className="py-2 px-3 font-mono font-medium">{u.username}</td>
                    <td className="py-2 px-3">{u.full_name}</td>
                    <td className="py-2 px-3">{u.role_name}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">{u.last_login_at || 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Backup & Restore */}
      {viewKey === 'backup_restore' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Archive className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
                <span>Create Consistent SQLite Snapshot Backup</span>
              </div>
              <p className="text-slate-500">
                Uses SQLite online backup API + SHA-256 manifest. Optional AES-256-GCM encryption protects portable backup archives.
              </p>
              <input
                type="password"
                value={backupPass}
                onChange={(e) => setBackupPass(e.target.value)}
                placeholder="Optional AES-256 encryption passphrase"
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <button
                onClick={() => runPost('/api/backups/create', { passphrase: backupPass }, 'Verified SQLite backup archive created.')}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-[#0F2942] text-white font-medium"
              >
                Create Backup Archive
              </button>
            </div>

            <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Upload className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
                <span>Restore &amp; PC Migration Wizard</span>
              </div>
              <input
                type="file"
                accept=".zip"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setRestoreFile(f);
                  setError(null);
                  const fd = new FormData();
                  fd.append('backupFile', f);
                  if (backupPass) fd.append('passphrase', backupPass);
                  try {
                    const prev = await apiFetch('/api/backups/preview', { method: 'POST', body: fd });
                    setRestorePreview(prev);
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
                className="block w-full text-xs"
              />
              {restorePreview && (
                <div className="p-3 rounded bg-slate-50 dark:bg-slate-800/50 space-y-2 font-mono text-[11px]">
                  <div>Verified SHA-256 · Companies: {restorePreview.manifest.counts.companies} · GSTINs: {restorePreview.manifest.counts.gst_registrations} · Sales: {restorePreview.manifest.counts.sales_invoices}</div>
                  <button
                    onClick={async () => {
                      if (!restoreFile) return;
                      const fd = new FormData();
                      fd.append('backupFile', restoreFile);
                      if (backupPass) fd.append('passphrase', backupPass);
                      await apiFetch('/api/backups/restore', { method: 'POST', body: fd });
                      setNotice('Database restored cleanly. Reloading context...');
                      onContextUpdated();
                      load();
                    }}
                    className="px-3 py-1.5 rounded bg-amber-600 text-white font-sans font-medium"
                  >
                    Confirm Restore Over Active DB
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Backup Filename</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Encrypted</th>
                  <th className="py-2 px-3 text-right">Size</th>
                  <th className="py-2 px-3">Created At</th>
                  <th className="py-2 px-3">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.backups || []).map((b: any) => (
                  <tr key={b.id}>
                    <td className="py-2 px-3 font-mono">{b.backup_filename}</td>
                    <td className="py-2 px-3">{b.backup_type}</td>
                    <td className="py-2 px-3">{b.is_encrypted ? 'AES-256-GCM' : 'Plain ZIP'}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{(b.file_size_bytes / 1024).toFixed(1)} KB</td>
                    <td className="py-2 px-3 font-mono text-[11px]">{b.created_at}</td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => apiDownload(`/api/backups/download/${b.backup_filename}`, {}, b.backup_filename)}
                        className="text-[#0F2942] dark:text-sky-400 hover:underline font-medium"
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Government Template Manager & Versioned Rules */}
      {viewKey === 'government_updates' && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runPost('/api/gov-templates/register', newTemplate, 'Official government template registered.');
            }}
            className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs items-end"
          >
            <input required placeholder="Template Name (e.g. GSTR1_Offline_Tool_V3.1.6)" value={newTemplate.template_name} onChange={(e) => setNewTemplate({ ...newTemplate, template_name: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            <select value={newTemplate.return_type} onChange={(e) => setNewTemplate({ ...newTemplate, return_type: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
              <option value="GSTR1">GSTR1</option>
              <option value="GSTR1A">GSTR1A</option>
              <option value="GSTR2B">GSTR2B</option>
              <option value="GSTR3B">GSTR3B</option>
              <option value="IMS">IMS</option>
            </select>
            <input required placeholder="Version (e.g. 3.1.6)" value={newTemplate.version} onChange={(e) => setNewTemplate({ ...newTemplate, version: e.target.value })} className="px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono" />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0F2942] text-white font-medium">Register Official Template</button>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Version-Controlled GST Statutory Rules (Effective-Date Driven)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                  <th className="py-2 px-3">Rule Code</th>
                  <th className="py-2 px-3">Category</th>
                  <th className="py-2 px-3">Rule Title</th>
                  <th className="py-2 px-3">Effective From</th>
                  <th className="py-2 px-3">Statutory Citation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.rules || []).map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-2 px-3 font-mono font-semibold">{r.rule_code}</td>
                    <td className="py-2 px-3">{r.rule_category}</td>
                    <td className="py-2 px-3">{r.title}</td>
                    <td className="py-2 px-3 font-mono">{r.effective_from}</td>
                    <td className="py-2 px-3 text-slate-500">{r.source_citation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Web Application Settings, Sample Data Control & Workflow Help */}
      {viewKey === 'settings_help' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">System &amp; Storage Configuration</h3>
            <div>
              <div className="text-slate-500 mb-1">Active Web Database Storage</div>
              <div className="font-mono p-2 rounded bg-slate-100 dark:bg-slate-800 break-all">{data?.dataRoot || 'pcil_data'}</div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <span>Interface Theme</span>
              <button
                onClick={onToggleDarkMode}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 font-medium"
              >
                Switch to {darkMode ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">Synthetic Sample Dataset (Oct 2026)</div>
                  <div className="text-[11px] text-slate-500">
                    Status:{' '}
                    {data?.hasPilotData ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Loaded (Demo Company &amp; Sample GSTINs present)</span>
                    ) : (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Clean (No sample data)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {data?.hasPilotData ? (
                    <button
                      disabled={busy}
                      onClick={() => runPost('/api/pilot/remove', {}, 'Synthetic sample dataset removed. Your own organization records are intact.')}
                      className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                    >
                      Remove Sample Data
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => runPost('/api/pilot/load', {}, 'Synthetic Pilot Test Dataset loaded.')}
                      className="px-3 py-1.5 rounded bg-[#0F2942] hover:bg-[#163A5F] text-white font-medium disabled:opacity-50"
                    >
                      Load Sample Data
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <CheckCircle2 className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
              <span>Web Compliance Workflow Guide</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              This 30-module GST Compliance Web Application runs directly in your browser with multi-user role permissions, server-side SQLite persistence, and direct browser Excel/PDF/JSON exports.
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>Configure your organization&apos;s GSTINs, Branches, Customers, Suppliers, and HSN/Rate masters.</li>
              <li>Upload Excel, CSV, or JSON registers in <strong>Import Registers</strong> with duplicate protection.</li>
              <li>Run <strong>Sales Verification</strong>, <strong>GSTR-2B Reconciliation</strong>, <strong>IMS Review</strong>, and <strong>RCM/ITC</strong> checks.</li>
              <li>Execute the 20-point <strong>Audit &amp; Exceptions</strong> engine (`AUD-001` to `AUD-020`) and clear critical items.</li>
              <li>Prepare and approve <strong>GSTR-1</strong> and <strong>GSTR-3B</strong> (Rule 88A set-off), then download portal files in <strong>Government Export</strong>.</li>
              <li>Create and download encrypted `.zip` snapshots anytime under <strong>Backup &amp; Restore</strong>.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};
