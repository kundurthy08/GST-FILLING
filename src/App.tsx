/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Sun, Moon, LogOut, Menu, X } from 'lucide-react';
import { apiFetch, setAuthToken } from './api';
import { NAV_ITEMS, NavKey, UserSession, GstRegistration } from './types';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { MastersView } from './components/MastersView';
import { ImportWizardView } from './components/ImportWizardView';
import { VerificationViews } from './components/VerificationViews';
import { ReturnsAndAuditViews } from './components/ReturnsAndAuditViews';

const PERIOD_OPTIONS = [
  { value: '102026', label: 'Oct 2026 (102026)' },
  { value: '092026', label: 'Sep 2026 (092026)' },
  { value: '112026', label: 'Nov 2026 (112026)' },
  { value: '082026', label: 'Aug 2026 (082026)' },
];

export default function App() {
  const [authStatus, setAuthStatus] = useState<{ needsBootstrap: boolean; dataRoot: string } | null>(null);
  const [user, setUser] = useState<UserSession | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const [companies, setCompanies] = useState<{ id: number; legal_name: string; pan: string }[]>([]);
  const [gstins, setGstins] = useState<GstRegistration[]>([]);
  const [selectedGstinId, setSelectedGstinId] = useState<number | null>(null);
  const [selectedFy, setSelectedFy] = useState('2026-27');
  const [selectedPeriod, setSelectedPeriod] = useState('102026');

  const fetchAuthStatus = async () => {
    const res = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json());
    setAuthStatus(res);
    return res;
  };

  const fetchContext = async () => {
    try {
      const ctx = await apiFetch('/api/context');
      setCompanies(ctx.companies || []);
      const list: GstRegistration[] = ctx.gstins || [];
      setGstins(list);
      if (list.length > 0 && (selectedGstinId === null || !list.some((g) => g.id === selectedGstinId))) {
        setSelectedGstinId(list[0].id);
      } else if (list.length === 0) {
        setSelectedGstinId(null);
      }
    } catch {
      // handled on auth
    }
  };

  useEffect(() => {
    (async () => {
      const status = await fetchAuthStatus();
      if (!status?.needsBootstrap) {
        try {
          const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData?.user) setUser(meData.user);
          }
        } catch {
          // user remains unauthenticated
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (user) {
      fetchContext();
    }
  }, [user]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  if (!authStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 text-xs text-slate-500">
        Initializing GST Compliance web workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        needsBootstrap={authStatus.needsBootstrap}
        dataRoot={authStatus.dataRoot}
        onAuthenticated={(u) => setUser(u)}
      />
    );
  }

  const sections = Array.from(new Set(NAV_ITEMS.map((i) => i.section)));

  const renderMainContent = () => {
    if (activeNav === 'dashboard') {
      return (
        <DashboardView
          selectedGstinId={selectedGstinId}
          selectedPeriod={selectedPeriod}
          onNavigate={setActiveNav}
          onRefreshContext={fetchContext}
        />
      );
    }
    if (
      [
        'company_master',
        'gstin_master',
        'branch_master',
        'customer_master',
        'supplier_master',
        'product_hsn_master',
        'gst_rate_master',
      ].includes(activeNav)
    ) {
      return <MastersView masterKey={activeNav as any} onContextUpdated={fetchContext} />;
    }
    if (activeNav === 'import_registers') {
      return <ImportWizardView selectedGstinId={selectedGstinId} selectedPeriod={selectedPeriod} />;
    }
    if (
      [
        'sales_verification',
        'discount_verification',
        'purchase_verification',
        'einvoice_reconciliation',
        'gstr2b_reconciliation',
        'ims_review',
        'itc_verification',
        'rcm_verification',
        'stock_transfer_verification',
      ].includes(activeNav)
    ) {
      return (
        <VerificationViews
          viewKey={activeNav as any}
          selectedGstinId={selectedGstinId}
          selectedPeriod={selectedPeriod}
        />
      );
    }
    return (
      <ReturnsAndAuditViews
        viewKey={activeNav as any}
        selectedGstinId={selectedGstinId}
        selectedPeriod={selectedPeriod}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onContextUpdated={fetchContext}
      />
    );
  };

  const renderSidebarNav = (isMobileDrawer = false) => (
    <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
      {sections.map((section) => (
        <div key={section}>
          {(!sidebarCollapsed || isMobileDrawer) && (
            <div className="px-2.5 mb-1 text-[10px] font-semibold tracking-wider text-slate-400">
              {section}
            </div>
          )}
          <div className="space-y-0.5">
            {NAV_ITEMS.filter((item) => item.section === section).map((item, idx) => {
              const active = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveNav(item.key);
                    if (isMobileDrawer) setMobileMenuOpen(false);
                  }}
                  title={item.label}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2 ${
                    active
                      ? 'bg-white text-[#0F2942] font-semibold'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {sidebarCollapsed && !isMobileDrawer ? (
                    <span className="font-mono text-[10px] mx-auto">{String(idx + 1).padStart(2, '0')}</span>
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Slide-Over Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0F2942] text-slate-100 flex flex-col transform transition-transform duration-200 lg:hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-display font-bold text-sm tracking-tight whitespace-nowrap truncate">
              GST Compliance
            </div>
            {companies[0]?.legal_name && (
              <div className="text-[10px] text-slate-300 truncate">{companies[0].legal_name}</div>
            )}
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
            className="p-1.5 rounded hover:bg-white/10 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {renderSidebarNav(true)}
      </aside>

      {/* Desktop Sidebar (30 Modules) */}
      <aside
        className={`hidden lg:flex ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        } shrink-0 border-r border-slate-200 dark:border-slate-800 bg-[#0F2942] text-slate-100 flex-col transition-all duration-150`}
      >
        <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-tight whitespace-nowrap truncate">
                GST Compliance
              </div>
              {companies[0]?.legal_name && (
                <div className="text-[10px] text-slate-300 truncate">{companies[0].legal_name}</div>
              )}
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {renderSidebarNav(false)}
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="min-h-14 py-2 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>

            <select
              value={selectedGstinId ?? ''}
              onChange={(e) => setSelectedGstinId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Select GSTIN"
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 max-w-full"
            >
              <option value="">All GSTINs (Management View)</option>
              {gstins.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.gstin} · {g.state_name}
                </option>
              ))}
            </select>

            <select
              value={selectedFy}
              onChange={(e) => setSelectedFy(e.target.value)}
              aria-label="Financial Year"
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="2026-27">FY 2026-27</option>
              <option value="2025-26">FY 2025-26</option>
            </select>

            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              aria-label="Return Period"
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
              {user.full_name} · {user.role_name}
            </span>
            <button
              onClick={() => setDarkMode(!darkMode)}
              title="Toggle Light / Dark Mode"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
                setAuthToken(null);
                setUser(null);
                fetchAuthStatus();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{renderMainContent()}</main>
      </div>
    </div>
  );
}
