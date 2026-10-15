// G5: the selector-to-stamp lookup the skill asks an agent to run in the live
// page (mcp/annotation-lookup.mjs). A small in-memory DOM stands in for the
// browser; the same code runs in the page in test/browser/g5-rehearsal.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationLookupSource, codexAnchorOf, codexSelectorOf, elementPathOf, lookupSnippet, matchCodexSelector,
  parseCodexSelector, resolveAnnotatedKey,
} from '../mcp/annotation-lookup.mjs';

class Node {
  constructor(tag, props = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.attributes = { ...(props.attrs || {}) };
    if (props.id) this.attributes.id = props.id;
    if (props.class) this.attributes.class = props.class;
    this.ownText = props.text || ''; this.children = []; this.parentElement = null; this.parentNode = null; this.shadowRoot = null;
    for (const child of children) this.append(child);
  }
  get id() { return this.attributes.id || ''; }
  get className() { return this.attributes.class || ''; }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  get textContent() { return [this.ownText, ...this.children.map(child => child.textContent)].filter(Boolean).join(' '); }
  append(child) { child.parentElement = this; child.parentNode = this; this.children.push(child); return child; }
  attachShadow(children) {
    const root = { host: this, children: [] };
    for (const child of children) { child.parentElement = null; child.parentNode = root; root.children.push(child); }
    this.shadowRoot = root; return root;
  }
}
const h = (tag, props, ...children) => new Node(tag, props, children);

// A page shaped like anything-llm's settings form: a stamped submit button
// whose text sits in an inner div, two same-class buttons elsewhere, a wrapper
// whose stamp is on a descendant, and a web component with a shadow root.
function page() {
  const updateButton = h('button', { class: 'border-none text-xs px-4 light:text-[#fff]', attrs: { 'data-tracer-el': 'p_aaaaaaaaaaaa:10-50#n1' } },
    h('div', { class: 'flex items-center', text: 'Update Workspace' }));
  const cancel = h('button', { class: 'border-none text-xs', attrs: { 'data-tracer-el': 'p_aaaaaaaaaaaa:10-50#n2' } }, h('div', { class: 'flex items-center', text: 'Cancel' }));
  const save = h('button', { class: 'border-none text-xs', attrs: { 'data-tracer-el': 'p_aaaaaaaaaaaa:10-50#n3' } }, h('div', { class: 'flex items-center', text: 'Save' }));
  const idButton = h('button', { id: 'delete-ws', class: 'danger', attrs: { 'data-tracer-el': 'p_bbbbbbbbbbbb:60-90#n1' }, text: 'Delete Workspace' });
  const unstampedWrapper = h('div', { class: 'card' }, h('span', { text: 'Suggested' }), h('a', { attrs: { href: '#', 'data-tracer-el': 'p_cccccccccccc:5-9#n1' }, text: 'Add message' }));
  const shadowButton = h('button', { class: 'inner', attrs: { 'data-tracer-el': 'p_dddddddddddd:1-4#n1' }, text: 'Shadow action' });
  const host = h('my-widget', { class: 'widget' });
  host.attachShadow([h('div', { class: 'shell' }, shadowButton)]);
  const form = h('form', { class: 'w-1/2 flex flex-col' }, h('div', { class: 'absolute top-0 right-0' }, updateButton), h('input', { attrs: { name: 'name' } }));
  const body = h('body', {}, h('div', { id: 'root' }, h('main', { class: 'settings' }, form, h('div', { class: 'row' }, cancel, save), idButton, unstampedWrapper, host)));
  const html = h('html', {}, body);
  return { document: { children: [html] }, updateButton, cancel, save, idButton, unstampedWrapper, shadowButton, host };
}

test('Codex selector builder: ≤4 levels, tag, #id stop, two regex-passing classes, :nth-of-type', () => {
  const dom = page();
  assert.equal(codexSelectorOf(dom.updateButton),
    'main.settings:nth-of-type(1) > form.flex.flex-col:nth-of-type(1) > div.absolute.top-0:nth-of-type(1) > button.border-none.text-xs:nth-of-type(1)');
  assert.equal(codexSelectorOf(dom.idButton), 'button#delete-ws.danger:nth-of-type(1)');
  assert.equal(elementPathOf(dom.updateButton), 'main > form > div > button');
  assert.equal(codexSelectorOf(dom.shadowButton), 'main.settings:nth-of-type(1) > my-widget.widget:nth-of-type(1) >>> div.shell:nth-of-type(1) > button.inner:nth-of-type(1)');
  const anchor = codexAnchorOf(dom.updateButton.children[0]); // pointer on the inner div climbs to the button
  assert.equal(anchor.picked, 'button');
  assert.equal(anchor.target, 'Update Workspace');
  assert.equal(anchor.nearby_text, 'Update Workspace');
  assert.deepEqual(parseCodexSelector('a > b >>> c').map(step => step.combinator), ['>', '>>>', null]);
  assert.equal(parseCodexSelector('div[onclick=x]'), null, 'attribute selectors are outside the Codex grammar');
});

