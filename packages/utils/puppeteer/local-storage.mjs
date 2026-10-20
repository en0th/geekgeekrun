export const setDomainLocalStorage = async (browser, url, kv, { page: providedPage } = {}) => {
  const page = providedPage || await browser.newPage();
  const respond = r => {
    void r.respond({
      status: 200,
      contentType: 'text/plain',
      body: ':)',
    }).catch(() => {});
  };
  try {
    await page.setRequestInterception(true);
    page.on('request', respond);
    await page.goto(url);
    await page.evaluate(kv => {
      Object.keys(kv || {}).forEach(k => {
        localStorage.setItem(k, kv[k]);
      })
    }, kv);
  } finally {
    page.off('request', respond);
    if (providedPage) await page.setRequestInterception(false);
    else await page.close();
  }
};
