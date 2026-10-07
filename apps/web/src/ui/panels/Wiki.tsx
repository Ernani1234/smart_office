import { useEffect, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import type { WikiPageDto } from '@office/contracts';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useOffice } from '../../store/store';
import { Markdown } from '../Markdown';
import { cx, Empty, inputClass, Pill, Sheet } from '../kit';

// Wiki da empresa com busca semântica (pgvector): pesquisa paga uma vez e é
// reaproveitada; post-mortems e relatórios financeiros também moram aqui.

const KIND_COLOR: Record<string, string> = {
  research: '#93c5fd',
  seo: '#fbbf24',
  postmortem: '#f472b6',
  report: '#4ade80',
};

export function WikiPanel() {
  const version = useOffice((s) => s.eventsVersion);
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<WikiPageDto[]>([]);
  const [open, setOpen] = useState<WikiPageDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<WikiPageDto[]>(`/api/wiki${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((list) => {
          setPages(list);
          setOpen((cur) => (cur ? (list.find((p) => p.slug === cur.slug) ?? cur) : (list[0] ?? null)));
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, version]);

  return (
    <Sheet
      title="Wiki da empresa"
      icon={<BookOpen size={18} />}
      subtitle="Pesquisas, especificações, relatórios e post-mortems — com busca semântica."
      onClose={() => useOffice.getState().openPanel(null)}
    >
      <div className="flex h-full min-h-[480px]">
        <div className="flex w-[320px] shrink-0 flex-col border-r border-ink-600/60">
          <div className="relative p-3">
            <Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar (ex.: preço freelancer)"
              className={cx(inputClass, 'pl-8')}
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {pages.map((p) => (
              <li key={p.slug}>
                <button
                  onClick={() => setOpen(p)}
                  className={cx('w-full rounded-lg px-3 py-2 text-left', open?.slug === p.slug ? 'bg-ink-700/80' : 'hover:bg-ink-700/40')}
                >
                  <div className="text-[13px] font-medium leading-snug text-ink-100">{p.title}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Pill color={KIND_COLOR[p.kind] ?? '#bcb8dc'}>{p.kind}</Pill>
                    {p.score !== undefined && q && <span className="text-[10.5px] text-ink-400">relevância {p.score.toFixed(2)}</span>}
                  </div>
                </button>
              </li>
            ))}
            {pages.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">Nada por aqui ainda.</li>}
          </ul>
        </div>
        <article className="min-w-0 flex-1 overflow-y-auto p-6">
          {open ? (
            <>
              <h2 className="font-pixel text-2xl text-ink-100">{open.title}</h2>
              <div className="mb-4 mt-1 flex items-center gap-2 text-[11.5px] text-ink-400">
                <span>wiki/{open.slug}</span>·<span>{dateTime(open.updatedAt)}</span>
                {open.tags.map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
              </div>
              <Markdown text={open.body} />
            </>
          ) : (
            <Empty icon={<BookOpen size={34} />} title="Escolha uma página" />
          )}
        </article>
      </div>
    </Sheet>
  );
}
