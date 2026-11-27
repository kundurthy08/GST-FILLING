import React, { useEffect, useState } from 'react';
import { Play, Check, X } from 'lucide-react';
import { apiFetch } from '../api';
import { formatINR } from '../types';

interface VerificationViewsProps {
  viewKey:
    | 'sales_verification'
    | 'discount_verification'
    | 'purchase_verification'
    | 'einvoice_reconciliation'
    | 'gstr2b_reconciliation'
    | 'ims_review'
    | 'itc_verification'
    | 'rcm_verification'
    | 'stock_transfer_verification';
  selectedGstinId: number | null;
  selectedPeriod: string;
}

export const VerificationViews: React.FC<VerificationViewsProps> = ({ viewKey, selectedGstinId, selectedPeriod }) => {
  const [data, setData] = useState<any>(null);
  const [tolerance, setTolerance] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!selectedGstinId) return;
    setError(null);
    const qs = `gstinId=${selectedGstinId}&period=${selectedPeriod}`;
    const routeMap: Record<VerificationViewsProps['viewKey'], string> = {
      sales_verification: `/api/sales?${qs}`,
      discount_verification: `/api/discounts?${qs}`,
      purchase_verification: `/api/purchases?${qs}`,
      einvoice_reconciliation: `/api/einvoices?${qs}`,
      gstr2b_reconciliation: `/api/gstr2b?${qs}`,
      ims_review: `/api/ims?${qs}`,
      itc_verification: `/api/itc?${qs}`,
      rcm_verification: `/api/rcm?${qs}`,
      stock_transfer_verification: `/api/stock-transfers?${qs}`,
    };
    try {
      const res = await apiFetch(routeMap[viewKey]);
      setData(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [viewKey, selectedGstinId, selectedPeriod]);

  if (!selectedGstinId) {
    return (
      <div className="p-8 text-center rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-500">
        Select a specific GSTIN registration from the top selector bar to inspect and verify segregated statutory records.
      </div>
    );
  }

  const runAction = async (endpoint: string, body: any) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      await load();
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
            Transaction-level audit preserving original source amounts alongside independently computed statutory values.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice / party / GSTIN..."
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          {viewKey === 'sales_verification' && (
            <button
              onClick={() => runAction('/api/sales/verify', { gstinId: selectedGstinId, period: selectedPeriod })}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run Sales Tax Recalculation</span>
            </button>
          )}
          {viewKey === 'gstr2b_reconciliation' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Tolerance ₹</label>
              <input
                type="number"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                className="w-16 px-2 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <button
                onClick={() => runAction('/api/gstr2b/reconcile', { gstinId: selectedGstinId, period: selectedPeriod, toleranceRupees: Number(tolerance) })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2942] text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run 6-Stage 2B Match</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Sales Verification Table */}
      {viewKey === 'sales_verification' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                <th className="py-2.5 px-3">Invoice No</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Customer / GSTIN</th>
                <th className="py-2.5 px-3">POS</th>
                <th className="py-2.5 px-3 text-right">Source Taxable</th>
                <th className="py-2.5 px-3 text-right">Source Tax</th>
                <th className="py-2.5 px-3 text-right">Calc Tax</th>
                <th className="py-2.5 px-3 text-right">Diff</th>
                <th className="py-2.5 px-3">IRN</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data?.rows || [])
                .filter((r: any) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
                .map((r: any) => {
                  const srcTax = r.source_igst_paise + r.source_cgst_paise + r.source_sgst_paise + r.source_cess_paise;
                  const calcTax = r.calc_igst_paise + r.calc_cgst_paise + r.calc_sgst_paise + r.calc_cess_paise;
                  const diff = srcTax - calcTax;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono font-medium">{r.invoice_number}</td>
                      <td className="py-2.5 px-3 font-mono">{r.invoice_date}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium">{r.customer_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{r.customer_gstin || 'B2C'}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{r.place_of_supply}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.source_taxable_paise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(srcTax)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(calcTax)}</td>
                      <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${Math.abs(diff) > 100 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                        {formatINR(diff)}
                      </td>
                      <td className="py-2.5 px-3 text-[11px]">{r.irnStatus || r.irn_status}</td>
                      <td className={`py-2.5 px-3 font-medium ${r.verification_status === 'Exception' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {r.verification_status}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Discount & Credit Notes Verification */}
      {viewKey === 'discount_verification' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                <th className="py-2.5 px-3">Note No</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Orig Invoice</th>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3 text-right">Accounting Value</th>
                <th className="py-2.5 px-3 text-right">GST-Adjustable</th>
                <th className="py-2.5 px-3">Statutory Status</th>
                <th className="py-2.5 px-3">Reviewer Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data?.discounts || []).map((d: any) => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono font-medium">{d.note_number}</td>
                  <td className="py-2.5 px-3">{d.discount_category}</td>
                  <td className="py-2.5 px-3 font-mono">{d.original_invoice_number || '—'}</td>
                  <td className="py-2.5 px-3">{d.customer_name}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(d.accounting_value_paise)}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(d.gst_adjustable_value_paise)}</td>
                  <td className="py-2.5 px-3">{d.statutory_status}</td>
                  <td className="py-2.5 px-3 flex gap-2">
                    <button
                      onClick={() => runAction(`/api/discounts/${d.id}/approve-treatment`, { treatment: 'Commercial Only' })}
                      className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Commercial Only
                    </button>
                    <button
                      onClick={() => runAction(`/api/discounts/${d.id}/approve-treatment`, { treatment: 'GST Credit Note' })}
                      className="px-2 py-1 text-[11px] rounded bg-[#0F2942] text-white"
                    >
                      Approve GST CN
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GSTR-2B Reconciliation */}
      {viewKey === 'gstr2b_reconciliation' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              Official Downloaded GSTR-2B vs Purchase Register (Never fabricated from books)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                  <th className="py-2.5 px-3">Supplier &amp; GSTIN</th>
                  <th className="py-2.5 px-3">2B Invoice No</th>
                  <th className="py-2.5 px-3">Book Invoice No</th>
                  <th className="py-2.5 px-3 text-right">2B Taxable</th>
                  <th className="py-2.5 px-3 text-right">Taxable Diff</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Manual Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.records || []).map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3">
                      <div className="font-medium">{r.supplier_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{r.supplier_gstin}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{r.invoice_number}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{r.book_invoice_number || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.taxable_paise)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${r.taxable_diff_paise !== 0 ? 'text-amber-600 font-semibold' : ''}`}>
                      {formatINR(r.taxable_diff_paise)}
                    </td>
                    <td className="py-2.5 px-3 text-[11px]">{r.match_stage || '—'}</td>
                    <td className="py-2.5 px-3 font-medium">{r.match_status}</td>
                    <td className="py-2.5 px-3">
                      {r.match_status !== 'Fully Matched' && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => runAction(`/api/gstr2b/${r.id}/manual-match`, { action: 'approve_match' })}
                            title="Manually Approve Match"
                            className="p-1 rounded bg-emerald-600 text-white"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => runAction(`/api/gstr2b/${r.id}/manual-match`, { action: 'reject' })}
                            title="Flag Supplier Correction"
                            className="p-1 rounded bg-amber-600 text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(data?.missingIn2B || []).length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-amber-700 dark:text-amber-400">
                Missing in Official GSTR-2B (Present in Books — Follow up with Supplier)
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px]">
                    <th className="py-2 px-3">Supplier</th>
                    <th className="py-2 px-3">Invoice No</th>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3 text-right">Taxable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.missingIn2B.map((m: any) => (
                    <tr key={m.id}>
                      <td className="py-2 px-3">{m.supplier_name} ({m.supplier_gstin})</td>
                      <td className="py-2 px-3 font-mono">{m.invoice_number}</td>
                      <td className="py-2 px-3 font-mono">{m.invoice_date}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatINR(m.source_taxable_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* IMS Review */}
      {viewKey === 'ims_review' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                <th className="py-2.5 px-3">Supplier</th>
                <th className="py-2.5 px-3">Invoice</th>
                <th className="py-2.5 px-3 text-right">Tax Value</th>
                <th className="py-2.5 px-3">Recommended Action</th>
                <th className="py-2.5 px-3">Portal Action Recorded</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data?.rows || []).length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-500">No IMS exceptions or pending actions for this period.</td></tr>
              ) : (
                (data?.rows || []).map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3">{r.supplier_name} ({r.supplier_gstin})</td>
                    <td className="py-2.5 px-3 font-mono">{r.invoice_number}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(r.total_tax_paise)}</td>
                    <td className="py-2.5 px-3 font-medium">{r.recommended_action}</td>
                    <td className="py-2.5 px-3">{r.actual_portal_action}</td>
                    <td className="py-2.5 px-3 max-w-xs">{r.reason}</td>
                    <td className="py-2.5 px-3 flex gap-1.5">
                      {(['Accept', 'Pending', 'Reject'] as const).map((act) => (
                        <button
                          key={act}
                          onClick={() => runAction(`/api/ims/${r.id}/action`, { recommended_action: act, actual_portal_action: `${act} (Authorized Portal)` })}
                          className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {act}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ITC Verification */}
      {viewKey === 'itc_verification' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                <th className="py-2.5 px-3">Invoice</th>
                <th className="py-2.5 px-3">Supplier</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3 text-right">IGST</th>
                <th className="py-2.5 px-3 text-right">CGST+SGST</th>
                <th className="py-2.5 px-3 text-right">Cess</th>
                <th className="py-2.5 px-3">Eligibility Status</th>
                <th className="py-2.5 px-3">Update Classification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(data?.register || []).map((i: any) => (
                <tr key={i.id}>
                  <td className="py-2.5 px-3 font-mono">{i.invoice_number || '—'}</td>
                  <td className="py-2.5 px-3">{i.supplier_name || '—'}</td>
                  <td className="py-2.5 px-3">{i.itc_category}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(i.igst_paise)}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(i.cgst_paise + i.sgst_paise)}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(i.cess_paise)}</td>
                  <td className="py-2.5 px-3 font-medium">{i.eligibility_status}</td>
                  <td className="py-2.5 px-3">
                    <select
                      value={i.eligibility_status}
                      onChange={(e) => runAction(`/api/itc/${i.id}/eligibility`, { eligibility_status: e.target.value })}
                      className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="Eligible">Eligible</option>
                      <option value="Ineligible">Ineligible</option>
                      <option value="Blocked Sec 17(5)">Blocked Sec 17(5)</option>
                      <option value="Pending Verification">Pending Verification</option>
                      <option value="Reversed">Reversed</option>
                      <option value="Reclaimed">Reclaimed</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generic fallback for Purchase, E-Invoice, RCM, Stock Transfers */}
      {['purchase_verification', 'einvoice_reconciliation', 'rcm_verification', 'stock_transfer_verification'].includes(viewKey) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          {(() => {
            const list: any[] = data?.rows || data?.einvoices || [];
            if (list.length === 0) {
              return <div className="py-10 text-center text-xs text-slate-500">No records found for this GSTIN and return period.</div>;
            }
            const cols = Object.keys(list[0]).filter((k) => !k.endsWith('_id') && k !== 'id');
            return (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold">
                    {cols.map((c) => (
                      <th key={c} className="py-2.5 px-3 whitespace-nowrap capitalize">{c.replace(/_paise$/, '').replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {list
                    .filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
                    .map((r, idx) => (
                      <tr key={r.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        {cols.map((c) => (
                          <td key={c} className="py-2 px-3 font-mono text-[11px] whitespace-nowrap tabular-nums">
                            {c.endsWith('_paise') ? formatINR(r[c]) : String(r[c] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}
    </div>
  );
};
