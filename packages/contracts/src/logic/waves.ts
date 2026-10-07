// Ordena as ordens do CEO em "ondas" respeitando dependências entre times:
// tudo que não depende de ninguém pendente roda em paralelo na mesma onda.
// Dependências desconhecidas ou circulares são ignoradas (não travam a empresa).

export interface Dependent {
  team: string;
  dependsOn: string[];
}

export function planWaves<T extends Dependent>(orders: T[]): T[][] {
  const teams = new Set(orders.map((o) => o.team));
  const pending = orders.map((o) => ({ order: o, deps: new Set(o.dependsOn.filter((d) => d !== o.team && teams.has(d))) }));
  const doneTeams = new Set<string>();
  const waves: T[][] = [];
  while (pending.length > 0) {
    const ready = pending.filter((p) => [...p.deps].every((d) => doneTeams.has(d)));
    // Ciclo: libera o primeiro pendente para não travar.
    const wave = ready.length > 0 ? ready : [pending[0]];
    waves.push(wave.map((p) => p.order));
    for (const p of wave) {
      pending.splice(pending.indexOf(p), 1);
    }
    // Um time só conta como concluído quando todas as suas ordens saíram.
    for (const team of new Set(wave.map((p) => p.order.team))) {
      if (!pending.some((p) => p.order.team === team)) doneTeams.add(team);
    }
  }
  return waves;
}
