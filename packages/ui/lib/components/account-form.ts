import type { TFunction } from '@extension/i18n';

type AccountMode = 'login' | 'register';

type AccountInput = { email: string; password: string; inviteCode: string };

type AccountResponse = { email?: string; models?: number; error?: string; status?: number };

type AccountInputProblem = { field: 'form' | 'inviteCode'; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/** The server uses this one message for missing, unknown, and already used codes. */
const INVITE_CODE_REJECTED = 'Invitation code is required, invalid, or already used';

const validateAccountInput = (
  mode: AccountMode,
  input: AccountInput,
  t: TFunction,
): AccountInputProblem | undefined => {
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    return { field: 'form', message: t('account_emailInvalid') };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { field: 'form', message: t('account_passwordTooShort') };
  }
  if (mode === 'register' && !input.inviteCode.trim()) {
    return { field: 'inviteCode', message: t('account_inviteCodeRequired') };
  }
  return undefined;
};

const accountRequest = (mode: AccountMode, input: AccountInput) =>
  mode === 'login'
    ? { type: 'ASK_LOGIN', email: input.email.trim(), password: input.password }
    : {
        type: 'ASK_REGISTER',
        email: input.email.trim(),
        password: input.password,
        inviteCode: input.inviteCode.trim(),
      };

const accountErrorMessage = (response: AccountResponse, t: TFunction): string => {
  // Email and password validation also answer 400, so only this exact message means the code.
  if (response.status === 400 && response.error === INVITE_CODE_REJECTED) {
    return t('account_inviteCodeRejected');
  }
  switch (response.status) {
    case 0:
      return t('account_serverUnreachable');
    case 401:
      return t('account_invalidCredentials');
    case 409:
      return t('account_emailTaken');
    default:
      return response.error ?? t('account_signInFailed');
  }
};

export { accountErrorMessage, accountRequest, INVITE_CODE_REJECTED, validateAccountInput };
export type { AccountMode, AccountResponse };
