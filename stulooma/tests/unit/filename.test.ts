import { describe, it, expect } from 'vitest';
import { portableFilename } from '../../src/core/export/filename';
describe('portable output names preserve user project names separately', () => {
  it('retains Korean names and extension', () => { expect(portableFilename('서울 팀-홈.stulooma')).toBe('서울 팀-홈.stulooma'); });
  it('removes path components and Windows invalid filename syntax', () => { expect(portableFilename('../team:home?.stulooma')).toBe('.._team_home_.stulooma'); });
  it('avoids Windows reserved device names', () => { expect(portableFilename('CON.stulooma')).toBe('STULOOMA-CON.stulooma'); });
});
