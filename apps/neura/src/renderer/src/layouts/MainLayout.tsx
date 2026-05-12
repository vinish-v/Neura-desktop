import { Search } from 'lucide-react';
import { Outlet, useLocation } from 'react-router';

import { AppSidebar } from '@/renderer/src/components/SideBar/app-sidebar';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
import { useSetting } from '@renderer/hooks/useSetting';
import { useStore } from '@renderer/hooks/useStore';

const routeTitle: Record<string, string> = {
  '/': 'Agent Workspace',
  '/local': 'New Task',
  '/dashboard': 'Agent Workspace',
  '/skills': 'Skills',
  '/connectors': 'Connectors',
  '/projects': 'Projects',
  '/canvas': 'Canvas',
};

export function MainLayout() {
  const location = useLocation();
  const { taskState } = useStore();
  const { settings } = useSetting();
  const title =
    taskState?.status === 'running'
      ? taskState.originalGoal
      : routeTitle[location.pathname] || 'Neura';
  const model = settings.plannerModelName || settings.vlmModelName || 'Model';

  return (
    <SidebarProvider
      style={{ '--sidebar-width-icon': '72px' }}
      className="neura-shell relative flex h-screen w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <SidebarInset className="relative z-10 flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-[#0a0a0a]/95 px-5">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-white">
            {title}
          </div>
          <div className="flex items-center gap-3">
            <button className="hidden h-8 items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#111] px-3 text-xs text-muted-foreground transition hover:border-blue-400/40 hover:text-white md:flex">
              <Search className="h-3.5 w-3.5" />
              Search
              <span className="text-[#666]">Ctrl K</span>
            </button>
            <div className="max-w-[220px] truncate rounded-md border border-[#2a2a2a] bg-[#111] px-3 py-1.5 text-xs text-muted-foreground">
              {model}
            </div>
            <div className="h-7 w-7 rounded-full border border-[#2a2a2a] bg-[#171717]" />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
