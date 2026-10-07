import { Fragment, type ReactNode } from 'react';

// Markdown mínimo e SEGURO: o conteúdo vem de modelos (e da web, via pesquisa),
// então nada de innerHTML. Gera elementos React: títulos, listas, código,
// negrito, itálico, código inline e links http(s).

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'));
      const href = tok.slice(tok.indexOf('(') + 1, -1);
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((it, i) => (
            <li key={i}>{inline(it, `li-${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, idx) => {
    if (code) {
      if (line.startsWith('```')) {
        blocks.push(<pre key={`pre-${idx}`}>{code.join('\n')}</pre>);
        code = null;
      } else code.push(line);
      return;
    }
    if (line.startsWith('```')) {
      flushList();
      code = [];
      return;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const Tag = `h${h[1].length}` as 'h1' | 'h2' | 'h3';
      blocks.push(<Tag key={`h-${idx}`}>{inline(h[2], `h-${idx}`)}</Tag>);
      return;
    }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      list.push(li[1]);
      return;
    }
    flushList();
    if (line.trim()) blocks.push(<p key={`p-${idx}`}>{inline(line, `p-${idx}`)}</p>);
  });
  if (code) blocks.push(<pre key="pre-end">{(code as string[]).join('\n')}</pre>);
  flushList();
  return (
    <div className={`markdown ${className ?? ''}`}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
