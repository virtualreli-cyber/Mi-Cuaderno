import { describe, expect, it } from 'vitest';
import { computeDeviceProfile } from '../../hooks/useDeviceProfile';

describe('computeDeviceProfile — desktop vs iPad landscape/portrait vs mobile', () => {
  it('classifies desktop fine-pointer wide screens without enabling touch/overlay sidebar', () => {
    const p = computeDeviceProfile(1440, 900, 900, false);
    expect(p.tier).toBe('desktop');
    expect(p.isDesktop).toBe(true);
    expect(p.isTouch).toBe(false);
    expect(p.isOverlaySidebar).toBe(false);
    expect(p.isTablet).toBe(false);
    expect(p.isMobile).toBe(false);
  });

  it('classifies iPad Air/Pro landscape (>= 1024px with coarse pointer) as tablet-landscape with overlay sidebar', () => {
    const p = computeDeviceProfile(1180, 820, 820, true);
    expect(p.tier).toBe('tablet-landscape');
    expect(p.isTouch).toBe(true);
    expect(p.isTablet).toBe(true);
    expect(p.isTabletLandscape).toBe(true);
    expect(p.isDesktop).toBe(false);
    expect(p.isOverlaySidebar).toBe(true);
  });

  it('classifies iPad portrait as tablet-portrait with overlay sidebar', () => {
    const p = computeDeviceProfile(820, 1180, 1180, true);
    expect(p.tier).toBe('tablet-portrait');
    expect(p.isTablet).toBe(true);
    expect(p.isTabletPortrait).toBe(true);
    expect(p.isTabletLandscape).toBe(false);
    expect(p.isOverlaySidebar).toBe(true);
  });

  it('classifies phones (< 640px) as mobile and detects virtual keyboard height shrink', () => {
    const p = computeDeviceProfile(390, 844, 520, true);
    expect(p.tier).toBe('mobile');
    expect(p.isMobile).toBe(true);
    expect(p.isOverlaySidebar).toBe(true);
    expect(p.isKeyboardOpen).toBe(true);
  });
});
