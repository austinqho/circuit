// G5 Part A, the annotation half (harness code, repository-agnostic).
//
// 1. "The user annotates": the pointer is placed at the centre of the element
//    the session names; the element under the pointer is climbed to Codex's
//    annotation target and Codex's anchor is rebuilt from it (selector, path,
//    Target, Nearby text; research note §1), exactly the evidence Codex's
//    manual annotation puts in the prompt. Ground truth (the target's own
//    data-tracer-el and outerHTML) is recorded separately for the grader.
// 2. "The agent's browser-tool step" (the skill, step 2): a second, separate
//    page evaluation that receives ONLY the prompt fields and runs
//    resolveAnnotatedKey from the package's mcp/annotation-lookup.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEMO_QUESTION = 'why did this fail?';

export async function annotateElement({ page, locator, out, packageDir, comment = DEMO_QUESTION, log = () => {} }) {
  const { annotationLookupSource } = await import(pathToFileURL(path.join(packageDir, 'mcp', 'annotation-lookup.mjs')).href);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('annotated element is not visible');
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await page.mouse.move(point.x, point.y);
  await page.screenshot({ path: path.join(out, 'annotate-page.png') });
  await locator.screenshot({ path: path.join(out, 'annotate-element.png') }).catch(() => {});

  // 1. What Codex's manual annotation derives from the click point.
  const anchor = await page.evaluate(({ source, point }) => {
    const tools = (0, eval)(source);
    const under = document.elementFromPoint(point.x, point.y);
    const built = tools.codexAnchorOf(under);
    const target = built.element;
    delete built.element;
    return { anchor: built, page_url: location.href, under_pointer: { tag: under.tagName.toLowerCase(), outer_html_head: under.outerHTML.slice(0, 200) },
      ground_truth: { data_tracer_el: target.getAttribute('data-tracer-el'), closest_data_tracer_el: target.closest('[data-tracer-el]')?.getAttribute('data-tracer-el') ?? null,
        oai_annotatable: target.getAttribute('oai-annotatable'), oai_annotation_metadata: target.getAttribute('oai-annotation-metadata'),
        outer_html: target.outerHTML, stamped_outer_html: target.closest('[data-tracer-el]')?.outerHTML ?? null,
        has_document_oai: typeof document.oai?.annotation?.request === 'function' } };
  }, { source: annotationLookupSource, point });
  const { formatCodexPrompt } = await import(pathToFileURL(path.join(packageDir, 'mcp', 'annotation-lookup.mjs')).href);
  const prompt = formatCodexPrompt(anchor.anchor, anchor.page_url, comment);
  fs.writeFileSync(path.join(out, 'annotation-prompt.txt'), `${prompt}\n`);
  fs.writeFileSync(path.join(out, 'annotated-element.html'), [
    '<!-- G5: the element Codex\'s manual annotation picks (gate off) under the pointer: -->', anchor.ground_truth.outer_html,
    '<!-- its nearest element carrying data-tracer-el (what the skill\'s closest() step reads): -->', anchor.ground_truth.stamped_outer_html ?? '<!-- none -->', ''].join('\n'));

  // 2. The skill's browser-tool step, from the prompt fields only.
  const evidence = { selector: anchor.anchor.selector, target: anchor.anchor.target, nearby_text: anchor.anchor.nearby_text };
  const lookup = await page.evaluate(({ source, evidence }) => {
    const tools = (0, eval)(source);
    const result = tools.resolveAnnotatedKey(document, evidence);
    let querySelectorAll = null;
    if (!evidence.selector.includes('>>>')) { try { querySelectorAll = document.querySelectorAll(evidence.selector).length; } catch (error) { querySelectorAll = `error: ${error.message}`; } }
    return { ...result, query_selector_all_matches: querySelectorAll };
  }, { source: annotationLookupSource, evidence });
  const record = { schema: 'producttrace.g5-annotation.v1', question: comment, pointer: point, ...anchor, prompt_fields: evidence, lookup };
  fs.writeFileSync(path.join(out, 'annotation-anchor.json'), JSON.stringify(record, null, 2));
  log('annotation', JSON.stringify({ selector: evidence.selector, lookup: lookup.status, key: lookup.element_key, truth: anchor.ground_truth.data_tracer_el }));
  return record;
}
