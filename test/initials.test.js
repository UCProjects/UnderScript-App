import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = await file.readFile(new URL('../src/launcher/initials.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.initials = initials;`, context);
const initials = (name) => context.initials(name);

describe('initials', () => {
  it('uses the capitals of a camel case name', () => {
    assert.equal(initials('PrettyCards'), 'PC');
    assert.equal(initials('DeckBuilder'), 'DB');
  });

  it('uses the first letters of the first two words', () => {
    assert.equal(initials('Chat Deck Viewer'), 'CD');
    assert.equal(initials('Hover Info'), 'HI');
    assert.equal(initials('hover info'), 'HI');
    assert.equal(initials('Better-Patchnotes_Plus'), 'BP');
  });

  it('uses one letter for a one word name', () => {
    assert.equal(initials('Wizascript'), 'W');
    assert.equal(initials('wizascript'), 'W');
  });

  it('keeps an all capitals word together', () => {
    assert.equal(initials('HTMLParser'), 'HP');
    assert.equal(initials('XPTools'), 'XT');
  });

  it('ignores a leading UC or Undercards, which only says what the game is', () => {
    assert.equal(initials('UC Player Info'), 'PI');
    assert.equal(initials('uc player info'), 'PI');
    assert.equal(initials('UCTools'), 'T');
    assert.equal(initials('Undercards Helper'), 'H');
    assert.equal(initials('UnderCards Deck Tool'), 'DT');
    assert.equal(initials('Under Cards Deck Tool'), 'DT');
  });

  it('keeps the word when nothing else is left, and keeps UC when it is not first', () => {
    assert.equal(initials('UC'), 'U');
    assert.equal(initials('Undercards'), 'U');
    assert.equal(initials('Under Cards'), 'UC');
    assert.equal(initials('Deck UC'), 'DU');
    assert.equal(initials('Ucky Tools'), 'UT');
    assert.equal(initials('Underdog Cards'), 'UC');
  });

  it('copes with digits, other alphabets and names with no letters', () => {
    assert.equal(initials('2fast Cards'), '2C');
    assert.equal(initials('日本語'), '日');
    assert.equal(initials('école Rouge'), 'ÉR');
    assert.equal(initials(''), '?');
    assert.equal(initials('---'), '?');
    assert.equal(initials(undefined), 'U');
  });
});
