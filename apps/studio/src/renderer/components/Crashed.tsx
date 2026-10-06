import { Component, type ReactNode } from 'react';

/**
 * If the app itself breaks while drawing, show this instead of a blank
 * window. Your work is safe: the file you saved, and the working copy the app
 * keeps as you edit (it is what reloading brings back). A copy of that
 * working copy can be downloaded here too.
 */
export class Crashed extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  private download = () => {
    const copy = globalThis.localStorage?.getItem('vcgs.project.v1');
    if (!copy) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([copy], { type: 'application/json' }));
    a.download = 'Recovered.vcgs';
    a.click();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="window-waiting" role="alert">
        <span>Something went wrong in VC Game Studio.</span>
        <span>Your saved file and your latest changes are kept. Reload to carry on.</span>
        <span>
          <button type="button" className="tb-btn primary" onClick={() => location.reload()}>
            Reload
          </button>{' '}
          <button type="button" className="tb-btn" onClick={this.download}>
            Download a copy of your work
          </button>
        </span>
        <small>{this.state.error.message}</small>
      </div>
    );
  }
}
