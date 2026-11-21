import { execFileSync } from 'node:child_process';
const cli = process.env.OBSIDIAN_CLI || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const vault = process.env.EOME_TEST_VAULT || 'Testprogramm 2';
function run(command, args) { return execFileSync(cli, [`vault=${vault}`, command, ...args], { encoding: 'utf8', timeout: 15000 }); }
function cdp(method, params) { const result = run('dev:cdp', [`method=${method}`, `params=${JSON.stringify(params)}`]); if (result.includes('Error:')) throw new Error(result); }
function key(key, code, modifiers = 0, text) {
  const windowsVirtualKeyCode = key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0);
  cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode, ...(text ? { text } : {}) });
  cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: 0 });
}
console.log(run('eval', ['code=(()=>{const cm=document.querySelector(".node-editor .cm-content")?.cmTile?.view;if(!cm)throw new Error("Open the test editor first");cm.dispatch({selection:{anchor:0,head:cm.state.doc.length}});cm.focus();return "Editor selected"})()']).trim());
cdp('Input.insertText', { text: 'Vault keyboard test' });
key('Enter', 'Enter', 8, '\r');
cdp('Input.insertText', { text: 'Second paragraph' });
const pasted = '\n\n- pasted internal list\n  - nested content\n> pasted quote\n```ts\n\t- code\n<!--section: 1-->\n```\n\n';
console.log(run('eval', ['code=await navigator.clipboard.writeText(' + JSON.stringify(pasted) + '); "Clipboard prepared"']).trim());
key('v', 'KeyV', 4);
console.log(run('eval', ['code=(()=>{const text=document.querySelector(".node-editor .cm-content")?.textContent;return JSON.stringify({editing:!!text,containsPastedList:text?.includes("pasted internal list")})})()']).trim());
key('Enter', 'Enter', 0);
console.log('Dispatched real Shift+Enter, normal paste and Enter through CDP.');
