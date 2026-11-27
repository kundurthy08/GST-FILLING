import React, { useState } from 'react';
import { ShieldCheck, Lock, Globe } from 'lucide-react';
import { apiFetch, setAuthToken } from '../api';
import { UserSession } from '../types';

interface AuthGateProps {
  needsBootstrap: boolean;
  dataRoot: string;
  onAuthenticated: (user: UserSession) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ needsBootstrap, dataRoot, onAuthenticated }) => {
  const [organizationName, setOrganizationName] = useState('');
  const [pan, setPan] = useState('');
  const [industry, setIndustry] = useState('Manufacturing');
  const [username, setUsername] = useState(needsBootstrap ? 'admin' : '');
  const [fullName, setFullName] = useState(needsBootstrap ? 'GST Compliance Administrator' : '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadPilot, setLoadPilot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = needsBootstrap ? '/api/auth/bootstrap' : '/api/auth/login';
      const body = needsBootstrap
        ? { organizationName, pan, industry, username, fullName, email, password, loadPilot }
        : { username, password };
      const res = await apiFetch<{ token: string; user: UserSession }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 px-4 py-12">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#0F2942] text-white flex items-center justify-center shrink-0">
            {needsBootstrap ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              GST Compliance Manager
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Web-Based GST Return Preparation, Reconciliation &amp; Audit Workspace
            </p>
          </div>
        </div>

        <div className="mb-6 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 mb-0.5">
            <Globe className="w-3.5 h-3.5 text-[#0F2942] dark:text-sky-400" />
            <span>Protected Web Application Workspace</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Role-based multi-user access with encrypted backup &amp; restore ({dataRoot ? 'Persistent storage active' : 'Ready'}).
          </div>
        </div>

        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
          {needsBootstrap ? 'First-Time Organization & Administrator Setup' : 'Authorized Officer Sign In'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          {needsBootstrap
            ? 'Enter your organization details and create the initial Administrator account to get started.'
            : 'Enter your individual account credentials. GST portal passwords and OTPs are never stored in this system.'}
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {needsBootstrap && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Organization Legal Name *
                </label>
                <input
                  type="text"
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942] dark:focus:ring-sky-500"
                  placeholder="Enter your company / organization name"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Organization PAN *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    minLength={10}
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942]"
                    placeholder="e.g. AAACA1234B"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Industry Sector
                  </label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942]"
                    placeholder="Manufacturing / Trading / Services"
                  />
                </div>
              </div>
            </>
          )}

          <div className={needsBootstrap ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942] dark:focus:ring-sky-500"
                placeholder="e.g. admin"
              />
            </div>

            {needsBootstrap && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Admin Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942]"
                />
              </div>
            )}
          </div>

          {needsBootstrap && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Official Email (Optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942]"
                placeholder="compliance@organization.com"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0F2942] dark:focus:ring-sky-500"
              placeholder={needsBootstrap ? 'Minimum 6 characters' : 'Enter password'}
            />
          </div>

          {needsBootstrap && (
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 cursor-pointer">
              <input
                type="checkbox"
                checked={loadPilot}
                onChange={(e) => setLoadPilot(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#0F2942] focus:ring-[#0F2942]"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Also load optional <strong className="text-slate-900 dark:text-white">Synthetic Sample Dataset</strong> for workflow testing (you can leave this unchecked to start purely with your organization&apos;s own GSTINs and registers).
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {submitting
              ? 'Initializing...'
              : needsBootstrap
                ? 'Initialize Organization & Start'
                : 'Sign In to Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
};
