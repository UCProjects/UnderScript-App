import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { matchesUrl } from '../src/userscript/match.js';
import { parseMeta } from '../src/userscript/meta.js';

const yes = (rules, url) => assert.equal(matchesUrl(rules, url), true, `expected ${url} to match`);
const no = (rules, url) => assert.equal(matchesUrl(rules, url), false, `expected ${url} not to match`);

describe('matchesUrl', () => {
  describe('@match', () => {
    it('matches nothing without any patterns', () => {
      no({}, 'https://example.com/');
      no({ matches: [], includes: [] }, 'https://example.com/');
    });

    it('handles the scheme', () => {
      const rules = { matches: ['*://example.com/*'] };
      yes(rules, 'http://example.com/a');
      yes(rules, 'https://example.com/a');
      no(rules, 'ftp://example.com/a');
      no(rules, 'file://example.com/a');
      const https = { matches: ['https://example.com/*'] };
      yes(https, 'https://example.com/a');
      no(https, 'http://example.com/a');
    });

    it('handles host wildcards', () => {
      const sub = { matches: ['https://*.example.com/*'] };
      yes(sub, 'https://example.com/');
      yes(sub, 'https://www.example.com/');
      yes(sub, 'https://a.b.example.com/x');
      no(sub, 'https://badexample.com/');
      no(sub, 'https://example.com.evil.com/');
      no(sub, 'https://evil.com/example.com/');
      yes({ matches: ['https://*/*'] }, 'https://anything.example/x');
    });

    it('compares hosts without case and ignores the port', () => {
      const rules = { matches: ['https://Example.com/*'] };
      yes(rules, 'https://example.COM/a');
      yes(rules, 'https://example.com:8443/a');
      no(rules, 'https://other.com/a');
    });

    it('matches the path and query as a glob', () => {
      yes({ matches: ['https://example.com/*'] }, 'https://example.com/');
      yes({ matches: ['https://example.com/*'] }, 'https://example.com/a/b?c=d');
      yes({ matches: ['https://example.com/foo'] }, 'https://example.com/foo');
      no({ matches: ['https://example.com/foo'] }, 'https://example.com/foo/');
      no({ matches: ['https://example.com/foo'] }, 'https://example.com/foobar');
      yes({ matches: ['https://example.com/foo*'] }, 'https://example.com/foobar');
      yes({ matches: ['https://example.com/a?b=*'] }, 'https://example.com/a?b=1&c=2');
      no({ matches: ['https://example.com/a?b=*'] }, 'https://example.com/a');
      yes({ matches: ['https://example.com/a'] }, 'https://example.com/a#section');
    });

    it('does not treat pattern text as a regular expression', () => {
      const rules = { matches: ['https://example.com/a.b+c'] };
      yes(rules, 'https://example.com/a.b+c');
      no(rules, 'https://example.com/aXb+c');
      no(rules, 'https://example.com/a.bbc');
    });

    it('supports <all_urls> for web and file pages only', () => {
      const rules = { matches: ['<all_urls>'] };
      yes(rules, 'https://example.com/');
      yes(rules, 'http://example.com/');
      yes(rules, 'file:///C:/a.html');
      no(rules, 'chrome://settings/');
      no(rules, 'data:text/plain,hi');
    });

    it('ignores malformed patterns and invalid urls', () => {
      no({ matches: ['example.com/*', 'https:/example.com/*', 'https://example.com'] }, 'https://example.com/a');
      no({ matches: ['https://example.com/*'] }, 'not a url');
    });
  });

  describe('@include', () => {
    it('matches globs against the whole url without case', () => {
      const rules = { includes: ['https://example.com/*'] };
      yes(rules, 'https://EXAMPLE.com/Anything');
      no(rules, 'http://example.com/a');
      yes({ includes: ['*'] }, 'https://anywhere.test/x');
    });

    it('supports regular expressions', () => {
      const rules = { includes: ['/^https:\\/\\/example\\.com\\/a\\d+$/'] };
      yes(rules, 'https://example.com/a12');
      no(rules, 'https://example.com/ab');
      yes({ includes: ['/EXAMPLE/i'] }, 'https://example.com/');
      no({ includes: ['/EXAMPLE/'] }, 'https://example.com/');
    });

    it('treats an invalid regular expression as a non-match', () => {
      no({ includes: ['/(/'] }, 'https://example.com/');
    });
  });

  describe('exclusions', () => {
    it('removes urls matched by @exclude', () => {
      const rules = { matches: ['https://example.com/*'], excludes: ['https://example.com/private/*'] };
      yes(rules, 'https://example.com/public/a');
      no(rules, 'https://example.com/private/a');
    });

    it('removes urls matched by @exclude-match', () => {
      const rules = { matches: ['https://*.example.com/*'], excludeMatches: ['https://admin.example.com/*'] };
      yes(rules, 'https://www.example.com/a');
      no(rules, 'https://admin.example.com/a');
    });

    it('applies exclusions to @include too', () => {
      no({ includes: ['*'], excludes: ['*secret*'] }, 'https://example.com/secret');
    });

    it('needs an inclusion first', () => {
      no({ excludes: ['https://other.com/*'] }, 'https://example.com/');
    });
  });

  describe('the real UnderScript meta', () => {
    const meta = parseMeta(readFileSync(new URL('./fixtures/underscript.meta.js', import.meta.url), 'utf8'));

    it('runs on undercards.net pages', () => {
      for (const url of [
        'https://undercards.net/',
        'https://undercards.net/SignIn',
        'https://undercards.net/Game?gameId=1',
        'https://www.undercards.net/Decks',
        'https://feildmaster.github.io/UnderScript/docs/',
      ]) yes(meta, url);
    });

    it('does not run elsewhere', () => {
      for (const url of [
        'http://undercards.net/',
        'https://example.com/',
        'https://undercards.net.evil.com/',
        'https://evil.com/undercards.net/',
        'https://github.com/UCProjects/UnderScript',
      ]) no(meta, url);
    });

    it('applies the two-segment exclude only where its glob matches', () => {
      no(meta, 'https://www.undercards.net/a/b');
      yes(meta, 'https://undercards.net/a/b');
    });
  });
});
