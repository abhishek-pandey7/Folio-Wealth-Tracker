import { StarIcon } from '@phosphor-icons/react';
import { type StarTarget, useWatchlist } from '../hooks.js';

export function StarButton({ target }: { target: StarTarget }) {
  const { isStarred, star, unstar } = useWatchlist();
  const starred = isStarred(target.symbol);

  return (
    <button
      type="button"
      className={`star-button${starred ? ' on' : ''}`}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${target.symbol}` : `Star ${target.symbol}`}
      title={starred ? 'Remove from watchlist' : 'Add to watchlist'}
      onClick={(event) => {
        event.stopPropagation(); // rows are clickable; starring should not also select
        if (starred) {
          unstar(target.symbol);
        } else {
          star(target);
        }
      }}
    >
      <StarIcon size={16} weight={starred ? 'fill' : 'regular'} />
    </button>
  );
}
