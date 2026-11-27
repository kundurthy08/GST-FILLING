import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { apiFetch } from '../api';

interface MastersViewProps {
  masterKey:
    | 'company_master'
    | 'gstin_master'
    | 'branch_master'
    | 'customer_master'
    | 'supplier_master'
    | 'product_hsn_master'
    | 'gst_rate_master';
  onContextUpdated: () => void;
}

const ENDPOINT_MAP: Record<MastersViewProps['masterKey'], { type: string; title: string; subtitle: string }> = {
  company_master: { type: 'companies', title: 'Company Master', subtitle: 'Legal entities, PAN, CIN, and manufacturing registration root' },
  gstin_master: { type: 'gstins', title: 'GSTIN Master', subtitle: 'State-wise GST registrations with Mod-36 checksum validation' },
  branch_master: { type: 'branches', title: 'Branch, Factory & Depot Master', subtitle: 'Manufacturing plants, clinker units, railheads, and depots mapped to GSTINs' },
  customer_master: { type: 'customers', title: 'Customer Master', subtitle: 'B2B dealers, institutional buyers, SEZ, exports, and B2C classifications' },
  supplier_master: { type: 'suppliers', title: 'Supplier Master', subtitle: 'Coal, gypsum, fly ash, packing, GTA transporters, and capital goods vendors' },
  product_hsn_master: { type: 'hsn', title: 'Product & HSN / SAC Master', subtitle: 'Cement grades (OPC, PPC, Clinker), scrap, fuels, and approved UQC codes' },
  gst_rate_master: { type: 'tax_rates', title: 'Versioned GST Rate Master', subtitle: 'Effective-date-based statutory rates with CBIC legal citations' },
};

export const MastersView: React.FC<MastersViewProps> = ({ masterKey, onContextUpdated }) => {
  const cfg = ENDPOINT_MAP[masterKey];
  const [rows, setRows] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [gstins, setGstins] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add form states
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<Record<string, string>>({});

  const load = async () => {
    setError(null);
    try {
      const [res, ctx] = await Promise.all([apiFetch(`/api/masters/${cfg.type}`), apiFetch('/api/context')]);
      setRows(res.rows || []);
      setCompanies(ctx.companies || []);
      setGstins(ctx.gstins || []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setShowForm(false);
    setFormState({});
    setSuccess(null);
    load();
  }, [masterKey]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const endpoint =
        masterKey === 'company_master'
          ? '/api/masters/companies'
          : masterKey === 'gstin_master'
            ? '/api/masters/gstins'
            : masterKey === 'branch_master'
              ? '/api/masters/branches'
              : '/api/masters/tax_rates';
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(formState) });
      setSuccess('Master record saved.');
      setShowForm(false);
      setFormState({});
      await load();
      onContextUpdated();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filtered = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
  const columns = filtered.length > 0 ? Object.keys(filtered[0]).filter((k) => !k.endsWith('_id') && k !== 'id') : [];
  const canCreate = ['company_master', 'gstin_master', 'branch_master', 'gst_rate_master'].includes(masterKey);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{cfg.title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{cfg.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter records..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>
          {canCreate && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Record</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
          {success}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4">
          {masterKey === 'company_master' && (
            <>
              <input required placeholder="Legal Name" onChange={(e) => setFormState({ ...formState, legal_name: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input required placeholder="PAN (10 chars)" maxLength={10} onChange={(e) => setFormState({ ...formState, pan: e.target.value })} className="px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input placeholder="Registered Address" onChange={(e) => setFormState({ ...formState, registered_address: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </>
          )}
          {masterKey === 'gstin_master' && (
            <>
              <select required onChange={(e) => setFormState({ ...formState, company_id: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                <option value="">Select Company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legal_name}</option>
                ))}
              </select>
              <input required placeholder="15-digit GSTIN (Mod-36 validated)" maxLength={15} onChange={(e) => setFormState({ ...formState, gstin: e.target.value })} className="px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input placeholder="Effective From (YYYY-MM-DD)" defaultValue="2026-04-01" onChange={(e) => setFormState({ ...formState, effective_from: e.target.value })} className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </>
          )}
          {masterKey === 'branch_master' && (
            <>
              <select required onChange={(e) => setFormState({ ...formState, gst_registration_id: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                <option value="">Select GSTIN</option>
                {gstins.map((g) => (
                  <option key={g.id} value={g.id}>{g.gstin} ({g.state_name})</option>
                ))}
              </select>
              <input required placeholder="Branch Code (e.g. TS-DEP-02)" onChange={(e) => setFormState({ ...formState, branch_code: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input required placeholder="Branch / Depot Name" onChange={(e) => setFormState({ ...formState, branch_name: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <select required onChange={(e) => setFormState({ ...formState, branch_type: e.target.value })} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                <option value="">Branch Type</option>
                <option value="Factory">Factory</option>
                <option value="Depot">Depot</option>
                <option value="Branch">Branch</option>
                <option value="Head Office">Head Office</option>
              </select>
              <input required placeholder="State Code (e.g. 36)" maxLength={2} onChange={(e) => setFormState({ ...formState, state_code: e.target.value })} className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </>
          )}
          {masterKey === 'gst_rate_master' && (
            <>
              <input required placeholder="HSN Code (e.g. 25232910)" onChange={(e) => setFormState({ ...formState, hsn_code: e.target.value })} className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input required type="number" step="0.5" placeholder="IGST Rate % (e.g. 28)" onChange={(e) => setFormState({ ...formState, igst_pct: e.target.value })} className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input required placeholder="Effective From (YYYY-MM-DD)" onChange={(e) => setFormState({ ...formState, effective_from: e.target.value })} className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              <input required placeholder="CBIC Notification / Legal Basis" onChange={(e) => setFormState({ ...formState, legal_basis: e.target.value })} className="md:col-span-2 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </>
          )}
          <div className="md:col-span-3 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700">Cancel</button>
            <button type="submit" className="px-4 py-1.5 text-xs rounded-lg bg-[#0F2942] text-white font-medium">Save Master</button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {columns.map((c) => (
                  <th key={c} className="py-2.5 px-3.5 whitespace-nowrap capitalize">{c.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(1, columns.length)} className="py-10 text-center text-slate-500">
                    No master records match your filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {columns.map((c) => (
                      <td key={c} className="py-2.5 px-3.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {c.endsWith('_bps') ? `${(Number(row[c]) / 100).toFixed(2)}%` : String(row[c] ?? '—')}
                      </td>
                    ))}
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
