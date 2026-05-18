/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useState, type ComponentProps } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Bot,
  BookOpen,
  Cable,
  Clock3,
  FolderPlus,
  Library,
  Search,
  PencilLine,
  SlidersHorizontal,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from '@renderer/components/ui/sidebar';
import { DragArea } from '@renderer/components/Common/drag';
import { useSession } from '@renderer//hooks/useSession';

import { NavHistory } from './nav-history';
import { NavSettings } from './nav-footer';
import { NeuraHeader } from './nav-header';

import { Operator } from '@main/store/types';
import { useGlobalSettings, GlobalSettings } from '../Settings/global';
import { useStore } from '../../hooks/useStore';
import { StatusEnum } from '@neura-desktop/sdk';
import { NavDialog } from '../AlertDialog/navDialog';
import { api } from '../../api';

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const {
    currentSessionId,
    sessions,
    getSession,
    deleteSession,
    setActiveSession,
  } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { openSettings } = useGlobalSettings();
  const { status } = useStore();
  const [isNavDialogOpen, setNavDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | 'home'
    | 'projects'
    | 'skills'
    | 'dashboard'
    | 'scheduled'
    | 'connectors'
    | 'canvas'
    | { type: 'session'; id: string }
    | null
  >(null);

  const needsConfirm =
    status === StatusEnum.RUNNING ||
    status === StatusEnum.CALL_USER ||
    status === StatusEnum.PAUSE;

  const goHome = useCallback(async () => {
    await navigate('/');
    await setActiveSession('');
  }, [navigate, setActiveSession]);

  const onSessionClick = useCallback(
    async (sessionId: string) => {
      const session = await getSession(sessionId);
      if (!session) return;

      const operator = session.meta.operator || Operator.LocalComputer;
      navigate('/local', {
        state: {
          operator,
          sessionId,
          isFree: session.meta.isFree ?? true,
          from: 'history',
        },
      });
    },
    [getSession, navigate],
  );

  const handleHomeClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('home');
      setNavDialogOpen(true);
    } else {
      goHome();
    }
  }, [needsConfirm]);

  const goProjects = useCallback(async () => {
    await navigate('/projects');
  }, [navigate]);

  const handleProjectsClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('projects');
      setNavDialogOpen(true);
    } else {
      goProjects();
    }
  }, [needsConfirm, goProjects]);

  const goSkills = useCallback(async () => {
    await navigate('/skills');
  }, [navigate]);

  const handleSkillsClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('skills');
      setNavDialogOpen(true);
    } else {
      goSkills();
    }
  }, [needsConfirm, goSkills]);

  const goDashboard = useCallback(async () => {
    await navigate('/dashboard');
  }, [navigate]);

  const handleDashboardClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('dashboard');
      setNavDialogOpen(true);
    } else {
      goDashboard();
    }
  }, [needsConfirm, goDashboard]);

  const goScheduled = useCallback(async () => {
    await navigate('/scheduled');
  }, [navigate]);

  const handleScheduledClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('scheduled');
      setNavDialogOpen(true);
    } else {
      goScheduled();
    }
  }, [needsConfirm, goScheduled]);

  const goConnectors = useCallback(async () => {
    await navigate('/connectors');
  }, [navigate]);

  const handleConnectorsClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('connectors');
      setNavDialogOpen(true);
    } else {
      goConnectors();
    }
  }, [needsConfirm, goConnectors]);

  const goCanvas = useCallback(async () => {
    await navigate('/canvas');
  }, [navigate]);

  const handleCanvasClick = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('canvas');
      setNavDialogOpen(true);
    } else {
      goCanvas();
    }
  }, [needsConfirm, goCanvas]);

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      if (needsConfirm) {
        setPendingAction({ type: 'session', id: sessionId });
        setNavDialogOpen(true);
      } else {
        onSessionClick(sessionId);
      }
    },
    [needsConfirm],
  );

  const onConfirm = useCallback(async () => {
    await api.stopRun();
    await api.clearHistory();

    if (pendingAction === 'home') {
      await goHome();
    } else if (pendingAction === 'projects') {
      await goProjects();
    } else if (pendingAction === 'skills') {
      await goSkills();
    } else if (pendingAction === 'dashboard') {
      await goDashboard();
    } else if (pendingAction === 'scheduled') {
      await goScheduled();
    } else if (pendingAction === 'connectors') {
      await goConnectors();
    } else if (pendingAction === 'canvas') {
      await goCanvas();
    } else if (pendingAction?.type === 'session') {
      await onSessionClick(pendingAction.id);
    }
    setPendingAction(null);
    setNavDialogOpen(false);
  }, [
    pendingAction,
    goHome,
    goProjects,
    goSkills,
    goDashboard,
    goScheduled,
    goConnectors,
    goCanvas,
    onSessionClick,
  ]);

  const onCancel = useCallback(() => {
    setPendingAction(null);
    setNavDialogOpen(false);
  }, []);

  const onSessionDelete = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId);
      if (currentSessionId === sessionId) {
        goHome();
      }
    },
    [currentSessionId, deleteSession, goHome],
  );

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="select-none border-r border-white/[0.075] bg-[#050607]/96"
        {...props}
      >
        <DragArea></DragArea>
        <SidebarHeader className="px-3 py-4">
          <NeuraHeader showTrigger={location.pathname === '/'} />
          <SidebarMenu className="items-center gap-1.5">
            <SidebarMenuButton
              className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.065] text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.1] hover:text-white"
              onClick={handleHomeClick}
            >
              <PencilLine />
              New task
            </SidebarMenuButton>
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleDashboardClick}
            >
              <Bot />
              Agent
              <span className="ml-1 rounded-md border border-cyan-300/15 bg-cyan-300/10 px-1.5 py-0.5 text-xs text-cyan-200">
                New
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleScheduledClick}
            >
              <Clock3 />
              Scheduled
            </SidebarMenuButton>
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleDashboardClick}
            >
              <Search />
              Search
            </SidebarMenuButton>
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleSkillsClick}
            >
              <Library />
              Library
            </SidebarMenuButton>
          </SidebarMenu>
          <SidebarGroup className="mt-7 p-0">
            <SidebarGroupLabel className="px-2 text-[12px] uppercase tracking-[0.14em] text-white/36">
              Projects
            </SidebarGroupLabel>
            <SidebarGroupAction
              className="right-2 top-1 text-muted-foreground hover:text-white"
              onClick={handleProjectsClick}
            >
              +
            </SidebarGroupAction>
            <SidebarMenu className="mt-2">
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleProjectsClick}
            >
              <FolderPlus />
              New project
            </SidebarMenuButton>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="mt-5 p-0">
            <SidebarGroupLabel className="px-2 text-[12px] uppercase tracking-[0.14em] text-white/36">
              Tools
            </SidebarGroupLabel>
            <SidebarMenu className="mt-2">
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleCanvasClick}
            >
              <BookOpen />
              Canvas
            </SidebarMenuButton>
            <SidebarMenuButton
              className="h-10 rounded-xl text-[15px] font-medium text-white/76 hover:bg-white/[0.065] hover:text-white"
              onClick={handleConnectorsClick}
            >
              <Cable />
              Connectors
            </SidebarMenuButton>
          </SidebarMenu>
          </SidebarGroup>
        </SidebarHeader>
        <SidebarContent className="px-1">
          <SidebarGroup className="px-2 pb-0 pt-1">
            <SidebarGroupLabel className="px-0 text-[12px] uppercase tracking-[0.14em] text-white/36">
              All tasks
            </SidebarGroupLabel>
            <SidebarGroupAction className="right-2 top-2 text-muted-foreground hover:text-white">
              <SlidersHorizontal />
            </SidebarGroupAction>
          </SidebarGroup>
          <NavHistory
            currentSessionId={currentSessionId}
            history={sessions}
            onSessionClick={handleSessionClick}
            onSessionDelete={onSessionDelete}
          />
        </SidebarContent>
        <SidebarFooter className="p-0">
          <NavSettings onClick={openSettings} />
        </SidebarFooter>
      </Sidebar>
      <GlobalSettings />
      <NavDialog
        open={isNavDialogOpen}
        onOpenChange={onCancel}
        onConfirm={onConfirm}
      />
    </>
  );
}
