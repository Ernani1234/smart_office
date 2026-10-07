import { useEffect, useMemo, useState } from 'react';
import { File, Folder, GitBranch, GitCommitHorizontal } from 'lucide-react';
import type { RepoTreeEntry } from '@office/contracts';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useOffice, useView } from '../../store/store';
import { cx, Empty, Sheet } from '../kit';

// Repositório da empresa: o PR é a entrega, o CI é a evidência. Aqui você vê o
// que já está integrado na main da missão.

interface Commit {
  commit: string;
  author: string;
  subject: string;
  ts: string;
}

export function RepoPanel() {
  const view = useView();
  const version = useOffice((s) => s.eventsVersion);
  const [missionId, setMissionId] = useState<string | null>(view.activeMissionId);
  const [tree, setTree] = useState<RepoTreeEntry[]>([]);
  const [log, setLog] = useState<Commit[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);

  useEffect(() => {
    if (!missionId) return;
    const t = setTimeout(() => {
      api<RepoTreeEntry[]>(`/api/repo/${missionId}/tree`)
        .then(setTree)
        .catch(() => setTree([]));
      api<Commit[]>(`/api/repo/${missionId}/log`)
        .then(setLog)
        .catch(() => setLog([]));
    }, 300);
    return () => clearTimeout(t);
  }, [missionId, version]);

  const open = (path: string) => {
    if (!missionId) return;
    api<{ path: string; content: string }>(`/api/repo/${missionId}/file?path=${encodeURIComponent(path)}`)
      .then(setFile)
      .catch(() => setFile({ path, content: '(não foi possível abrir)' }));
  };

  const grouped = useMemo(() => {
    const dirs = new Map<string, RepoTreeEntry[]>();
    for (const f of tree) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
      dirs.set(dir, [...(dirs.get(dir) ?? []), f]);
    }
    return [...dirs.entries()].sort(([a], [b]) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
  }, [tree]);

  return (
    <Sheet
      wide
      title="Repositório"
      icon={<GitBranch size={18} />}
      subtitle="Um repositório Git por missão; cada tarefa num worktree e branch próprios, integrados na main depois da revisão."
      onClose={() => useOffice.getState().openPanel(null)}
      actions={
        <select
          value={missionId ?? ''}
          onChange={(e) => {
            setMissionId(e.target.value || null);
            setFile(null);
          }}
          className="h-8 max-w-[260px] rounded-lg border border-ink-500/60 bg-ink-900/70 px-2 text-sm text-ink-100 outline-none"
        >
          {[...view.missionOrder].reverse().map((id) => (
            <option key={id} value={id}>
              {view.missions[id]?.title}
            </option>
          ))}
        </select>
      }
    >
      {!missionId || tree.length === 0 ? (
        <Empty icon={<GitBranch size={34} />} title="Repositório vazio">
          O repositório nasce quando a missão começa; os merges aparecem aqui.
        </Empty>
      ) : (
        <div className="flex h-full min-h-[520px]">
          <div className="w-[280px] shrink-0 overflow-y-auto border-r border-ink-600/60 p-2">
            {grouped.map(([dir, files]) => (
              <div key={dir} className="mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-ink-300">
                  <Folder size={13} className="text-amber" /> {dir === '.' ? '/' : dir}
                </div>
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => open(f.path)}
                    className={cx(
                      'flex w-full items-center gap-1.5 rounded-md py-1 pl-6 pr-2 text-left text-[12px]',
                      file?.path === f.path ? 'bg-ink-700 text-ink-100' : 'text-ink-200 hover:bg-ink-700/40',
                    )}
                  >
                    <File size={12} className="text-ink-400" />
                    <span className="truncate">{f.path.split('/').pop()}</span>
                    <span className="ml-auto text-[10px] text-ink-400">{f.size} B</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto">
            {file ? (
              <div>
                <div className="sticky top-0 border-b border-ink-600/60 bg-ink-850/95 px-4 py-2 font-mono text-[12px] text-ink-200">
                  {file.path}
                </div>
                <pre className="p-0 font-mono text-[12px] leading-[1.55]">
                  {file.content.split('\n').map((line, i) => (
                    <div key={i} className="flex hover:bg-ink-800/50">
                      <span className="w-12 shrink-0 select-none pr-3 text-right text-ink-500">{i + 1}</span>
                      <span className="whitespace-pre text-ink-100">{line || ' '}</span>
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <div className="p-5">
                <h3 className="mb-3 font-pixel text-[13px] uppercase tracking-wider text-ink-300">Commits na main</h3>
                <ol className="space-y-1">
                  {log.map((c) => (
                    <li key={c.commit} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800/40">
                      <GitCommitHorizontal
                        size={15}
                        className={c.subject.startsWith('Merge') ? 'mt-0.5 text-astra' : 'mt-0.5 text-ink-400'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-ink-100">{c.subject}</div>
                        <div className="text-[11px] text-ink-400">
                          {c.author} · {dateTime(c.ts)} · <span className="font-mono">{c.commit.slice(0, 7)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
