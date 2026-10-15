import { useEffect, useRef, useState } from 'react';
import { attachTake, AUDIO_ACCEPT, detachTake, getAudio, isAudioFile, storeTake, takeSummary } from '../../model/audio-takes';
import type { Project } from '../../model/types';

/** One take plays at a time, wherever it was started. */
let playing: { audio: HTMLAudioElement; url: string; stop: () => void } | null = null;
const stopPlaying = () => {
  if (!playing) return;
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing.stop();
  playing = null;
};

/**
 * A line's recorded take: upload the audio (or drop it here) and the line is
 * marked recorded; play it back, replace it, or take it off. Where the
 * project came from another computer, the line knows it was recorded but the
 * audio has to be uploaded again here.
 */
export const TakeControl = ({ project, lineId, onCommit, compact = false }: { project: Project; lineId: string; onCommit: (p: Project) => void; compact?: boolean }) => {
  const line = project.lines.find((l) => l.id === lineId);
  const latest = useRef(project);
  latest.current = project;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [here, setHere] = useState<boolean | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [over, setOver] = useState(false);
  const take = line?.take;

  useEffect(() => {
    let live = true;
    setHere(null);
    if (take) void getAudio(take.id).then((b) => live && setHere(!!b));
    return () => {
      live = false;
    };
  }, [take?.id]);
  useEffect(() => () => void (isPlaying && stopPlaying()), [isPlaying]);

  if (!line || line.kind !== 'dialogue') return null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!isAudioFile(file)) {
      setError(`${file.name} isn’t an audio file.`);
      return;
    }
    setBusy(true);
    try {
      const stored = await storeTake(file);
      onCommit(attachTake(latest.current, lineId, stored));
      setHere(true);
    } catch {
      setError('This computer wouldn’t keep the audio (it may be out of room).');
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    if (isPlaying) return stopPlaying();
    if (!take) return;
    const blob = await getAudio(take.id);
    if (!blob) return setHere(false);
    stopPlaying();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    playing = { audio, url, stop: () => setIsPlaying(false) };
    audio.onended = () => stopPlaying();
    setIsPlaying(true);
    const refused = () => {
      stopPlaying();
      setError('This browser can’t play that file.');
    };
    try {
      void audio.play()?.catch(refused);
    } catch {
      refused();
    }
  };

  const who = line.text.trim().slice(0, 40) || 'this line';
  return (
    <div
      className={`take${compact ? ' compact' : ''}${over ? ' over' : ''}${take ? ' has' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void upload(e.dataTransfer.files[0]);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        aria-label={`Audio file for “${who}”`}
        onChange={(e) => {
          void upload(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      {take ? (
        <>
          <button type="button" className="icon-btn small take-play" aria-label={isPlaying ? 'Stop' : `Play the take for “${who}”`} disabled={here === false} onClick={() => void play()}>
            {isPlaying ? '■' : '▶'}
          </button>
          {!compact && (
            <span className="take-name" title={take.name}>
              {take.name}
            </span>
          )}
          <span className="take-meta">{here === false ? 'audio not on this computer' : takeSummary(take)}</span>
          <button type="button" className="tb-btn small" disabled={busy} onClick={() => input.current?.click()} title="Upload a different take">
            {here === false ? 'Upload again' : compact ? '↻' : 'Replace'}
          </button>
          <button type="button" className="icon-btn small" aria-label={`Remove the take for “${who}”`} title="Take it off (the line goes back to be recorded)" onClick={() => onCommit(detachTake(latest.current, lineId))}>
            ×
          </button>
        </>
      ) : (
        <button type="button" className="tb-btn small take-up" disabled={busy || line.vo === 'none'} onClick={() => input.current?.click()} title={line.vo === 'none' ? 'This line has no VO' : 'Upload the recorded take (or drop an audio file here); the line is marked recorded'}>
          {busy ? 'Uploading…' : compact ? '🎙 Add take' : '🎙 Upload take…'}
        </button>
      )}
      {error && (
        <span className="take-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
};
