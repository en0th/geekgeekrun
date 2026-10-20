import { clickTaskElement, hoverTaskElement, isBackgroundTaskPage } from './task-page-input.mjs'
import { sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'

const fields = [
  { key: 'salaryList', field: 'salary', label: '薪资待遇', prefix: 'sel-job-rec-salary-' },
  { key: 'experienceList', field: 'experience', label: '工作经验', prefix: 'sel-job-rec-exp-' },
  { key: 'degreeList', field: 'degree', label: '学历要求', prefix: 'sel-job-rec-degree-' },
  { key: 'industryList', field: 'industry', label: '公司行业', prefix: 'sel-industry-' },
  { key: 'scaleList', field: 'scale', label: '公司规模', prefix: 'sel-job-rec-scale-' },
]
const normalized = value => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(','))
  .map(String).map(value => value.trim()).filter(value => value && value !== '0'))].sort()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const labelKey = value => String(value).normalize('NFKC').replace(/\s/g, '').replace(/[–—－~～至]/g, '-').toLowerCase()
const labelsMatch = (actual, expected, spec) => {
  const normalize = value => spec.field === 'experience' && ['在校生', '应届生', '在校/应届', '在校生/应届生'].includes(value)
    ? '在校/应届' : labelKey(value)
  return normalize(actual) === normalize(expected)
}

// Runs in the page; read the actual rendered control and bound search parameters.
function inspectFilter(spec) {
  const bar = document.querySelector('.page-jobs-main .filter-condition-inner')
  const control = bar?.__vue__?.$children?.find(child => child.placeholder === spec.label)?.$el
  const form = document.querySelector('.page-jobs-main')?.__vue__?.formData
  const options = [...(control?.querySelectorAll('[ka^="' + spec.prefix + '"]') || [])].map(node => ({
    ka: node.getAttribute('ka'), label: node.textContent.trim(),
    active: ['active', 'selected', 'is-selected', 'is-active', 'checked', 'is-checked'].some(key => node.classList.contains(key)) ||
      node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-checked') === 'true',
    visible: !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none',
    mounted: !!node.getClientRects().length && getComputedStyle(node).display !== 'none',
  }))
  return { hasControl: !!control, hasForm: !!form, hasScope: !!form && form[spec.field] !== undefined,
    scope: form?.[spec.field], options,
    urlScope: new URL(location.href).searchParams.get(spec.field),
    availableOptions: [...(control?.querySelectorAll('li, a, button, [ka]') || [])].slice(0, 40).map(node => ({
      label: node.textContent.trim().slice(0, 100), ka: node.getAttribute('ka'),
      visible: !!node.getClientRects().length, classes: node.classList?.value || '',
    })) }
}

function selectedCodes(state, spec, choices) {
  return normalized(state.options.filter(option => option.active && option.label !== '不限').map(option => {
    if (spec.field !== 'industry') {
      const code = option.ka.slice(spec.prefix.length)
      const expected = choices.find(choice => String(choice.code) === code)
      return expected && labelsMatch(option.label, expected.name, spec) ? code : 'unknown:' + option.label
    }
    // Industry ka values are UI indexes, not industry codes. Resolve by the visible name.
    return choices.find(choice => labelKey(choice.name) === labelKey(option.label))?.code ?? 'unknown:' + option.label
  }))
}
function confirmed(state, wanted, spec, choices) {
  // Some job types omit inapplicable controls (e.g. a monthly salary picker for hourly
  // jobs). Absence is only unrestricted when nothing was requested and no old value exists.
  if (!wanted.length && state.hasForm && !state.hasScope && !normalized(state.urlScope).length &&
    !selectedCodes(state, spec, choices).length) return true
  return state.hasControl && state.hasScope && same(normalized(state.scope), wanted) && same(selectedCodes(state, spec, choices), wanted)
}

