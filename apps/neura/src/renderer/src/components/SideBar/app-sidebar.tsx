/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useState, type ComponentProps } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  BookOpen,
  Cable,
  FolderClock,
  LayoutDashboard,
  PanelsTopLeft,
  PencilLine,
} from 'lucide-react';
import { FolderKanban } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
    } else if (pendingAction === 'connectors') {
      await goConnectors();
    } else if (pendingAction === 'canvas') {
      await goCanvas();
    } else if (pendingAction?.type === 'session') {
      await onSessionClick(pendingAction.id);
    }
    setPendingAction(null);
    setNavDialogOpen(false);
  }, [pendingAction, goHome, onSessionClick]);

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
        className="select-none border-r border-[#2a2a2a] bg-[#0a0a0a]"
        {...props}
      >
        <DragArea></DragArea>
        <SidebarHeader>
          <NeuraHeader showTrigger={location.pathname === '/'} />
          <SidebarMenu className="items-center">
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={goHome}
            >
              <LayoutDashboard />
              Agent Workspace
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg border border-blue-400/20 bg-blue-500/10 font-medium text-blue-100 hover:bg-blue-500/15 hover:text-white"
              onClick={handleHomeClick}
            >
              <PencilLine />
              New task
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={handleDashboardClick}
            >
              <FolderClock />
              Queue
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={handleSkillsClick}
            >
              <BookOpen />
              Skills
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={handleConnectorsClick}
            >
              <Cable />
              Connectors
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={handleProjectsClick}
            >
              <FolderKanban />
              Projects
            </SidebarMenuButton>
            <SidebarMenuButton
              className="rounded-lg font-medium text-white/85 hover:bg-white/8 hover:text-white"
              onClick={handleCanvasClick}
            >
              <PanelsTopLeft />
              Canvas
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
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
