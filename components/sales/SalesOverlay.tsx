'use client';

import { useEffect, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/** Full-screen sales overlays must escape animated/scrolling page stacking contexts. */
export default function SalesOverlay({ className, children, printable = false, ...props }: HTMLAttributes<HTMLDivElement> & { printable?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  // Shell headers/mobile navigation use 100 and the sidebar uses 120.
  // Preserve existing modal/lightbox layers of 200–500 and all layout classes.
  const layerClasses = className?.replace(/(^|\s)z-(?:50|\[(?:100|110|120)\])(?=\s|$)/g, '$1z-[200]');
  const overlayClassName = `font-sans text-[#1d1d1f] ${printable ? '' : 'print:hidden'} ${layerClasses || ''}`;
  return createPortal(<div {...props} className={overlayClassName}>{children}</div>, document.body);
}
