'use client';

import { useState, useTransition, useRef, useMemo } from 'react';
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
import { getPlanForProfile } from '@/lib/business';
import CreditsTopUpModal from '@/components/CreditsTopUpModal';

type CreditBalance = {
  credits: number;
  video_credits: number;
  monthly_credits?: number;
  monthly_credits_reset_at?: string | null;
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

type TabId = 'personal' | 'credits' | 'subscription' | 'activity';

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

  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>('personal');

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
  const [isEditingIdentity, setIsEditingIdentity] = useState(false);

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
  // Two buckets: monthly community allowance (resets) + purchased (persists).
  const monthlyCredits = creditBalance?.monthly_credits ?? 0;
  const purchasedCredits = creditBalance?.credits ?? 0;
  const imageCredits = monthlyCredits + purchasedCredits;
  const topUpTransactions = creditTransactions.filter((t) => t.amount > 0);
  const usageTransactions = creditTransactions.filter((t) => t.amount < 0);
  const creditsSpent = usageTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const planImageMax = Math.max(currentPlan.monthlyImageLimit, imageCredits, 1);
  const imagePct = Math.max(0, Math.min(100, Math.round((imageCredits / planImageMax) * 100)));

  return (
    <div id="view-content" className="min-h-screen bg-dark">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 md:px-10 lg:flex-row lg:gap-10 lg:py-14">
        <Sidebar
          displayName={displayName}
          avatarUrl={avatarUrl}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <main className="min-w-0 flex-1 space-y-4">
          {activeTab === 'personal' && (
            <PersonalTab
              profile={profile}
              displayName={displayName}
              avatarUrl={avatarUrl}
              uploadingAvatar={uploadingAvatar}
              fileInputRef={fileInputRef}
              onAvatarUpload={handleAvatarUpload}
              fullName={fullName}
              setFullName={setFullName}
              username={username}
              setUsername={setUsername}
              isPublic={isPublic}
              setIsPublic={setIsPublic}
              isEditingIdentity={isEditingIdentity}
              setIsEditingIdentity={setIsEditingIdentity}
              profileChanged={profileChanged}
              savingProfile={savingProfile}
              profileError={profileError}
              onSaveProfile={handleSaveProfile}
              onChangeEmail={() => setShowEmailModal(true)}
              onChangePassword={() => setShowPasswordModal(true)}
              onSignOut={handleSignOut}
              onDelete={() => setShowDeleteModal(true)}
            />
          )}

          {activeTab === 'credits' && (
            <CreditsTab
              imageCredits={imageCredits}
              monthlyCredits={monthlyCredits}
              purchasedCredits={purchasedCredits}
              monthlyGrant={currentPlan.monthlyCreditGrant}
              imagePct={imagePct}
              creditsSpent={creditsSpent}
              updatedAt={creditBalance?.updated_at}
              topUpTransactions={topUpTransactions}
              usageTransactions={usageTransactions}
              onTopUp={() => setShowTopUpModal(true)}
            />
          )}

          {activeTab === 'subscription' && (
            <SubscriptionTab
              plan={currentPlan}
              imageCredits={imageCredits}
              onTopUp={() => setShowTopUpModal(true)}
            />
          )}

          {activeTab === 'activity' && (
            <ActivityTab
              activity={activity}
              topCategories={topCategories}
              likesCount={metrics.likes_count}
              boardsCount={metrics.boards_count}
            />
          )}
        </main>
      </div>

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

      <CreditsTopUpModal open={showTopUpModal} onClose={() => setShowTopUpModal(false)} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SIDEBAR
// ──────────────────────────────────────────────────────────────

function Sidebar({
  displayName,
  avatarUrl,
  activeTab,
  onTabChange,
}: {
  displayName: string;
  avatarUrl: string | null;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <aside className="w-full shrink-0 lg:w-60">
      <div className="mb-8 flex items-center gap-3">
        <Avatar name={displayName} size="sm" src={avatarUrl} />
        <span className="truncate font-bebas text-2xl text-white uppercase tracking-tight leading-none">
          {displayName}
        </span>
      </div>

      <NavGroup label="Account settings">
        <NavItem
          icon={IconUser}
          label="Personal Profile"
          active={activeTab === 'personal'}
          onClick={() => onTabChange('personal')}
        />
      </NavGroup>

      <NavGroup label="Workspace">
        <NavItem
          icon={IconCredits}
          label="Credits & Usage"
          active={activeTab === 'credits'}
          onClick={() => onTabChange('credits')}
        />
        <NavItem
          icon={IconCrown}
          label="Subscription"
          active={activeTab === 'subscription'}
          onClick={() => onTabChange('subscription')}
        />
        <NavItem
          icon={IconActivity}
          label="Activity"
          active={activeTab === 'activity'}
          onClick={() => onTabChange('activity')}
        />
      </NavGroup>
    </aside>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 px-3 font-mono text-[9px] uppercase tracking-[0.25em] text-white/35">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 border px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-widest transition-colors ${
        active
          ? 'border-acid/40 bg-acid/5 text-acid'
          : 'border-transparent text-white/55 hover:border-white/10 hover:bg-panel/40 hover:text-white'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// PERSONAL TAB
// ──────────────────────────────────────────────────────────────

function PersonalTab({
  profile,
  displayName,
  avatarUrl,
  uploadingAvatar,
  fileInputRef,
  onAvatarUpload,
  fullName,
  setFullName,
  username,
  setUsername,
  isPublic,
  setIsPublic,
  isEditingIdentity,
  setIsEditingIdentity,
  profileChanged,
  savingProfile,
  profileError,
  onSaveProfile,
  onChangeEmail,
  onChangePassword,
  onSignOut,
  onDelete,
}: {
  profile: ProfileRow;
  displayName: string;
  avatarUrl: string | null;
  uploadingAvatar: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fullName: string;
  setFullName: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  isPublic: boolean;
  setIsPublic: (v: boolean) => void;
  isEditingIdentity: boolean;
  setIsEditingIdentity: (v: boolean) => void;
  profileChanged: boolean;
  savingProfile: boolean;
  profileError: string | null;
  onSaveProfile: (e: React.FormEvent) => void;
  onChangeEmail: () => void;
  onChangePassword: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  return (
    <form onSubmit={onSaveProfile} className="space-y-4">
      {/* Identity card */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <div className="relative group/avatar shrink-0">
              <Avatar name={displayName} size="lg" src={avatarUrl} />
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
                onChange={onAvatarUpload}
              />
            </div>
            <div className="min-w-0">
              <h1 className="font-bebas text-4xl md:text-5xl text-white uppercase tracking-tight leading-none truncate">
                {displayName}
              </h1>
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
          <button
            type="button"
            onClick={() => setIsEditingIdentity(!isEditingIdentity)}
            className="flex items-center gap-2 border border-white/15 bg-panel/40 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-white/70 hover:border-acid hover:text-acid transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            {isEditingIdentity ? 'Cancel' : 'Edit profile'}
          </button>
        </div>
      </Card>

      {/* Username + Email */}
      <Card>
        <FieldRow label="USERNAME">
          {isEditingIdentity ? (
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="vertix_user"
              maxLength={20}
              className="w-full bg-transparent border-b border-white/20 focus:border-acid font-mono text-[13px] text-white outline-none pb-1.5 placeholder:text-white/20 transition-colors"
            />
          ) : (
            <p className="font-mono text-[13px] text-white">
              {username || <span className="text-white/30">— not set —</span>}
            </p>
          )}
        </FieldRow>

        <div className="h-px bg-white/5 my-5" />

        <FieldRow label="FULL NAME">
          {isEditingIdentity ? (
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={displayName}
              maxLength={60}
              className="w-full bg-transparent border-b border-white/20 focus:border-acid font-mono text-[13px] text-white outline-none pb-1.5 placeholder:text-white/20 transition-colors"
            />
          ) : (
            <p className="font-mono text-[13px] text-white">
              {fullName || <span className="text-white/30">— not set —</span>}
            </p>
          )}
        </FieldRow>

        <div className="h-px bg-white/5 my-5" />

        <FieldRow label="EMAIL">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[13px] text-white truncate">{profile.email ?? '—'}</p>
            <button
              type="button"
              onClick={onChangeEmail}
              className="font-mono text-[10px] text-white/50 hover:text-acid uppercase tracking-widest transition-colors"
            >
              CHANGE
            </button>
          </div>
        </FieldRow>

        <div className="h-px bg-white/5 my-5" />

        <FieldRow label="PASSWORD">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[13px] text-white">••••••••</p>
            <button
              type="button"
              onClick={onChangePassword}
              className="font-mono text-[10px] text-white/50 hover:text-acid uppercase tracking-widest transition-colors"
            >
              CHANGE
            </button>
          </div>
        </FieldRow>

        <div className="h-px bg-white/5 my-5" />

        <FieldRow label="VISIBILITY">
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
        </FieldRow>

        {isEditingIdentity && (
          <div className="mt-6 flex items-center gap-3 border-t border-white/5 pt-5">
            <button
              type="submit"
              disabled={!profileChanged || savingProfile}
              className="bg-acid text-black font-mono text-[10px] uppercase tracking-widest px-5 py-2 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white transition-colors"
            >
              {savingProfile ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
            {profileError && (
              <p className="font-mono text-[10px] text-danger uppercase tracking-widest">
                {profileError}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Danger zone */}
      <Card>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50 mb-5">
          Account actions
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSignOut}
            className="font-mono text-[10px] text-white/60 hover:text-white border border-white/10 hover:border-white/30 px-4 py-2 uppercase tracking-widest transition-all"
          >
            SIGN OUT
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="font-mono text-[10px] text-danger/70 hover:text-danger border border-white/10 hover:border-danger px-4 py-2 uppercase tracking-widest transition-all"
          >
            DELETE ACCOUNT
          </button>
        </div>
      </Card>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────
// CREDITS TAB
// ──────────────────────────────────────────────────────────────

function CreditsTab({
  imageCredits,
  monthlyCredits,
  purchasedCredits,
  monthlyGrant,
  imagePct,
  creditsSpent,
  updatedAt,
  topUpTransactions,
  usageTransactions,
  onTopUp,
}: {
  imageCredits: number;
  monthlyCredits: number;
  purchasedCredits: number;
  monthlyGrant: number;
  imagePct: number;
  creditsSpent: number;
  updatedAt: string | undefined;
  topUpTransactions: CreditTransaction[];
  usageTransactions: CreditTransaction[];
  onTopUp: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Credits + Usage chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
              <IconCredits className="h-3 w-3" />
              Credits
            </h2>
            {updatedAt && (
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">
                Updated {formatDate(updatedAt)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="font-bebas text-6xl leading-none tracking-tight text-white">
                {imagePct}%
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-white/50">
                {imageCredits.toLocaleString()} left
              </p>
            </div>
            <CircularProgress pct={imagePct} size={92} />
          </div>

          {monthlyGrant > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-px border border-white/10 bg-white/10">
              <div className="bg-dark p-3">
                <p className="font-mono text-[8px] uppercase tracking-widest text-acid">Community</p>
                <p className="mt-1 font-bebas text-2xl leading-none text-white">
                  {monthlyCredits.toLocaleString()}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
                  of {monthlyGrant.toLocaleString()} / mo · resets monthly
                </p>
              </div>
              <div className="bg-dark p-3">
                <p className="font-mono text-[8px] uppercase tracking-widest text-white/50">Purchased</p>
                <p className="mt-1 font-bebas text-2xl leading-none text-white">
                  {purchasedCredits.toLocaleString()}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-widest text-white/35">
                  never expire
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/5 pt-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/45">
              {monthlyGrant > 0 ? 'Monthly resets · purchased never expire' : 'Credits never expire'}
            </div>
            <button
              type="button"
              onClick={onTopUp}
              className="bg-white text-black font-mono text-[10px] font-bold uppercase tracking-[0.2em] px-5 py-2.5 hover:bg-acid transition-colors"
            >
              Top-up
            </button>
          </div>
        </Card>

        <Card>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
              <IconActivity className="h-3 w-3" />
              Usage history
            </h2>
            <span className="font-mono text-[9px] uppercase tracking-widest text-white/40">
              {creditsSpent.toLocaleString()} spent
            </span>
          </div>
          <UsageChart transactions={usageTransactions} />
        </Card>
      </div>

      {/* Top-up history + recent usage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
            Top-up history
          </h2>
          {topUpTransactions.length === 0 ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">
              No top-ups yet
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {topUpTransactions.slice(0, 6).map((t) => (
                <CreditTransactionRow key={t.id} transaction={t} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
            Recent usage
          </h2>
          {usageTransactions.length === 0 ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">
              No usage in this period
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {usageTransactions.slice(0, 6).map((t) => (
                <CreditTransactionRow key={t.id} transaction={t} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SUBSCRIPTION TAB
// ──────────────────────────────────────────────────────────────

function SubscriptionTab({
  plan,
  imageCredits,
  onTopUp,
}: {
  plan: ReturnType<typeof getPlanForProfile>;
  imageCredits: number;
  onTopUp: () => void;
}) {
  const imageMax = Math.max(plan.monthlyImageLimit, imageCredits, 1);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
              Current plan
            </p>
            <h2 className="mt-2 font-bebas text-5xl text-white uppercase tracking-tight leading-none">
              {plan.name}
            </h2>
          </div>
          <span className="border border-acid/40 bg-acid/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-acid">
            Active
          </span>
        </div>

        <div className="mt-8 grid gap-5">
          <CreditMeter label="Credit balance" value={imageCredits} max={imageMax} />
        </div>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-white/5 pt-6">
          <button
            type="button"
            onClick={onTopUp}
            className="bg-acid text-black font-mono text-[10px] font-bold uppercase tracking-[0.2em] px-5 py-2.5 hover:bg-white transition-colors"
          >
            Top-up credits
          </button>
          <button
            type="button"
            onClick={onTopUp}
            className="border border-white/15 bg-panel/40 px-5 py-2.5 font-mono text-[10px] uppercase tracking-widest text-white/70 hover:border-acid hover:text-acid transition-colors"
          >
            Buy credits
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
          How credits work
        </h2>
        <div className="grid grid-cols-2 gap-px bg-white/10">
          <PlanDatum label="Image" value="2–70 cr" />
          <PlanDatum label="Video" value="65–550 cr" />
        </div>
        <p className="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-widest text-white/35">
          Cost depends on the model and options you pick. Credits never expire.
        </p>
      </Card>
    </div>
  );
}

function PlanDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-dark p-5">
      <span className="block font-mono text-[9px] uppercase tracking-[0.25em] text-white/35">
        {label}
      </span>
      <span className="mt-2 block font-bebas text-3xl text-white tracking-tight leading-none">
        {value}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ACTIVITY TAB
// ──────────────────────────────────────────────────────────────

function ActivityTab({
  activity,
  topCategories,
  likesCount,
  boardsCount,
}: {
  activity: ActivityEvent[];
  topCategories: CategoryStat[];
  likesCount: number;
  boardsCount: number;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
          Overview
        </h2>
        <div className="grid grid-cols-2 gap-px bg-white/10">
          <PlanDatum label="Likes" value={likesCount.toLocaleString()} />
          <PlanDatum label="Boards" value={boardsCount.toLocaleString()} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
            Recent activity
          </h2>
          {activity.length === 0 ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">
              No activity yet
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
        </Card>

        <Card>
          <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-white/55">
            Top categories
          </h2>
          {topCategories.length === 0 ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">
              Like items to see stats
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
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
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SHARED UI PRIMITIVES
// ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="border border-white/10 bg-panel/70 p-5 md:p-7">
      {children}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">
        {label}
      </p>
      {children}
    </div>
  );
}

function CircularProgress({ pct, size = 80 }: { pct: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-acid)"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
}

function UsageChart({ transactions }: { transactions: CreditTransaction[] }) {
  const bars = useMemo(() => {
    const days = 30;
    const now = Date.now();
    const buckets = new Array(days).fill(0);
    for (const t of transactions) {
      const ts = new Date(t.created_at).getTime();
      const diffDays = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < days) {
        buckets[days - 1 - diffDays] += Math.abs(t.amount);
      }
    }
    return buckets;
  }, [transactions]);

  const max = Math.max(...bars, 1);
  const hasData = bars.some((b) => b > 0);

  if (!hasData) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/30">
          No usage in last 30 days
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {bars.map((value, i) => {
          const h = Math.max(2, Math.round((value / max) * 100));
          return (
            <div
              key={i}
              className="flex-1 bg-acid/70 hover:bg-acid transition-colors"
              style={{ height: `${h}%` }}
              title={`${value} credits`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[9px] uppercase tracking-widest text-white/30">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
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

// ──────────────────────────────────────────────────────────────
// ICONS
// ──────────────────────────────────────────────────────────────

function IconUser({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconCredits({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M9 10c0-1.5 1.5-2 3-2s3 .5 3 2-1.5 2-3 2-3 .5-3 2 1.5 2 3 2 3-.5 3-2" />
    </svg>
  );
}

function IconCrown({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7l4 5 5-7 5 7 4-5v12H3z" />
    </svg>
  );
}

function IconActivity({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────
// FORMATTERS
// ──────────────────────────────────────────────────────────────

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
