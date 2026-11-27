import React, { useEffect, useState } from 'react';
import { UploadCloud, Download, AlertCircle, CheckCircle2, FolderOpen } from 'lucide-react';
import { apiFetch, apiDownload } from '../api';
import { formatINR } from '../types';
import {
  isFolderPickerSupported,
  connectWorkspaceFolder,
  getConnectedFolderName,
  listConnectedInputFiles,
  LocalFolderFile,
} from '../utils/localFolderSync';

interface ImportWizardViewProps {
  selectedGstinId: number | null;
  selectedPeriod: string;
}

const REGISTER_TYPES = [
  { key: 'sales_register', label: 'Sales Register (Outward Invoices)' },
  { key: 'discount_register', label: 'Discount & Credit Note Register' },
  { key: 'purchase_register', label: 'Purchase Register (Inward Invoices)' },
  { key: 'gstr2b', label: 'Official GSTR-2B Portal Statement (JSON / Excel)' },
];

const CANONICAL_FIELDS = [
  { key: 'invoice_number', label: 'Invoice / Note Number', required: true },
  { key: 'invoice_date', label: 'Invoice / Note Date', required: true },
  { key: 'customer_gstin', label: 'Customer GSTIN (Sales/Discounts)' },
  { key: 'supplier_gstin', label: 'Supplier GSTIN (Purchases/2B)' },
  { key: 'party_name', label: 'Customer / Supplier Name' },
  { key: 'place_of_supply', label: 'Place of Supply (State Code)' },
  { key: 'hsn_code', label: 'HSN / SAC Code' },
  { key: 'product_description', label: 'Product Description' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'basic_value', label: 'Basic Value' },
  { key: 'discount', label: 'Invoice Discount' },
  { key: 'taxable_value', label: 'Taxable Value', required: true },
  { key: 'gst_rate', label: 'GST Rate (%)' },
  { key: 'igst', label: 'IGST Amount' },
  { key: 'cgst', label: 'CGST Amount' },
  { key: 'sgst', label: 'SGST / UTGST Amount' },
  { key: 'cess', label: 'Cess Amount' },
  { key: 'irn', label: 'E-Invoice IRN' },
  { key: 'expense_category', label: 'Expense / Discount Category' },
  { key: 'rcm_flag', label: 'RCM Applicable (Yes/No)' },
  { key: 'capital_goods_flag', label: 'Capital Goods (Yes/No)' },
];

