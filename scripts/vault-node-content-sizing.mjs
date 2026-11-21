// Live layout regression: Markdown must fit its preview without changing source.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const cli = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
function run(command, args = []) {
  const out = execFileSync(cli, ['vault=Testprogramm 2', command, ...args], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 2_000_000,
  });
  if (/^Error:/m.test(out)) throw Error(out);
  return out;
}
run('dev:cdp', ['method=Emulation.setFocusEmulationEnabled', 'params={"enabled":true}']);
try {
  const output = run('eval', ['code=' + String.raw`(async () => {
    if (app.workspace.getLeavesOfType('mindmap-view').some(l => l.view.wrapper?.querySelector('.editing'))) throw Error('An editor is active');
    const plugin = app.plugins.plugins['excerpt-outline-mindmap-editor'];
    const originalPath = app.workspace.getActiveFile()?.path || window.__eomeListOriginalPath;
    const originalFile = app.vault.getAbstractFileByPath(originalPath);
    const originalSource = originalFile && await app.vault.read(originalFile);
    const folder = 'EOME content sizing ' + new Date().toISOString().replace(/[:.]/g, '-');
    await app.vault.createFolder(folder);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async f => { for (let i = 0; i < 750; i++) { if (await f()) return; await wait(20); } throw Error('Timed out'); };
    const frames = async () => { await new Promise(r => requestAnimationFrame(r)); await new Promise(r => requestAnimationFrame(r)); };
    const encode = text => text.split('\n').map((line, i) => (i ? '  ' : '- ') + line).join('\n');
    const cases = [
      ['reported lazy continuation', '- asdf\n- asdf\n- dsf\n- dsf\n- asd\n- fsda\n- fasd\nasdfasdfasdd sadf asdf dsa f sdaf sda '],
      ['reported nested list', 'asdasdsa\n- asdf\n- asdf\n- sadfas\n\t- asdfsd\n\t\t- sydfsad'],
      ['paragraph after bullet list', '- first\n- second\n- third\n\nParagraph after the list. LAST PARAGRAPH'],
      ['numbered list', '1. first\n2. second\n3. third\n\nParagraph after numbered list. LAST PARAGRAPH'],
      ['nested numbered and bullet lists', 'Before\n\n1. one\n   - nested bullet\n     - deeper\n2. two\n\nAfter. LAST PARAGRAPH'],
      ['loose list', '- first paragraph\n\n  More in the first item.\n\n- second paragraph\n\nAfter. LAST PARAGRAPH'],
      ['tasks', '- [x] complete\n- [ ] incomplete\n\nAfter tasks. LAST PARAGRAPH'],
      ['wrapped continuation', '- item\n- item\n' + 'A long continuation with 日本語 and umlauts äöü. '.repeat(15) + 'END'],
      ['inline code and emphasis', '- **bold** and *italic*\n- inline CODEcodeCODE\n\nText and CODEcodeCODE after list. END'.replaceAll('CODE', String.fromCharCode(96))],
      ['fenced code after list', '- list item\n- list item\n\n~~~js\nconst value = 1;\nconsole.log(value);\n~~~\n\nAfter code. END'],
      ['quote after list', '- first\n- second\n\n> A quote after the list\n> with a second line\n\nAfter quote. END'],
      ['headings and table', '- item\n\n## Heading\n\n| A | B |\n| --- | --- |\n| one | two |\n\nAfter table. END'],
      ['long single node', '- beginning\n- second\n\n' + 'Long paragraph with Unicode 日本語 äöü. '.repeat(1700) + 'END OF LONG NODE'],
      ['empty', ''],
    ];
    const source = '---\neome-outline-format: 2\n---\n' + cases.map(([, text]) => encode(text)).join('\n');
    const path = folder + '/Lists.md';
    const file = await app.vault.create(path, source);
    const checks = [], samples = [];
    const check = (name, passed, details) => { checks.push({ name, passed, details }); if (!passed) throw Error(name + ': ' + JSON.stringify(details)); };
    let v;
    const open = async (f, expected) => {
      await plugin.openMindmapReplacingLeaf(f);
      await until(() => {
        v = app.workspace.getLeavesOfType('mindmap-view').find(l => l.view.file?.path === f.path && l.view.wrapper && l.view.cy)?.view;
        return v?.getFlatNodes().length === expected && v.wrapper.querySelectorAll('[data-overlay][data-node-line]').length === expected;
      });
      app.workspace.setActiveLeaf(v.leaf, { focus: true });
      await frames();
    };
    const inspect = async (width, zoom) => {
      v.cy.zoom(zoom); await frames();
      for (const [i, node] of v.getFlatNodes().entries()) {
        const box = [...v.wrapper.querySelectorAll('[data-overlay][data-node-line]')].find(b => Number(b.dataset.nodeLine) === node.line);
        const content = box.querySelector('.mindmap-node-content');
        // Offscreen content-visibility is an optimization; force layout only in this test.
        content.style.contentVisibility = 'visible';
        const sample = { name: cases[i][0], width, zoom, measured: v.sizeMap.get(node.line).h, client: content.clientHeight, scroll: content.scrollHeight, lineHeight: getComputedStyle(content).lineHeight };
        samples.push(sample);
        check('Full preview fits: ' + cases[i][0] + ' width=' + width + ' zoom=' + zoom, sample.scroll <= sample.client + 1, sample);
        check('Complete node source: ' + cases[i][0], node.text === cases[i][1], { characters: node.text.length });
        content.style.removeProperty('content-visibility');
      }
    };
    try {
      await open(file, cases.length);
      for (const width of [300, 220, 420]) {
        v.nodeOptions = { ...v.getNodeOptions(), nodeWidth: width };
        await v.refreshRenderedAttachments(); await frames();
        for (const zoom of [1, 0.65, 1.5, 2]) await inspect(width, zoom);
      }
      check('Read-only layout preserves the exact file', await app.vault.read(file) === source);
      v.nodeOptions = { ...v.getNodeOptions(), nodeWidth: 300 };
      await v.refreshRenderedAttachments(); await frames();
      const first = v.getFlatNodes()[0];
      await v.enterEditModeForNodeByLine(first.line);
      const editor = () => v.wrapper.querySelector('.node-editor .cm-content')?.cmTile.view;
      await until(() => !!editor());
      const text = cases[0][1] + '\n\nAdded paragraph after the list. END OF EDIT';
      editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text } });
      editor().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, bubbles: true, cancelable: true }));
      await until(() => !editor() && v.getFlatNodes()[0].text === text);
      await frames();
      cases[0][1] = text;
      await inspect(300, 1);
      check('Save preserves all other nodes', v.getFlatNodes().slice(1).every((n, i) => n.text === cases[i + 1][1]));
      const saved = await app.vault.read(file);
      await v.executeUndo(); await frames();
      check('Undo restores the exact source including list whitespace', await app.vault.read(file) === source);
      await v.executeRedo(); await frames();
      check('Redo restores the complete saved edit', await app.vault.read(file) === saved && v.getFlatNodes()[0].text === text);
      check('No temporary measurement elements remain', !v.wrapper.querySelector('.mindmap-measurement-container'));
      const largeText = 'Paragraph with Unicode 日本語 and nested list content. '.repeat(30);
      const largeSource = '---\neome-outline-format: 2\n---\n' + Array.from({ length: 130 }, (_, i) => {
        const indent = '\t'.repeat(i % 5);
        return ('Node ' + i + '\n\n- first\n  - nested\n    - deeper\n- last\n\n' + largeText + 'END ' + i)
          .split('\n').map((line, j) => indent + (j ? '  ' : '- ') + line).join('\n');
      }).join('\n');
      const largeFile = await app.vault.create(folder + '/Large nested map.md', largeSource);
      const coldStart = performance.now(); await open(largeFile, 130);
      const coldRenderMs = performance.now() - coldStart;
      check('Large document retains all 130 nodes', v.getFlatNodes().length === 130 && v.cy.nodes().length === 130);
      check('Large document retains every node tail', v.getFlatNodes().every((n, i) => n.text.endsWith('END ' + i)));
      let measurements = 0;
      const set = v.measurementCache.set;
      v.measurementCache.set = function(...args) { measurements++; return set.apply(this, args); };
      const warmStart = performance.now(); await v.draw(); await frames();
      const warmRenderMs = performance.now() - warmStart;
      check('Warm redraw reuses measurements', measurements === 0, { measurements });
      // Separate steady viewport interaction from first-paint Markdown work.
      await wait(500); await frames();
      const geometry = v.updateOverlayGeometry, overlay = v.updateOverlays;
      const geometryTimes = [], frameTimes = []; let rebuilds = 0, lastFrame = performance.now();
      v.updateOverlayGeometry = function() { const start = performance.now(); const result = geometry.call(v); geometryTimes.push(performance.now() - start); return result; };
      v.updateOverlays = function() { rebuilds++; return overlay.call(v); };
      const pan = { ...v.cy.pan() }, zoom = v.cy.zoom();
      try {
        for (let i = 0; i < 100; i++) {
          await new Promise(r => requestAnimationFrame(r));
          const now = performance.now(); frameTimes.push(now - lastFrame); lastFrame = now;
          if (i < 50) v.cy.pan({ x: pan.x + Math.sin(i * 0.2) * 80, y: pan.y + Math.cos(i * 0.2) * 80 });
          else v.cy.zoom({ level: zoom * (1 + Math.sin(i * 0.15) * 0.15), renderedPosition: { x: 400, y: 300 } });
        }
      } finally {
        v.updateOverlayGeometry = geometry; v.updateOverlays = overlay; v.measurementCache.set = set;
        v.cy.zoom(zoom); v.cy.pan(pan); v.updateOverlayGeometry();
      }
      check('Pan and zoom do not remeasure or rebuild nodes', measurements === 0 && rebuilds === 0, { measurements, rebuilds });
      check('Large document remains byte-for-byte unchanged', await app.vault.read(largeFile) === largeSource);
      const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { n: sorted.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) }; };
      const performanceResults = { nodes: 130, characters: largeSource.length, coldRenderMs, warmRenderMs, frames: stats(frameTimes.slice(2)), geometry: stats(geometryTimes), measurements, rebuilds };
      if (originalFile) check('Original user note is byte-for-byte unchanged', await app.vault.read(originalFile) === originalSource);
      window.__eomeNodeSizingResults = { folder, characters: source.length, nodeCount: cases.length, checkCount: checks.length, passed: true, samples, performanceResults };
      return JSON.stringify({ ...window.__eomeNodeSizingResults, samples: undefined, sampleCount: samples.length });
    } finally {
      for (const leaf of app.workspace.getLeavesOfType('mindmap-view')) if (leaf.view.file?.path?.startsWith(folder + '/')) leaf.detach();
      if (originalFile) await plugin.openMindmapReplacingLeaf(originalFile);
    }
  })()`]);
  const result = JSON.parse(output.slice(output.indexOf('=> ') + 3));
  // Keep individual CLI responses small; large eval output can block the CLI.
  result.samples = [];
  for (let i = 0; i < result.sampleCount; i += 20) {
    const chunk = run('eval', ['code=JSON.stringify(window.__eomeNodeSizingResults.samples.slice(' + i + ',' + (i + 20) + '))']);
    result.samples.push(...JSON.parse(chunk.slice(chunk.indexOf('=> ') + 3)));
  }
  writeFileSync('/tmp/eome-node-content-sizing-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ folder: result.folder, characters: result.characters, checks: result.checkCount, samples: result.samples.length, passed: result.passed, performance: result.performanceResults }, null, 2));
} finally {
  run('dev:cdp', ['method=Emulation.setFocusEmulationEnabled', 'params={"enabled":false}']);
}
