import { Icon } from './icons';
import s from './panels.module.css';

/** First-run invitation shown over an empty wall. */
export function EmptyState({
  onSurprise,
  onStarter,
  starterLabel,
  onScratch,
}: {
  onSurprise: () => void;
  onStarter: () => void;
  starterLabel: string;
  onScratch: () => void;
}) {
  return (
    <div className={s.emptyState} data-testid="empty-state">
      <div className={s.emptyCard}>
        <svg className={s.emptyArt} viewBox="0 0 120 64" aria-hidden="true">
          <path d="M8 14 Q60 40 112 14" className={s.artTwine} />
          <path d="M8 14 Q34 46 60 22 Q86 46 112 14" className={s.artTwine2} />
          <circle cx="8" cy="14" r="3" className={s.artNail} />
          <circle cx="60" cy="22" r="3" className={s.artNail} />
          <circle cx="112" cy="14" r="3" className={s.artNail} />
          <rect x="26" y="26" width="13" height="16" rx="1" className={s.artPhoto} transform="rotate(-6 32 30)" />
          <rect x="78" y="25" width="13" height="16" rx="1" className={s.artPhoto} transform="rotate(5 84 30)" />
        </svg>
        <h2 className={s.emptyTitle}>Let’s string something lovely</h2>
        <p className={s.emptyText}>Nails on the wall, twine between them, photos pinned along the way. Start playful and refine later.</p>
        <div className={s.emptyActions}>
          <button type="button" className={s.bigBtn} data-primary onClick={onSurprise}>
            <Icon name="sparkle" size={22} />
            <span>
              <strong>Surprise me</strong>
              <small>A random composition to riff on</small>
            </span>
          </button>
          <button type="button" className={s.bigBtn} onClick={onStarter}>
            <Icon name="frame" size={22} />
            <span>
              <strong>{starterLabel}</strong>
              <small>A classic to tweak</small>
            </span>
          </button>
          <button type="button" className={s.bigBtn} onClick={onScratch}>
            <Icon name="nail" size={22} />
            <span>
              <strong>Start from scratch</strong>
              <small>Place nails by hand in Refine</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
