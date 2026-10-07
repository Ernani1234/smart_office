import type { BillingMode, Effort, Level } from '../enums';
import type { RolesFile } from '../roles';

// Do roles.yaml para os funcionários de carne e pixel: cada instância de um
// cargo vira um agente com id estável, nome, mesa e semente de aparência.

export interface AgentSpec {
  id: string;
  roleId: string;
  name: string;
  title: string;
  team: string;
  level: Level;
  model: string;
  baseModel: string;
  escalationModel: string | null;
  effort: Effort;
  billing: BillingMode;
  desk: string;
  seed: number;
}

const NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elisa',
  'Felipe',
  'Gabi',
  'Heitor',
  'Iara',
  'João',
  'Kaio',
  'Lara',
  'Marina',
  'Nico',
  'Otávio',
  'Paula',
  'Rafa',
  'Sofia',
  'Téo',
  'Vitória',
  'Wagner',
  'Yara',
  'Zeca',
  'Bia',
  'Caio',
  'Duda',
  'Enzo',
  'Flora',
  'Guto',
  'Helena',
];

export function hashString(s: string): number {
  // FNV-1a 32 bits
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deskFor(level: Level, team: string, roleId: string, index: number): string {
  switch (level) {
    case 'executive':
      return 'ceo';
    case 'lead':
      return `lead:${team}`;
    case 'staff':
      return `staff:${roleId}`;
    default:
      return `desk:${team}:${index}`;
  }
}

export function buildRoster(file: RolesFile): AgentSpec[] {
  const agents: AgentSpec[] = [];
  const usedNames = new Set<string>();
  const deskCounters = new Map<string, number>();

  // Ordem estável: executivo, líderes, trabalhadores, staff.
  const order: Level[] = ['executive', 'lead', 'worker', 'staff'];
  const roleEntries = Object.entries(file.roles).sort(([, a], [, b]) => order.indexOf(a.level) - order.indexOf(b.level));

  for (const [roleId, role] of roleEntries) {
    for (let i = 0; i < role.instances; i++) {
      const id = role.instances === 1 ? roleId : `${roleId}-${i + 1}`;
      const override = file.overrides[id] ?? {};
      let name = override.name ?? role.names?.[i];
      if (!name) {
        let h = hashString(id);
        name = NAMES[h % NAMES.length];
        let guard = 0;
        while (usedNames.has(name) && guard++ < NAMES.length) {
          h = (h + 7) >>> 0;
          name = NAMES[h % NAMES.length];
        }
      }
      usedNames.add(name);
      let index = 0;
      if (role.level === 'worker') {
        index = (deskCounters.get(role.team) ?? 0) + 1;
        deskCounters.set(role.team, index);
      }
      agents.push({
        id,
        roleId,
        name,
        title: role.title,
        team: role.team,
        level: role.level,
        model: override.model ?? role.model,
        baseModel: role.model,
        escalationModel: role.escalation?.model ?? null,
        effort: override.effort ?? role.effort,
        billing: role.billing,
        desk: deskFor(role.level, role.team, roleId, index),
        seed: hashString(`${id}:${name}`),
      });
    }
  }
  return agents;
}

export function leadOf(roster: AgentSpec[], team: string): AgentSpec | undefined {
  return roster.find((a) => a.level === 'lead' && a.team === team);
}

export function ceoOf(roster: AgentSpec[]): AgentSpec | undefined {
  return roster.find((a) => a.level === 'executive');
}
