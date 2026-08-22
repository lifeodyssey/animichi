/**
 * The lead bubble breaks its greeting across bold runs, so Testing Library's
 * text matcher (which reads only an element's direct text nodes) can never see
 * the whole sentence. This matches the bubble by its assembled text instead.
 */
export function leadBubbleWith(greeting: string) {
  return (_text: string, element: Element | null): boolean =>
    element?.classList.contains("chat-cold-start__lead") === true
    && element.textContent === greeting;
}
