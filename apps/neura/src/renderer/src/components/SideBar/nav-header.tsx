/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarTrigger,
} from '@renderer/components/ui/sidebar';

import logoVector from '@resources/logo-vector.png?url';

interface HeaderProps {
  showTrigger: boolean;
}

export function NeuraHeader({ showTrigger }: HeaderProps) {
  return (
    <SidebarMenu className="items-center">
      <SidebarMenuButton
        // size="lg"
        className="group-data-[collapsible=icon]:p-0! mb-4 h-14 rounded-2xl data-[state=open]:bg-white/8 data-[state=open]:text-white hover:bg-white/6"
      >
        <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-white shadow-[0_0_34px_rgba(45,212,191,0.2)]">
          <img src={logoVector} alt="Neura" className="rounded-xl" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate text-lg font-semibold tracking-normal text-white">
            Neura
          </span>
          <span className="truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Agent Operations
          </span>
        </div>
      </SidebarMenuButton>
      {showTrigger && (
        <SidebarTrigger className="absolute top-12 right-2 group-data-[collapsible=icon]:right-[-36px]" />
      )}
    </SidebarMenu>
  );
}
