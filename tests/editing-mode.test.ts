import {expect,it} from 'vitest';
import {useSingleLineEditor} from '../src/editor/editing-mode';
it('keeps the established multiline default when no choice is stored',()=>{expect(useSingleLineEditor(undefined,'Text')).toBe(false);expect(useSingleLineEditor('multiline','Text')).toBe(false);});
it('uses classic editing for empty, plain and list-like single-line thoughts',()=>{for(const text of ['', 'Text', '- literal bullet','1. literal number','[x] literal'])expect(useSingleLineEditor('single-line',text)).toBe(true);});
it('retains the full editor for existing multiline content and CRLF',()=>{for(const text of ['\n','First\n\nLast','Text\r\nSecond','\r'])expect(useSingleLineEditor('single-line',text)).toBe(false);});
it('expands classic editing after multiline paste without changing any content',()=>{let text='Original';expect(useSingleLineEditor('single-line',text)).toBe(true);const pasted='\n\n- internal\n  - nested\nTail  \n';text+=pasted;expect(useSingleLineEditor('single-line',text)).toBe(false);expect(text).toBe('Original'+pasted);});
it('keeps documents far beyond 50k characters intact in either editing mode',()=>{const text=('Paragraph 日本語.  \n\n').repeat(10000)+'END';expect(text.length).toBeGreaterThan(100000);expect(useSingleLineEditor('single-line',text)).toBe(false);expect(useSingleLineEditor('multiline',text)).toBe(false);expect(text.endsWith('END')).toBe(true);});

it('counts affected thoughts rather than paragraphs or structural descendants',async()=>{const {countMultilineThoughts}=await import('../src/editor/editing-mode');expect(countMultilineThoughts([{text:'One'},{text:'Two\n\nThree\nFour'},{text:'Child'},{text:'CRLF\r\nBody'}])).toBe(2);});
