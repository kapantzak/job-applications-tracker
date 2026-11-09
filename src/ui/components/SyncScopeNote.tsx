import { Link } from 'react-router-dom';
import { normalizeMailFilter } from '../../server/domain/mail-filter.js';
import { useCurrentProfile, useProfileHref } from '../profile-route.js';

// What "Sync from Gmail" searches (SOW-0032, decision 3). Placed in PageHeader actions after the buttons;
// `basis-full` puts it on its own line under them.
export function SyncScopeNote() {
  const profile = useCurrentProfile();
  const href = useProfileHref();
  const scope = normalizeMailFilter(profile.mail_filter);

  let text;
  if (scope === '') text = 'Sync searches by company and job-board senders.';
  else if (profile.mail_filter_kind === 'label') {
    text = (
      <>
        Sync searches Gmail label <span className="font-medium break-all text-foreground">{scope}</span>.
      </>
    );
  } else {
    text = (
      <>
        Sync searches Gmail for <span className="font-medium break-all text-foreground">{scope}</span>.
      </>
    );
  }

  return (
    <p className="basis-full text-right text-xs text-muted-foreground">
      {text}{' '}
      <Link to={href('/profile')} className="underline underline-offset-4">
        Change
      </Link>
    </p>
  );
}
