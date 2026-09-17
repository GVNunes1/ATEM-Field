import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './ModalOverlay.css';

interface ModalOverlayProps extends HTMLAttributes<HTMLDivElement> {
  onDismiss?: () => void;
}

// Keep nested dialogs above their parent, with only the top dialog interactive.
const layers: HTMLDivElement[] = [];
let rootWasInert = false;
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function ModalOverlay({ children, className = '', onDismiss, ...props }: ModalOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);

  useLayoutEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    if (!layers.length && root) {
      rootWasInert = root.inert;
      root.inert = true;
    }
    layers.push(layer);
    layers.forEach((entry, index) => {
      entry.inert = entry !== layer;
      entry.style.zIndex = String(1000 + index);
    });

    const isTop = () => layers[layers.length - 1] === layer;
    const controls = () => Array.from(layer.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
    const focusFirst = () => (controls()[0] || layer).focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => { if (isTop()) focusFirst(); });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape' && dismissRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        layer.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === layer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !layer.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      const index = layers.indexOf(layer);
      if (index !== -1) layers.splice(index, 1);
      const top = layers[layers.length - 1];
      layers.forEach(entry => { entry.inert = entry !== top; });
      if (!top && root) root.inert = rootWasInert;
      queueMicrotask(() => {
        if (opener?.isConnected && !opener.closest('[inert]') && (!top || top.contains(opener))) {
          opener.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  // Rendering under body avoids transformed/animated ancestors and clipped pages.
  return createPortal(
    <div {...props} ref={layerRef} tabIndex={-1} className={`field-modal-layer ${className}`}>
      {children}
    </div>,
    document.body
  );
}
