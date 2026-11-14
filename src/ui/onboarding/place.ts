/** Where a tour's card goes beside the element it points at. Pure, so it can be tested without a browser. */

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type Side = 'right' | 'bottom' | 'top' | 'left' | 'center';

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: Side;
}

const MARGIN = 12;
const GAP = 16;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * The card's top-left. Beside the target when it fits: to the right for
 * something narrow (a sidebar item), below or above for something wide (a
 * section), and kept inside the window. No target: the middle of the window.
 */
export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }): Placement {
  const center = (): Placement => ({
    top: clamp((view.height - card.height) / 2, MARGIN, view.height - card.height - MARGIN),
    left: clamp((view.width - card.width) / 2, MARGIN, view.width - card.width - MARGIN),
    side: 'center',
  });
  if (!target) return center();

  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const midY = clamp(target.top + target.height / 2 - card.height / 2, MARGIN, view.height - card.height - MARGIN);
  const midX = clamp(target.left + target.width / 2 - card.width / 2, MARGIN, view.width - card.width - MARGIN);

  const sides: Record<Exclude<Side, 'center'>, { fits: boolean; at: Placement }> = {
    right: { fits: right + GAP + card.width <= view.width - MARGIN, at: { top: midY, left: right + GAP, side: 'right' } },
    bottom: { fits: bottom + GAP + card.height <= view.height - MARGIN, at: { top: bottom + GAP, left: midX, side: 'bottom' } },
    top: { fits: target.top - GAP - card.height >= MARGIN, at: { top: target.top - GAP - card.height, left: midX, side: 'top' } },
    left: { fits: target.left - GAP - card.width >= MARGIN, at: { top: midY, left: target.left - GAP - card.width, side: 'left' } },
  };
  const wide = target.width > view.width * 0.35;
  const order: readonly (keyof typeof sides)[] = wide ? ['bottom', 'top', 'right', 'left'] : ['right', 'bottom', 'top', 'left'];
  for (const side of order) if (sides[side].fits) return sides[side].at;

  // Bigger than any gap around it (a tall section): over its lower part, inside the window.
  return {
    top: clamp(bottom - card.height - MARGIN, MARGIN, view.height - card.height - MARGIN),
    left: midX,
    side: 'bottom',
  };
}
