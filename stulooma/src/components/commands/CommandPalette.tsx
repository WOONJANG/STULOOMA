import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import { commandGroupOrder, focusableControls, type CommandListProps, type StudioCommand } from './types';
import './commands.css';

interface CommandPaletteProps extends CommandListProps { close: () => void }
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\s·.\-_/:]+/g, '');

function matchScore(command: StudioCommand, query: string): number {
  if (!query) return 0;
  const title = normalize(command.label);
  const full = normalize(`${command.label} ${command.group} ${command.keywords ?? ''} ${command.shortcut ?? ''}`);
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (full.includes(query)) return 40;
  let cursor = 0;
  for (const letter of full) if (letter === query[cursor]) cursor++;
  return cursor === query.length ? 10 : -1;
}

export function CommandPalette({ commands, onCommand, close }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const id = useId();
  const results = useMemo(() => {
    const needle = normalize(query);
    return commands.map((command, index) => ({ command, index, score: matchScore(command, needle) }))
      .filter(result => result.score >= 0)
      .sort((a, b) => b.score - a.score ||
        (commandGroupOrder.indexOf(a.command.group) + 1 || 99) - (commandGroupOrder.indexOf(b.command.group) + 1 || 99) || a.index - b.index)
      .map(result => result.command);
  }, [commands, query]);
  const enabled = results.filter(command => !command.disabled);
  const active = enabled.some(command => command.id === activeId) ? activeId : enabled[0]?.id ?? null;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = dialog.current;
    input.current?.focus();
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const controls = focusableControls(dialog.current);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      // A command may have focused an input in a new dialog during this commit.
      // Restore the invoker only while focus still belongs to this palette.
      if (previousFocus.current?.isConnected && (container?.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const option = list.current?.querySelector<HTMLElement>(`[data-command-id="${CSS.escape(active)}"]`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(commandId: string) {
    const command = commands.find(item => item.id === commandId);
    if (!command || command.disabled) return;
    // Restore focus before the command opens another dialog.
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    close();
    onCommand(commandId);
  }

  return createPortal(<div className="studio-command-palette-backdrop" onPointerDown={event => {
    if (event.target === event.currentTarget) close();
  }}>
    <div className="studio-command-palette" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={dialog}>
      <header className="studio-command-palette-title"><span id={`${id}-title`}>명령 검색</span><span>작업에 필요한 명령을 바로 실행하세요</span><button type="button" aria-label="명령 검색 닫기" onClick={close}><X size={17}/></button></header>
      <div className="studio-command-search"><Search size={19} aria-hidden="true"/><label className="studio-command-sr-only" htmlFor={`${id}-input`}>명령 검색어</label><input
        ref={input} id={`${id}-input`} value={query} autoComplete="off" spellCheck={false}
        placeholder="명령 이름이나 단축키 검색…" role="combobox" aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-results`} aria-activedescendant={active ? `${id}-option-${results.findIndex(command => command.id === active)}` : undefined}
        onChange={event => { setQuery(event.target.value); setActiveId(null); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const index = enabled.findIndex(command => command.id === active);
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActiveId(enabled[(index + direction + enabled.length) % enabled.length]?.id ?? null);
          } else if (event.key === 'Enter' && active) {
            event.preventDefault();
            run(active);
          }
        }}
      /><kbd>Esc</kbd></div>
      <div className="studio-command-results" role="listbox" id={`${id}-results`} aria-label="검색된 명령" ref={list}>
        {results.length ? results.map((command, index) => <div key={command.id}>
          {(index === 0 || results[index - 1].group !== command.group) && <div className="studio-command-result-group" aria-hidden="true">{command.group}</div>}
          <div
            id={`${id}-option-${index}`} role="option" aria-selected={active === command.id} aria-disabled={Boolean(command.disabled)}
            data-command-id={command.id} className={`studio-command-result${active === command.id ? ' is-active' : ''}${command.disabled ? ' is-disabled' : ''}`}
            onPointerMove={() => { if (!command.disabled) setActiveId(command.id); }}
            onPointerDown={event => event.preventDefault()} onClick={() => run(command.id)}
          ><span className="studio-command-check">{command.checked && <Check size={14} aria-hidden="true"/>}</span><span className="studio-command-label">{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</div>
        </div>) : <div className="studio-command-empty" role="status"><strong>일치하는 명령이 없습니다</strong><span>다른 이름이나 영문 키워드로 검색해 보세요.</span></div>}
      </div>
      <footer className="studio-command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 실행</span><span>{results.length}개 명령</span></footer>
    </div>
  </div>, document.body);
}
