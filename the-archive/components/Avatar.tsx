import { getInitials } from '@/lib/profileMetrics';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<Size, { box: string; text: string }> = {
  sm: { box: 'w-10 h-10',   text: 'text-xl' },
  md: { box: 'w-16 h-16',   text: 'text-3xl' },
  lg: { box: 'w-24 h-24',   text: 'text-5xl' },
};

interface Props {
  name: string | null | undefined;
  size?: Size;
  className?: string;
}

export default function Avatar({ name, size = 'md', className = '' }: Props) {
  const { box, text } = SIZE_CLASSES[size];
  const initials = getInitials(name);

  return (
    <div
      className={`${box} flex items-center justify-center bg-dark border border-acid select-none shrink-0 ${className}`}
      aria-label={name ?? 'avatar'}
    >
      <span className={`font-bebas ${text} text-acid leading-none tracking-wider pt-1`}>
        {initials}
      </span>
    </div>
  );
}
