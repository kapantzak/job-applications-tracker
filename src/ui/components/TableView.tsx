import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, ListFilterIcon, XIcon } from 'lucide-react';
import type { TableView } from '../hooks/use-table-view.js';
import {
  canonicalText,
  type ColumnDef,
  type DateBound,
  type DateRange,
  dayLabel,
  type FilterValue,
  facetOptions,
  fromIsoDay,
  toIsoDay,
  withDateBound,
} from '../table-view.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { TableHead } from '@/components/ui/table';

// The checklist gets its own search box once it is too long to scan.
const FIND_THRESHOLD = 8;

// BrowserRouter applies URL changes in a transition, and an input controlled by a transition resets
// while typing (caret jumps, lost keys, broken IME). The box keeps its own draft and only follows the
// URL when it changes from elsewhere, such as Reset.
function DraftInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: string; onValueChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // URL values this box has sent and not yet seen come back, in canonical form.
  const sent = useRef<string[]>([]);
  useEffect(() => {
    const echoed = sent.current.indexOf(value);
    if (echoed !== -1) {
      sent.current = sent.current.slice(echoed + 1);
      return;
    }
    sent.current = [];
    setDraft(value);
  }, [value]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        sent.current.push(canonicalText(e.target.value));
        onValueChange(e.target.value);
      }}
    />
  );
}

export function SortableHead<Row>({
  view,
  id,
  className,
  children,
}: {
  view: TableView<Row>;
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const sort = view.state.sort?.id === id ? view.state.sort : null;
  const Icon = !sort ? ChevronsUpDownIcon : sort.desc ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead className={className} aria-sort={!sort ? 'none' : sort.desc ? 'descending' : 'ascending'}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2.5 h-8" onClick={() => view.toggleSort(id)}>
        {children}
        <Icon aria-hidden="true" className={sort ? undefined : 'text-muted-foreground'} />
      </Button>
    </TableHead>
  );
}

// A date filter shows only its own end; undefined while that end is open.
function summary<Row>(column: ColumnDef<Row>, value: FilterValue, rows: Row[], bound?: DateBound): string | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 1) return `${value.length} selected`;
    return facetOptions(rows, column, value).find((o) => o.value === value[0])?.label ?? value[0]!;
  }
  if (typeof value === 'string') return `“${value.trim()}”`;
  const day = bound ? value[bound] : null;
  return day ? dayLabel(day) : undefined;
}

function ValuesFilter<Row>({ view, column }: { view: TableView<Row>; column: ColumnDef<Row> }) {
  const id = useId();
  const [find, setFind] = useState('');
  const selected = (view.state.filters[column.id] as string[] | undefined) ?? [];
  const options = facetOptions(view.rows, column, selected);
  const needle = find.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const toggle = (value: string, on: boolean) =>
    view.setFilter(column.id, on ? [...selected, value] : selected.filter((v) => v !== value));
  return (
    <div className="flex flex-col gap-2">
      {options.length > FIND_THRESHOLD && (
        <Input
          aria-label={`Find ${column.label.toLowerCase()}`}
          placeholder="Find…"
          className="h-8"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      )}
      <div role="group" aria-label={column.label} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {shown.map((o, i) => (
          <div key={o.value} className="flex items-center gap-2 rounded-sm px-1 py-1">
            <Checkbox
              id={`${id}-${i}`}
              checked={selected.includes(o.value)}
              onCheckedChange={(v) => toggle(o.value, v === true)}
            />
            <Label htmlFor={`${id}-${i}`} className="flex-1 truncate font-normal">
              {o.label}
            </Label>
            <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>
          </div>
        ))}
        {shown.length === 0 && <p className="px-1 py-1 text-sm text-muted-foreground">No matching values</p>}
      </div>
      {selected.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => view.setFilter(column.id, null)}>
          Clear
        </Button>
      )}
    </div>
  );
}

