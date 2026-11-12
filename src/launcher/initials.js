function initials(name) {
  const words = String(name)
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const [first, second] = words.map((word) => word.toLowerCase());
  let skip = 0;
  if (first === 'uc') skip = 1;
  else if (first === 'undercards') skip = 1;
  else if (first === 'under' && second === 'cards') skip = 2;
  const rest = words.length > skip ? words.slice(skip) : words;
  const letters = rest.slice(0, 2).map((word) => Array.from(word)[0]);
  return letters.join('').toUpperCase() || '?';
}
