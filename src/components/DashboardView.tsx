import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../api';
import { NavKey, formatINR, formatShortINR } from '../types';

interface DashboardViewProps {
  selectedGstinId: number | null;
  selectedPeriod: string;
  onNavigate: (key: NavKey) => void;
  onRefreshContext: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedGstinId,
  selectedPeriod,
  onNavigate,
  onRefreshContext,
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period: selectedPeriod });
      if (selectedGstinId) qs.set('gstinId', String(selectedGstinId));
      const res = await apiFetch(`/api/dashboard?${qs.toString()}`);
      setData(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [selectedGstinId, selectedPeriod]);

  const handleRunFullAudit = async () => {
    if (!selectedGstinId) return;
    setRunningAudit(true);
    try {
      await apiFetch('/api/audit/run', {
        method: 'POST',
        body: JSON.stringify({ gstinId: selectedGstinId, period: selectedPeriod }),
      });
      await loadDashboard();
      onRefreshContext();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunningAudit(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  const k = data?.kpis || {};
  const trends: any[] = data?.monthlyTrends || [];
  const maxTrend = Math.max(1, ...trends.map((t) => Number(t.taxable || 0)));

  const primaryKpis: { label: string; value: string; sub: string; target: NavKey; tone?: 'danger' | 'warn' | 'ok' }[] = [
    {
      label: 'Total Taxable Sales',
      value: formatINR(k.taxableSales),
      sub: `${k.totalSalesInvoices || 0} sales invoices`,
      target: 'sales_verification',
    },
    {
      label: 'Total Output GST Liability',
      value: formatINR(k.totalOutputGst),
      sub: `IGST ${formatShortINR(k.igstLiability)} · CGST ${formatShortINR(k.cgstLiability)} · SGST ${formatShortINR(k.sgstLiability)}`,
      target: 'gstr1_preparation',
    },
    {
      label: 'Net Eligible ITC',
      value: formatINR(k.eligibleItc),
      sub: `Avail ${formatShortINR(k.itcAvailable)} · Ineligible ${formatShortINR(k.ineligibleItc)}`,
      target: 'itc_verification',
    },
    {
      label: 'Estimated Cash Tax Payable',
      value: formatINR(k.estimatedCashPayable),
      sub: `Incl. RCM Liability ${formatShortINR(k.rcmLiability)}`,
      target: 'gstr3b_preparation',
    },
  ];

  const secondaryMetrics: { label: string; value: string; target: NavKey; alert?: boolean }[] = [
    { label: 'Purchase Value', value: formatShortINR(k.purchaseValue), target: 'purchase_verification' },
    { label: 'Total Purchase Invoices', value: String(k.totalPurchaseInvoices || 0), target: 'purchase_verification' },
    { label: 'GSTR-2B Matched', value: String(k.matchedInvoices || 0), target: 'gstr2b_reconciliation' },
    { label: 'GSTR-2B Unmatched / Review', value: String(k.unmatchedInvoices || 0), target: 'gstr2b_reconciliation', alert: (k.unmatchedInvoices || 0) > 0 },
    { label: 'ITC Reversals / Reclaims', value: `${formatShortINR(k.itcReversals)} / ${formatShortINR(k.itcReclaims)}`, target: 'itc_verification' },
    { label: 'Cess Liability', value: formatShortINR(k.cessLiability), target: 'gstr3b_preparation' },
    { label: 'Critical Exceptions', value: String(k.criticalExceptions || 0), target: 'audit_exceptions', alert: (k.criticalExceptions || 0) > 0 },
    { label: 'Pending Approvals', value: String(k.pendingApprovals || 0), target: 'historical_returns' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Compliance Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click any compliance figure to drill down directly to source invoices and audit logs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedGstinId && (
            <button
              onClick={handleRunFullAudit}
              disabled={runningAudit}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${runningAudit ? 'animate-spin' : ''}`} />
              <span>{runningAudit ? 'Running 20-Point Audit...' : 'Run Complete Verification'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Primary 4 KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {primaryKpis.map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.target)}
            className="text-left p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#0F2942] dark:hover:border-sky-500 transition-colors group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#0F2942] dark:group-hover:text-sky-400" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-1.5">
              {item.value}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              {item.sub}
            </div>
          </button>
        ))}
      </div>

      {/* Secondary Operational Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {secondaryMetrics.map((m) => (
          <button
            key={m.label}
            onClick={() => onNavigate(m.target)}
            className="text-left p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 truncate">{m.label}</div>
            <div
              className={`text-sm font-semibold font-mono tabular-nums ${
                m.alert ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {m.value}
            </div>
          </button>
        ))}
      </div>

      {/* Two-Column Split: GSTIN Filing Status & Monthly Tax Trend */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              GSTIN-Wise Compliance &amp; Filing Status
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">Period {selectedPeriod}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4">GSTIN</th>
                  <th className="py-2.5 px-4">State</th>
                  <th className="py-2.5 px-4 text-right">Sales Inv</th>
                  <th className="py-2.5 px-4 text-right">Critical Exc</th>
                  <th className="py-2.5 px-4">Workflow Stage</th>
                  <th className="py-2.5 px-4">GSTR-3B ARN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {(data?.gstinStatus || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No GSTIN registrations configured yet. Open GSTIN Master or load synthetic pilot data.
                    </td>
                  </tr>
                ) : (
                  (data?.gstinStatus || []).map((row: any) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">{row.gstin}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{row.state_name}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{row.sales_count}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {row.critical_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {row.critical_count}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            0
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{row.period_status}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-500">{row.gstr3b_arn || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Trend Bar Chart */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              Monthly Taxable &amp; Output Tax Trend
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Segregated by selected registration filter
            </p>
          </div>
          {trends.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No monthly transaction data available yet.</div>
          ) : (
            <div className="space-y-3">
              {trends.map((t) => {
                const pct = Math.max(6, Math.round((Number(t.taxable) / maxTrend) * 100));
                const taxPct = Math.max(4, Math.round((Number(t.output_tax) / maxTrend) * 100));
                return (
                  <div key={t.return_period} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-700 dark:text-slate-300">{t.return_period}</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatShortINR(t.taxable)} / Tax {formatShortINR(t.output_tax)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                      <div className="h-full bg-[#0F2942] dark:bg-sky-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                      <div className="h-full bg-amber-600 dark:bg-amber-400" style={{ width: `${taxPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {k.criticalExceptions > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Official export gated until {k.criticalExceptions} critical item(s) resolved
              </span>
              <button
                onClick={() => onNavigate('audit_exceptions')}
                className="font-medium text-[#0F2942] dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                Inspect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
