import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * What a component returns for `props`, read as an element tree so a test
 * can call its handlers as a tap would. The component runs inside a render,
 * so its hooks work (a plain call has no dispatcher and throws).
 * `around` wraps that render, such as in a held group (Held.tsx).
 */
export function drawn<P>(component: (props: P) => ReactNode, props: P, around?: (child: ReactElement) => ReactElement): ReactElement {
  let tree: ReactNode = null;
  function Probe() {
    tree = component(props);
    return null;
  }
  const probe = createElement(Probe);
  renderToStaticMarkup(around ? around(probe) : probe);
  return tree as unknown as ReactElement;
}
