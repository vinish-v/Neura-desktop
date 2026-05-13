import { Bell, ChevronDown, Sparkles } from 'lucide-react';
import { Outlet, useLocation } from 'react-router';
import type { CSSProperties } from 'react';

import { AppSidebar } from '@/renderer/src/components/SideBar/app-sidebar';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
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
  const title =
    taskState?.status === 'running'
      ? taskState.originalGoal
      : routeTitle[location.pathname] || 'Neura';
  const sidebarStyle = {
    '--sidebar-width': '23.5rem',
    '--sidebar-width-icon': '64px',
  } as CSSProperties;

  return (
    <SidebarProvider
      style={sidebarStyle}
      className="neura-shell relative flex h-screen w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <SidebarInset className="relative z-10 flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/10 bg-[#1a1a1a] px-7">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[22px] font-semibold text-white">
            <span className="truncate">
              {title === 'Agent Workspace' ? 'Neura 1.6 Lite' : title}
            </span>
            {title === 'Agent Workspace' ? (
              <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-white/55" />
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#202020] text-white/80 transition hover:bg-white/10 hover:text-white">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-red-500" />
            </button>
            <button className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-[#202020] px-4 text-sm font-semibold text-white transition hover:bg-white/10">
              <Sparkles className="h-4 w-4" />
              300
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
