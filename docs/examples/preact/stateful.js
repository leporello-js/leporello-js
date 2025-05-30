import { Component } from "preact"

export const Stateful = ({ getInitialState, handlers, render }) => {
  return class extends Component {
    constructor() {
      super()
      this.compState = getInitialState()
      this.handlers = Object.fromEntries(
        Object.entries(handlers).map(([name, h]) => [
          name,
          this.makeHandler(h),
        ]),
      )
    }

    makeHandler(h) {
      return (...args) => {
        this.compState = h(this.compState, ...args)
        this.forceUpdate()
      }
    }

    render() {
      return render(this.props, this.compState, this.handlers)
    }
  }
}
