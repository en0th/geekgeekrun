const backgroundPages = new WeakSet()

export function useBackgroundTaskInput(page) { backgroundPages.add(page) }

// Ordinary clicks wait on IntersectionObserver and painted hit-test data. Both can stop
// updating when minimized. Invoke the attached, visible DOM control; detail IDs are still
// checked after every job-card click before saving or taking any further action.
export async function clickTaskElement(page, element) {
  if (!backgroundPages.has(page)) return element.click()
  await element.evaluate(node => {
    if (!node.isConnected || !node.getClientRects().length || typeof node.click !== 'function' ||
      node.disabled || node.getAttribute('aria-disabled') === 'true' ||
      getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden')
      throw new Error('Task control is not available')
    node.click()
  })
}

export async function hoverTaskElement(page, element) {
  if (!backgroundPages.has(page)) return element.hover()
  await element.scrollIntoView()
  const point = await element.clickablePoint()
  await page.mouse.move(point.x, point.y)
}
