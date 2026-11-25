import { forwardRef } from 'react';
import type { MapPoint } from './geo';
import { Spinner } from '../components';
import { StartupMap } from './StartupMap';
import { count, type StartupStat } from './words';
import './Startup.css';

/** ok ✓, busy (a turning spinner: still going), fail ✗, neutral ● (a state, not a step). */
export type LineTone = 'ok' | 'busy' | 'fail' | 'neutral';

export interface StartupLine {
  readonly key: string;
  readonly tone: LineTone;
  readonly text: string;
}

export interface StartupScreenProps {
  readonly lines: readonly StartupLine[];
  /** 0..1. */
  readonly progress: number;
  /** "Good morning, Maria" and "Sunday, 1 November"; null with nobody signed in. */
  readonly greeting: { readonly text: string; readonly date: string } | null;
  readonly stats: readonly StartupStat[];
  readonly points: readonly MapPoint[];
  readonly appVersion: string;
  readonly reducedMotion: boolean;
  /** Fading out. */
  readonly leaving: boolean;
  readonly onSkip: () => void;
}

const MARKS: Record<Exclude<LineTone, 'busy'>, string> = { ok: '✓', fail: '✗', neutral: '●' };

/**
 * The startup screen: the brand, what is happening, and every listing on a
 * map. Always dark (data-theme="dark"), whatever the theme. A click anywhere
 * skips it; so does any key, which the caller listens for.
 */
export const StartupScreen = forwardRef<HTMLDivElement, StartupScreenProps>(function StartupScreen(
  { lines, progress, greeting, stats, points, appVersion, reducedMotion, leaving, onSkip },
  ref,
) {
  const shown = Math.max(0, Math.min(1, progress));
  return (
    <div
      ref={ref}
      className="startup"
      data-theme="dark"
      data-leaving={leaving || undefined}
      tabIndex={-1}
      aria-labelledby="startup-brand"
      role="dialog"
      aria-modal="true"
      onClick={onSkip}
    >
      {/* The islands from the start; the listings' dots join them as the list arrives. */}
      <StartupMap points={points} reducedMotion={reducedMotion} />

      <div className="startup__intro">
        <h1 id="startup-brand" className="startup__brand">
          <span className="startup__apg">APG</span> <span className="startup__name">Post-It</span>
        </h1>
        <p className="startup__by">
          by <b>Christopher Joseph Aureo</b>
        </p>

        <div role="status" className="startup__status">
          <ul className="startup__lines">
            {lines.map((line) => (
              <li key={line.key} className="startup__line" data-tone={line.tone}>
                <span className="startup__mark" aria-hidden="true">
                  {line.tone === 'busy' ? <Spinner size="small" className="startup__spinner" /> : MARKS[line.tone]}
                </span>
                {line.text}
              </li>
            ))}
          </ul>
          {points.length > 0 ? <p className="visually-hidden">{count(points.length)} listings on the map</p> : null}
        </div>
        <div className="startup__bar" aria-hidden="true">
          <div className="startup__fill" style={{ transform: `scaleX(${shown})` }} />
        </div>
        <p className="visually-hidden">Press any key or click to skip.</p>
      </div>

      <p className="startup__foot">Alpha Premier Group · v{appVersion}</p>

      {greeting ? (
        <div className="startup__greeting">
          <p className="startup__hello">{greeting.text}</p>
          <p className="startup__date">{greeting.date}</p>
        </div>
      ) : null}

      {stats.length > 0 ? (
        <ul className="startup__stats">
          {stats.map((stat) => (
            <li key={stat.label} className="startup__stat">
              <span className="startup__value" aria-hidden={stat.value === null || undefined}>
                {stat.value === null ? '–' : count(stat.value)}
              </span>
              <span className="startup__label">{stat.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
