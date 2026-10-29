import {afterEach,describe,it,expect,vi} from 'vitest';
import {homedir} from 'node:os';import {join,resolve} from 'node:path';
import {allowedCommand} from '../src/codex-prototype/session';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
describe('candidate runtime location preserves pinned identity and approval scope',()=>{
 it('resolves the approved dedicated backend without using the official installation directory',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_BIN',undefined);vi.resetModules();const {PIN}=await import('../src/codex-prototype/pin');
  expect(PIN).toEqual({path:join(homedir(),'AppData','Local','CodexSidebar','backends','0.163.0-alpha.10.2-76b4bfc83785f31c','codex.exe'),version:'codex-cli 0.163.0-alpha.10.2',sha256:'76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47',sourceCandidate:'https://github.com/openai/codex/releases/tag/rust-v0.163.0-alpha.10.2'});
 });
 it('allows an explicit location override while retaining the exact binary identity requirement',async()=>{
  const path=resolve('synthetic-runtime','codex.exe');vi.stubEnv('CODEX_PROTOTYPE_BIN',path);vi.resetModules();const {PIN}=await import('../src/codex-prototype/pin');
  expect(PIN.path).toBe(path);expect(PIN.version).toBe('codex-cli 0.163.0-alpha.10.2');expect(PIN.sha256).toBe('76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47');
 });
 it('accepts only the original current-user PowerShell wrapper and the original narrow commands',()=>{
  const shell=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
  expect(allowedCommand(`"${shell}" -Command "Write-Output 'test'"`)).toBe(true);
  expect(allowedCommand(`"${join(homedir(),'other','pwsh.exe')}" -Command "Write-Output 'test'"`)).toBe(false);
  expect(allowedCommand(`"${shell}" -Command "Get-Content 'secret'"`)).toBe(false);
 });
 it.each(["Write-Output 'FILETOOLS_LIVE_0152_OK'","Start-Sleep -Seconds 3; Write-Output 'test'"])('accepts the observed fixed NoProfile wrapper for %s',body=>{
  const shell=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
  expect(allowedCommand(`"${shell}" -NoProfile -Command "${body}"`)).toBe(true);
 });
 it.each([
  ['-NoLogo -Command',"Write-Output 'test'"],
  ['-NoProfile -NoLogo -Command',"Write-Output 'test'"],
  ['-NoProfile -NoProfile -Command',"Write-Output 'test'"],
  ['-Command -NoProfile',"Write-Output 'test'"],
  ['-NoProfile -File',"Write-Output 'test'"],
  ['-NoProfile -EncodedCommand',"Write-Output 'test'"],
  ['-NoProfile -Command',"Write-Output '$env:TOKEN'"],
  ['-NoProfile -Command',"Write-Output 'test'; Get-Content C:/other"],
  ['-NoProfile -Command','Invoke-WebRequest https://example.com'],
 ])('rejects unapproved parameters/body: %s %s',(parameters,body)=>{
  const shell=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
  expect(allowedCommand(`"${shell}" ${parameters} "${body}"`)).toBe(false);
 });
 it('rejects a different executable even with the observed NoProfile wrapper',()=>{
  expect(allowedCommand(`"${join(homedir(),'other','pwsh.exe')}" -NoProfile -Command "Write-Output 'test'"`)).toBe(false);
 });
});
