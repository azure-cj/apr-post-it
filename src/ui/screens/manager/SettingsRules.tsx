import { useId, useState, type FormEvent } from 'react';
import { Button, Card, Notice, Spinner } from '../../components';
import { RULE_LIMITS } from '@/core/types';
import { sentence } from './SettingsShared';

/** The rules the server keeps on its Settings tab. */
export interface RuleValues {
  readonly cooldownDays: number;
  readonly repostDueDays: number;
  readonly perWeek: number;
  /** v14: how many weeks a new queue runs, 1 to 3. */
  readonly queueWeeks: number;
}

type RuleKey = keyof RuleValues;

interface RuleDef {
  readonly key: RuleKey;
  readonly label: string;
  readonly what: string;
  readonly unit: readonly [string, string];
  readonly min: number;
  readonly max: number;
}

const { cooldownDays, repostDueDays, perWeek, queueWeeks } = RULE_LIMITS;

/** The ranges are the server's (RULE_LIMITS, as Code.gs holds them). */
export const RULES: readonly RuleDef[] = [
  { key: 'cooldownDays', label: 'Cooldown', what: 'Days before a listing can be posted again.', unit: ['day', 'days'], min: cooldownDays.min, max: cooldownDays.max },
  { key: 'repostDueDays', label: 'Due for repost', what: 'Days without a post before a listing is due again.', unit: ['day', 'days'], min: repostDueDays.min, max: repostDueDays.max },
  { key: 'perWeek', label: 'Listings per week', what: 'Each agent’s target per week of a queue.', unit: ['listing', 'listings'], min: perWeek.min, max: perWeek.max },
  { key: 'queueWeeks', label: 'Queue length', what: 'Working weeks a new queue runs. Weekends don’t count.', unit: ['week', 'weeks'], min: queueWeeks.min, max: queueWeeks.max },
];

/** The problem with a typed value, or null. */
export function ruleProblem(text: string, def: Pick<RuleDef, 'min' | 'max'>): string | null {
  const t = text.trim();
  if (t === '') return 'Type a number.';
  if (!/^\d+$/.test(t)) return `Use a whole number from ${def.min} to ${def.max}.`;
  const n = Number(t);
  if (n < def.min || n > def.max) return `Use a whole number from ${def.min} to ${def.max}.`;
  return null;
}

export interface SettingsRulesProps {
  /** As the server last said them. Null while they are read. */
  readonly rules: RuleValues | null;
  /** Saves them. Resolves with what the server kept. Without it, the rules are read-only. */
  readonly onSave?: ((rules: RuleValues) => Promise<RuleValues>) | undefined;
}

export function SettingsRules({ rules, onSave }: SettingsRulesProps) {
  return (
    <div className="settings__column">
      <Card>
        {rules ? (
          <RulesForm saved={rules} onSave={onSave} />
        ) : (
          <div className="settings__waiting">
            <Spinner size="small" label="Reading the rules" />
            <span>Reading the rules…</span>
          </div>
        )}
      </Card>
    </div>
  );
}

function RulesForm({ saved, onSave }: { readonly saved: RuleValues; readonly onSave?: ((rules: RuleValues) => Promise<RuleValues>) | undefined }) {
  const asText = (r: RuleValues) => ({
    cooldownDays: String(r.cooldownDays),
    repostDueDays: String(r.repostDueDays),
    perWeek: String(r.perWeek),
    queueWeeks: String(r.queueWeeks),
  });
  /** What the server holds: the props at first, then what each Save kept. */
  const [base, setBase] = useState(saved);
  const [values, setValues] = useState<Record<RuleKey, string>>(asText(saved));
  const [checked, setChecked] = useState<ReadonlySet<RuleKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const formId = useId();

  const editable = Boolean(onSave);
  const dirty = RULES.some((r) => values[r.key].trim() !== String(base[r.key]));
  const problems = Object.fromEntries(RULES.map((r) => [r.key, ruleProblem(values[r.key], r)])) as Record<RuleKey, string | null>;

  const set = (key: RuleKey, text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    setDone(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSave || busy || !dirty) return;
    setChecked(new Set(RULES.map((r) => r.key)));
    const bad = RULES.find((r) => problems[r.key]);
    if (bad) {
      document.getElementById(`${formId}-${bad.key}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const kept = await onSave({
        cooldownDays: Number(values.cooldownDays),
        repostDueDays: Number(values.repostDueDays),
        perWeek: Number(values.perWeek),
        queueWeeks: Number(values.queueWeeks),
      });
      setBase(kept);
      setValues(asText(kept));
      setChecked(new Set());
      setDone(true);
    } catch (err) {
      setError(sentence(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rules" onSubmit={(e) => void submit(e)} noValidate>
      {RULES.map((r) => {
        const id = `${formId}-${r.key}`;
        const problem = checked.has(r.key) ? problems[r.key] : null;
        const n = Number(values[r.key]);
        const whole = /^\d+$/.test(values[r.key].trim());
        return (
          <div key={r.key} className="rule">
            <div className="rule__text">
              <label className="rule__label" htmlFor={id}>
                {r.label}
              </label>
              <p className="rule__what" id={`${id}-what`}>
                {r.what}
              </p>
            </div>
            <div className="rule__control">
              <div className={['stepper', problem ? 'stepper--error' : null].filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className="stepper__step"
                  aria-label={`Fewer: ${r.label}`}
                  disabled={!editable || busy || (whole && n <= r.min)}
                  onClick={() => set(r.key, String(whole ? Math.max(r.min, n - 1) : r.min))}
                >
                  −
                </button>
                <input
                  id={id}
                  className="stepper__input tabular"
                  inputMode="numeric"
                  autoComplete="off"
                  value={values[r.key]}
                  readOnly={!editable || busy}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={[problem ? `${id}-error` : null, `${id}-what`].filter(Boolean).join(' ')}
                  onChange={(e) => set(r.key, e.target.value)}
                  onBlur={() => setChecked((c) => new Set(c).add(r.key))}
                  onKeyDown={(e) => {
                    if (!editable || busy || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    const base = whole ? n : r.min;
                    set(r.key, String(Math.min(r.max, Math.max(r.min, base + (e.key === 'ArrowUp' ? 1 : -1)))));
                  }}
                />
                <button
                  type="button"
                  className="stepper__step"
                  aria-label={`More: ${r.label}`}
                  disabled={!editable || busy || (whole && n >= r.max)}
                  onClick={() => set(r.key, String(whole ? Math.min(r.max, n + 1) : r.min))}
                >
                  +
                </button>
              </div>
              <span className="rule__unit">{whole && n === 1 ? r.unit[0] : r.unit[1]}</span>
            </div>
            {problem ? (
              <p className="rule__error" id={`${id}-error`}>
                {problem}
              </p>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      {editable ? (
        <div className="rules__actions">
          <span className="rules__saved" role="status">
            {done && !dirty ? 'Saved' : ''}
          </span>
          <Button
            disabled={!dirty || busy}
            onClick={() => {
              setValues(asText(base));
              setChecked(new Set());
              setError(null);
            }}
          >
            Reset
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!dirty && !busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : (
        <p className="settings__muted">Read-only: this web app can&rsquo;t save rules yet.</p>
      )}
    </form>
  );
}
