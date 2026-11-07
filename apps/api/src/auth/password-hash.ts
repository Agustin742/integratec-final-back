import * as bcrypt from 'bcrypt';

/** bcrypt cost shared by registration, password reset and the login timing-equalizer hash. */
export const BCRYPT_SALT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}
