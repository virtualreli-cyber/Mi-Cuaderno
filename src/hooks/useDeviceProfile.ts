import { useEffect, useState } from 'react';

export type LayoutTier = 'desktop' | 'tablet-landscape' | 'tablet-portrait' | 'mobile';

export interface DeviceProfile {
  /** True when the primary pointer is touch/coarse or hover is unavailable (iPad, Android tablet, mobile). */
  isTouch: boolean;
  viewportWidth: number;
  viewportHeight: number;
  /** Visual viewport height (shrinks when iOS/Android software keyboard is open). */
  visualViewportHeight: number;
  isKeyboardOpen: boolean;
  tier: LayoutTier;
  isDesktop: boolean;
  isTablet: boolean;
  isTabletLandscape: boolean;
  isTabletPortrait: boolean;
  isMobile: boolean;
  /** True on all touch devices (including iPad landscape) and narrow viewports < 1024px. */
  isOverlaySidebar: boolean;
}

export function computeDeviceProfile(
  viewportWidth: number,
  viewportHeight: number,
  visualViewportHeight: number,
  isTouch: boolean
): DeviceProfile {
  const isMobile = viewportWidth < 640;
  const isTablet = !isMobile && (isTouch || viewportWidth < 1024);
  const isTabletLandscape = isTablet && viewportWidth >= 900;
  const isTabletPortrait = isTablet && viewportWidth < 900;
  const isDesktop = !isMobile && !isTablet;
  const tier: LayoutTier = isMobile
    ? 'mobile'
    : isTabletPortrait
      ? 'tablet-portrait'
      : isTabletLandscape
        ? 'tablet-landscape'
        : 'desktop';
  const isKeyboardOpen =
    isTouch && viewportHeight > 0 && viewportHeight - visualViewportHeight > 140;

  return {
    isTouch,
    viewportWidth,
    viewportHeight,
    visualViewportHeight,
    isKeyboardOpen,
    tier,
    isDesktop,
    isTablet,
    isTabletLandscape,
    isTabletPortrait,
    isMobile,
    isOverlaySidebar: isTouch || viewportWidth < 1024,
  };
}

function readSnapshot(): DeviceProfile {
  if (typeof window === 'undefined') {
    return computeDeviceProfile(1440, 900, 900, false);
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const isTouch = coarse || noHover;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const vvh = window.visualViewport?.height ?? vh;
  return computeDeviceProfile(vw, vh, vvh, isTouch);
}

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(readSnapshot);

  useEffect(() => {
    const update = () => {
      setProfile((prev) => {
        const next = readSnapshot();
        if (
          prev.isTouch === next.isTouch &&
          prev.viewportWidth === next.viewportWidth &&
          prev.viewportHeight === next.viewportHeight &&
          Math.abs(prev.visualViewportHeight - next.visualViewportHeight) < 4
        ) {
          return prev;
        }
        return next;
      });
    };

    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const mqHover = window.matchMedia('(hover: none)');

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    mqCoarse.addEventListener?.('change', update);
    mqHover.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      mqCoarse.removeEventListener?.('change', update);
      mqHover.removeEventListener?.('change', update);
    };
  }, []);

  return profile;
}
