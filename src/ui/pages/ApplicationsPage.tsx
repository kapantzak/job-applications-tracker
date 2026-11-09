import { useEffect, useState } from 'react';
import { ExternalLinkIcon, MailIcon, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../../server/domain/types.js';
import { listApplications, setApplicationStatus, startSync } from '../api/client.js';
import { AddApplicationForm } from '../components/AddApplicationForm.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { NoMatches, SortableHead, TableToolbar } from '../components/TableView.js';
import { formatTime } from '../format.js';
import { useListLinkState, useTableView } from '../hooks/use-table-view.js';
import { STATUS_LABELS } from '../labels.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { type ColumnDef, orderIndex } from '../table-view.js';
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

const COLUMNS: ColumnDef<Application>[] = [
  {
    id: 'company',
    label: 'Company',
    sortValue: (a) => a.company,
    searchText: (a) => a.company,
    filter: { kind: 'values', value: (a) => a.company },
  },
  {
    id: 'role',
    label: 'Role',
    sortValue: (a) => a.role,
    searchText: (a) => a.role,
    filter: { kind: 'text', value: (a) => a.role },
  },
  {
    id: 'status',
    label: 'Status',
    sortValue: (a) => orderIndex(APPLICATION_STATUSES, a.status),
    filter: {
      kind: 'values',
      value: (a) => a.status,
      order: APPLICATION_STATUSES,
      optionLabel: (v) => STATUS_LABELS[v as ApplicationStatus] ?? v,
    },
  },
  {
    id: 'applied',
    label: 'Applied',
    sortValue: (a) => a.applied_at,
    filter: { kind: 'date', value: (a) => a.applied_at },
  },
];
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
  const view = useTableView(COLUMNS, apps ?? NO_APPS);
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
        description="Every application you are tracking. Mail sync proposes status changes for review."
        actions={
          <>
            <Button type="button" variant="outline" disabled={syncing} onClick={sync}>
              <MailIcon />
              Sync from Gmail
            </Button>
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
