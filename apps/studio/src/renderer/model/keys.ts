/** Names as code can use them: snake_case keys and PascalCase types, from any text. */

const words = (text: string): string[] =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

export const toKey = (text: string): string => {
  const key = words(text).join('_').toLowerCase();
  return /^[0-9]/.test(key) ? `n_${key}` : key || 'unnamed';
};

export const toType = (text: string): string => {
  const type = words(text)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
  return /^[0-9]/.test(type) ? `N${type}` : type || 'Unnamed';
};
