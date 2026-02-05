'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Grid from '@/components/Grid';
import { useSync } from '@/components/SyncContext';

export default function Favorites() {
  const { setStatus } = useSync();
  const [likedItems, setLikedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFavorites() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch all likes for the user
      const { data: likes, error: likesError } = await supabase
        .from('user_likes')
        .select('*')
        .eq('user_id', user.id);

      if (likesError || !likes) {
        if (likesError) console.error('Error fetching likes:', likesError);
        setLikedItems([]);
        setLoading(false);
        setStatus(likesError ? 'ERROR' : 'ONLINE');
        return;
      }

      if (likes.length === 0) {
        setLikedItems([]);
        setLoading(false);
        setStatus('ONLINE');
        return;
      }

      // Separate likes by type for efficient batch fetching
      const visualIds = likes.filter(l => l.item_type === 'visual').map(l => l.item_id);
      const systemIds = likes.filter(l => l.item_type === 'system').map(l => l.item_id);
      const communityIds = likes.filter(l => l.item_type === 'community').map(l => l.item_id);

      const fetchPromises = [];

      if (visualIds.length > 0) {
        fetchPromises.push(
          supabase.from('prompts').select('*').in('id', visualIds).then(res => {
            return (res.data || []).map(item => ({ ...item, _itemType: 'visual' as const }));
          })
        );
      }
      if (systemIds.length > 0) {
        fetchPromises.push(
          supabase.from('functional_prompts').select('*').in('id', systemIds).then(res => {
            return (res.data || []).map(item => ({ ...item, _itemType: 'system' as const }));
          })
        );
      }
      if (communityIds.length > 0) {
        fetchPromises.push(
          supabase.from('community_visuals').select('*').in('id', communityIds).then(res => {
            return (res.data || []).map(item => ({ ...item, _itemType: 'community' as const }));
          })
        );
      }

      const results = await Promise.all(fetchPromises);
      const allItems = results.flat();

      // Sort items by the order they were liked
      const sortedItems = likes
        .map(like => allItems.find(item => item.id.toString() === like.item_id.toString() && item._itemType === like.item_type))
        .filter(Boolean);

      setLikedItems(sortedItems as any[]);
      setLoading(false);
      setStatus('ONLINE');
    }

    loadFavorites();
  }, []);

  const handleToggle = (itemId: string, itemType: string, newIsLiked: boolean) => {
    if (!newIsLiked) {
      setLikedItems(prev => prev.filter(item => !(item.id === itemId && item._itemType === itemType)));
    }
  };

  return (
    <div id="view-content">
      <header className="pt-12 pb-6 px-6 bg-panel/30">
        <div className="w-full text-left">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-acid text-black font-mono text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest text-shadow">USER DATASHORE</span>
          </div>
          <h1 id="view-title" className="font-anton text-6xl md:text-8xl text-white uppercase tracking-tighter leading-[0.8] mb-4">Saved Assets</h1>
          <p id="view-desc" className="font-mono text-xs text-white/60 border-l border-acid pl-4 max-w-lg uppercase tracking-wider">Your curated collection of prompts and references.</p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="font-mono text-acid animate-pulse tracking-widest uppercase text-xs">Accessing Likes...</div>
        </div>
      ) : likedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 border-y border-white/5">
          <div className="font-anton text-4xl text-white/20 uppercase tracking-tighter mb-4">Empty Repository</div>
          <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest">No liked assets found in your session.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[2px] p-[2px] min-h-screen pb-20">
          {likedItems.map((item) => {
            const activeTab = item._itemType;
            let cardTitle = 'ASSET';
            let secondaryLabel = 'VOL';
            let bottomLabel = 'CATEGORY';

            if(activeTab === 'visual') {
              cardTitle = item.category || 'ASSET';
              secondaryLabel = item.volume || 'VOL';
              bottomLabel = 'CATEGORY';
            } else if(activeTab === 'system') {
              cardTitle = item.title || 'SYSTEM';
              secondaryLabel = item.prompt_type || 'TYPE';
              bottomLabel = 'IDENTIFIER';
            } else if(activeTab === 'community') {
              cardTitle = item.author || 'COMMUNITY';
              secondaryLabel = item.is_featured ? 'FEATURED' : 'MEMBER';
              bottomLabel = 'AUTHOR';
            }

            return (
              <Card 
                key={`${item._itemType}-${item.id}`}
                item={item}
                cardTitle={cardTitle}
                secondaryLabel={secondaryLabel}
                bottomLabel={bottomLabel}
                itemType={item._itemType}
                initialIsLiked={true}
                onToggle={handleToggle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

import Card from '@/components/Card';
