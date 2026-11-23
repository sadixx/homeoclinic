// Registration-council dropdown + "Other (type manually)" box, shared by the
// S01 setup wizard and S18 Settings (MS reuse, design §8). The dropdown offers
// the verified list (registrationCouncils.ts); a stored value not in the list
// re-opens as Other with its text kept. The parent owns the two pieces of
// state so the wizard's Back keeps what the doctor chose.
//
// A11y: a labelled native <select> and text box, required marks hidden from
// screen readers (aria-required carries it), inline role="alert" errors.
import { t } from '@/shared/strings';

import {
  REGISTRATION_COUNCIL_LABELS,
  councilSelectionFor,
} from './registrationCouncils';

/**
 * Dropdown value of the "Other (type manually)" option. Not a valid council
 * label, so it can never collide with a listed authority or be stored.
 */
export const COUNCIL_OTHER_VALUE = '__other__';

/** Dropdown + Other-text state of the control. */
export interface CouncilState {
  /** `''` | a listed label | {@link COUNCIL_OTHER_VALUE}. */
  readonly choice: string;
  /** The typed name, used only when Other is chosen. */
  readonly other: string;
}

/** Dropdown + Other-text state that re-opens a stored council string. */
export function councilStateFor(stored: string): CouncilState {
  const sel = councilSelectionFor(stored);
  if (sel.choice === 'listed') return { choice: sel.text, other: '' };
  if (sel.choice === 'other')
    return { choice: COUNCIL_OTHER_VALUE, other: sel.text };
  return { choice: '', other: '' };
}

/** The council string to store for a state (trimmed Other text, or the label). */
export function councilValueOf(state: CouncilState): string {
  return state.choice === COUNCIL_OTHER_VALUE
    ? state.other.trim()
    : state.choice;
}

/** Props of {@link CouncilSelect}. */
export interface CouncilSelectProps {
  /** testid base: the select is `idBase`, the Other box `${idBase}-other`. */
  readonly idBase: string;
  readonly value: CouncilState;
  readonly onChange: (next: CouncilState) => void;
  /** Inline errors keyed `idBase` / `${idBase}-other`. */
  readonly errors: Readonly<Record<string, string>>;
  /** LIC-006: read-only while a licence binds the identity. */
  readonly disabled?: boolean;
  /** Classes for the select and the text box. */
  readonly controlClassName?: string;
  /** Text size of the labels and errors (S18 uses `text-base`, >= 14 px). */
  readonly textSize?: 'text-sm' | 'text-base';
}

const DEFAULT_CONTROL_CLASS =
  'h-10 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600';

/** Registration-council dropdown with the "Other" text box. */
export function CouncilSelect({
  idBase,
  value,
  onChange,
  errors,
  disabled = false,
  controlClassName = DEFAULT_CONTROL_CLASS,
  textSize = 'text-sm',
}: CouncilSelectProps): JSX.Element {
  const otherId = `${idBase}-other`;
  const isOther = value.choice === COUNCIL_OTHER_VALUE;

  const errorLine = (key: string): JSX.Element | null => {
    const message = errors[key];
    if (message === undefined) return null;
    return (
      <p
        data-testid={`${key}-error`}
        role="alert"
        className={`mt-1 ${textSize} text-red-700`}
      >
        {message}
      </p>
    );
  };

  return (
    <>
      <div className="flex flex-col">
        <label
          htmlFor={`${idBase}-input`}
          className={`${textSize} text-slate-700`}
        >
          {t('setup.doctor.council')}
          <span aria-hidden="true">{t('setup.requiredMark')}</span>
        </label>
        <select
          id={`${idBase}-input`}
          data-testid={idBase}
          aria-required
          aria-invalid={errors[idBase] !== undefined}
          disabled={disabled}
          value={value.choice}
          onChange={(e) => onChange({ ...value, choice: e.target.value })}
          className={controlClassName}
        >
          <option value="">{t('setup.doctor.councilPlaceholder')}</option>
          {REGISTRATION_COUNCIL_LABELS.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
          <option value={COUNCIL_OTHER_VALUE}>
            {t('setup.doctor.councilOtherOption')}
          </option>
        </select>
        {errorLine(idBase)}
      </div>
      {isOther ? (
        <div className="flex flex-col">
          <label
            htmlFor={`${otherId}-input`}
            className={`${textSize} text-slate-700`}
          >
            {t('setup.doctor.councilOther')}
            <span aria-hidden="true">{t('setup.requiredMark')}</span>
          </label>
          <input
            id={`${otherId}-input`}
            data-testid={otherId}
            type="text"
            aria-required
            aria-invalid={errors[otherId] !== undefined}
            readOnly={disabled}
            placeholder={t('setup.doctor.councilOtherPlaceholder')}
            value={value.other}
            onChange={(e) => onChange({ ...value, other: e.target.value })}
            className={controlClassName}
          />
          {errorLine(otherId)}
        </div>
      ) : null}
    </>
  );
}
