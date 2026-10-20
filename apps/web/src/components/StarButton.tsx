import { StarIcon } from '@phosphor-icons/react';
import { type StarTarget, useWatchlist } from '../hooks.js';

export function StarButton({ target, label = false }: { target: StarTarget; label?: boolean }) {
  const { isStarred, star, unstar } = useWatchlist();
  const starred = isStarred(target);
  const name = target.kind === 'fund' ? (target.name ?? 'this fund') : target.symbol;

  return (
    <button
      type="button"
      className={`star-button${starred ? ' on' : ''}${label ? ' with-label' : ''}`}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
      title={starred ? 'Remove from starred' : 'Add to starred'}
      onClick={(event) => {
        event.preventDefault(); // stars sit inside links and clickable rows
        event.stopPropagation();
        if (starred) {
          unstar(target);
        } else {
          star(target);
        }
      }}
    >
      <StarIcon size={16} weight={starred ? 'fill' : 'regular'} />
      {label && <span>{starred ? 'Starred' : 'Star'}</span>}
    </button>
  );
}
