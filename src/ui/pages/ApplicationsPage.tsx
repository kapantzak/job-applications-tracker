import { useEffect, useState } from 'react';
import { ExternalLinkIcon, MailIcon, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Application, ApplicationStatus } from '../../server/domain/types.js';
import { listApplications, setApplicationStatus, startSync } from '../api/client.js';
import { APPLICATION_COLUMNS, applicationViewKey } from '../application-view.js';
import { AddApplicationForm } from '../components/AddApplicationForm.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { InfoTip } from '../components/InfoTip.js';
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
  // Shared with the Dashboard and saved per profile (SOW-0054).
  const view = useSharedTableView(APPLICATION_COLUMNS, apps ?? NO_APPS, applicationViewKey(profileId));
  const linkState = useListLinkState();

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
            {view.visible.length === 0 ? (
              <NoMatches onClear={view.reset} />
            ) : (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead view={view} id="company" className="pl-4">
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
                        <TableCell className="pl-4 font-medium">{a.company}</TableCell>
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
