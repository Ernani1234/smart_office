import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Sandbox } from '../sandbox/exec';
import { tail } from '../util';

// O CI é a evidência. Portões automáticos rodam por código, no sandbox, e o
// resultado (com o fim da saída de cada checagem) vai junto para a revisão.

const CiConfigSchema = z.object({
  checks: z
    .array(
      z.object({
        name: z.string().min(1),
        run: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

export interface CiCheckResult {
  name: string;
  ok: boolean;
  ms: number;
  tail: string;
}

export interface CiRun {
  ok: boolean;
  ms: number;
  checks: CiCheckResult[];
}

export class CiRunner {
  constructor(private readonly sandbox: Sandbox) {}

  checksOf(dir: string): z.infer<typeof CiConfigSchema>['checks'] {
    const file = path.join(dir, 'ci.json');
    if (!existsSync(file)) return [{ name: 'testes', run: ['node', '--test'] }];
    const parsed = CiConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return [{ name: 'ci.json', run: ['node', '-e', 'console.error("ci.json inválido"); process.exit(1)'] }];
    return parsed.data.checks;
  }

  async run(dir: string, onCheck?: (c: CiCheckResult) => void): Promise<CiRun> {
    const started = Date.now();
    const results: CiCheckResult[] = [];
    for (const check of this.checksOf(dir)) {
      const r = await this.sandbox.exec(dir, check.run, { timeoutMs: check.timeoutMs ?? 180_000 });
      const output = `${r.stdout}\n${r.stderr}`.trim();
      const result: CiCheckResult = {
        name: check.name,
        ok: r.code === 0 && !r.timedOut,
        ms: r.ms,
        tail: tail(r.timedOut ? `${output}\n(tempo esgotado)` : output, 1500),
      };
      results.push(result);
      onCheck?.(result);
    }
    return { ok: results.every((c) => c.ok), ms: Date.now() - started, checks: results };
  }
}
