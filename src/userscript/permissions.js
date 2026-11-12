const texts = new Map([
  ['GM_getValue', 'Save and read its own data'],
  ['GM_setValue', 'Save and read its own data'],
  ['GM_deleteValue', 'Save and read its own data'],
  ['GM_listValues', 'Save and read its own data'],
  ['GM_xmlhttpRequest', 'Make web requests, only to the sites listed under Can reach'],
  ['GM.xmlHttpRequest', 'Make web requests, only to the sites listed under Can reach'],
  ['GM_getResourceText', 'Read the text files it comes with'],
  ['unsafeWindow', "Use the page's own window"],
]);

export function describePermissions(grants = []) {
  const groups = new Map();
  for (const grant of grants.filter((name) => name !== 'none')) {
    const text = texts.get(grant) ?? `Use ${grant}`;
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(grant);
  }
  return [...groups].map(([text, names]) => ({ text, names }));
}
