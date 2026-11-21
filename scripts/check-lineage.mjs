// Run against an independently checked-out, unmodified Lineage source tree.
// LINEAGE_SOURCE=/tmp/eome-lineage-reference node scripts/check-lineage.mjs
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const reference = process.env.LINEAGE_SOURCE;
if (!reference) throw new Error('Set LINEAGE_SOURCE to the unmodified Lineage checkout.');
const temporary = await mkdtemp(join(tmpdir(), 'eome-lineage-check-'));
const output = join(temporary, 'checks.mjs');
const source = `
import assert from 'node:assert/strict';
import { extractFrontmatter } from '${reference}/src/view/helpers/extract-frontmatter';
import { stringifyDocument } from '${reference}/src/view/helpers/stringify-document';
import { outlineToJson } from '${reference}/src/lib/data-conversion/x-to-json/outline-to-json';
import { jsonToOutline } from '${reference}/src/lib/data-conversion/json-to-x/json-to-outline';
import { columnsToJson } from '${reference}/src/lib/data-conversion/x-to-json/columns-to-json';
import { jsonToColumns } from '${reference}/src/lib/data-conversion/json-to-x/json-to-columns';
import { changeNodePosition } from '${reference}/src/lib/tree-utils/move/change-node-position';
import { cleanAndSortColumns } from '${reference}/src/lib/tree-utils/sort/clean-and-sort-columns';
import { parseOutline } from '${resolve('src/utils/outline.ts')}';
import { serializeOutline } from '${resolve('src/domain/outline-format.ts')}';
import { document, thought, semantic } from '${resolve('tests/multiline-fixtures.ts')}';
const common = [thought('Paragraph one\\n\\nParagraph two\\n- internal\\n  * nested\\n+ plus\\n1. numbered\\n> quote\\n# Heading\\n~~~ts\\n\\t- code\\n~~~\\nUnicode 日本語 🧠 [[Link]] ![[Embed]]', [thought('Child\\n\\nBody', [thought('Grandchild')])], 'unchecked'), thought('Target', [thought('Existing')], 'checked')];
const results = [];
const body = nodes => serializeOutline(nodes);
const eome = text => parseOutline('---\\neome-outline-format: 2\\n---\\n' + text);
function check(name, action) { action(); results.push({ name, result: 'passed' }); }
check('EOME → original Lineage parser → columns → writer → EOME', () => {
  const columns = jsonToColumns(outlineToJson(body(common)));
  const result = eome(jsonToOutline(columnsToJson(columns.columns, columns.content)));
  assert.deepEqual(semantic(result), semantic(common));
});
check('Lineage → EOME → original Lineage parser and writer', () => {
  const original = outlineToJson(body(common));
  const roundtrip = outlineToJson(body(eome(jsonToOutline(original))));
  assert.deepEqual(roundtrip, original);
});
check('Complete versioned EOME file → original Lineage frontmatter/columns/stringify → EOME', () => {
  const input = document(common);
  const { body: markdown, frontmatter } = extractFrontmatter(input);
  const columns = jsonToColumns(outlineToJson(markdown));
  const written = frontmatter + stringifyDocument(columns, 'outline');
  assert.deepEqual(semantic(parseOutline(written)), semantic(common));
  assert.equal(written.slice(0, frontmatter.length), input.slice(0, frontmatter.length));
});
check('Complete Lineage file → EOME → original Lineage frontmatter/parser/columns writer', () => {
  const input = document(common);
  const eomeWritten = document(parseOutline(input));
  const split = extractFrontmatter(eomeWritten);
  const columns = jsonToColumns(outlineToJson(split.body));
  const result = split.frontmatter + stringifyDocument(columns, 'outline');
  assert.deepEqual(semantic(parseOutline(result)), semantic(common));
});
check('Original Lineage subtree move preserves content and descendants', () => {
  const columns = jsonToColumns(outlineToJson(body(common)));
  const source = columns.columns[0].groups[0].nodes[0];
  const target = columns.columns[0].groups[0].nodes[1];
  changeNodePosition(columns, source, target, 'right', 'drop', false);
  cleanAndSortColumns(columns);
  const after = eome(jsonToOutline(columnsToJson(columns.columns, columns.content)));
  const expected = structuredClone(common);
  const moved = expected.shift(); expected[0].children.push(moved);
  assert.deepEqual(semantic(after), semantic(expected));
});
check('Lineage leading blank loss reproduced', () => {
  const original = [thought('\\n\\nLeading blank content')];
  const after = eome(jsonToOutline(outlineToJson(body(original))));
  assert.notDeepEqual(semantic(after), semantic(original));
});
check('Lineage section-comment rejection inside code reproduced', () => {
  assert.throws(() => outlineToJson(body([thought('Code\\n~~~\\n<!--section: 1-->\\n~~~')])));
});
check('Lineage writer trim of boundary whitespace reproduced', () => {
  const original = [thought('  Leading\\nTrailing  \\n')];
  const columns = jsonToColumns(outlineToJson(body(original)));
  const after = eome(jsonToOutline(columnsToJson(columns.columns, columns.content)));
  assert.notDeepEqual(semantic(after), semantic(original));
});
check('Replacing structural tabs with spaces changes Lineage hierarchy', () => {
  const original = body(common);
  assert.notDeepEqual(outlineToJson(original.replace(/\\t/g, '    ')), outlineToJson(original));
});
check('EOME literal-task escape is visible to unmodified Lineage', () => {
  assert.equal(outlineToJson(body([thought('[x] literal')]))[0].content, '\\\\[x] literal');
});
export default results;
`;
await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output,
  nodePaths: [resolve('node_modules'), '/tmp/eome-lineage-deps/node_modules'],
  plugins: [{ name: 'reference-aliases', setup(builder) {
    builder.onResolve({ filter: /^src\// }, args => ({ path: resolve(reference, args.path + '.ts') }));
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/obsidian-mock.ts') }));
  } }],
});
const results = (await import(pathToFileURL(output).href)).default;
const version = JSON.parse(await readFile(resolve(reference, 'manifest.json'), 'utf8')).version;
const commit = execFileSync('git', ['-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(JSON.stringify({ version, commit, results }, null, 2));