export const ImportWizardView: React.FC<ImportWizardViewProps> = ({ selectedGstinId, selectedPeriod }) => {
  const [registerType, setRegisterType] = useState('sales_register');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState('');
  const [batches, setBatches] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | null>(getConnectedFolderName());
  const [folderFiles, setFolderFiles] = useState<LocalFolderFile[]>([]);
  const [savedInputFiles, setSavedInputFiles] = useState<any[]>([]);

  const loadHistory = async () => {
    try {
      const qs = selectedGstinId ? `?gstinId=${selectedGstinId}` : '';
      const [batchRes, wsRes] = await Promise.all([
        apiFetch(`/api/import/batches${qs}`),
        apiFetch('/api/workspace-files'),
      ]);
      setBatches(batchRes.batches || []);
      setProfiles(batchRes.profiles || []);
      setSavedInputFiles(wsRes.inputFiles || []);
    } catch {
      // handled in UI
    }
  };

  const handleConnectFolder = async () => {
    setError(null);
    try {
      const { name } = await connectWorkspaceFolder();
      setConnectedFolder(name);
      setFolderFiles(await listConnectedInputFiles());
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err.message);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [selectedGstinId]);

  const handleInspect = async (selectedFile: File, worksheet?: string) => {
    if (!selectedGstinId) {
      setError('Please select a GSTIN in the top filter bar before importing accounting registers.');
      return;
    }
    setBusy(true);
    setError(null);
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('gstRegistrationId', String(selectedGstinId));
      fd.append('returnPeriod', selectedPeriod);
      if (worksheet) fd.append('worksheet', worksheet);
      const res = await apiFetch('/api/import/preview', { method: 'POST', body: fd });
      setPreview(res);
      setMapping(res.suggestedMapping || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!file || !preview || !selectedGstinId) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('gstRegistrationId', String(selectedGstinId));
      fd.append('returnPeriod', selectedPeriod);
      fd.append('registerType', registerType);
      fd.append('worksheetName', preview.selectedWorksheet);
      fd.append('headerRow', String(preview.detectedHeaderRow));
      fd.append('mapping', JSON.stringify(mapping));
      if (profileName.trim()) fd.append('saveProfileName', profileName.trim());
      const res = await apiFetch('/api/import/commit', { method: 'POST', body: fd });
      setCommitResult(res);
      setPreview(null);
      setFile(null);
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Import Accounting Registers
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accepts XLS, XLSX, CSV &amp; JSON. Preserves source file, sheet, row, SHA-256 hash, and control totals immutably.
          </p>
        </div>
        <button
          onClick={() => apiDownload(`/api/import/sample-template/${registerType}`, {}, `Sample_${registerType}.xlsx`)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download Sample Register Template</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {commitResult && (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4" />
            <span>Import Batch {commitResult.batchCode} Completed</span>
          </div>
          <div className="font-mono text-slate-700 dark:text-slate-300">
            Total Rows: {commitResult.totalRows} · Imported: {commitResult.importedRows} · Quarantined/Rejected: {commitResult.rejectedRows} · Control Taxable: {formatINR(commitResult.controlTaxablePaise)} · Control Tax: {formatINR(commitResult.controlTaxPaise)}
          </div>
          {commitResult.savedInputPath && (
            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
              Archived in server input folder: input_files/{commitResult.savedInputPath}
            </div>
          )}
        </div>
      )}

      {/* Workspace Folder Connection (Optional Single-Folder Workflow) */}
      <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
              <span>Workspace Input &amp; Output Folders (Persisted Across Logouts)</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Uploaded registers are archived in <code className="font-mono">input_files/</code> and generated returns are saved in <code className="font-mono">output_files/</code> permanently across sign-outs.
              {isFolderPickerSupported() && ' In Chrome/Edge, you can also connect one local PC folder to pick files here and auto-save outputs into its output_files/ subfolder.'}
            </p>
          </div>
          {isFolderPickerSupported() && (
            <button
              type="button"
              onClick={handleConnectFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{connectedFolder ? `Connected: ${connectedFolder}` : 'Connect PC Folder'}</span>
            </button>
          )}
        </div>

        {connectedFolder && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-2">
              Files in <span className="font-mono">{connectedFolder}</span> (click to load into wizard; exports auto-save to <span className="font-mono">{connectedFolder}/output_files/</span>):
            </div>
            {folderFiles.length === 0 ? (
              <div className="text-[11px] text-slate-500">No .xlsx, .xls, .csv, or .json files found in this folder or its input_files/ subfolder.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {folderFiles.map((lf) => (
                  <button
                    key={lf.subpath}
                    type="button"
                    onClick={() => {
                      setFile(lf.file);
                      handleInspect(lf.file);
                    }}
                    className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-mono"
                  >
                    {lf.subpath}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upload & Register Selector */}
      <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">1. Register Type</label>
            <select
              value={registerType}
              onChange={(e) => setRegisterType(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {REGISTER_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">2. Apply Saved Profile (Optional)</label>
            <select
              onChange={(e) => {
                const prof = profiles.find((p) => String(p.id) === e.target.value);
                if (prof) setMapping(JSON.parse(prof.column_mapping_json));
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="">Auto-detect columns</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.profile_name} ({p.register_type})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">3. Upload Register File</label>
            <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-400 dark:border-slate-600 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs text-slate-700 dark:text-slate-200">
              <UploadCloud className="w-4 h-4 text-[#0F2942] dark:text-sky-400" />
              <span className="truncate">{file ? file.name : 'Choose XLS / XLSX / CSV / JSON'}</span>
              <input
                type="file"
                accept=".xls,.xlsx,.csv,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    handleInspect(f);
                  }
                }}
              />
            </label>
          </div>
        </div>

        {/* Column Mapping Wizard */}
        {preview && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="font-mono text-slate-600 dark:text-slate-300">
                Sheet: <strong>{preview.selectedWorksheet}</strong> · Detected Header Row: <strong>{preview.detectedHeaderRow}</strong> · Data Rows: <strong>{preview.totalRows}</strong> · SHA-256: {preview.fileChecksum.slice(0, 14)}...
              </div>
              {preview.worksheets.length > 1 && file && (
                <select
                  value={preview.selectedWorksheet}
                  onChange={(e) => handleInspect(file, e.target.value)}
                  className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {preview.worksheets.map((ws: string) => (
                    <option key={ws} value={ws}>{ws}</option>
                  ))}
                </select>
              )}
            </div>

            {preview.duplicateFileWarning && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                Duplicate File Warning: This exact file checksum has already been imported for this GSTIN and return period. Duplicate invoice keys will be rejected automatically.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {CANONICAL_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {field.label} {field.required ? '*' : ''}
                  </label>
                  <select
                    value={mapping[field.key] || ''}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                    className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Unmapped --</option>
                    {preview.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Save mapping profile as (e.g. PCIL SAP Sales Format)"
                className="w-80 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <button
                onClick={handleCommit}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] text-white text-xs font-medium disabled:opacity-50"
              >
                {busy ? 'Importing & Hashing...' : `Commit ${preview.totalRows} Source Rows`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Immutable Import Batch History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Immutable Import Batches &amp; Control Totals</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-3.5">Batch Code</th>
                <th className="py-2.5 px-3.5">Register</th>
                <th className="py-2.5 px-3.5">Original Filename</th>
                <th className="py-2.5 px-3.5 text-right">Total / OK / Rej</th>
                <th className="py-2.5 px-3.5 text-right">Control Taxable</th>
                <th className="py-2.5 px-3.5 text-right">Control Tax</th>
                <th className="py-2.5 px-3.5">Imported At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">No import batches recorded yet.</td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3.5 font-mono font-medium">{b.batch_code}</td>
                    <td className="py-2.5 px-3.5">{b.register_type}</td>
                    <td className="py-2.5 px-3.5 truncate max-w-[220px]">{b.original_filename}</td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                      {b.total_rows} / {b.imported_rows} / {b.rejected_rows}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">{formatINR(b.control_taxable_paise)}</td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">{formatINR(b.control_tax_paise)}</td>
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-slate-500">{b.imported_at}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Persisted Input Files Folder Archive */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Saved Input Files Folder (input_files/)</h3>
          <span className="text-[11px] font-mono text-slate-500">{savedInputFiles.length} file(s) retained</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-2 px-3.5">Folder Path (GSTIN / Period / File)</th>
                <th className="py-2 px-3.5 text-right">Size</th>
                <th className="py-2 px-3.5">Saved At</th>
                <th className="py-2 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {savedInputFiles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">No uploaded input files archived yet.</td>
                </tr>
              ) : (
                savedInputFiles.slice(0, 20).map((f) => (
                  <tr key={f.relativePath}>
                    <td className="py-2 px-3.5 font-mono text-[11px]">input_files/{f.relativePath}</td>
                    <td className="py-2 px-3.5 text-right font-mono">{(f.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-2 px-3.5 font-mono text-[11px] text-slate-500">{f.modifiedAt.slice(0, 19).replace('T', ' ')}</td>
                    <td className="py-2 px-3.5 text-right">
                      <button
                        onClick={() =>
                          apiDownload(
                            `/api/workspace-files/download?folder=input_files&path=${encodeURIComponent(f.relativePath)}`,
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
    </div>
  );
};
