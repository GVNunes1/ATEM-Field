import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export function scriptPath(fileName: string): string {
  const compiledCandidate = path.resolve(__dirname, fileName);
  if (fs.existsSync(compiledCandidate)) return compiledCandidate;
  return path.resolve(__dirname, '../../src/services', fileName);
}

export function parsePythonJson(stdout: string, stderr = ''): any {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Logs de bibliotecas externas podem preceder o resultado JSON
    }
  }
  const details = (stderr || stdout).trim();
  throw new Error(`O conector Google retornou uma resposta inválida${details ? ': ' + details : '.'}`);
}

export function executeCalendarPython(fileName: string, args: string[] = [], timeoutMs = 300_000, input?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_EXECUTABLE?.trim() || (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, ['-u', scriptPath(fileName), ...args], {
      cwd: path.resolve(__dirname, '../..'),
      windowsHide: true,
      env: process.env
    });
    child.stdin.on('error', () => { /* tratadores de spawn/close relatam erros do conector */ });
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error('A comunicação com o Google Agenda excedeu o tempo limite.'));
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try {
        const result = parsePythonJson(stdout, stderr);
        if (code !== 0 || !result.success) {
          const error = new Error(result.error || stderr.trim() || `Conector Google finalizado com código ${code}.`);
          Object.assign(error, { authRequired: Boolean(result.auth_required), details: result });
          reject(error);
          return;
        }
        if (stderr.trim()) console.log(`[Google Agenda] ${stderr.trim()}`);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
