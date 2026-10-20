import { clickTaskElement, hoverTaskElement } from './task-page-input.mjs'
// BOSS has used different numeric type codes. Select the visible label instead.
// This only improves recall: the detail-level hard check remains authoritative.
export async function applyJobNatureFilter(page, selected = []) {
  if (!selected.length) return true
  const label = selected.length === 1 ? selected[0] : '不限'
  let trigger, option
  try {
    const handle = await page.evaluateHandle(() => {
      const bar = document.querySelector('.page-jobs-main .filter-condition-inner')
      return bar?.__vue__?.$children?.find(child => child.placeholder === '求职类型')?.$el || null
    })
    trigger = handle.asElement()
    if (!trigger) { await handle.dispose(); return false }
    await hoverTaskElement(page, trigger)
    const findVisibleOption = (element, text) => [...element.querySelectorAll('li, a')].find(item =>
      item.textContent.trim() === text && item.getClientRects().length &&
      getComputedStyle(item).visibility !== 'hidden') || null
    const handleOption = await page.evaluateHandle(findVisibleOption, trigger, label)
    option = handleOption.asElement()
    if (!option) {
      await handleOption.dispose()
      await clickTaskElement(page, trigger)
      const visible = await page.waitForFunction(findVisibleOption, { timeout: 2000, polling: 100 }, trigger, label)
      option = visible.asElement()
      if (!option) { await visible.dispose(); return false }
    }
    const active = element => ['active', 'selected', 'is-selected', 'is-active', 'checked', 'is-checked'].some(name => element.classList.contains(name)) ||
      element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-checked') === 'true'
    const code = await option.evaluate(element => element.getAttribute('ka')?.match(/-(\d+)$/)?.[1] || null)
    if (!await option.evaluate(active)) await clickTaskElement(page, option)
    const applied = await page.waitForFunction((element, value) => {
      const selected = ['active', 'selected', 'is-selected', 'is-active', 'checked', 'is-checked'].some(name => element.classList.contains(name)) ||
        element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-checked') === 'true'
      const actual = document.querySelector('.page-jobs-main')?.__vue__?.formData?.jobType
      return selected || (value != null && actual != null &&
        (String(actual) === value || (value === '0' && actual === '')))
    }, { timeout: 2000, polling: 100 }, option, code)
    await applied.dispose()
    return true
  } catch (error) {
    console.debug('Job nature filter could not be verified:', label, String(error?.message || error).split('\n')[0])
    return false
  } finally {
    await option?.dispose().catch(() => {})
    await trigger?.dispose().catch(() => {})
    await page.mouse.move(0, 0).catch(() => {})
  }
}
