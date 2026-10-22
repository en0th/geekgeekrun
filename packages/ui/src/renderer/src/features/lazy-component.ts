import { defineAsyncComponent, defineComponent, h, type AsyncComponentLoader, type Component } from 'vue'

// Keep the workspace shell usable while an infrequently used view is loading.
export function lazyComponent<T extends Component>(loader: AsyncComponentLoader<T>, label = '正在加载页面') {
  return defineAsyncComponent<T>({
    loader,
    suspensible: false,
    delay: 120,
    loadingComponent: defineComponent(() => () => h('div', { role: 'status', class: 'ggr-text-muted' }, label)),
    errorComponent: defineComponent(() => () => h('div', { role: 'alert', class: 'ggr-text-muted' }, [
      h('p', '此页面暂时无法打开，请重新加载后再试。'),
      h('button', { type: 'button', onClick: () => location.reload() }, '重新加载'),
    ])),
  })
}
