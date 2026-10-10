import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "./ui";
import { Logo } from "./Logo";

export class AppErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Groundwork view failed", error, info.componentStack); }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) { if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center"><Logo /><div className="gw-spatial-mark mt-8" aria-hidden="true"><div className="gw-spatial-stack"><i /><i /><i /></div></div><p className="gw-kicker">Let’s get you back to your work</p><h1 className="mt-4 text-3xl font-medium tracking-tight">This view couldn’t be opened.</h1><p className="mt-3 max-w-sm text-sm leading-7 text-slate-400">Reload this view, or head back to your projects to continue.</p><div className="mt-6 flex gap-3"><Button onClick={() => window.location.reload()}>Reload view</Button><Link className="gw-link-button gw-button-outline" to="/dashboard">Your projects ↗</Link></div></main>;
  }
}
