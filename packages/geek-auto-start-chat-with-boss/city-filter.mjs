import { clickTaskElement } from './task-page-input.mjs'
// 全国 is a search scope, never a literal job city. Used by execution and preview.
export function normalizeCitySelection(cities) {
  const values = [...new Set((Array.isArray(cities) ? cities : [])
    .filter(city => typeof city === 'string').map(city => city.trim()).filter(Boolean))]
  return values.includes('全国') ? [] : values
}

export function matchesCitySelection(cities, actualCity) {
  const selected = normalizeCitySelection(cities)
  return !selected.length || selected.includes(actualCity)
}

const cityTriggerSelector = '.page-jobs-main .filter-condition-inner [ka="switch_city_dialog_open"]'

// This function runs in the page. No server or undocumented Vue method is called.
function cityStateMatches(selector, requested, expectedCode) {
  const trigger = document.querySelector(selector)
  if (!trigger) return false
  const text = trigger.textContent.trim()
  const code = trigger.getAttribute('data-city-code') || trigger.getAttribute('data-code') ||
    document.querySelector('.page-jobs-main')?.__vue__?.formData?.city
  // When the page exposes its search parameters, a changed label alone is not proof.
  if (requested && expectedCode && code != null && String(code) !== '' && String(code) !== String(expectedCode)) return false
  if (requested === '全国') return text === '全国' || String(code) === '100010000'
  if (requested) return text === requested
  return text === '全国' || String(code) === '100010000' ||
    (!trigger.classList.contains('active') && ['城市', '不限', ''].includes(text))
}

function visibleCityOption(cityName, alphabet = false) {
  const selector = alphabet
    ? '.city-select-dialog .city-char-list li'
    : '.city-select-dialog .city-select-wrapper li, .city-select-dialog .city-select-wrapper a, .city-select-dialog .city-select-wrapper button'
  return [...document.querySelectorAll(selector)].find(element =>
    element.textContent.trim() === cityName && element.getClientRects().length &&
    getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none') || null
}

export async function applyCityFilter(page, cities = [], { cityCatalog = [], timeoutMs = 10000 } = {}) {
  const requested = cities[0] || ''
  const expectedCode = requested === '全国' ? 100010000 : cityCatalog.find(city => city.name === requested)?.code
  let trigger, option, alphabetEntry
  try {
    if (await page.evaluate(cityStateMatches, cityTriggerSelector, requested, expectedCode)) return
    trigger = await page.$(cityTriggerSelector)
    if (!trigger) throw new Error('city control missing')
    if (!requested) {
      const clear = await page.$('.page-jobs-main .filter-condition-inner [ka="empty-filter"]')
      if (!clear) throw new Error('city clear control missing')
      try { await clickTaskElement(page, clear) } finally { await clear.dispose() }
    } else {
      await clickTaskElement(page, trigger)
      const visible = await page.waitForFunction(() => {
        const dialog = document.querySelector('.city-select-dialog')
        return dialog?.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden'
      }, { timeout: timeoutMs, polling: 100 })
      await visible.dispose()
      const handle = await page.evaluateHandle(visibleCityOption, requested)
      option = handle.asElement()
      if (!option) {
        await handle.dispose()
        const firstChar = cityCatalog.find(city => city.name === requested)?.firstChar?.toUpperCase()
        if (!firstChar) throw new Error('city not in catalog')
        const letterHandle = await page.evaluateHandle(visibleCityOption, firstChar, true)
        alphabetEntry = letterHandle.asElement()
        if (!alphabetEntry) { await letterHandle.dispose(); throw new Error('city alphabet missing') }
        await clickTaskElement(page, alphabetEntry)
        // Non-hot cities can be rendered asynchronously after changing the letter.
        const loaded = await page.waitForFunction(visibleCityOption, { timeout: timeoutMs, polling: 100 }, requested)
        option = loaded.asElement()
        if (!option) { await loaded.dispose(); throw new Error('city option missing') }
      }
      await clickTaskElement(page, option)
    }
    const applied = await page.waitForFunction(cityStateMatches, { timeout: timeoutMs, polling: 100 }, cityTriggerSelector, requested, expectedCode)
    await applied.dispose()
  } catch (cause) {
    const error = new Error('AUTO_CHAT_CITY_FILTER_NOT_APPLIED', { cause })
    error.detail = `城市筛选未能确认（${requested || '不限'}），请检查BOSS城市选择器后恢复任务`
    throw error
  } finally {
    await option?.dispose().catch(() => {})
    await alphabetEntry?.dispose().catch(() => {})
    await trigger?.dispose().catch(() => {})
  }
}
