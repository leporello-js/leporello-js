import _ from 'https://unpkg.com/lodash-es'

async function getPopularLanguages() {
  const url = 'https://api.github.com/search/repositories?q=stars:%3E1&sort=stars'
  const resp = await fetch(url)
  const repos = await resp.json()
  return _(repos.items)
    .map(r => r.language)
    .filter(l => l != null)
    .countBy()
    .toPairs()
    .sortBy(([lang, useCount]) => useCount)
    .map(([lang]) => lang)
    .value()
}

await getPopularLanguages()
