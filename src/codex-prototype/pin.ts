import {homedir} from 'node:os';
import {join} from 'node:path';
export const PIN = {
  path: process.env['CODEX_PROTOTYPE_BIN']??join(homedir(),'AppData','Local','CodexSidebar','backends','0.163.0-alpha.10.2-76b4bfc83785f31c','codex.exe'),
  version: 'codex-cli 0.163.0-alpha.10.2',
  sha256: '76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47',
  sourceCandidate: 'https://github.com/openai/codex/releases/tag/rust-v0.163.0-alpha.10.2',
} as const;
