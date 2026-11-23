import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ForbiddenError, fetchOpsStatus } from '@/lib/api';

export const Route = createFileRoute('/_authed/')({ component: OpsDashboard });

function OpsDashboard() {
  const status = useQuery({
    queryKey: ['ops-status'],
    queryFn: fetchOpsStatus,
    refetchInterval: 15_000,
  });

  if (status.error instanceof ForbiddenError) {
    return (
      <Alert>
        <AlertDescription>You do not have access to operations status.</AlertDescription>
      </Alert>
    );
  }
  if (status.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load operations status.</AlertDescription>
      </Alert>
    );
  }
  if (!status.data) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Operations status</h1>
      <Card>
        <CardHeader>
          <CardTitle>Queues</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Delayed</TableHead>
                <TableHead>Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.data.queues.map((queue) => (
                <TableRow key={queue.name}>
                  <TableCell>{queue.name}</TableCell>
                  <TableCell>{queue.waiting}</TableCell>
                  <TableCell>{queue.active}</TableCell>
                  <TableCell>{queue.delayed}</TableCell>
                  <TableCell>{queue.failed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
        </CardHeader>
        <CardContent>
          {status.data.workers.length === 0 ? (
            <p className="text-sm">No worker has reported a heartbeat yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Instance</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.workers.map((worker) => (
                  <TableRow key={`${worker.workerGroup}:${worker.instanceId}`}>
                    <TableCell>{worker.workerGroup}</TableCell>
                    <TableCell>{worker.instanceId}</TableCell>
                    <TableCell>{new Date(worker.lastSeenAt).toLocaleString()}</TableCell>
                    <TableCell>{worker.stale ? 'Stale' : 'Healthy'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
