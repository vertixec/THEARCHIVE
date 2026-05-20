'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/Toast';
import Avatar from '@/components/Avatar';
import { formatRelative } from '@/lib/profileMetrics';
import type {
  ProfileRow,
  ProfileMetrics,
  ActivityEvent,
  CategoryStat,
} from '@/lib/profileMetrics';
import { getPlanForProfile, PLAN_CONFIG } from '@/lib/business';

type CreditBalance = {
  credits: number;
  video_credits: number;
  updated_at: string;
};

type CreditTransaction = {
  id: string;
  amount: number;
  balance_after: number | null;
  credit_type: string;
  reason: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

interface Props {
  profile: ProfileRow;
  metrics: ProfileMetrics;
  activity: ActivityEvent[];
  topCategories: CategoryStat[];
  creditBalance: CreditBalance | null;
  creditTransactions: CreditTransaction[];
}

export default function ProfileContent({
  profile,
  metrics,
  activity,
  topCategories,
  creditBalance,
  creditTransactions,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [isEditingIdentity, setIsEditingIdentity] = useState(false);

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
    setIsEditingIdentity(false);
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('INVALID FILE TYPE'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('MAX FILE SIZE: 5MB'); return; }

    setUploadingAvatar(true);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${profile.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      showToast('UPLOAD FAILED');
      setUploadingAvatar(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', profile.id);

    setUploadingAvatar(false);

    if (updateError) { showToast('SAVE FAILED'); return; }

    setAvatarUrl(`${publicUrl}?t=${Date.now()}`);
    showToast('AVATAR UPDATED');
    startTransition(() => router.refresh());
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
  const currentPlan = getPlanForProfile(profile);
  const imageCredits = creditBalance?.credits ?? 0;
  const videoCredits = creditBalance?.video_credits ?? 0;
  const topUpTransactions = creditTransactions.filter((transaction) => transaction.amount > 0);
  const usageTransactions = creditTransactions.filter((transaction) => transaction.amount < 0);
  const creditsSpent = usageTransactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const planOptions = [PLAN_CONFIG.free, PLAN_CONFIG.community, PLAN_CONFIG.pro];
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 1);

  return (
    <div id="view-content" className="min-h-screen bg-dark pb-20">
      <header className="px-6 md:px-12 pt-8">
        <form
          onSubmit={handleSaveProfile}
          className="max-w-6xl mx-auto border border-white/10 bg-panel/70 p-5 md:p-7 flex flex-col gap-6 md:flex-row md:items-start md:justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
          <div className="relative group/avatar shrink-0">
            <Avatar name={displayName} size="md" src={avatarUrl} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity disabled:cursor-wait"
              title="UPLOAD PHOTO"
            >
              {uploadingAvatar ? (
                <span className="font-mono text-[9px] text-white uppercase tracking-widest">...</span>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
          <div className="min-w-0">
            {isEditingIdentity ? (
              <div className="grid gap-3">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={displayName}
                  maxLength={60}
                  className="w-full bg-transparent border-b border-white/20 focus:border-acid font-bebas text-4xl md:text-5xl text-white uppercase tracking-tight leading-none outline-none placeholder:text-white/25 transition-colors"
                />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="vertix_user"
                  maxLength={20}
                  className="w-full max-w-xs bg-transparent border-b border-white/20 focus:border-acid font-mono text-[12px] text-acid outline-none pb-1.5 placeholder:text-white/20 transition-colors"
                />
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="font-bebas text-4xl md:text-5xl text-white uppercase tracking-tight leading-none truncate">
                    {displayName}
                  </h1>
                  <PencilButton label="Edit name" onClick={() => setIsEditingIdentity(true)} />
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <p className="truncate font-space text-[10px] uppercase tracking-[0.18em] text-white/50">
                    {username ? <span className="text-acid">@{username}</span> : <span className="text-white/30">NO USERNAME</span>}
                    <span className="mx-2 text-white/20">/</span>
                    <span className={isPublic ? 'text-acid' : 'text-white/40'}>
                      {isPublic ? 'PUBLIC' : 'PRIVATE'}
                    </span>
                  </p>
                  <PencilButton label="Edit username" onClick={() => setIsEditingIdentity(true)} />
                </div>
              </>
            )}
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
          <div className="grid gap-4 md:min-w-80">
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
            </Field>

            {profileError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {profileError}
              </p>
            )}

            <button
              type="submit"
              disabled={!profileChanged || savingProfile}
              className="self-start bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white transition-colors"
            >
              {savingProfile ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </div>
        </form>
      </header>

      <section className="max-w-6xl mx-auto px-6 md:px-12 mt-10 space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="border border-white/10 bg-panel/70 p-5 md:p-7">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">Credits</h2>
              {creditBalance?.updated_at && (
                <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">
                  Updated {formatDate(creditBalance.updated_at)}
                </span>
              )}
            </div>
            <div className="font-bebas text-6xl leading-none tracking-tight text-white">
              {imageCredits.toLocaleString()}
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-white/40">image credits left</p>

            <div className="mt-6 space-y-3">
              <CreditMeter label="Plan images" value={imageCredits} max={Math.max(currentPlan.monthlyImageLimit, imageCredits, 1)} />
              <CreditMeter label="Video credits" value={videoCredits} max={Math.max(currentPlan.monthlyVideoLimit, videoCredits, 1)} />
            </div>

            <button
              type="button"
              onClick={() => setShowTopUpModal(true)}
              className="mt-6 w-full bg-acid px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black transition-colors hover:bg-white"
            >
              Top-up
            </button>
          </section>

          <section className="border border-white/10 bg-panel/70 p-5 md:p-7">
            <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">Top-up history</h2>
            {topUpTransactions.length === 0 ? (
              <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">No top-ups yet</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {topUpTransactions.slice(0, 5).map((transaction) => (
                  <CreditTransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="border border-white/10 bg-panel/70">
          <div className="flex flex-col gap-3 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between md:p-7">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">Usage history</h2>
            <span className="self-start border border-white/10 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-white/40 md:self-auto">
              Last 20 events
            </span>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <ProfileDatum label="Credits spent" value={creditsSpent.toLocaleString()} />
            <ProfileDatum label="Generations" value={usageTransactions.length.toLocaleString()} />
            <ProfileDatum label="Likes" value={metrics.likes_count.toLocaleString()} />
            <ProfileDatum label="Boards" value={metrics.boards_count.toLocaleString()} />
          </div>
          <div className="min-h-40 p-5 md:p-7">
            {usageTransactions.length === 0 ? (
              <p className="py-10 text-center font-mono text-[10px] uppercase tracking-widest text-white/30">
                No usage in this period
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {usageTransactions.slice(0, 8).map((transaction) => (
                  <CreditTransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </section>

      <div className="max-w-6xl mx-auto px-6 md:px-12 mt-4 grid grid-cols-1 lg:grid-cols-2">
        {/* ACTIVITY */}
        <Block title="ACTIVITY">
          {activity.length === 0 ? (
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
              NO ACTIVITY YET
            </p>
          ) : (
            <>
            <ul className="flex flex-col">
              {visibleActivity.map((event, i) => (
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
            {activity.length > 1 && (
              <button
                type="button"
                onClick={() => setShowAllActivity(!showAllActivity)}
                className="mt-4 border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-white/50 transition-colors hover:border-acid hover:text-acid"
              >
                {showAllActivity ? 'Hide activity' : `View ${activity.length - 1} more`}
              </button>
            )}
            </>
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

            <Row label="ACCESS TIER" value={currentPlan.name.toUpperCase()}>
              <button type="button" onClick={() => setShowTopUpModal(true)} className="font-mono text-[10px] uppercase tracking-widest text-acid hover:text-white transition-colors">
                {currentPlan.monthlyImageLimit} IMG / {currentPlan.monthlyVideoLimit} VID
              </button>
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

      {showTopUpModal && (
        <Modal title="TOP-UP CREDITS" onClose={() => setShowTopUpModal(false)}>
          <div className="grid gap-3">
            {planOptions.map((plan) => (
              <div key={plan.id} className="border border-white/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-acid">{plan.label}</p>
                    <h4 className="mt-1 font-bebas text-3xl uppercase tracking-tight text-white">{plan.name}</h4>
                  </div>
                  <div className="text-right font-mono text-[9px] uppercase tracking-widest text-white/45">
                    <p>{plan.monthlyImageLimit} images</p>
                    <p>{plan.monthlyVideoLimit} videos</p>
                  </div>
                </div>
                <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-widest text-white/45">
                  {plan.description}
                </p>
                <Link
                  href={plan.id === 'community' ? '/inactive-membership' : plan.id === 'free' ? '/profile' : '/pricing'}
                  className="mt-4 block border border-white/15 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/70 transition-colors hover:border-acid hover:text-acid"
                >
                  {plan.id === currentPlan.id ? 'Current plan' : plan.id === 'pro' ? 'Coming soon' : 'Select'}
                </Link>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProfileDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-dark p-4 md:p-5">
      <span className="block font-mono text-[9px] uppercase tracking-[0.25em] text-white/35">
        {label}
      </span>
      <span className="mt-1 block truncate font-mono text-[12px] text-white/80">
        {value}
      </span>
    </div>
  );
}

function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-white/35 transition-colors hover:text-acid"
      title={label}
      aria-label={label}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}

function CreditMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-widest text-white/45">
        <span>{label}</span>
        <span className="text-white/70">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden bg-white/10">
        <div className="h-full bg-acid" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CreditTransactionRow({ transaction }: { transaction: CreditTransaction }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] uppercase tracking-widest text-white/70">
          {formatReason(transaction.reason)}
        </p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/30">
          {transaction.credit_type} / {formatDate(transaction.created_at)}
        </p>
      </div>
      <div className={`font-bebas text-3xl leading-none ${transaction.amount >= 0 ? 'text-acid' : 'text-danger'}`}>
        {transaction.amount >= 0 ? '+' : ''}
        {transaction.amount}
      </div>
    </li>
  );
}

function formatReason(reason: string) {
  return reason.replace(/_/g, ' ');
}

function formatDate(value: string) {
  return new Date(value)
    .toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .toUpperCase();
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
