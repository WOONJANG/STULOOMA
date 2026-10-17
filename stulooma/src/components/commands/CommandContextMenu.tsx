import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { CommandListProps } from './types';
import './commands.css';

interface ContextMenuProps extends CommandListProps { close: () => void; x: number; y: number }

export function CommandContextMenu({ commands, onCommand, close, x, y }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = menu.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
    menu.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) closeRef.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      } else if (event.key === 'Tab') closeRef.current();
    };
    const dismiss = () => closeRef.current();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('resize', dismiss);
      if (previousFocus.current?.isConnected && (menu.current?.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.current.focus();
    };
  }, []);
  return createPortal(<div ref={menu} role="menu" aria-label="편집 작업" className="studio-command-menu studio-command-context" style={position} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const controls = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % controls.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + controls.length) % controls.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = controls.length - 1;
    if (next >= 0 && controls[next]) { event.preventDefault(); controls[next].focus(); }
  }}>
    {commands.map((command, index) => <div key={command.id}>
      {index > 0 && commands[index - 1].group !== command.group && <div className="studio-command-separator" role="separator"/>}
      <button type="button" role={command.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={command.checked} disabled={command.disabled} tabIndex={-1} className="studio-command-item" onClick={() => { close(); onCommand(command.id); }}><span className="studio-command-check">{command.checked && <Check size={14} aria-hidden="true"/>}</span><span className="studio-command-label">{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>
    </div>)}
  </div>, document.body);
}
