import { setVisibilityFilter } from '../actions/index.js'
import Link from '../components/Link.js'

const mapStateToProps = (state, ownProps) => ({
  active: ownProps.filter === state.visibilityFilter
})

const mapDispatchToProps = (dispatch, ownProps) => ({
  onClick: () => dispatch(setVisibilityFilter(ownProps.filter))
})

export default ReactRedux.connect(
  mapStateToProps,
  mapDispatchToProps
)(Link)
