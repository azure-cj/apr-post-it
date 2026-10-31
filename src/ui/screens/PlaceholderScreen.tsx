import { Card, EmptyState, Icon, Pill } from '../components';

export interface PlaceholderScreenProps {
  readonly title: string;
  /** What the screen is for, as the person using it would put it. */
  readonly description: string;
  /** The build step that delivers it, from docs/plans/TAURI-PLAN.md §5. */
  readonly step: number;
  /** What that step adds, in a few words. */
  readonly arrives: string;
}

/** A route that exists before its screen does. Says what it will be and when. */
export function PlaceholderScreen({ title, description, step, arrives }: PlaceholderScreenProps) {
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header__row">
          <h1 className="page-header__title" tabIndex={-1}>
            {title}
          </h1>
          <Pill tone="info">Not built yet</Pill>
        </div>
        <p className="page-header__description">{description}</p>
      </header>

      <Card>
        <EmptyState icon={<Icon name="info" size={24} />} title={`Arrives in step ${step}`}>
          {arrives}
        </EmptyState>
      </Card>
    </div>
  );
}
