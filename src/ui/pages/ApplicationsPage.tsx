import { useEffect, useMemo, useState } from 'react';
import { ExternalLinkIcon, MailIcon, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Application, ApplicationStatus } from '../../server/domain/types.js';
import { listApplications, setApplicationStatus, startSync, type ApplicationDetail } from '../api/client.js';
import { APPLICATION_COLUMNS, applicationViewKey } from '../application-view.js';
import { AddApplicationForm } from '../components/AddApplicationForm.js';
import { ErrorAlert, LoadingState, SuccessMessage } from '../components/feedback.js';
import { InfoTip } from '../components/InfoTip.js';
import { MergeApplicationsDialog } from '../components/MergeApplicationsDialog.js';
import { PageHeader } from '../components/PageHeader.js';
import { SyncScopeNote } from '../components/SyncScopeNote.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { NoMatches, SortableHead, TableToolbar } from '../components/TableView.js';
import { formatTime } from '../format.js';
import { FIELD_HELP } from '../help-text.js';
import { useListLinkState, useSharedTableView } from '../hooks/use-table-view.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Stored URLs are untrusted; never render javascript: and friends as links.
const isHttp = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

const NO_APPS: Application[] = [];

export function ApplicationsPage() {
  const profileId = useProfileId();
  const href = useProfileHref();
  const navigate = useNavigate();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rows ticked for a merge (SOW-0055); only rows the filters show count.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<string | null>(null);
  // Shared with the Dashboard and saved per profile (SOW-0054).
  const view = useSharedTableView(APPLICATION_COLUMNS, apps ?? NO_APPS, applicationViewKey(profileId));
  const linkState = useListLinkState();
  const chosen = useMemo(() => view.visible.filter((a) => selected.has(a.id)), [view.visible, selected]);

  // A row the filters hide leaves the selection, so a merge never includes rows the user cannot see.
  useEffect(() => {
    if (chosen.length !== selected.size) setSelected(new Set(chosen.map((a) => a.id)));
  }, [chosen, selected]);

  const toggle = (id: string, on: boolean) => {
    // A new selection starts a new merge; the last one's message no longer applies.
    setMerged(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onMerged = (kept: ApplicationDetail, removedIds: string[]) => {
    const { history: _history, aliases: _aliases, ...app } = kept;
    const removed = new Set(removedIds);
    setApps((prev) => prev?.filter((a) => !removed.has(a.id)).map((a) => (a.id === app.id ? app : a)) ?? null);
    setSelected(new Set());
    setMerging(false);
    setMerged(`Merged ${removedIds.length + 1} applications into ${app.company} - ${app.role}.`);
  };

  useEffect(() => {
    let active = true;
    listApplications(profileId)
      .then((list) => {
        if (active) setApps(list);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  const changeStatus = async (id: string, next: ApplicationStatus) => {
    setBusyId(id);
    setError(null);
    try {
      const updated = await setApplicationStatus(profileId, id, next);
      setApps((prev) => prev?.map((a) => (a.id === id ? updated : a)) ?? null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const run = await startSync(profileId);
      navigate(href(`/runs/${run.id}`));
    } catch (e) {
      setError(message(e));
      setSyncing(false);
    }
  };

  const onCreated = (created: Application) => {
    setApps((prev) => [created, ...(prev ?? [])]);
    setAdding(false);
  };

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Every application you are tracking. Gmail sync proposes status changes and new applications for review."
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" disabled={syncing} onClick={sync}>
                <MailIcon />
                Sync from Gmail
              </Button>
              <InfoTip topic="Sync from Gmail" text={FIELD_HELP.syncFromGmail} />
            </div>
            <Sheet open={adding} onOpenChange={setAdding}>
              <SheetTrigger asChild>
                <Button type="button">
                  <PlusIcon />
                  Add application
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Add application</SheetTitle>
                  <SheetDescription>Track an application you made outside of discovery.</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">
                  <AddApplicationForm profileId={profileId} onCreated={onCreated} />
                </div>
              </SheetContent>
            </Sheet>
            <SyncScopeNote />
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!apps ? (
          !error && <LoadingState />
        ) : apps.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No applications yet</EmptyTitle>
              <EmptyDescription>Save or mark a job applied, or add one by hand.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <TableToolbar view={view} noun="applications" />
            {merged && <SuccessMessage>{merged}</SuccessMessage>}
            {/* Always mounted, so screen readers announce the count as it changes. */}
            <div className={chosen.length > 0 ? 'flex items-center gap-2 text-sm' : 'sr-only'}>
              <span role="status">{chosen.length > 0 ? `${chosen.length} selected` : ''}</span>
              {chosen.length > 0 && (
                <>
                  <Button type="button" size="sm" disabled={chosen.length < 2} onClick={() => setMerging(true)}>
                    Merge
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </Button>
                </>
              )}
            </div>
            <MergeApplicationsDialog
              profileId={profileId}
              applications={chosen}
              open={merging}
              onOpenChange={setMerging}
              onMerged={onMerged}
            />
            {view.visible.length === 0 ? (
              <NoMatches onClear={view.reset} />
            ) : (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4">
                        <span className="sr-only">Select</span>
                      </TableHead>
                      <SortableHead view={view} id="company">
                        Company
                      </SortableHead>
                      <SortableHead view={view} id="role">
                        Role
                      </SortableHead>
                      <SortableHead view={view} id="status">
                        Status
                      </SortableHead>
                      <SortableHead view={view} id="applied">
                        Applied
                      </SortableHead>
                      <TableHead className="pr-4">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.visible.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-4">
                          <Checkbox
                            aria-label={`Select ${a.company} - ${a.role}`}
                            checked={selected.has(a.id)}
                            onCheckedChange={(on) => toggle(a.id, on === true)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{a.company}</TableCell>
                        <TableCell>{a.role}</TableCell>
                        <TableCell>
                          <StatusSelect
                            size="sm"
                            value={a.status}
                            disabled={busyId === a.id}
                            onChange={(next) => changeStatus(a.id, next)}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatTime(a.applied_at)}</TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button asChild variant="outline" size="sm">
                              <Link to={href(`/applications/${a.id}`)} state={linkState}>
                                Details
                              </Link>
                            </Button>
                            {isHttp(a.url) && (
                              <Button asChild variant="ghost" size="sm">
                                <a href={a.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLinkIcon />
                                  Open posting
                                </a>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
