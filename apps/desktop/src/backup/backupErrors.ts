// Backup error presentation (R-UI-007/008, NFR-033): map a mapped
// `UserFacingError` to the plain-language en.json string the S17 screen shows.
// The UI never displays the raw message, a code, SQL or a file path — only one
// of these curated strings plus the error's own `suggestedAction` behind a
// Details expander (00-conventions §4).
import type { ErrorCode, UserFacingError } from '@/bindings';
import { isUserFacingError } from '@/shared/command';
import { t, type StringKey } from '@/shared/strings';

/** The backup error codes S17 distinguishes; everything else is generic. */
const CODE_TO_KEY: Partial<Record<ErrorCode, StringKey>> = {
  wrong_backup_password: 'backup.error.wrongPassword',
  bad_backup: 'backup.error.badBackup',
  backup_too_new: 'backup.error.tooNew',
  backup_destination_unavailable: 'backup.error.destUnavailable',
  backup_out_of_space: 'backup.error.outOfSpace',
};

/** Resolve a thrown value to a plain-language backup message. */
export function backupErrorMessage(err: unknown): string {
  if (isUserFacingError(err)) {
    const key = CODE_TO_KEY[err.code];
    if (key !== undefined) {
      return t(key);
    }
  }
  return t('backup.error.generic');
}

/**
 * The support "Details" line: the error's own suggested action (already
 * patient-data-free, R-PRIV-001) or a safe fallback. Never a stack trace.
 */
export function backupErrorDetails(err: unknown): string {
  if (isUserFacingError(err)) {
    const safe = err as UserFacingError;
    if (safe.suggestedAction.trim() !== '') {
      return safe.suggestedAction;
    }
  }
  return t('backup.error.generic');
}

/** True when the thrown value is specifically a wrong-backup-password error. */
export function isWrongBackupPassword(err: unknown): boolean {
  return isUserFacingError(err) && err.code === 'wrong_backup_password';
}
