import type { ReactNode } from 'react';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Keeps role="alert" so failures stay announced and testable.
export function ErrorAlert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlertIcon />
      <AlertDescription className="text-destructive">{children}</AlertDescription>
    </Alert>
  );
}

// Success feedback is a polite status, not an alert.
export function SuccessMessage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn('flex items-center gap-1.5 text-sm text-success', className)}>
      <CircleCheckIcon className="size-4" />
      {children}
    </p>
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Loading...</span>
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
