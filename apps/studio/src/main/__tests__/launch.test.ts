import { describe, expect, it } from 'vitest';
import { isNewer, projectInArgv, releaseFor } from '../launch';

describe('launching with a project', () => {
  it('finds the project a double-click passes, absolute or relative', () => {
    expect(projectInArgv(['C:\\App\\VC Game Studio.exe', 'C:\\Games\\Cave.vcgs'], 'C:\\')).toBe('C:\\Games\\Cave.vcgs');
    expect(projectInArgv(['/app/vcgs', '--flag', 'Cave.VCGS'], '/home/ken')).toBe('/home/ken/Cave.VCGS');
  });

  it('ignores flags, other files and the executable itself', () => {
    expect(projectInArgv(['/app/vcgs'], '/')).toBeNull();
    expect(projectInArgv(['/app/vcgs', '--inspect=9229', 'notes.txt'], '/')).toBeNull();
    expect(projectInArgv(['/app/x.vcgs'], '/')).toBeNull();
  });
});

describe('update check', () => {
  it('compares versions number by number', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('v0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
  });

  it('reads this platform’s release from the site', () => {
    const body = { releases: [{ platform: 'windows', version: '0.2.0', release_notes: null }, { platform: 'macos', version: '0.2.1', release_notes: 'Faster saves.' }] };
    expect(releaseFor(body, 'macos')).toEqual({ version: '0.2.1', notes: 'Faster saves.' });
    expect(releaseFor(body, 'windows')).toEqual({ version: '0.2.0', notes: null });
    expect(releaseFor({ releases: [] }, 'windows')).toBeNull();
    expect(releaseFor(null, 'windows')).toBeNull();
  });
});
