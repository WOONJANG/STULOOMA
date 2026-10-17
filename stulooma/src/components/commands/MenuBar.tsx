import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { commandGroups, type CommandListProps } from './types';
import './commands.css';

/** Desktop-style menus. Only the open menu is mounted in the accessibility tree. */
export function MenuBar({ commands, onCommand }: CommandListProps) {
  const groups = commandGroups(commands);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [tabGroup, setTabGroup] = useState(groups[0] ?? '');
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const options = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<'first' | 'last' | null>(null);
  const id = useId();

  function close(restore = true) {
    setOpenGroup(null);
    if (restore && openGroup) buttons.current.get(openGroup)?.focus();
  }

  function open(group: string, focus: 'first' | 'last' | null = null) {
    pendingFocus.current = focus;
    setTabGroup(group);
    setOpenGroup(group);
    if (openGroup === group && focus) {
      const enabled = commands.filter(command => command.group === group && !command.disabled);
      const target = focus === 'first' ? enabled[0] : enabled.at(-1);
      if (target) options.current.get(target.id)?.focus();
    }
  }

  useEffect(() => {
    if (!openGroup || !pendingFocus.current) return;
    const enabled = commands.filter(command => command.group === openGroup && !command.disabled);
    const target = pendingFocus.current === 'first' ? enabled[0] : enabled.at(-1);
    pendingFocus.current = null;
    if (target) options.current.get(target.id)?.focus();
  }, [openGroup, commands]);

  useEffect(() => {
    if (!openGroup) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    const loseWindow = () => close(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', loseWindow);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', loseWindow);
    };
  }, [openGroup]);

  function moveGroup(group: string, direction: number, focusMenu: boolean) {
    const index = groups.indexOf(group);
    const next = groups[(index + direction + groups.length) % groups.length];
    setTabGroup(next);
    if (focusMenu) open(next, 'first');
    else buttons.current.get(next)?.focus();
  }

  function groupKey(event: KeyboardEvent<HTMLButtonElement>, group: string) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveGroup(group, event.key === 'ArrowRight' ? 1 : -1, Boolean(openGroup));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(group, event.key === 'ArrowDown' ? 'first' : 'last');
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? groups[0] : groups.at(-1)!;
      setTabGroup(next);
      if (openGroup) open(next, 'first');
      else buttons.current.get(next)?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close(false);
  }

  function optionKey(event: KeyboardEvent<HTMLButtonElement>, commandId: string, group: string) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const enabled = commands.filter(command => command.group === group && !command.disabled);
    const index = enabled.findIndex(command => command.id === commandId);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveGroup(group, event.key === 'ArrowRight' ? 1 : -1, true);
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === 'Tab') {
      close(false);
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const offset = enabled.slice(index + 1).concat(enabled.slice(0, index + 1));
      const match = offset.find(command => command.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match) {
        event.preventDefault();
        options.current.get(match.id)?.focus();
      }
      return;
    }
    if (next >= 0 && enabled[next]) {
      event.preventDefault();
      options.current.get(enabled[next].id)?.focus();
    }
  }

  return <div className="studio-command-menubar" role="menubar" aria-label="프로그램 메뉴" ref={root}>
    {groups.map((group, groupIndex) => <div className="studio-command-menu-group" key={group}>
      <button
        ref={element => { if (element) buttons.current.set(group, element); else buttons.current.delete(group); }}
        type="button" role="menuitem" className="studio-command-menu-trigger"
        id={`${id}-trigger-${groupIndex}`} aria-haspopup="menu" aria-expanded={openGroup === group}
        aria-controls={openGroup === group ? `${id}-menu-${groupIndex}` : undefined}
        tabIndex={tabGroup === group ? 0 : -1}
        onFocus={() => setTabGroup(group)} onKeyDown={event => groupKey(event, group)}
        onPointerEnter={() => { if (openGroup && openGroup !== group) open(group); }}
        onClick={() => { if (openGroup === group) close(); else open(group, 'first'); }}
      >{group}</button>
      {openGroup === group && <div className="studio-command-menu" role="menu" id={`${id}-menu-${groupIndex}`} aria-labelledby={`${id}-trigger-${groupIndex}`}>
        {commands.filter(command => command.group === group).map(command => <button
          key={command.id} type="button" role={command.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={command.checked} disabled={command.disabled} tabIndex={-1}
          ref={element => { if (element) options.current.set(command.id, element); else options.current.delete(command.id); }}
          className="studio-command-item" onKeyDown={event => optionKey(event, command.id, group)}
          onClick={() => { close(); onCommand(command.id); }}
        ><span className="studio-command-check">{command.checked && <Check size={14} aria-hidden="true"/>}</span><span className="studio-command-label">{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>)}
      </div>}
    </div>)}
  </div>;
}
