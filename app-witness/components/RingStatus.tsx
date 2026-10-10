import AppLink from "@/components/AppLink";
import { linkClass } from "@/lib/ui/styles";

export const PLAYGROUND_URL = "https://developer.amazon.com/ring/console/playground";

/** Connection state of the activity feed: live, or a calm prompt to reconnect an expired token. */
export default function RingStatus({
  source,
  needsReconnect,
}: {
  source: "ring" | "demo" | null;
  needsReconnect: boolean;
}) {
  if (needsReconnect) {
    return (
      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Reconnect Ring</p>
        <p className="mt-1 text-sm">
          The Ring connection has expired. Get a fresh token from the{" "}
          <a href={PLAYGROUND_URL} target="_blank" rel="noreferrer" className={linkClass}>
            Ring Developer Playground
          </a>{" "}
          and paste it in{" "}
          <AppLink href="/settings" className={linkClass}>
            Settings
          </AppLink>
          .
        </p>
      </div>
    );
  }
  if (source === "ring") {
    return <p className="text-sm text-stone-600">Connected to your Ring doorbell.</p>;
  }
  return null;
}
