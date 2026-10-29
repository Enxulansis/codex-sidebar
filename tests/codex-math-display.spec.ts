import {describe,it,expect} from 'vitest';
import MarkdownIt from 'markdown-it';
import {mathSegments,mathFormatText,prepareMath} from '../src/codex-prototype/display/dsh-math';
import {createRequire} from 'node:module';
import {FORMULA_MARKDOWN} from '../src/codex-prototype/offline/fixtures';
const md=()=>{const m=new MarkdownIt({html:false});m.inline.ruler.disable(['escape']);return m;};
const original=createRequire(import.meta.url)('./fixtures/dsh-math-scanner.js');
describe('formula display — original 165 semantics, restricted resources',()=>{
 it.each([String.raw`紧贴中文$E=mc^2$`,String.raw`\$5, $123$, $a,b,$, $ x $`,String.raw`$$\begin{pmatrix}a&b\\c&d\end{pmatrix}$$`,String.raw`\(x_1\) and \[x^2\]`,'$$\n x+y \n$$','$unclosed', '$a\n b$', '$'+ 'x'.repeat(2001)+'$',String.raw`$\frac{a}{b}$ and $x_i$`])('matches the original scanner: %s',source=>{expect(mathSegments(source)).toEqual(original(source));});
 it('retains code fences, indented code and exact-run inline code while rendering multiline math',()=>{
  const source='`$not_math$` and `` $also_not_math$ `x` ``\n\n```tex\n$$x+y$$\n```\n\n    $indented$\n\n$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\n$$';const parser=md(),p=prepareMath(source,parser),tokens=parser.parse(p.source,{});
  expect(tokens.find(t=>t.type==='fence')?.content).toBe('$$x+y$$\n');expect(tokens.find(t=>t.type==='code_block')?.content).toBe('$indented$\n');
  expect(tokens.flatMap(t=>t.children??[]).filter(t=>t.type==='code_inline').map(t=>t.content)).toEqual(['$not_math$','$also_not_math$ `x`']);expect([...p.values.values()].map(v=>v.tex)).toEqual(['\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}']);
 });
 it('protects formula punctuation from emphasis, tables and supplied private-use characters',()=>{
  const parser=md(),p=prepareMath('\uE0020\uE003\n\n| Formula |\n|---|\n| $a_b * c \\mid d$ |',parser);expect(p.values.size).toBe(1);expect(p.source).toContain('\uE0020\uE003');const children=parser.parse(p.source,{}).flatMap(t=>t.children??[]);expect(children.some(t=>t.type==='em_open')).toBe(false);expect(children.filter(t=>t.type==='text').some(t=>p.pattern.test(t.content))).toBe(true);
 });
 it('keeps incomplete and invalid-surrogate streaming text readable',()=>{const p=prepareMath('$x+\ud800 and $$\\frac{a',md());expect(p.values.size).toBe(0);expect(p.source).toBe('$x+\ud800 and $$\\frac{a');});
 it.each(['markdown','tex','tex-delimited','mathml'] as const)('supports original copy format %s',format=>{expect(mathFormatText(format,'x+y',false,'<math>x+y</math>')).toBe(format==='tex'?'x+y':format==='mathml'?'<math>x+y</math>':'$x+y$');expect(mathFormatText(format,'x+y',true)).toBe(format==='tex'||format==='mathml'?'x+y':'$$x+y$$');});
 it('has synthetic formula diversity without real requests or secrets',()=>{const p=prepareMath(FORMULA_MARKDOWN,md());expect(p.values.size).toBeGreaterThanOrEqual(15);expect([...p.values.values()].filter(v=>v.display).length).toBe(4);expect(FORMULA_MARKDOWN).not.toMatch(/Bearer|api_key|requestApproval/);});
});
