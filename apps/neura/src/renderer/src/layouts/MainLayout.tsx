import { Outlet } from 'react-router';
import type { CSSProperties } from 'react';

import { AppSidebar } from '@/renderer/src/components/SideBar/app-sidebar';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';

export function MainLayout() {
  const sidebarStyle = {
    '--sidebar-width': '20rem',
    '--sidebar-width-icon': '64px',
  } as CSSProperties;

  return (
    <SidebarProvider
      style={sidebarStyle}
      className="neura-shell relative flex h-screen w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <SidebarInset className="relative z-10 flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="neura-topbar h-11 shrink-0 border-b border-white/[0.07]" />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