test('shape (a): a #id step resolves the stamped element itself', () => {
  const dom = page();
  const result = resolveAnnotatedKey(dom.document, { selector: 'main.settings:nth-of-type(1) > button#delete-ws.danger:nth-of-type(1)', target: 'Delete Workspace' });
  assert.equal(result.status, 'ok'); assert.equal(result.element_key, 'p_bbbbbbbbbbbb:60-90#n1'); assert.equal(result.via, 'self');
});

test('shape (b): tag + two classes + :nth-of-type, stamp on the element', () => {
  const dom = page();
  const selector = codexSelectorOf(dom.updateButton);
  const result = resolveAnnotatedKey(dom.document, { selector, target: 'Update Workspace', nearby_text: 'Update Workspace' });
  assert.equal(result.status, 'ok'); assert.equal(result.element_key, 'p_aaaaaaaaaaaa:10-50#n1'); assert.equal(result.matches, 1);
});

test('shape (c): 4-level chain to an inner node: closest() climbs to the stamped ancestor', () => {
  const dom = page();
  const inner = dom.updateButton.children[0];
  const selector = codexSelectorOf(inner);
  assert.equal(selector.split(' > ').length, 4);
  const result = resolveAnnotatedKey(dom.document, { selector, target: 'Update Workspace' });
  assert.equal(result.status, 'ok'); assert.equal(result.element_key, 'p_aaaaaaaaaaaa:10-50#n1'); assert.equal(result.via, 'ancestor');
});

test('shape (d): a non-unique selector is disambiguated by Target text, and abstains when text cannot decide', () => {
  const dom = page();
  const selector = 'div.row:nth-of-type(1) > button.border-none.text-xs';
  assert.equal(matchCodexSelector(dom.document, selector).length, 2);
  const save = resolveAnnotatedKey(dom.document, { selector, target: 'Save' });
  assert.equal(save.status, 'ok'); assert.equal(save.element_key, 'p_aaaaaaaaaaaa:10-50#n3'); assert.equal(save.matches, 2);
  const none = resolveAnnotatedKey(dom.document, { selector });
  assert.equal(none.status, 'ambiguous'); assert.equal(none.element_key, null);
  assert.deepEqual(none.candidates.map(candidate => candidate.element_key), ['p_aaaaaaaaaaaa:10-50#n2', 'p_aaaaaaaaaaaa:10-50#n3']);
});

test('descendant fallback, shadow joins, and abstentions', () => {
  const dom = page();
  const wrapper = resolveAnnotatedKey(dom.document, { selector: codexSelectorOf(dom.unstampedWrapper), nearby_text: 'Suggested Add message' });
  assert.equal(wrapper.status, 'ok'); assert.equal(wrapper.via, 'descendant'); assert.equal(wrapper.element_key, 'p_cccccccccccc:5-9#n1');
  // A container with several stamped descendants: ambiguous with every key, never the first.
  const row = resolveAnnotatedKey(dom.document, { selector: 'main.settings:nth-of-type(1) > div.row:nth-of-type(1)' });
  assert.equal(row.status, 'ambiguous'); assert.equal(row.reason, 'several_stamped_descendants'); assert.equal(row.element_key, null);
  assert.deepEqual(row.candidate_keys, ['p_aaaaaaaaaaaa:10-50#n2', 'p_aaaaaaaaaaaa:10-50#n3']);
  const shadow = resolveAnnotatedKey(dom.document, { selector: codexSelectorOf(dom.shadowButton), target: 'Shadow action' });
  assert.equal(shadow.status, 'ok'); assert.equal(shadow.element_key, 'p_dddddddddddd:1-4#n1');
  assert.equal(resolveAnnotatedKey(dom.document, { selector: 'section.none > button' }).status, 'no_match');
  assert.equal(resolveAnnotatedKey(dom.document, { selector: codexSelectorOf(dom.updateButton), target: 'Something else' }).status, 'text_mismatch');
  assert.equal(resolveAnnotatedKey(dom.document, { selector: 'input:nth-of-type(1)' }).status, 'no_key');
});

test('the page-evaluable source and the agent snippet build the same tools', () => {
  const tools = new Function(`return ${annotationLookupSource}`)();
  const dom = page();
  assert.equal(tools.resolveAnnotatedKey(dom.document, { selector: codexSelectorOf(dom.updateButton), target: 'Update Workspace' }).element_key, 'p_aaaaaaaaaaaa:10-50#n1');
  const snippet = lookupSnippet({ selector: 'button#x', target: 'X' });
  assert.match(snippet, /\.resolveAnnotatedKey\(document, \{"selector":"button#x","target":"X","nearby_text":null\}\)$/u);
  const document = dom.document;
  assert.equal(new Function('document', `return ${lookupSnippet({ selector: 'button#delete-ws', target: 'Delete Workspace' })}`)(document).element_key, 'p_bbbbbbbbbbbb:60-90#n1');
});
