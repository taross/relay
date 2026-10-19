import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

export function WorkbenchDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[autofocus]")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  return <div className="workbench-dialog-backdrop" onMouseDown={closeFromBackdrop}>
    <section ref={dialogRef} className="workbench-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header><h2 id={titleId}>{title}</h2><button className="workbench-dialog-close" type="button" aria-label="Close dialog" onClick={close}>Close</button></header>
      {children}
    </section>
  </div>;
}

export function FormError({ message }: { message: string }) {
  return message ? <p className="workbench-error" role="alert">{message}</p> : null;
}
