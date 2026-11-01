import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

/*
 * A disabled fieldset stops every native control inside it, but each shared
 * control draws its own colors inline, so it never learned it was stopped
 * and kept its enabled look (LOCKED-LOOK). `Held` is the fieldset and this
 * context together, and every shared control reads the context beside its
 * own `disabled`, so one flag gives the whole group the disabled look of
 * looks.ts.
 */
const HeldContext = createContext(false);

/** Whether a control is off: its own `disabled`, or a `Held` group around it. */
export function useHeld(own?: boolean): boolean {
  const held = useContext(HeldContext);
  return held || own === true;
}

/**
 * A group of controls that cannot act now, such as a save page whose outcome
 * is being checked. Nested groups stay held while any outer one is. The
 * fieldset draws no box of its own.
 */
export function Held(props: { held: boolean; children: ReactNode; style?: CSSProperties; "aria-busy"?: boolean }) {
  const outer = useContext(HeldContext);
  return (
    <fieldset disabled={props.held} aria-busy={props["aria-busy"]} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, ...props.style }}>
      <HeldContext.Provider value={outer || props.held}>{props.children}</HeldContext.Provider>
    </fieldset>
  );
}

/**
 * Ends a held group at a real portal's edge, as RowHintScope ends a row's
 * hint. A Dialog is the one portal a held group opens: its controls leave
 * the fieldset's DOM and still act, so they must look it. The app's other
 * portals render outside every held group. A Popover and a Sheet render in
 * place, so their controls stay inside the fieldset, natively off, and keep
 * the held look.
 */
export function HeldScope(props: { children: ReactNode }) {
  return <HeldContext.Provider value={false}>{props.children}</HeldContext.Provider>;
}
