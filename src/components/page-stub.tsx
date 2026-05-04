import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A single-card stub for the 8 dashboard views during Phase 6. Each view's
 * Phase 7 implementation replaces this with the real layout.
 *
 * Including the Phase 7 sub-phase reference so it's clear which BUILD_PLAN
 * task fills it in.
 */

export interface PageStubProps {
  title: string;
  description: string;
  phaseRef: string;
  whatGoesHere: React.ReactNode;
  icon?: React.ReactNode;
}

export function PageStub({ title, description, phaseRef, whatGoesHere, icon }: PageStubProps) {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting Phase 7 implementation</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={icon}
            title={`This view is built in ${phaseRef}`}
            description={whatGoesHere}
          />
        </CardContent>
      </Card>
    </div>
  );
}
