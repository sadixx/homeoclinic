// S18 error presentation (R-UI-007/008, NFR-033): map a mapped
// `UserFacingError` code to the plain-language en.json string the Settings
// screen shows. The UI never displays a raw message, SQL or a file path.
import type { ErrorCode } from '@/bindings';
import { isUserFacingError } from '@/shared/command';
import { t, type StringKey } from '@/shared/strings';

/** The error code of a thrown value, or `null` when it is not a typed error. */
export function errorCodeOf(err: unknown): ErrorCode | null {
  return isUserFacingError(err) ? err.code : null;
}

const DATA_FOLDER_KEYS: Partial<Record<ErrorCode, StringKey>> = {
  data_folder_invalid: 'settings.dataFolder.error.invalid',
  data_folder_move_failed: 'settings.dataFolder.error.moveFailed',
};

/** Plain-language message for a failed data-folder move. */
export function dataFolderErrorMessage(err: unknown): string {
  const code = errorCodeOf(err);
  const key = code === null ? undefined : DATA_FOLDER_KEYS[code];
  return t(key ?? 'settings.dataFolder.error.generic');
}

/** Plain-language message for a failed General save (form level). */
export function saveErrorMessage(err: unknown): string {
  return errorCodeOf(err) === 'identity_locked'
    ? t('settings.error.identityLocked')
    : t('settings.error.generic');
}
