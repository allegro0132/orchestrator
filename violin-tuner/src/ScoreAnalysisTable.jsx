import React from 'react';
import { noteName } from './pitch.js';

export default function ScoreAnalysisTable({ events, analysis, time, text }) {
  // A track/tempo change can render before its analysis reset effect runs.
  if (analysis.events !== events) return null;
  return (
    <div className="score-table-scroll">
      <table>
        <thead>
          <tr>
            {[
              text('小节', 'Bar'),
              text('音符', 'Note'),
              text('音准', 'Pitch'),
              text('覆盖', 'Coverage'),
              text('起音', 'Onset'),
            ].map((s) => (
              <th key={s}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events
            .filter((e) => e.midi !== null && e.end <= time && e.end > analysis.from)
            .map((e) => {
              const r = analysis.results[e.index];
              const note = noteName(e.midi);
              return (
                <tr key={e.index}>
                  <td>{e.bar}</td>
                  <td>
                    {note.name}
                    {note.octave}
                  </td>
                  <td>{r.samples ? `${Math.round((100 * r.accurate) / r.samples)}%` : '—'}</td>
                  <td>{Math.min(100, Math.round((100 * r.voicedSeconds) / (e.end - e.start)))}%</td>
                  <td>
                    {r.onset === null
                      ? text('未检测到', 'Not detected')
                      : `${Math.round(r.onset * 1000)} ms`}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
