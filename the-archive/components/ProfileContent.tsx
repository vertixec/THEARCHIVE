'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/Toast';
import Avatar from '@/components/Avatar';
import { formatJoinDate, formatRelative } from '@/lib/profileMetrics';
import type {
  ProfileRow,
  ProfileMetrics,
  ActivityEvent,
  CategoryStat,
} from '@/lib/profileMetrics';

interface Props {
  profile: ProfileRow;
  metrics: ProfileMetrics;
  activity: ActivityEvent[];
  topCategories: CategoryStat[];
}

export default function ProfileContent({
  profile,
  metrics,
  activity,
  topCategories,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();

  // Edit form state
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [username, setUsername] = useState(profile.username ?? '');
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Email modal
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  // Delete account modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const profileChanged =
    fullName !== (profile.full_name ?? '') ||
    username !== (profile.username ?? '') ||
    isPublic !== profile.is_public;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileChanged || savingProfile) return;
    setProfileError(null);
    setSavingProfile(true);

    const usernameNormalized = username.trim().toLowerCase();
    if (usernameNormalized && !/^[a-z0-9_]{3,20}$/.test(usernameNormalized)) {
      setProfileError('USERNAME: 3-20 chars, a-z 0-9 _');
      setSavingProfile(false);
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        username: usernameNormalized || null,
        is_public: isPublic,
      })
      .eq('id', profile.id);

    setSavingProfile(false);

    if (error) {
      if (error.code === '23505') setProfileError('USERNAME ALREADY TAKEN');
      else setProfileError(error.message.toUpperCase());
      return;
    }

    showToast('PROFILE UPDATED');
    startTransition(() => router.refresh());
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('MIN 8 CHARACTERS');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('PASSWORDS DO NOT MATCH');
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      setPasswordError(error.message.toUpperCase());
      return;
    }

    setShowPasswordModal(false);
    setNewPassword('');
    setConfirmPassword('');
    showToast('PASSWORD UPDATED');
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setEmailError('INVALID EMAIL FORMAT');
      return;
    }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSavingEmail(false);

    if (error) {
      setEmailError(error.message.toUpperCase());
      return;
    }

    setShowEmailModal(false);
    setNewEmail('');
    showToast('CHECK YOUR INBOX TO CONFIRM');
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function handleDeleteAccount() {
    setDeleteError(null);
    if (deleteConfirm.toLowerCase() !== (profile.username ?? profile.email ?? '').toLowerCase()) {
      setDeleteError('CONFIRMATION DOES NOT MATCH');
      return;
    }
    setDeleting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setDeleting(false);
      setDeleteError('SESSION EXPIRED, RELOAD');
      return;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const res = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    setDeleting(false);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      setDeleteError(txt.toUpperCase() || 'DELETE FAILED');
      return;
    }

    await supabase.auth.signOut();
    router.push('/login');
  }

  const displayName = profile.full_name || profile.email?.split('@')[0] || 'MEMBER';
  const memberSince = formatJoinDate(profile.created_at);

  return (
    <div id="view-content" className="min-h-screen pb-20">
      {/* Header hero */}
      <header className="px-6 md:px-12 pt-12 pb-10 border-b border-white/10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end gap-6 md:gap-10">
          <Avatar name={displayName} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="font-bebas text-5xl md:text-7xl text-white uppercase tracking-tighter leading-none">
              {displayName}
            </h1>
            <p className="font-space text-[11px] text-white/50 uppercase tracking-[0.25em] mt-3">
              {profile.username ? <span className="text-acid">@{profile.username}</span> : <span className="text-white/30">NO USERNAME · </span>}
              <span className="mx-2 text-white/20">·</span>
              MEMBER SINCE {memberSince}
              <span className="mx-2 text-white/20">·</span>
              <span className={profile.is_public ? 'text-acid' : 'text-white/40'}>
                {profile.is_public ? 'PUBLIC' : 'PRIVATE'}
              </span>
            </p>
            {profile.is_public && profile.username && (
              <Link
                href={`/u/${profile.username}`}
                className="inline-block mt-3 font-mono text-[10px] text-white/40 hover:text-acid uppercase tracking-widest transition-colors"
              >
                ↗ VIEW PUBLIC PROFILE
              </Link>
            )}
          </div>
        </div>

        {/* Hero metrics */}
        <div className="max-w-6xl mx-auto mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10">
          <Stat label="LIKES" value={metrics.likes_count} />
          <Stat label="BOARDS" value={metrics.boards_count} />
          <Stat label="ITEMS" value={metrics.items_count} />
          <Stat label="DAYS ACTIVE" value={metrics.days_since_join} />
        </div>
      </header>

      {/* Grid bloques */}
      <div className="max-w-6xl mx-auto px-6 md:px-12 mt-10 grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/10 border border-white/10">

        {/* EDIT INFO */}
        <Block title="EDIT INFO">
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
            <Field label="FULL NAME">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="JOHN DOE"
                maxLength={60}
                className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[12px] text-white outline-none w-full pb-1.5 placeholder:text-white/15 transition-colors"
              />
            </Field>

            <Field label="USERNAME">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="vertix_user"
                maxLength={20}
                className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[12px] text-white outline-none w-full pb-1.5 placeholder:text-white/15 transition-colors"
              />
              <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest mt-1.5 block">
                3-20 chars · a-z 0-9 _
              </span>
            </Field>

            <Field label="VISIBILITY">
              <button
                type="button"
                onClick={() => setIsPublic(!isPublic)}
                className="flex items-center gap-3 group"
              >
                <span
                  className={`w-10 h-5 border flex items-center transition-all ${
                    isPublic ? 'bg-acid border-acid justify-end' : 'bg-transparent border-white/30 justify-start'
                  }`}
                >
                  <span className={`w-4 h-4 ${isPublic ? 'bg-black' : 'bg-white/40 ml-0.5'}`} />
                </span>
                <span className="font-mono text-[10px] text-white/70 uppercase tracking-widest group-hover:text-white">
                  {isPublic ? 'PUBLIC PROFILE ON' : 'PUBLIC PROFILE OFF'}
                </span>
              </button>
              <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest mt-1.5 block">
                {isPublic
                  ? 'OTHER MEMBERS CAN VIEW /u/' + (username || '...')
                  : 'ONLY YOU CAN SEE THIS PROFILE'}
              </span>
            </Field>

            {profileError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {profileError}
              </p>
            )}

            <button
              type="submit"
              disabled={!profileChanged || savingProfile}
              className="self-start bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-acid/80 transition-colors"
            >
              {savingProfile ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </form>
        </Block>

        {/* ACTIVITY */}
        <Block title="ACTIVITY">
          {activity.length === 0 ? (
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
              NO ACTIVITY YET
            </p>
          ) : (
            <ul className="flex flex-col">
              {activity.map((event, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-b-0"
                >
                  <span
                    className={`w-1.5 h-1.5 ${
                      event.type === 'like' ? 'bg-acid' : 'bg-white/40'
                    }`}
                  />
                  <span className="flex-1 font-mono text-[11px] text-white/70 truncate">
                    {event.label}
                  </span>
                  <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest shrink-0">
                    {formatRelative(event.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* TOP CATEGORIES + COMPLETION */}
        <Block title="TOP CATEGORIES">
          {topCategories.length === 0 ? (
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-6">
              LIKE ITEMS TO SEE STATS
            </p>
          ) : (
            <ul className="flex flex-col gap-3 mb-8">
              {topCategories.map((c, i) => {
                const max = topCategories[0]?.count ?? 1;
                const pct = Math.round((c.count / max) * 100);
                return (
                  <li key={c.label}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="font-bebas text-2xl text-white tracking-wider">
                        {String(i + 1).padStart(2, '0')}. {c.label}
                      </span>
                      <span className="font-mono text-[10px] text-acid uppercase tracking-widest">
                        {c.count}
                      </span>
                    </div>
                    <div className="h-px bg-white/5 relative overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-acid"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-white/5 pt-5">
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-mono text-[10px] text-white/50 uppercase tracking-widest">
                PROFILE COMPLETION
              </span>
              <span className="font-mono text-[10px] text-acid uppercase tracking-widest">
                {metrics.completion_pct}%
              </span>
            </div>
            <div className="h-1 bg-white/5 relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-acid transition-all duration-500"
                style={{ width: `${metrics.completion_pct}%` }}
              />
            </div>
          </div>
        </Block>

        {/* ACCOUNT */}
        <Block title="ACCOUNT">
          <div className="flex flex-col gap-4">
            <Row label="EMAIL" value={profile.email ?? '—'}>
              <button
                onClick={() => setShowEmailModal(true)}
                className="font-mono text-[10px] text-white/50 hover:text-acid uppercase tracking-widest transition-colors"
              >
                CHANGE
              </button>
            </Row>

            <Row label="PASSWORD" value="••••••••">
              <button
                onClick={() => setShowPasswordModal(true)}
                className="font-mono text-[10px] text-white/50 hover:text-acid uppercase tracking-widest transition-colors"
              >
                CHANGE
              </button>
            </Row>

            <Row label="STATUS" value={(profile.status ?? 'unknown').toUpperCase()}>
              <span className={`font-mono text-[10px] uppercase tracking-widest ${profile.status === 'active' ? 'text-acid' : 'text-danger'}`}>
                {profile.role?.toUpperCase() ?? 'MEMBER'}
              </span>
            </Row>

            <div className="flex items-center gap-3 pt-4 mt-2 border-t border-white/5">
              <button
                onClick={handleSignOut}
                className="font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-4 py-2 uppercase tracking-widest transition-all"
              >
                SIGN OUT
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="font-mono text-[10px] text-danger/70 hover:text-danger border border-white/10 hover:border-danger px-4 py-2 uppercase tracking-widest transition-all"
              >
                DELETE ACCOUNT
              </button>
            </div>
          </div>
        </Block>
      </div>

      {/* Password modal */}
      {showPasswordModal && (
        <Modal title="CHANGE PASSWORD" onClose={() => setShowPasswordModal(false)}>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="NEW PASSWORD"
              autoFocus
              className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[12px] text-white outline-none w-full pb-1.5 placeholder:text-white/20 transition-colors"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="CONFIRM PASSWORD"
              className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[12px] text-white outline-none w-full pb-1.5 placeholder:text-white/20 transition-colors"
            />
            {passwordError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {passwordError}
              </p>
            )}
            <button
              type="submit"
              disabled={savingPassword}
              className="self-start bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2 disabled:opacity-30 hover:bg-acid/80 transition-colors mt-2"
            >
              {savingPassword ? 'SAVING...' : 'UPDATE PASSWORD'}
            </button>
          </form>
        </Modal>
      )}

      {/* Email modal */}
      {showEmailModal && (
        <Modal title="CHANGE EMAIL" onClose={() => setShowEmailModal(false)}>
          <form onSubmit={handleChangeEmail} className="flex flex-col gap-4">
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">
              CURRENT: {profile.email}
            </p>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="NEW EMAIL"
              autoFocus
              className="bg-transparent border-b border-white/30 focus:border-acid font-mono text-[12px] text-white outline-none w-full pb-1.5 placeholder:text-white/20 transition-colors"
            />
            {emailError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {emailError}
              </p>
            )}
            <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest leading-relaxed">
              YOU WILL RECEIVE A CONFIRMATION LINK AT THE NEW ADDRESS.
            </p>
            <button
              type="submit"
              disabled={savingEmail}
              className="self-start bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2 disabled:opacity-30 hover:bg-acid/80 transition-colors mt-2"
            >
              {savingEmail ? 'SENDING...' : 'SEND CONFIRMATION'}
            </button>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {showDeleteModal && (
        <Modal title="DELETE ACCOUNT" onClose={() => setShowDeleteModal(false)}>
          <div className="flex flex-col gap-4">
            <p className="font-mono text-[11px] text-white/70 leading-relaxed">
              This is permanent. All your moodboards, likes, and account data will be erased.
            </p>
            <p className="font-mono text-[10px] text-white/40 uppercase tracking-widest">
              TYPE <span className="text-danger">{profile.username ?? profile.email}</span> TO CONFIRM
            </p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoFocus
              className="bg-transparent border-b border-danger/40 focus:border-danger font-mono text-[12px] text-white outline-none w-full pb-1.5 transition-colors"
            />
            {deleteError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {deleteError}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="font-mono text-[10px] text-danger border border-danger px-5 py-2 uppercase tracking-widest disabled:opacity-30 hover:bg-danger hover:text-black transition-all"
              >
                {deleting ? 'DELETING...' : 'DELETE FOREVER'}
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="font-mono text-[10px] text-white/50 hover:text-white px-3 py-2 uppercase tracking-widest transition-colors"
              >
                CANCEL
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-dark p-6 flex flex-col gap-1">
      <span className="font-bebas text-5xl md:text-6xl text-white leading-none tracking-tighter">
        {value.toLocaleString()}
      </span>
      <span className="font-mono text-[9px] text-white/40 uppercase tracking-[0.25em]">
        {label}
      </span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-dark p-6 md:p-8">
      <h2 className="font-mono text-[10px] text-white/40 uppercase tracking-[0.3em] mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] text-white/40 uppercase tracking-[0.25em] mb-2 block">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[9px] text-white/40 uppercase tracking-[0.25em] block">
          {label}
        </span>
        <span className="font-mono text-[12px] text-white/80 truncate block mt-0.5">
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-white/15 max-w-md w-full p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-mono text-[10px] text-acid uppercase tracking-[0.3em]">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
