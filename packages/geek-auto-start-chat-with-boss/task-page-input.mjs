const backgroundPages = new WeakSet()

export function useBackgroundTaskInput(page) { backgroundPages.add(page) }
export function isBackgroundTaskPage(page) { return backgroundPages.has(page) }

// Background clicks do not depend on IntersectionObserver or painted hit-test data.
// allowHidden is restricted to an identified filter option in its own mounted dropdown;
// the caller still verifies both selected state and actual page parameters afterwards.
export async function clickTaskElement(page, element, { allowHidden = false } = {}) {
  if (!backgroundPages.has(page)) return element.click()
  await element.evaluate((node, allowHidden) => {
    if (!node.isConnected || !node.getClientRects().length || typeof node.click !== 'function' ||
      node.disabled || node.getAttribute('aria-disabled') === 'true' ||
      getComputedStyle(node).display === 'none' || (!allowHidden && getComputedStyle(node).visibility === 'hidden'))
      throw new Error('Task control is not available')
    node.click()
  }, allowHidden)
}

export async function hoverTaskElement(page, element) {
  if (!backgroundPages.has(page)) return element.hover()
  await element.scrollIntoView()
  const point = await element.clickablePoint()
  await page.mouse.move(point.x, point.y)
}
