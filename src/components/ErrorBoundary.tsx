import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Download } from 'lucide-react';
import { useStore } from '../state/store';
import { downloadBytes, baseName } from '../lib/utils/file';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  rescuing: boolean;
  rescued: 'idle' | 'ok' | 'fail';
}

/**
 * Catches any render-time crash below it so a single faulty element, NaN
 * coordinate or pdf.js hiccup can never white-screen the whole editor and take
 * the user's unsaved edits with it. The fallback lets the user *rescue* their
 * current work as a PDF (the edits still live in the store) before reloading —
 * lossless to the very last moment.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, rescuing: false, rescued: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('PDFWorld crashed:', error, info.componentStack);
  }

  private rescue = async (): Promise<void> => {
    const { buildExportBytes, fileName } = useStore.getState();
    this.setState({ rescuing: true, rescued: 'idle' });
    try {
      const bytes = await buildExportBytes();
      if (!bytes) {
        this.setState({ rescuing: false, rescued: 'fail' });
        return;
      }
      const name = `${baseName(fileName || 'pdfworld')}-rettung.pdf`;
      downloadBytes(bytes, name);
      this.setState({ rescuing: false, rescued: 'ok' });
    } catch {
      this.setState({ rescuing: false, rescued: 'fail' });
    }
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const hasWork = useStore.getState().pages.length > 0;
    const { rescuing, rescued } = this.state;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <AlertTriangle size={40} className="crash-icon" />
          <h1>Etwas ist schiefgelaufen</h1>
          <p>
            PDFWorld ist auf einen unerwarteten Fehler gestossen. Deine bisherigen
            Bearbeitungen sind noch im Speicher — du kannst sie als PDF retten,
            bevor du die App neu lädst.
          </p>
          {rescued === 'ok' && <p className="crash-hint ok">Gerettetes PDF wurde heruntergeladen.</p>}
          {rescued === 'fail' && <p className="crash-hint fail">Rettung fehlgeschlagen — bitte App neu laden.</p>}
          <div className="crash-actions">
            {hasWork && (
              <button className="btn" onClick={this.rescue} disabled={rescuing}>
                <Download size={16} />
                {rescuing ? 'Wird gerettet…' : 'Arbeit als PDF retten'}
              </button>
            )}
            <button className="btn primary" onClick={() => window.location.reload()}>
              <RotateCcw size={16} />
              App neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}