async function applyOne(page, spec, values, { choices, timeoutMs, checkResponses }) {
  const wanted = normalized(values)
  if (wanted.some(code => !choices.some(choice => String(choice.code) === code)))
    throw new Error('unknown configured option')
  let state = await page.evaluate(inspectFilter, spec), trigger
  const changed = !confirmed(state, wanted, spec, choices)
  const background = isBackgroundTaskPage(page)
  const choose = predicate => {
    const candidates = state.options.filter(predicate)
    return candidates.find(option => option.visible) ||
      (background && candidates.filter(option => option.mounted).length === 1
        ? candidates.find(option => option.mounted) : null)
  }
  const read = () => page.evaluate(inspectFilter, spec)
  const clickOption = async option => {
    const handle = await page.evaluateHandle((spec, ka, background) => {
      const control = document.querySelector('.page-jobs-main .filter-condition-inner')?.__vue__?.$children
        ?.find(child => child.placeholder === spec.label)?.$el
      const candidates = [...(control?.querySelectorAll('[ka^="' + spec.prefix + '"]') || [])].filter(node =>
        node.getAttribute('ka') === ka && node.getClientRects().length && getComputedStyle(node).display !== 'none')
      return candidates.find(node => getComputedStyle(node).visibility !== 'hidden') ||
        (background && candidates.length === 1 ? candidates[0] : null)
    }, spec, option.ka, background)
    try {
      const element = handle.asElement()
      if (!element) throw new Error('visible option is missing')
      await checkResponses()
      await clickTaskElement(page, element, { allowHidden: background })
    } finally { await handle.dispose() }
  }
  try {
    if (changed) {
      const handle = await page.evaluateHandle(spec =>
        document.querySelector('.page-jobs-main .filter-condition-inner')?.__vue__?.$children
          ?.find(child => child.placeholder === spec.label)?.$el || null, spec)
      trigger = handle
      const element = handle.asElement()
      if (!element) throw new Error('filter control is missing')
      if (!background || !state.options.some(option => option.mounted)) {
        await hoverTaskElement(page, element)
        state = await read()
      }
      if (!state.options.some(option => option.visible || (background && option.mounted))) {
        await clickTaskElement(page, element)
        const visible = await page.waitForFunction(spec => {
          const control = document.querySelector('.page-jobs-main .filter-condition-inner')?.__vue__?.$children
            ?.find(child => child.placeholder === spec.label)?.$el
          return [...(control?.querySelectorAll('[ka^="' + spec.prefix + '"]') || [])].some(node =>
            node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
        }, { timeout: timeoutMs, polling: 100 }, spec)
        await visible.dispose()
        state = await read()
      }
      if (!wanted.length && spec.field !== 'industry') {
        const unlimited = choose(option => option.label === '不限' || option.ka === spec.prefix + '0')
        if (!unlimited) throw new Error('unlimited option is missing')
        await clickOption(unlimited)
      } else {
        if (spec.field !== 'salary') {
          for (const active of state.options.filter(option => option.active && option.label !== '不限')) {
            const code = spec.field === 'industry'
              ? choices.find(choice => labelKey(choice.name) === labelKey(active.label))?.code
              : active.ka.slice(spec.prefix.length)
            if (!wanted.includes(String(code))) await clickOption(active)
          }
        }
        for (const code of wanted) {
          state = await read()
          const name = choices.find(choice => String(choice.code) === code)?.name
          const option = choose(option => spec.field === 'industry'
            ? labelKey(option.label) === labelKey(name) : option.ka === spec.prefix + code && labelsMatch(option.label, name, spec))
          if (!option) throw new Error('configured option is missing')
          if (!option.active) await clickOption(option)
        }
      }
      const deadline = Date.now() + timeoutMs
      while (true) {
        await checkResponses()
        state = await read()
        if (confirmed(state, wanted, spec, choices)) break
        if (Date.now() >= deadline) throw new Error('selected options and page parameters do not agree')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    return { field: spec.field, label: spec.label, requested: wanted,
      selected: selectedCodes(state, spec, choices), actual: normalized(state.scope), unavailable: !state.hasControl || !state.hasScope, changed }
  } catch (cause) {
    const observed = await read().catch(() => state)
    throw Object.assign(cause, { filterState: observed })
  } finally {
    await trigger?.dispose().catch(() => {})
    if (!background) await page.mouse.move(0, 0).catch(() => {})
  }
}

export async function applyPageFilters(page, selected = {}, { catalogs, timeoutMs = 3000,
  checkResponses = async () => {}, onApplied = () => {}, onFailure = () => {}, settle = () => sleepWithRandomDelay(500) } = {}) {
  const result = []
  const stop = (spec, cause) => {
    try { onFailure({ field: spec.field, requested: normalized(selected[spec.key]), observed: cause.filterState, cause: cause.message }) } catch {}
    throw Object.assign(new Error('AUTO_CHAT_PAGE_FILTER_NOT_APPLIED', { cause }), {
      detail: `${spec.label}筛选未能确认，任务已暂停；请检查BOSS页面筛选后恢复。`, field: spec.field,
    })
  }
  for (const spec of fields) {
    try {
      await checkResponses()
      const applied = await applyOne(page, spec, selected[spec.key] || [], {
        choices: catalogs?.[spec.key] || [], timeoutMs, checkResponses,
      })
      result.push(applied)
      if (applied.changed) await settle()
    } catch (cause) {
      await checkResponses()
      stop(spec, cause)
    }
  }
  // Later controls can reset earlier ones. Confirm the complete combination again
  // before reporting success or allowing any job to be processed.
  for (const [index, spec] of fields.entries()) {
    try {
      await checkResponses()
      const state = await page.evaluate(inspectFilter, spec)
      const wanted = normalized(selected[spec.key]), choices = catalogs?.[spec.key] || []
      if (!confirmed(state, wanted, spec, choices))
        throw Object.assign(new Error('filter combination changed during application'), { filterState: state })
      Object.assign(result[index], { selected: selectedCodes(state, spec, choices), actual: normalized(state.scope) })
    } catch (cause) {
      await checkResponses()
      stop(spec, cause)
    }
  }
  onApplied(result)
  return result
}
