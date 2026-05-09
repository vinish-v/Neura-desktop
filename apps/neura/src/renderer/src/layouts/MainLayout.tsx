import { Outlet } from 'react-router';
import { AppSidebar } from '@/renderer/src/components/SideBar/app-sidebar';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';

export function MainLayout() {
  return (
    <SidebarProvider
      style={{ '--sidebar-width-icon': '72px' }}
      className="neura-shell relative flex h-screen w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <SidebarInset className="relative z-10 flex-1 bg-transparent">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
