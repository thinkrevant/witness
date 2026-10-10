import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * In-app link that replaces the current history entry instead of adding one. The app then
 * holds a single entry in the browser's Back history, so after a quick exit (which replaces
 * that entry with the weather site) Back cannot return to any page of the app.
 */
export default function AppLink(props: ComponentProps<typeof Link>) {
  return <Link replace {...props} />;
}
