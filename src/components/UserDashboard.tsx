import React, { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function UserDashboard() {
  const {
    userProfile,
    liveUsage,
    loading,
    authError,
    signInWithGoogle,
    regenerateApiKey,
    refreshUsage,
  } = useAuth();

  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    if (userProfile) {
      void refreshUsage();
    }
  }, [userProfile, refreshUsage]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-48 rounded-xl bg-slate-200/70 animate-pulse" />
        <div className="h-36 rounded-xl bg-slate-200/70 animate-pulse" />
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 sm:p-10">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-rose-700">Autentikasi Google OAuth</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Masuk atau Daftar untuk Mendapatkan API Key Pribadi
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Gunakan akun Google Anda untuk registrasi dan login instan. Setiap akun otomatis menerima API Key unik dengan kuota <span className="font-semibold text-slate-900">1.000 request/hari</span> (atau akses <span className="font-semibold text-slate-900">Unlimited</span> untuk Admin).
          </p>

          {authError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
              {authError}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-3 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
                />
              </svg>
              Lanjutkan dengan Google OAuth
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-6 text-xs text-slate-600 sm:grid-cols-3">
            <div>
              <p className="font-semibold text-slate-900">Otomatis Terdaftar</p>
              <p className="mt-1">Data profil dan API key tersimpan aman di Firestore.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-900">Anti-403 cURL</p>
              <p className="mt-1">Key langsung aktif untuk request CLI, Python, PHP, atau JS.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-900">Regenerasi Kapan Saja</p>
              <p className="mt-1">Putar ulang API Key Anda dalam satu klik bila diperlukan.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = userProfile.role === 'admin' || userProfile.dailyLimit === -1;
  const requestsToday = liveUsage?.requestsToday ?? userProfile.requestsToday ?? 0;
  const requestsTotal = liveUsage?.requestsTotal ?? userProfile.requestsTotal ?? 0;
  const dailyLimit = isAdmin ? -1 : liveUsage?.dailyLimit ?? userProfile.dailyLimit;
  const maskedKey = `${userProfile.apiKey.slice(0, 10)}••••••••••••••••${userProfile.apiKey.slice(-4)}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sampleCurl = `curl -H "x-api-key: ${userProfile.apiKey}" "${origin}/api/v1/komik/terupdate"`;

  const handleCopyKey = () => {
    void navigator.clipboard.writeText(userProfile.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyCurl = () => {
    void navigator.clipboard.writeText(sampleCurl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1800);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateApiKey();
      setConfirmRegen(false);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="flex items-center gap-4">
          {userProfile.photoURL ? (
            <img
              src={userProfile.photoURL}
              alt={userProfile.displayName}
              referrerPolicy="no-referrer"
              className="h-12 w-12 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 font-display text-sm font-bold text-white">
              {userProfile.displayName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-950">{userProfile.displayName}</h1>
            <p className="text-xs text-slate-500">
              {userProfile.email} · Role: <span className="font-semibold text-slate-800">{userProfile.role}</span> · Status:{' '}
              <span className={userProfile.status === 'active' ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                {userProfile.status}
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void refreshUsage()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Perbarui Statistik
        </button>
      </div>

      {/* Quota Summary */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5">
          <p className="text-xs text-slate-500">Paket & Kuota Harian</p>
          <p className="mt-1 font-display text-xl font-bold text-slate-950 tabular-nums">
            {isAdmin ? 'Admin Unlimited' : `${dailyLimit.toLocaleString('id-ID')} req/hari`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isAdmin ? 'Tanpa batas harian & burst' : `Paket aktif: ${userProfile.plan.toUpperCase()}`}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Pemakaian Hari Ini</p>
          <p className="mt-1 font-display text-xl font-bold text-slate-950 tabular-nums">
            {requestsToday.toLocaleString('id-ID')}
            {!isAdmin && (
              <span className="text-sm font-normal text-slate-400">
                {' '}/ {dailyLimit.toLocaleString('id-ID')}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">Reset otomatis pukul 00:00 WIB</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Total Request Keseluruhan</p>
          <p className="mt-1 font-display text-xl font-bold text-slate-950 tabular-nums">
            {requestsTotal.toLocaleString('id-ID')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {liveUsage?.lastUserAgent ? `Terakhir: ${liveUsage.lastUserAgent.slice(0, 28)}` : 'Belum ada hit API'}
          </p>
        </div>
      </div>

      {/* API Key Vault */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-rose-700" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">API Key Pribadi</h2>
              <p className="text-xs text-slate-500">
                Jangan bagikan API key Anda di kode frontend publik yang dapat dilihat pengguna lain.
              </p>
            </div>
          </div>

          {!confirmRegen ? (
            <button
              type="button"
              onClick={() => setConfirmRegen(true)}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Regenerasi Key
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={regenerating}
                onClick={() => void handleRegenerate()}
                className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {regenerating ? 'Membuat...' : 'Konfirmasi Putar Ulang'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRegen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-xs text-slate-900 break-all">
            {revealed ? userProfile.apiKey : maskedKey}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {revealed ? 'Sembunyikan' : 'Tampilkan'}
            </button>
            <button
              type="button"
              onClick={handleCopyKey}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Tersalin' : 'Salin Key'}
            </button>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">Uji Cepat Langsung (Tanpa cURL) & cURL Publik</p>
            <div className="flex items-center gap-3">
              <a
                href={`/api/v1/komik/terupdate?apikey=${encodeURIComponent(userProfile.apiKey)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:text-rose-700"
              >
                Buka Raw JSON di Tab Baru
              </a>
              <button
                type="button"
                onClick={handleCopyCurl}
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-800"
              >
                {copiedCurl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCurl ? 'Tersalin' : 'Salin cURL'}
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">
            {sampleCurl}
          </pre>
        </div>
      </div>
    </div>
  );
}
