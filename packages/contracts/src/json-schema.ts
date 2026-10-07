import { z } from 'zod';

// O mesmo schema Zod valida a saída dos modelos e tipa os eventos da UI.
// Para Structured Outputs no modo estrito, o JSON Schema precisa de:
// todas as propriedades em `required`, `additionalProperties: false` e nenhuma
// palavra-chave fora do subconjunto suportado.

type Json = Record<string, unknown>;

const DROP_KEYS = new Set([
  '$schema',
  'default',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'id',
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (DROP_KEYS.has(key)) continue;
    out[key] = strictify(value);
  }
  if (out.type === 'object' || (out.properties && typeof out.properties === 'object')) {
    const props = (out.properties ?? {}) as Json;
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

/** Converte um schema Zod em JSON Schema aceito pelo modo estrito de Structured Outputs. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'output', unrepresentable: 'any' }) as Json;
  return strictify(raw) as Json;
}

export interface StructuredFormat {
  type: 'json_schema';
  name: string;
  schema: Json;
  strict: true;
}

export function structuredFormat(name: string, schema: z.ZodType): StructuredFormat {
  return { type: 'json_schema', name, schema: toStrictJsonSchema(schema), strict: true };
}
