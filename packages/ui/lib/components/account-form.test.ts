import {
  accountErrorMessage,
  accountRequest,
  INVITE_CODE_REJECTED,
  validateAccountInput,
} from './account-form';
import { describe, expect, it } from 'vitest';
import type { TFunction } from '@extension/i18n';

const t: TFunction = key => key;

const valid = { email: ' user@example.com ', password: 'password-1', inviteCode: '  AbC-12 x9\t' };

describe('validateAccountInput', () => {
  it('requires an invitation code for registration and points at its field', () => {
    for (const inviteCode of ['', '   \t']) {
      expect(validateAccountInput('register', { ...valid, inviteCode }, t)).toEqual({
        field: 'inviteCode',
        message: 'account_inviteCodeRequired',
      });
    }
  });

  it('does not ask for an invitation code on sign-in', () => {
    expect(validateAccountInput('login', { ...valid, inviteCode: '' }, t)).toBeUndefined();
  });

  it('reports email and password problems before the invitation code', () => {
    expect(validateAccountInput('register', { ...valid, email: 'bad', inviteCode: '' }, t)).toEqual(
      { field: 'form', message: 'account_emailInvalid' },
    );
    expect(
      validateAccountInput('register', { ...valid, password: 'short', inviteCode: '' }, t),
    ).toEqual({ field: 'form', message: 'account_passwordTooShort' });
  });

  it('accepts a complete registration', () => {
    expect(validateAccountInput('register', valid, t)).toBeUndefined();
  });
});

describe('accountRequest', () => {
  it('trims only the ends of the invitation code and keeps its case', () => {
    expect(accountRequest('register', valid)).toEqual({
      type: 'ASK_REGISTER',
      email: 'user@example.com',
      password: 'password-1',
      inviteCode: 'AbC-12 x9',
    });
  });

  it('sends sign-in without an invitation code', () => {
    expect(accountRequest('login', valid)).toEqual({
      type: 'ASK_LOGIN',
      email: 'user@example.com',
      password: 'password-1',
    });
  });
});

describe('accountErrorMessage', () => {
  it('explains a rejected invitation code', () => {
    expect(accountErrorMessage({ status: 400, error: INVITE_CODE_REJECTED }, t)).toBe(
      'account_inviteCodeRejected',
    );
  });

  it('keeps other 400 errors as the server reported them', () => {
    expect(accountErrorMessage({ status: 400, error: 'Invalid email address' }, t)).toBe(
      'Invalid email address',
    );
    expect(accountErrorMessage({ status: 400, error: 'Password is too short' }, t)).toBe(
      'Password is too short',
    );
  });

  it('keeps the existing messages for other statuses', () => {
    expect(accountErrorMessage({ status: 409, error: 'Email already registered' }, t)).toBe(
      'account_emailTaken',
    );
    expect(accountErrorMessage({ status: 0, error: 'Cannot reach' }, t)).toBe(
      'account_serverUnreachable',
    );
    expect(accountErrorMessage({ status: 401, error: 'Nope' }, t)).toBe(
      'account_invalidCredentials',
    );
    expect(accountErrorMessage({ error: INVITE_CODE_REJECTED, status: 500 }, t)).toBe(
      INVITE_CODE_REJECTED,
    );
  });
});
