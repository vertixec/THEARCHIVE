import { createClient } from '@/lib/supabaseServer';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { canAccessFeature, type BusinessProfile } from '@/lib/business';
import CommunityContent, { type CommunityTab } from './CommunityContent';
import LockedCommunity from './LockedCommunity';

const PAGE_SIZE = 60;

const VALID_TABS: CommunityTab[] = ['visuals', 'workflows', 'drops'];

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: CommunityTab = VALID_TABS.includes(tab as CommunityTab)
    ? (tab as CommunityTab)
    : 'visuals';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve the viewer's tier to decide full hub vs. locked teaser.
  let profile: BusinessProfile | null = null;
  if (user) {
    const expanded = await supabase
      .from('profiles')
      .select('id, status, role, access_tier, plan_id')
      .eq('id', user.id)
      .maybeSingle<BusinessProfile>();
    profile = expanded.error
      ? (
          await supabase
            .from('profiles')
            .select('id, status, role')
            .eq('id', user.id)
            .maybeSingle<BusinessProfile>()
        ).data ?? null
      : expanded.data;
  }

  const isMember = canAccessFeature(profile, 'view_community');

  // Non-members get a locked teaser with a few blurred featured previews.
  // RLS hides community_visuals from non-members, so fetch the teaser image
  // URLs with the admin client (server-only, returns just a handful of URLs).
  // Non-essential: if the service key is missing, the teaser renders without
  // images.
  if (!isMember) {
    let previews: string[] = [];
    try {
      const admin = createAdminClient();
      const { data: previewData } = await admin
        .from('community_visuals')
        .select('image_url')
        .order('is_featured', { ascending: false })
        .limit(9);
      previews = (previewData || [])
        .map((p) => p.image_url as string | null)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
    } catch {
      previews = [];
    }
    return <LockedCommunity previews={previews} />;
  }

  // The members hub pulls both feeds up front so switching sub-tabs is instant.
  const [visualsResult, workflowsResult] = await Promise.all([
    supabase
      .from('community_visuals')
      .select('*')
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE),
    supabase
      .from('workflows')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  const visuals = visualsResult.data || [];
  const workflows = workflowsResult.data || [];

  return (
    <CommunityContent
      initialTab={initialTab}
      initialVisuals={visuals}
      visualsHasMore={visuals.length === PAGE_SIZE}
      initialWorkflows={workflows}
      workflowsHasMore={workflows.length === PAGE_SIZE}
    />
  );
}
