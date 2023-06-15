import { VisibilityFilters } from '../actions/index.js'

const visibilityFilter = (state = VisibilityFilters.SHOW_ALL, action) => {
  if(action.type == 'SET_VISIBILITY_FILTER') {
    return action.filter
  } else {
    return state
  }
}

export default visibilityFilter
