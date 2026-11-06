import { useEffect, useState } from 'react';
import {
  acceptProposal,
  listProposals,
  rejectProposal,
  type ProposalWithApplication,
} from '../api/client.js';
import { formatTime } from '../format.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ReviewPage() {
  const [proposals, setProposals] = useState<ProposalWithApplication[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProposals()
      .then((list) => {
        if (active) setProposals(list);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const decide = async (id: string, action: (id: string) => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action(id);
      setProposals((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  if (!proposals) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  return (
    <section>
      <h1>Review</h1>
      {error && <p role="alert">{error}</p>}
      {proposals.length === 0 && <p>Nothing to review</p>}
      {proposals.map((p) => (
        <article key={p.id} className="card">
          <h2>
            {p.application ? `${p.application.company} - ${p.application.role}` : 'Unknown application'}
          </h2>
          <p>
            {p.application?.status ?? 'unknown'} → {p.proposed_status} ({Math.round(p.confidence * 100)}%)
          </p>
          <p>{p.reason}</p>
          <blockquote>
            <p>From: {p.evidence.from}</p>
            <p>Date: {formatTime(p.evidence.date)}</p>
            <p>Subject: {p.evidence.subject}</p>
            <p>{p.evidence.snippet}</p>
            <a
              href={`https://mail.google.com/mail/#all/${encodeURIComponent(p.evidence.message_id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Gmail
            </a>
          </blockquote>
          <button type="button" disabled={busy === p.id} onClick={() => decide(p.id, acceptProposal)}>
            Accept
          </button>{' '}
          <button
            type="button"
            className="secondary"
            disabled={busy === p.id}
            onClick={() => decide(p.id, rejectProposal)}
          >
            Reject
          </button>
        </article>
      ))}
    </section>
  );
}
