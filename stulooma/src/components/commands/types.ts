export interface StudioCommand {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  keywords?: string;
}

export interface CommandListProps {
  commands: StudioCommand[];
  onCommand: (id: string) => void;
}

export const commandGroupOrder = ['파일', '편집', '디자인', '보기', '도움말'];

export function commandGroups(commands: StudioCommand[]): string[] {
  const groups = [...new Set(commands.map(command => command.group))];
  return groups.sort((a, b) => {
    const ai = commandGroupOrder.indexOf(a);
    const bi = commandGroupOrder.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

export function focusableControls(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
  )).filter(element => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true');
}
