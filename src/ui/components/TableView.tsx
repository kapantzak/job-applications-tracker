import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, ListFilterIcon, XIcon } from 'lucide-react';
import type { DateRange as DayRange } from 'react-day-picker';
import type { TableView } from '../hooks/use-table-view.js';
import {
  canonicalText,
  type ColumnDef,
  type DateRange,
  dateRangeLabel,
  type FilterValue,
  facetOptions,
  fromIsoDay,
  toIsoDay,
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

function summary<Row>(column: ColumnDef<Row>, value: FilterValue, rows: Row[]): string {
  if (Array.isArray(value)) {
    if (value.length !== 1) return `${value.length} selected`;
    return facetOptions(rows, column, value).find((o) => o.value === value[0])?.label ?? value[0]!;
  }
  if (typeof value === 'string') return `“${value.trim()}”`;
  return dateRangeLabel(value);
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

function DateFilter<Row>({ view, column }: { view: TableView<Row>; column: ColumnDef<Row> }) {
  const range = view.state.filters[column.id] as DateRange | undefined;
  const selected: DayRange | undefined = range && {
    from: range.from ? fromIsoDay(range.from) : undefined,
    to: range.to ? fromIsoDay(range.to) : undefined,
  };
  const onSelect = (next: DayRange | undefined, day: Date) => {
    // DayPicker clears a range that has only an end (an "Until" range from the URL); add the start instead.
    if (range && !range.from && range.to) {
      const picked = toIsoDay(day);
      view.setFilter(column.id, picked <= range.to ? { from: picked, to: range.to } : { from: range.to, to: picked });
      return;
    }
    view.setFilter(
      column.id,
      next?.from ? { from: toIsoDay(next.from), to: next.to ? toIsoDay(next.to) : null } : null,
    );
  };
  return (
    <div className="flex flex-col">
      <Calendar mode="range" selected={selected} onSelect={onSelect} defaultMonth={selected?.from ?? selected?.to} />
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-xs text-muted-foreground">Pick the first day, then the last.</p>
        {range && (
          <Button type="button" variant="ghost" size="sm" onClick={() => view.setFilter(column.id, null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function ColumnFilter<Row>({ view, column }: { view: TableView<Row>; column: ColumnDef<Row> }) {
  const value = view.state.filters[column.id];
  const kind = column.filter!.kind;
  const name = `Filter by ${column.label.toLowerCase()}`;
  const current = value === undefined ? undefined : summary(column, value, view.rows);
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
          {column.label}
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
        className={kind === 'date' ? 'w-auto p-0' : 'w-64 p-2'}
      >
        {kind === 'values' && <ValuesFilter view={view} column={column} />}
        {kind === 'text' && <TextFilter view={view} column={column} />}
        {kind === 'date' && <DateFilter view={view} column={column} />}
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
          .map((c) => (
            <ColumnFilter key={c.id} view={view} column={c} />
          ))}
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
