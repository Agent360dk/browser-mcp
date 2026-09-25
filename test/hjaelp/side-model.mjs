/**
 * Build the small DOM surface used by expression-level tests.
 *
 * The element is supplied by the caller so a test can install instance
 * descriptors (for example, a controlled component's rolling-back `value`
 * setter) before this helper adds the shared page plumbing.
 */
export function lavSide({ element, bodyText = () => '' }) {
  const kasse = { x: 0, y: 0, width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 };
  const readBodyText = typeof bodyText === 'function' ? bodyText : () => bodyText;

  Object.assign(element, {
    tagName: 'SELECT',
    form: null,
    options: [{ value: 'a', text: 'Alfa' }, { value: 'b', text: 'Beta' }],
    getBoundingClientRect: () => kasse,
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {}, focus() {}, blur() {},
    isConnected: true,
    offsetHeight: 24,
    checkVisibility: () => true,
  });

  const document = {
    querySelector: () => element,
    querySelectorAll: () => [],
    elementFromPoint: () => element,
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    activeElement: element,
    body: { get innerText() { return readBodyText(); }, contains: () => true },
    documentElement: { scrollTop: 0, scrollLeft: 0, clientWidth: 1280, clientHeight: 800 },
  };
  class Ev { constructor(type) { this.type = type; } }

  return {
    document,
    Ev,
    window: { scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 800 },
    getComputedStyle: () => ({
      visibility: 'visible', display: 'block', opacity: '1', pointerEvents: 'auto',
    }),
  };
}
