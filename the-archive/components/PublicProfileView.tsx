import Avatar from '@/components/Avatar';
import { formatJoinDate } from '@/lib/profileMetrics';
import type {
  ProfileRow,
  ProfileMetrics,
  CategoryStat,
} from '@/lib/profileMetrics';

interface Props {
  profile: ProfileRow;
  metrics: ProfileMetrics;
  topCategories: CategoryStat[];
}

export default function PublicProfileView({
  profile,
  metrics,
  topCategories,
}: Props) {
  const displayName = profile.full_name || profile.username || 'MEMBER';

  return (
    <div id="view-content" className="min-h-screen pb-20">
      <header className="px-6 md:px-12 pt-16 pb-12 border-b border-white/10">
        <div className="max-w-4xl mx-auto flex flex-col items-center text-center gap-6">
          <Avatar name={displayName} size="lg" />
          <div>
            <h1 className="font-bebas text-5xl md:text-7xl text-white uppercase tracking-tighter leading-none">
              {displayName}
            </h1>
            <p className="font-space text-[11px] text-acid uppercase tracking-[0.25em] mt-3">
              @{profile.username}
              <span className="mx-2 text-white/20">·</span>
              <span className="text-white/50">MEMBER SINCE {formatJoinDate(profile.created_at)}</span>
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto mt-12 grid grid-cols-3 gap-px bg-white/10 border border-white/10">
          <Stat label="LIKES" value={metrics.likes_count} />
          <Stat label="BOARDS" value={metrics.boards_count} />
          <Stat label="DAYS" value={metrics.days_since_join} />
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 md:px-12 mt-12">
        <h2 className="font-mono text-[10px] text-white/40 uppercase tracking-[0.3em] mb-6">
          TOP CATEGORIES
        </h2>
        {topCategories.length === 0 ? (
          <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
            NO ACTIVITY YET
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {topCategories.map((c, i) => {
              const max = topCategories[0]?.count ?? 1;
              const pct = Math.round((c.count / max) * 100);
              return (
                <li key={c.label}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-bebas text-3xl text-white tracking-wider">
                      {String(i + 1).padStart(2, '0')}. {c.label}
                    </span>
                    <span className="font-mono text-[11px] text-acid uppercase tracking-widest">
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
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-dark p-6 flex flex-col gap-1 items-center text-center">
      <span className="font-bebas text-5xl md:text-6xl text-white leading-none tracking-tighter">
        {value.toLocaleString()}
      </span>
      <span className="font-mono text-[9px] text-white/40 uppercase tracking-[0.25em]">
        {label}
      </span>
    </div>
  );
}
