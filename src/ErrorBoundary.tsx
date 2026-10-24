import { Component, type ErrorInfo, type ReactNode } from 'react'

// The last safety net. If anything in the app throws while drawing (a screen's code that could not be downloaded because the site was
// updated while this tab was open, say), the player gets a way out instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app stopped:', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="crash" role="alert">
        <h1>Galaxy Campaign</h1>
        <p>Something went wrong, or the site was updated while this page was open.</p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
