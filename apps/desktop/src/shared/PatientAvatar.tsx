// Default patient avatar (M3-RWv5 C2): an OFFLINE inline-SVG male or female
// silhouette shown wherever the patient photo slot renders and no photo is
// stored. Pure markup — no <img>, no URL, no asset fetch — so it works under
// the strict CSP with zero network. A real photo always overrides it (callers
// render this only in the no-photo branch).

import { t } from '@/shared/strings';

/** Which silhouette a stored sex maps to (`null` = no default avatar). */
export type AvatarKind = 'male' | 'female';

/**
 * Map the stored sex code (`M` / `F` / `O` / null) to a silhouette. Only male
 * and female have a default avatar; any other value keeps the caller's
 * existing "no photo" placeholder.
 */
export function avatarKindForSex(
  sex: string | null | undefined,
): AvatarKind | null {
  if (sex === 'M') return 'male';
  if (sex === 'F') return 'female';
  return null;
}

/** Props for {@link PatientAvatar}. */
export interface PatientAvatarProps {
  /** Which silhouette to draw. */
  readonly kind: AvatarKind;
  /** Stable E2E/test hook for the avatar element. */
  readonly testId: string;
  /** Extra classes for the wrapper (size is inherited from the photo slot). */
  readonly className?: string;
}

/**
 * The default silhouette. The wrapper is `role="img"` with a localised
 * accessible name; the SVG itself is decorative (`aria-hidden`). The two
 * silhouettes differ in shape (the female one has a longer hair outline), so
 * the meaning never relies on colour alone.
 */
export function PatientAvatar({
  kind,
  testId,
  className,
}: PatientAvatarProps): JSX.Element {
  const label =
    kind === 'male'
      ? t('patient.avatar.male.label')
      : t('patient.avatar.female.label');
  return (
    <span
      data-testid={testId}
      data-avatar={kind}
      role="img"
      aria-label={label}
      className={['flex h-full w-full items-center justify-center', className]
        .filter((c) => c !== undefined && c !== '')
        .join(' ')}
    >
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        className="h-full w-full text-slate-500"
        fill="currentColor"
      >
        {kind === 'male' ? (
          <>
            {/* Short hair cap + head */}
            <circle cx="32" cy="22" r="11" />
            <path d="M21 19c1-7 6-11 11-11s10 4 11 11c-3-3-7-4-11-4s-8 1-11 4z" />
            {/* Broad shoulders */}
            <path d="M10 60c0-12 10-20 22-20s22 8 22 20z" />
          </>
        ) : (
          <>
            {/* Long hair falling past the shoulders */}
            <path d="M18 40c-2-6-3-12-2-19 1-9 8-14 16-14s15 5 16 14c1 7 0 13-2 19z" />
            {/* Head */}
            <circle cx="32" cy="23" r="10" fill="#e2e8f0" />
            {/* Narrower shoulders */}
            <path d="M14 60c0-11 8-19 18-19s18 8 18 19z" />
          </>
        )}
      </svg>
    </span>
  );
}