function TextFilter<Row>({ view, column }: { view: TableView<Row>; column: ColumnDef<Row> }) {
  const value = (view.state.filters[column.id] as string | undefined) ?? '';
  return (
    <div className="flex flex-col gap-2">
      <DraftInput
        aria-label={`${column.label} contains`}
        placeholder="Contains…"
        className="h-8"
        autoFocus
        value={value}
        onValueChange={(v) => view.setFilter(column.id, v)}
      />
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => view.setFilter(column.id, null)}>
          Clear
        </Button>
      )}
    </div>
  );
}

function DateFilter<Row>({ view, column, bound }: { view: TableView<Row>; column: ColumnDef<Row>; bound: DateBound }) {
  const range = view.state.filters[column.id] as DateRange | undefined;
  const day = range?.[bound] ?? null;
  const other = (bound === 'from' ? range?.to : range?.from) ?? null;
  const selected = day ? fromIsoDay(day) : undefined;
  // The other end limits this calendar, so the range can never be reversed.
  const disabled = other ? (bound === 'from' ? { after: fromIsoDay(other) } : { before: fromIsoDay(other) }) : undefined;
  const set = (next: string | null) => view.setFilter(column.id, withDateBound(range, bound, next));
  return (
    <div className="flex flex-col">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(next) => set(next ? toIsoDay(next) : null)}
        disabled={disabled}
        defaultMonth={selected ?? (other ? fromIsoDay(other) : undefined)}
      />
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-xs text-muted-foreground">{bound === 'from' ? 'This day and later.' : 'This day and earlier.'}</p>
        {day && (
          <Button type="button" variant="ghost" size="sm" onClick={() => set(null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// A date column gets two of these, one per `bound`.
function ColumnFilter<Row>({ view, column, bound }: { view: TableView<Row>; column: ColumnDef<Row>; bound?: DateBound }) {
  const value = view.state.filters[column.id];
  const kind = column.filter!.kind;
  const label = bound ? `${column.label} ${bound}` : column.label;
  const name = `Filter by ${label.toLowerCase()}`;
  const current = value === undefined ? undefined : summary(column, value, view.rows, bound);
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Named apart from the header's sort button, which shows the same column label. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-dashed"
          aria-label={current ? `${name}: ${current}` : name}
        >
          <ListFilterIcon aria-hidden="true" />
          {label}
          {current && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <Badge variant="secondary" className="max-w-48 truncate rounded-sm px-1 font-normal">
                {current}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={name}
        // Value lists grow with their labels (search start times, SOW-0040) up to a cap, then truncate.
        className={kind === 'date' ? 'w-auto p-0' : kind === 'values' ? 'w-auto min-w-64 max-w-sm p-2' : 'w-64 p-2'}
      >
        {kind === 'values' && <ValuesFilter view={view} column={column} />}
        {kind === 'text' && <TextFilter view={view} column={column} />}
        {kind === 'date' && bound && <DateFilter view={view} column={column} bound={bound} />}
      </PopoverContent>
    </Popover>
  );
}

// `noun` is the plural shown to the user ("jobs"); `note` adds a line such as a load limit.
export function TableToolbar<Row>({ view, noun, note }: { view: TableView<Row>; noun: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={`Filter ${noun}`} className="flex flex-wrap items-center gap-2">
        <DraftInput
          type="search"
          aria-label={`Search ${noun}`}
          placeholder="Search…"
          className="h-8 w-56"
          value={view.state.q}
          onValueChange={view.setQuery}
        />
        {view.columns
          .filter((c) => c.filter)
          .flatMap((c) =>
            c.filter!.kind === 'date'
              ? (['from', 'to'] as const).map((bound) => <ColumnFilter key={`${c.id}-${bound}`} view={view} column={c} bound={bound} />)
              : [<ColumnFilter key={c.id} view={view} column={c} />],
          )}
        {view.filtered && (
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={view.reset}>
            Reset
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Showing {view.visible.length} of {view.rows.length} {noun}
        {note ? `. ${note}` : ''}
      </p>
    </div>
  );
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>No rows match your filters</EmptyTitle>
        <EmptyDescription>Change the search or filters, or clear them.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}
