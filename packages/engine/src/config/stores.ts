import { readFileSync, statSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isScalar, parseDocument, parse as parseYaml } from 'yaml';
import {
  buildRoster,
  PricingSchema,
  RolesFileSchema,
  type AgentSpec,
  type Pricing,
  type Role,
  type RolesFile,
  type Rules,
} from '@office/contracts';

// Arquivos de configuração com recarga a quente: cada leitura confere o mtime,
// então editar o YAML (à mão ou pela interface) vale na próxima chamada.

class CachedFile<T> {
  private cache: { mtimeMs: number; value: T } | null = null;
  constructor(
    readonly file: string,
    private readonly parse: (text: string) => T,
  ) {}

  get(): T {
    const mtimeMs = statSync(this.file).mtimeMs;
    if (!this.cache || this.cache.mtimeMs !== mtimeMs) {
      this.cache = { mtimeMs, value: this.parse(readFileSync(this.file, 'utf8')) };
    }
    return this.cache.value;
  }

  invalidate(): void {
    this.cache = null;
  }
}

export interface RolesPatch {
  roles?: Record<
    string,
    Partial<Pick<Role, 'model' | 'effort' | 'reviewEffort' | 'pivotEffort' | 'billing' | 'taskBudgetUsd' | 'instances' | 'finalModel'>>
  >;
  overrides?: Record<string, { model?: string; effort?: string; name?: string } | null>;
  rules?: Partial<Rules>;
}

export class RolesStore {
  private readonly file: CachedFile<RolesFile>;

  constructor(readonly configDir: string) {
    this.file = new CachedFile(path.join(configDir, 'roles.yaml'), (text) => RolesFileSchema.parse(parseYaml(text)));
  }

  get(): RolesFile {
    return this.file.get();
  }

  roster(): AgentSpec[] {
    return buildRoster(this.get());
  }

  role(roleId: string): Role {
    const role = this.get().roles[roleId];
    if (!role) throw new Error(`Cargo desconhecido: ${roleId}`);
    return role;
  }

  agent(agentId: string): AgentSpec {
    const a = this.roster().find((x) => x.id === agentId);
    if (!a) throw new Error(`Agente desconhecido: ${agentId}`);
    return a;
  }

  /**
   * Aplica um patch preservando comentários do YAML, valida o resultado inteiro
   * com o schema e grava de forma atômica. Retorna a lista de mudanças legível.
   */
  update(patch: RolesPatch, knownModels: Set<string>, knownImageModels: Set<string>): string[] {
    const text = readFileSync(this.file.file, 'utf8');
    const doc = parseDocument(text);
    const before = this.get();
    const changes: string[] = [];
    // Valor simples que já existe no arquivo é trocado no próprio texto: o resto
    // (comentários alinhados, listas inline) fica byte a byte igual e o diff no
    // git mostra só a linha que mudou. Mudança estrutural cai no toString().
    const splices: { start: number; end: number; text: string }[] = [];
    let structural = false;
    const set = (at: string[], value: string | number | boolean) => {
      const node = doc.getIn(at, true);
      if (isScalar(node) && node.range) {
        const text = typeof value === 'string' && !/^[A-Za-z0-9][\w.-]*$/.test(value) ? JSON.stringify(value) : String(value);
        splices.push({ start: node.range[0], end: node.range[1], text });
      } else structural = true;
      doc.setIn(at, value);
    };

    for (const [roleId, fields] of Object.entries(patch.roles ?? {})) {
      if (!before.roles[roleId]) throw new Error(`Cargo desconhecido: ${roleId}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        const prev = (before.roles[roleId] as Record<string, unknown>)[key];
        if (prev === value) continue;
        set(['roles', roleId, key], value as string | number | boolean);
        changes.push(`${roleId}.${key}: ${String(prev ?? '—')} → ${String(value)}`);
      }
    }
    for (const [agentId, override] of Object.entries(patch.overrides ?? {})) {
      if (override === null) {
        if (before.overrides[agentId]) {
          doc.deleteIn(['overrides', agentId]);
          structural = true;
          changes.push(`${agentId}: promoção removida`);
        }
        continue;
      }
      const clean = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== ''));
      doc.setIn(['overrides', agentId], doc.createNode(clean));
      structural = true;
      changes.push(
        `${agentId}: ${Object.entries(clean)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
      );
    }
    for (const [key, value] of Object.entries(patch.rules ?? {})) {
      if (value === undefined) continue;
      set(['company', 'rules', key], value);
      changes.push(`regra ${key} → ${value}`);
    }

    const next = RolesFileSchema.parse(doc.toJS());
    for (const [roleId, role] of Object.entries(next.roles)) {
      const known = role.kind === 'image' ? knownImageModels : knownModels;
      if (!known.has(role.model)) throw new Error(`${roleId}: modelo sem preço em pricing.yaml (${role.model})`);
      if (role.escalation && !knownModels.has(role.escalation.model)) {
        throw new Error(`${roleId}: modelo de escalonamento sem preço (${role.escalation.model})`);
      }
    }
    for (const [agentId, o] of Object.entries(next.overrides)) {
      if (o.model && !knownModels.has(o.model) && !knownImageModels.has(o.model)) {
        throw new Error(`${agentId}: modelo sem preço em pricing.yaml (${o.model})`);
      }
    }

    if (changes.length > 0) {
      const tmp = `${this.file.file}.tmp`;
      const out = structural
        ? doc.toString({ lineWidth: 0 })
        : splices.sort((a, b) => b.start - a.start).reduce((t, sp) => t.slice(0, sp.start) + sp.text + t.slice(sp.end), text);
      writeFileSync(tmp, out, 'utf8');
      renameSync(tmp, this.file.file);
      this.file.invalidate();
    }
    return changes;
  }
}

export class PricingStore {
  private readonly file: CachedFile<Pricing>;
  constructor(configDir: string) {
    this.file = new CachedFile(path.join(configDir, 'pricing.yaml'), (text) => PricingSchema.parse(parseYaml(text)));
  }
  get(): Pricing {
    return this.file.get();
  }
  models(): Set<string> {
    return new Set(Object.keys(this.get().models));
  }
  imageModels(): Set<string> {
    return new Set(Object.keys(this.get().images));
  }
}

export class PromptStore {
  private readonly cache = new Map<string, { mtimeMs: number; text: string }>();
  constructor(private readonly configDir: string) {}

  read(relative: string | undefined): string {
    if (!relative) return '';
    const full = path.resolve(this.configDir, relative);
    if (!full.startsWith(path.resolve(this.configDir))) throw new Error('prompt fora de config/');
    if (!existsSync(full)) return '';
    const mtimeMs = statSync(full).mtimeMs;
    const hit = this.cache.get(full);
    if (hit && hit.mtimeMs === mtimeMs) return hit.text;
    const text = readFileSync(full, 'utf8');
    this.cache.set(full, { mtimeMs, text });
    return text;
  }

  /** Prefixo estável (manual + cargo): sempre no início, para aproveitar o cache. */
  instructionsFor(roles: RolesFile, role: Role): string {
    const handbook = this.read(roles.company.handbook);
    const rolePrompt = this.read(role.prompt);
    return [handbook, rolePrompt].filter(Boolean).join('\n\n---\n\n');
  }
}
