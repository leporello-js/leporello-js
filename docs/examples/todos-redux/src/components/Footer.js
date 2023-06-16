import FilterLink from '../containers/FilterLink.js'
import { VisibilityFilters } from '../actions/index.js'

const h = React.createElement

const Footer = () => (
  h('div', null,
    h('span', null, 'Show: '),
    h(FilterLink, {filter: VisibilityFilters.SHOW_ALL}, 'All'),
    h(FilterLink, {filter: VisibilityFilters.SHOW_ACTIVE}, 'Active'),
    h(FilterLink, {filter: VisibilityFilters.SHOW_COMPLETED}, 'Completed'),
  )
)

export default Footer
