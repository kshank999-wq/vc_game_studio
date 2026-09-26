import type { Report } from '../../model/reports';

/**
 * A production report, laid out as a document to read or print (spec §20).
 * Print prints only the report; the system print dialog saves it as a PDF.
 */
export const ReportPreview = ({ report, projectName, onClose }: { report: Report; projectName: string; onClose: () => void }) => (
  <div className="report-backdrop" role="dialog" aria-modal="true" aria-label={report.title} onPointerDown={onClose}>
    <div className="report-frame" onPointerDown={(e) => e.stopPropagation()}>
      <div className="report-bar">
        <span className="lbl">Preview</span>
        <span className="report-bar-title">{report.title}</span>
        <div className="grow" />
        <button className="tb-btn small" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button className="icon-btn small" aria-label="Close preview" onClick={onClose}>
          ×
        </button>
      </div>
      <article className="report">
        <header className="report-head">
          <span className="report-project">{projectName}</span>
          <h1>{report.title}</h1>
          <span className="report-date">{new Date().toLocaleDateString([], { dateStyle: 'long' })}</span>
        </header>
        {report.blocks.map((block, i) => {
          switch (block.kind) {
            case 'h2':
              return (
                <h2 key={i}>
                  {block.text}
                  {block.note && <span className="report-note">{block.note}</span>}
                </h2>
              );
            case 'p':
              return <p key={i}>{block.text}</p>;
            case 'kv':
              return block.rows.length ? (
                <dl key={i}>
                  {block.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null;
            case 'table':
              return block.rows.length ? (
                <table key={i}>
                  <thead>
                    <tr>
                      {block.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((cell, k) => (
                          <td key={k}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null;
          }
        })}
      </article>
    </div>
  </div>
);
