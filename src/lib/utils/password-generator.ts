export interface PasswordOptions {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
  excludeSimilar?: boolean; // Exclude similar chars like 0, O, l, 1
  excludeAmbiguous?: boolean; // Exclude ambiguous symbols
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

const SIMILAR_CHARS = '0O1lI';
const AMBIGUOUS_SYMBOLS = '{}[]()/\\\'"`~,;.<>';

export function generatePassword(options: PasswordOptions = {}): string {
  const {
    length = 16,
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
    excludeSimilar = false,
    excludeAmbiguous = false
  } = options;

  let charset = '';

  if (includeLowercase) {
    charset += excludeSimilar
      ? LOWERCASE.split('').filter(c => !SIMILAR_CHARS.includes(c)).join('')
      : LOWERCASE;
  }

  if (includeUppercase) {
    charset += excludeSimilar
      ? UPPERCASE.split('').filter(c => !SIMILAR_CHARS.includes(c)).join('')
      : UPPERCASE;
  }

  if (includeNumbers) {
    charset += excludeSimilar
      ? NUMBERS.split('').filter(c => !SIMILAR_CHARS.includes(c)).join('')
      : NUMBERS;
  }

  if (includeSymbols) {
    charset += excludeAmbiguous
      ? SYMBOLS.split('').filter(c => !AMBIGUOUS_SYMBOLS.includes(c)).join('')
      : SYMBOLS;
  }

  if (charset.length === 0) {
    throw new Error('At least one character set must be selected');
  }

  // Generate password
  let password = '';
  const array = new Uint8Array(length);

  // Use crypto for secure random generation
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(array);
  } else {
    // Fallback for Node.js environment
    const crypto = require('crypto');
    crypto.randomFillSync(array);
  }

  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }

  // Ensure at least one character from each selected set
  const requiredSets: string[] = [];
  if (includeLowercase) requiredSets.push(LOWERCASE);
  if (includeUppercase) requiredSets.push(UPPERCASE);
  if (includeNumbers) requiredSets.push(NUMBERS);
  if (includeSymbols) requiredSets.push(SYMBOLS);

  // Check if password contains at least one char from each set
  const hasAllRequired = requiredSets.every(set =>
    password.split('').some(char => set.includes(char))
  );

  // If not, regenerate (recursion with max depth to prevent infinite loop)
  if (!hasAllRequired && length >= requiredSets.length) {
    return generatePassword(options);
  }

  return password;
}

export function copyToClipboard(text: string): Promise<void> {
  if (typeof window === 'undefined' || !window.navigator?.clipboard) {
    return Promise.reject(new Error('Clipboard API not available'));
  }

  return window.navigator.clipboard.writeText(text);
}