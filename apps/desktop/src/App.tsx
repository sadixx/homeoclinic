// Root application component: mounts the app shell (which owns routing).
import { AppShell } from '@/app/AppShell';

export function App(): JSX.Element {
  return <AppShell />;
}
