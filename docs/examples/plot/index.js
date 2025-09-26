import _ from "lodash-es"

const url = "https://api.github.com/search/repositories?q=stars:%3E1&sort=stars"
const resp = await fetch(url)
const repos = await resp.json()
const langs = _(repos.items)
  .map(r => r.language)
  .filter(l => l != null)
  .countBy()
  .toPairs()
  .map(([language, count]) => ({ language, count }))
  .value()

import { barY } from "@observablehq/plot"

/*
  Move the cursor to the following line and see the plot displayed alongside
  the code. Use the @dom pragma to display DOM content inline
*/

// @dom
barY(langs, {
  x: "language",
  y: "count",
  sort: { x: "y", reverse: true },
  fill: "purple",
}).plot()
