/**
 * Scrolls the page to its very end. The composer is sticky over the bottom of the thread, so
 * scrolling an end marker into view put the newest card under it (audit D1); at the page's real
 * end the thread's bottom padding keeps the last card clear of the composer.
 */
export function scrollToEnd(behavior: ScrollBehavior): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}
